// Operator-only hourly review alerts. No health database or public endpoint.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Self-contained so the existing Apple credential container keeps its key.
export async function fetchReviews(appId, env = process.env, fetcher = fetch) {
  const { readFileSync } = await import('node:fs');
  const { sign } = await import('node:crypto');
  if (!/^\d+$/.test(appId) || !env.ASC_KEY_ID || !env.ASC_ISSUER_ID || !env.ASC_PRIVATE_KEY_PATH) throw Error('Apple configuration missing');
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: 'ES256', kid: env.ASC_KEY_ID, typ: 'JWT' })}.${encode({ iss: env.ASC_ISSUER_ID, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' })}`;
  const signature = sign('sha256', Buffer.from(unsigned), { key: readFileSync(env.ASC_PRIVATE_KEY_PATH), dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const endpoint = `/v1/apps/${appId}/customerReviews`;
  let next = `https://api.appstoreconnect.apple.com${endpoint}?limit=200&sort=-createdDate`;
  const pages = new Set(), reviews = new Map();
  while (next) {
    const url = new URL(next);
    if (url.origin !== 'https://api.appstoreconnect.apple.com' || url.pathname !== endpoint || url.username || url.password || url.hash || pages.has(url.href) || pages.size >= 100) throw Error('Unexpected Apple pagination');
    pages.add(url.href);
    const response = await fetcher(url, { redirect: 'error', headers: { Authorization: `Bearer ${unsigned}.${signature}` }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw Error(`Apple HTTP ${response.status}`);
    const page = await response.json();
    if (!Array.isArray(page.data)) throw Error('Invalid Apple response');
    for (const row of page.data) {
      const a = row.attributes;
      if (row.type !== 'customerReviews' || typeof row.id !== 'string' || !row.id || !a || !Number.isInteger(a.rating) || a.rating < 1 || a.rating > 5 || typeof a.title !== 'string' || typeof a.body !== 'string' || typeof a.territory !== 'string' || typeof a.createdDate !== 'string' || !Number.isFinite(Date.parse(a.createdDate))) throw Error('Invalid Apple review');
      reviews.set(row.id, { id: row.id, rating: a.rating, title: a.title.slice(0, 1000), body: a.body.slice(0, 50_000), territory: a.territory, createdDate: a.createdDate });
    }
    next = page.links?.next ?? null;
  }
  return [...reviews.values()];
}

export function reviewMail(review, appName) {
  return {
    subject: `${appName}: New ${review.rating}-star App Store review`,
    text: [`New App Store review for ${appName}`, '', `Rating: ${review.rating}/5`, `Country/region: ${review.territory}`, `Published: ${review.createdDate}`, '', review.title, '', review.body, '', 'View or respond in App Store Connect:', 'https://appstoreconnect.apple.com/'].join('\n'),
  };
}

export async function checkReviews({ appId, appName, reviews, state, save, send, now = new Date().toISOString() }) {
  if (state && (state.version !== 1 || state.appId !== appId || !Array.isArray(state.seen) || state.seen.some(id => typeof id !== 'string'))) throw Error('Invalid review state; restore it before continuing');
  if (!state) {
    await save({ version: 1, appId, seen: reviews.map(r => r.id), lastSuccessAt: now });
    return { baselined: reviews.length, sent: 0 };
  }
  const seen = new Set(state.seen);
  let sent = 0;
  for (const review of reviews.slice().sort((a, b) => a.createdDate.localeCompare(b.createdDate))) {
    if (seen.has(review.id)) continue;
    if (!await send(reviewMail(review, appName))) throw Error('Review email not accepted');
    seen.add(review.id);
    // Commit each accepted message so a later failure retries only remaining ones.
    await save({ version: 1, appId, seen: [...seen], lastSuccessAt: state.lastSuccessAt });
    sent++;
  }
  await save({ version: 1, appId, seen: [...seen], lastSuccessAt: now });
  return { baselined: 0, sent };
}

function atomicJSON(path, value) {
  writeFileSync(path + '.tmp', JSON.stringify(value) + '\n', { mode: 0o600 });
  renameSync(path + '.tmp', path);
}

async function main() {
  const configPath = process.argv[2];
  if (!configPath) throw Error('Private configuration file required');
  const config = JSON.parse(readFileSync(resolve(configPath), 'utf8'));
  const { appId, appName, appleContainer, mailContainer, stateDir } = config;
  if (typeof appId !== 'string' || !/^\d+$/.test(appId) || typeof appName !== 'string' || !appName.trim() || !appleContainer || !mailContainer || !stateDir?.startsWith('/')) throw Error('Invalid configuration');
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const status = join(stateDir, 'status.json');
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const container = JSON.parse(execFileSync('docker', ['inspect', mailContainer], { encoding: 'utf8' }))[0];
    const env = Object.fromEntries(container.Config.Env.map(item => { const at = item.indexOf('='); return [item.slice(0, at), item.slice(at + 1)]; }));
    const { mailConfig, sendMail } = await import(pathToFileURL(resolve(root, 'web/lib/email.ts')));
    const mail = mailConfig(env);
    const to = env.WEB_APP_STORE_ALERT_TO?.trim();
    if (!mail || !to) throw Error('Review mail configuration unavailable');
    const send = message => sendMail({ ...message, to }, mail);
    if (process.argv[3] === '--test-email') {
      if (!await send({ subject: `${appName}: App Store review alerts setup test`, text: 'This is a setup test, not a customer review. New published App Store reviews will be checked hourly. Existing reviews are baselined without alerts. Each alert contains the rating, title, text and country/region. No health data is accessed.' })) throw Error('Test email not accepted');
      console.log('Review setup test accepted by SES');
      return;
    }
    const code = `(${fetchReviews.toString()})(process.argv[1]).then(r => console.log(JSON.stringify(r))).catch(() => { console.error('Apple review fetch failed'); process.exitCode = 1; });`;
    const reviews = JSON.parse(execFileSync('docker', ['exec', appleContainer, 'node', '--input-type=module', '-e', code, appId], { encoding: 'utf8', timeout: 180_000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
    const file = join(stateDir, 'reviews.json');
    let state = null;
    try { state = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const result = await checkReviews({ appId, appName, reviews, state, save: value => atomicJSON(file, value), send });
    atomicJSON(status, { ok: true, checkedAt: new Date().toISOString(), reviews: reviews.length, ...result });
    console.log(JSON.stringify(result));
  } catch {
    atomicJSON(status, { ok: false, checkedAt: new Date().toISOString(), error: 'Review check failed; inspect Apple access, mail configuration and saved state privately.' });
    throw Error('Review check failed');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('App Store review check failed; inspect private status.json'); process.exitCode = 1; });
}
