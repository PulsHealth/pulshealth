import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchReviews, checkReviews, reviewMail } from './app-store-reviews.mjs';

const review = (id, day = '20') => ({ id, rating: 5, title: 'Useful', body: 'A review', territory: 'USA', createdDate: `2026-10-${day}T12:00:00Z` });
const state = seen => ({ version: 1, appId: '123', seen, lastSuccessAt: 'previous' });

test('initial run baselines existing reviews; later runs send each new ID once', async () => {
  let stored = null;
  const sent = [];
  const run = reviews => checkReviews({ appId: '123', appName: 'Example', reviews, state: stored, save: v => { stored = v; }, send: m => { sent.push(m); return true; } });
  assert.deepEqual(await run([review('old')]), { baselined: 1, sent: 0 });
  assert.deepEqual(await run([review('new'), review('old')]), { baselined: 0, sent: 1 });
  assert.deepEqual(await run([review('new'), review('old')]), { baselined: 0, sent: 0 });
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /5-star/);
  assert.match(sent[0].text, /USA/);
});

test('failed delivery retains completed IDs and retries the unsent review', async () => {
  let stored = state([]);
  const run = send => checkReviews({ appId: '123', appName: 'Example', reviews: [review('second'), review('first', '19')], state: stored, save: v => { stored = v; }, send });
  let calls = 0;
  await assert.rejects(run(() => ++calls === 1), /not accepted/);
  assert.deepEqual(stored.seen, ['first']);
  assert.equal(stored.lastSuccessAt, 'previous');
  const messages = [];
  assert.equal((await run(m => { messages.push(m); return true; })).sent, 1);
  assert.equal(messages.length, 1);
  assert.deepEqual(stored.seen, ['first', 'second']);
});

test('bad or wrong-app state fails without sending or silently baselining', async () => {
  for (const invalid of [{ ...state([]), appId: '999' }, { version: 1 }]) {
    await assert.rejects(checkReviews({ appId: '123', state: invalid, save: () => assert.fail(), send: () => assert.fail() }), /Invalid review state/);
  }
});

test('message preserves review as plain text', () => {
  assert.match(reviewMail({ ...review('a'), body: '<script>untrusted</script>' }, 'Example').text, /<script>untrusted<\/script>/);
});

test('Apple pagination uses signed auth, validates results and rejects credential redirects', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-key-'));
  try {
    const path = join(dir, 'key.p8');
    writeFileSync(path, generateKeyPairSync('ec', { namedCurve: 'prime256v1', privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey, { mode: 0o600 });
    const env = { ASC_KEY_ID: 'test', ASC_ISSUER_ID: 'test', ASC_PRIVATE_KEY_PATH: path };
    const apiReview = id => ({ id, type: 'customerReviews', attributes: review(id) });
    const next = 'https://api.appstoreconnect.apple.com/v1/apps/123/customerReviews?cursor=next';
    let calls = 0;
    const result = await fetchReviews('123', env, async (url, options) => {
      assert.equal(options.redirect, 'error');
      assert.match(options.headers.Authorization, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
      calls++;
      return { ok: true, json: async () => ({ data: [apiReview(String(calls))], links: { next: calls === 1 ? next : null } }) };
    });
    assert.equal(result.length, 2);
    assert.equal(calls, 2);
    for (const badNext of ['https://example.com/leak', next.replace('/123/', '/999/'), 'https://api.appstoreconnect.apple.com/v1/apps/123/customerReviews?limit=200&sort=-createdDate']) {
      let n = 0;
      await assert.rejects(fetchReviews('123', env, async () => { n++; return { ok: true, json: async () => ({ data: [], links: { next: badNext } }) }; }), /Unexpected Apple pagination/);
      assert.equal(n, 1);
    }
    await assert.rejects(fetchReviews('123', env, async () => ({ ok: false, status: 403 })), /Apple HTTP 403/);
    await assert.rejects(fetchReviews('123', env, async () => ({ ok: true, json: async () => ({ data: [{ ...apiReview('x'), attributes: { rating: 5 } }] }) })), /Invalid Apple review/);
  } finally { rmSync(dir, { recursive: true }); }
});
