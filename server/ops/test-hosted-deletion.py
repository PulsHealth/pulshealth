#!/usr/bin/env python3
"""Explicit opt-in live smoke test: two new synthetic users only, no email.

Creates personal and self-service fixtures, exercises real HTTP pairing/ingest/
deletion, and verifies removal. Never reads another user's health records.
Run on the host with --synthetic. Failed cleanup is reported, never hidden.
"""
import base64
import hashlib
import http.client
import importlib.util
import json
from pathlib import Path
import secrets
import sys
import time
from urllib.parse import parse_qs, urlencode, urlsplit
from uuid import uuid4

spec = importlib.util.spec_from_file_location('hosted_check', Path(__file__).with_name('hosted-check.py'))
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


def main():
    if sys.argv[1:] != ['--synthetic']:
        raise RuntimeError('requires --synthetic; creates and deletes only new test users')
    cid = ops.command(ops.COMPOSE + ['ps', '-q', 'web'])
    data = json.loads(ops.command(['docker', 'inspect', cid]))[0]
    env = dict(item.split('=', 1) for item in data['Config']['Env'])
    origin = env['WEB_PUBLIC_URL'].rstrip('/')
    host = urlsplit(origin).netloc
    port = int(data['NetworkSettings']['Ports']['3000/tcp'][0]['HostPort'])
    ingest_id = ops.command(ops.COMPOSE + ['ps', '-q', 'ingest'])
    ingest = json.loads(ops.command(['docker', 'inspect', ingest_id]))[0]
    ingest_port = int(ingest['NetworkSettings']['Ports']['8080/tcp'][0]['HostPort'])

    def request(path, cookie=None, body=None, ingest_request=False, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', ingest_port if ingest_request else port, timeout=30)
        all_headers = {'Host': host, 'X-Forwarded-Host': host, 'X-Forwarded-Proto': 'https', 'Origin': origin}
        if cookie:
            all_headers['Cookie'] = '__Host-puls-session=' + cookie
        if body is not None:
            all_headers['Content-Type'] = 'application/x-www-form-urlencoded'
        all_headers.update(headers or {})
        connection.request('GET' if body is None else 'POST', path, body=body, headers=all_headers)
        response = connection.getresponse()
        result = (response.status, response.getheader('Location', ''), response.read().decode())
        connection.close()
        return result

    fixtures = []
    completed = 0
    try:
        for eligibility in ('personal_users', 'self_service_users'):
            user, account = str(uuid4()), str(uuid4())
            raw = secrets.token_bytes(32)
            cookie = base64.urlsafe_b64encode(raw).decode().rstrip('=')
            digest = hashlib.sha256(raw).hexdigest()
            fixtures.append(user)
            # IDs, hash and reserved .invalid address are generated here, never user input.
            ops.sql(f"""BEGIN;
INSERT INTO users(id,name) VALUES ('{user}','Synthetic launch check');
INSERT INTO auth.accounts(id,user_id,email,password_hash) VALUES ('{account}','{user}','{user}@launch.invalid','no-login-synthetic-fixture');
INSERT INTO auth.{eligibility}(user_id) VALUES ('{user}');
INSERT INTO auth.sessions(id,account_id,expires_at) VALUES (decode('{digest}','hex'),'{account}',now()+interval '10 minutes');
COMMIT;""")
            status, _, page = request('/account', cookie)
            assert status == 200 and 'Delete my account and data' in page, 'personal deletion unavailable'
            status, link, _ = request('/api/auth/connect-iphone', cookie, urlencode({'name': 'Synthetic launch check'}))
            assert status == 303 and link.startswith('puls://pair?'), 'pairing failed'
            pairing = parse_qs(urlsplit(link).query)
            assert pairing['user'][0] == user, 'pairing user mismatch'
            bearer = pairing['token'][0]
            now = int(time.time() * 1000)
            batch_id = str(uuid4())
            batch = '\n'.join(json.dumps(row) for row in [
                dict(batchID=batch_id, deviceID='synthetic-launch-check', type='HKQuantityTypeIdentifierHeartRate', reason='manual', exportedAt=now, schemaVersion=1, sampleCount=1, deletionCount=0),
                dict(uuid=str(uuid4()), type='HKQuantityTypeIdentifierHeartRate', kind='quantity', start=now, end=now, value=70, unit='count/min')
            ]) + '\n'
            headers = {'Authorization': 'Bearer ' + bearer, 'X-User-ID': user, 'Content-Type': 'application/x-ndjson', 'X-Puls-Protocol': '1', 'X-Batch-ID': batch_id}
            status, _, body = request('/v1/batches', body=batch, ingest_request=True, headers=headers)
            assert status == 200 and json.loads(body)['accepted'] == 1, 'synthetic ingestion failed'
            mismatch = {**headers, 'X-User-ID': str(uuid4())}
            status, _, _ = request('/v1/batches', body=batch, ingest_request=True, headers=mismatch)
            assert status == 403, 'cross-user upload was accepted'
            status, receipt, _ = request('/api/auth/delete-account', cookie, 'confirm=yes')
            assert status == 303 and urlsplit(receipt).path.startswith('/deletion/'), 'deletion not accepted'
            receipt = urlsplit(receipt).path
            for _ in range(60):
                status, _, page = request(receipt)
                if status == 200 and 'Your account and health records have been removed from the live database.' in page:
                    break
                time.sleep(1)
            else:
                raise RuntimeError('deletion did not complete in smoke-test window')
            status, _, _ = request('/v1/batches', body=batch, ingest_request=True, headers=headers)
            assert status == 401, 'deleted sync token still accepted'
            status, location, _ = request('/account', cookie)
            assert status in (303, 307) and '/login' in location, 'deleted browser session still accepted'
            # Check every user_id table, including tables without a foreign key.
            # Receipt/tombstone retention is intentional and checked separately.
            verification = ops.sql(f"""DO $$ DECLARE r record; n bigint; BEGIN
FOR r IN SELECT table_schema,table_name FROM information_schema.columns
 WHERE column_name='user_id' AND table_schema IN ('public','auth')
 AND table_name NOT IN ('deletion_tombstones') LOOP
 EXECUTE format('SELECT count(*) FROM %I.%I WHERE user_id::text=$1',r.table_schema,r.table_name) INTO n USING '{user}';
 IF n<>0 THEN RAISE EXCEPTION 'synthetic user rows remain'; END IF;
END LOOP;
IF EXISTS(SELECT 1 FROM users WHERE id='{user}') THEN RAISE EXCEPTION 'synthetic user remains'; END IF;
IF NOT EXISTS(SELECT 1 FROM auth.deletion_tombstones WHERE user_id='{user}') THEN RAISE EXCEPTION 'missing tombstone'; END IF;
END $$;""")
            assert not verification or verification == 'DO'
            completed += 1
    finally:
        # If the HTTP flow failed, erase only this invocation's random fixtures
        # through the real authorized request + independent-ledger route. Do not
        # bypass erasure protections or touch any existing account.
        for user in fixtures:
            remaining = ops.sql(f"SELECT count(*) FROM users WHERE id='{user}';")
            if remaining != '0':
                print('FAIL: synthetic fixture remains; use the private run log to finish deletion', file=sys.stderr)
                # Keep identifiers only on private host stderr, never normal result.
                print('synthetic fixture UUID: ' + user, file=sys.stderr)
    assert completed == 2
    print('PASS: personal and self-service HTTP pairing, synthetic sync, cross-user refusal, completed erasure, revoked sessions/tokens, and zero remaining account/health rows')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('FAIL: hosted deletion check; inspect privately, no health data or credentials logged', file=sys.stderr)
        sys.exit(1)
