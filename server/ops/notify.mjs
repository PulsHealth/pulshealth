// Operator-only alerts. Reuses the application's tested SES sender. Run with
// Node >=22.18 (native TypeScript stripping); never exports credentials to disk.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function notificationPlan(result, previous, now) {
  const failed = !result.ok;
  const signature = failed ? JSON.stringify((result.problems ?? ['check unavailable']).slice().sort()) : 'ok';
  const send = failed
    ? !previous || !previous.failed || previous.signature !== signature || now - previous.sentAt >= 21600
    : Boolean(previous?.failed);
  return { send, failed, signature, sentAt: now };
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const args = process.argv.slice(2);
  const test = args[0] === '--test';
  const configOnly = args[0] === '--check-config';
  const cid = execFileSync('docker', ['compose', '-f', resolve(root, 'server/docker-compose.yml'), 'ps', '-aq', 'web'], { encoding: 'utf8' }).trim();
  if (!cid) throw Error('viewer container missing');
  const container = JSON.parse(execFileSync('docker', ['inspect', cid], { encoding: 'utf8' }))[0];
  const env = Object.fromEntries(container.Config.Env.map(item => {
    const at = item.indexOf('='); return [item.slice(0, at), item.slice(at + 1)];
  }));
  const { mailConfig, sendMail } = await import(pathToFileURL(resolve(root, 'web/lib/email.ts')));
  const config = mailConfig(env);
  if (!config?.admin) throw Error('operator mail not configured');
  if (configOnly) { console.log('operator mail configured'); return; }
  let result;
  let previous;
  let state;
  let plan;
  if (!test) {
    const path = resolve(args[0]);
    result = JSON.parse(readFileSync(path, 'utf8'));
    state = resolve(dirname(path), 'hosted-notification.json');
    previous = existsSync(state) ? JSON.parse(readFileSync(state, 'utf8')) : null;
    plan = notificationPlan(result, previous, Math.floor(Date.now() / 1000));
    if (!plan.send) return;
  }
  const subject = test ? 'PulsHealth operations: delivery test'
    : plan.failed ? 'PulsHealth operations: action needed' : 'PulsHealth operations: recovered';
  const text = test
    ? 'This is the authorized synthetic PulsHealth operations delivery test. No customer or health data is included. Failure alerts are checked every five minutes, repeated at most every six hours while unchanged, and followed by a recovery notice. Please confirm receipt.'
    : plan.failed
      ? 'Hosted checks need attention.\n\n' + (result.problems ?? ['Check unavailable']).join('\n') + '\n\nInspect the private host status and docs/hosted-operations.md. No health data or credentials are included.'
      : 'All hosted checks are passing again. Review the incident and confirm deletion and backup recovery in the hosted operations runbook.';
  if (!await sendMail({ to: config.admin, subject, text }, config)) throw Error('operator mail was not accepted');
  if (state) {
    writeFileSync(state + '.tmp', JSON.stringify(plan) + '\n', { mode: 0o600 });
    renameSync(state + '.tmp', state);
  }
  console.log(test ? 'synthetic delivery test accepted by SES' : 'operator notification accepted by SES');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('operator notification failed; inspect mail configuration privately'); process.exitCode = 1; });
}
