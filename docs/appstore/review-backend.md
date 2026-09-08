# Standing up a backend for App Review

App Review cannot exercise PulsHealth without a server, because the app has no
backend of its own. This is how the maintainer puts a **short-lived, throwaway,
publicly reachable** instance in front of a reviewer, and takes it down again.

Nothing here modifies [`scripts/bootstrap.sh`](../../scripts/bootstrap.sh) —
the review instance is an ordinary install of the reference stack, created the
same way a user creates theirs. That is the point: the reviewer exercises the
real thing.

## Rules for this instance

- **Empty.** Seed no personal data — not the maintainer's own history, not a
  friend's, not an anonymised copy of either. The reviewer's test device
  supplies whatever data flows, and that is all that should ever be in it.
- **Disposable.** Its own host (or at minimum its own Docker volume), created
  for this submission and destroyed after approval, volume included.
- **Not your production stack.** Never point review at the server holding your
  real health data. The credentials go into a form at Apple, and a bearer token
  is upload *and delete* access.
- **Rotated afterwards.** Even after the instance is gone, rotate the token, on
  the assumption that anything written into review notes may be retained.

## 1. A host the reviewer can reach

Apple's reviewers are not on your network, so the instance needs a public
HTTPS URL with a certificate a stock iPhone trusts. Any small Linux box with
Docker will do — a cheap VPS is the usual answer, and it is easy to delete.

Two paths, both documented in [`server/README.md`](../../server/README.md)
under "Exposing the server":

**A. A domain and a TLS-terminating reverse proxy.** Caddy, nginx, Traefik, or
a cloud tunnel in front of ingest on `127.0.0.1:8080`. Caddy with automatic
certificates is the shortest route if you already have a DNS name to point at
the box.

**B. Tailscale Funnel.** No domain and no certificate work of your own:

```bash
tailscale serve --bg --https=443 http://localhost:8080
tailscale funnel --bg 443
```

That publishes the ingest API on `https://<machine>.<your-tailnet>.ts.net` with
a certificate iOS trusts, reachable from the public internet. Convenient, but
remember that it *is* public and the token is then the only gate — which is
exactly why this instance must be disposable.

Either way, ingest itself stays on loopback. Do not use `--lan`
(`INGEST_BIND_ADDR=0.0.0.0`) for a review instance: that is the plain-HTTP
path, and the reviewer needs HTTPS.

## 2. Bring the stack up

On the review host, clone the repository at the exact revision you are
submitting and run the bootstrap script, telling it the public URL so the
pairing block and QR code carry that instead of a LAN address:

```bash
git clone https://github.com/PulsHealth/pulshealth.git
cd pulshealth
scripts/bootstrap.sh --build --url https://<the-public-url>
```

- `--url` is stored as `PULS_PUBLIC_URL` in `server/.env` and is what the
  pairing payload advertises. The script refuses a plain `http://` URL to a
  non-local host, which is the same rule the app enforces.
- `--build` builds the four images from the checkout. Keep it until the
  project's first tagged release publishes `ghcr.io/pulshealth/*`; before that
  the published images do not exist and a plain `scripts/bootstrap.sh` cannot
  pull them.
- The script creates `server/.env` if it is absent, generating every secret
  with `openssl rand -hex 32`, starts the stack, waits for ingest to answer
  `GET /healthz` and `GET /v1/capabilities`, and then prints the pairing block.
- It is safe to re-run. It never rewrites an existing `.env`.

You need `docker` with the Compose v2 plugin, `openssl` and `curl`. `qrencode`
is optional and irrelevant here — the reviewer types the values rather than
scanning, so `--no-qr` is fine.

## 3. Collect the three values

```bash
make pairing        # re-prints the pairing block, starts and changes nothing
```

It prints the payload `puls://pair?url=…&token=…&user=…`. Take from it:

| Review-notes placeholder | Where it comes from |
|---|---|
| `<<<REVIEW_SERVER_URL>>>` | the `url=` value — your public HTTPS URL |
| `<<<REVIEW_TOKEN>>>` | the `token=` value — `PULS_TOKEN` in `server/.env` |
| `<<<REVIEW_USER_ID>>>` | the `user=` value — `5ea4d000-0000-4000-8000-000000000001` unless you changed it |

Set `<<<REVIEW_EXPIRY>>>` to a date comfortably past the expected review, and
do not let the instance disappear before it.

## 4. Check it from outside

From a machine that is **not** on the review host's network — ideally over
cellular, which is closest to what a reviewer has:

```bash
curl -sS https://<the-public-url>/healthz
curl -sS -H "Authorization: Bearer <the-token>" https://<the-public-url>/v1/capabilities
```

The first should report `"ok":true`; the second should return the capability
JSON with HTTP 200. If either fails, the reviewer will fail too.

Then do the reviewer's own walkthrough end to end on a spare device, following
[`review-notes.md`](review-notes.md) exactly as written. A wrong step in the
notes costs a review cycle.

Useful while checking: `make logs` (add `ARGS=ingest` for one service),
`make ps`.

## 5. Paste into App Store Connect

Fill the placeholders in [`review-notes.md`](review-notes.md) and paste the
notes block into App Review Information → Notes. Keep the filled-in copy out
of the repository — it holds a live token.

## 6. Tear it down

After the app is approved (or the submission is abandoned):

```bash
cd pulshealth/server
docker compose down -v          # -v destroys the database volume as well
```

Then rotate the token even though the stack is gone, in case you reuse the
host:

1. Edit `PULS_TOKEN` in `server/.env` (or delete `server/.env` entirely if the
   host is being reused for nothing).
2. `docker compose up -d ingest` — only ingest reads that value.
3. `make pairing` prints the new one; any phone still paired with the old token
   must be re-paired.

Finally, delete the VPS, or at least stop the tunnel: `tailscale funnel --https=443 off`
if you used path B.

## Anticipated question: "why can't the app work without this?"

It can — it just has nothing to upload to, which is not something a reviewer
can evaluate. [`review-notes.md`](review-notes.md) answers the question in the
notes themselves; this document exists so the answer is backed by a server that
actually works.
