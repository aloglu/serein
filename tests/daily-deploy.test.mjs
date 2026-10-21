import assert from 'node:assert/strict';
import test from 'node:test';
import { deployAndVerify, homepageStatus } from '../scripts/daily-deploy.mjs';

function page(id = 'old', rendered = '2026-10-21', poem = rendered) {
  return `<meta name="serein-build-id" content="${id}"><main data-rendered-as-of="${rendered}" data-poem-date="${poem}"></main>`;
}
function scenario(responses, options = {}) {
  const calls = [];
  const waits = [];
  return {
    calls, waits,
    run: () => deployAndVerify({
      hookUrl: 'https://example.test/secret',
      siteUrl: 'https://example.test/',
      now: () => new Date('2026-10-20T21:05:00Z'), // Oct 21 in Istanbul
      wait: async ms => { waits.push(ms); }, log: () => {},
      triggerDelays: [0, 1], verificationAttempts: 4, pollIntervalMs: 1,
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), ...init });
        assert.ok(responses.length, 'Unexpected extra request');
        const next = responses.shift();
        if (next instanceof Error) throw next;
        return typeof next === 'number' ? new Response('', { status: next }) : new Response(next);
      }, ...options
    })
  };
}

test('waits for a fresh build with both the publication date and correct poem', async () => {
  const h = scenario([page(), 200, page(), page('new', '2026-10-20'),
    page('new', '2026-10-21', '2026-10-20'), page('new')]);
  assert.equal((await h.run()).buildId, 'new');
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
  assert.ok(h.calls.filter(c => !c.method).every(c => c.url.includes('deployment_check=')));
});

test('accepting the hook without a completed deployment fails verification', async () => {
  const h = scenario([page(), 200, page(), page(), page(), page()]);
  await assert.rejects(h.run(), /never appeared/);
});

test('retries transient trigger failures and homepage outages', async () => {
  const h = scenario([page(), 503, 200, new Error('offline'), page('new')]);
  assert.equal((await h.run()).poemDate, '2026-10-21');
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 2);
});

test('permanent hook failures stop immediately and exhausted retries fail', async () => {
  await assert.rejects(scenario([page(), 403]).run(), /HTTP 403/);
  await assert.rejects(scenario([page(), 503, new Error('secret URL')]).run(), /all retry attempts/);
});

test('first deployment can upgrade a homepage without a build marker', async () => {
  const old = '<main data-rendered-as-of="2026-10-20" data-poem-date="2026-10-20">';
  assert.equal(homepageStatus(old).buildId, '');
  assert.equal((await scenario([old, 200, page('first')]).run()).buildId, 'first');
});

test('missing credentials or unavailable baseline do not trigger deployment', async () => {
  await assert.rejects(deployAndVerify({ hookUrl: '' }), /Missing secret/);
  const h = scenario([500]);
  await assert.rejects(h.run(), /Homepage returned HTTP 500/);
  assert.equal(h.calls.length, 1);
});
