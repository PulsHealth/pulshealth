import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notificationPlan } from './notify.mjs';

test('alerts on first failure, changes, and six-hour reminder; suppresses duplicates', () => {
  const bad = { ok: false, problems: ['backup overdue'] };
  const first = notificationPlan(bad, null, 100);
  assert.equal(first.send, true);
  assert.equal(notificationPlan(bad, first, 400).send, false);
  assert.equal(notificationPlan(bad, first, 21700).send, true);
  assert.equal(notificationPlan({ok:false, problems:['deletion stalled']}, first, 500).send, true);
});
test('only one recovery notice, no routine healthy email', () => {
  const first = notificationPlan({ ok: false, problems: ['failure'] }, null, 0);
  const recovery = notificationPlan({ ok: true }, first, 1);
  assert.equal(recovery.send, true);
  assert.equal(notificationPlan({ ok: true }, recovery, 2).send, false);
  assert.equal(notificationPlan({ ok: true }, null, 2).send, false);
});
