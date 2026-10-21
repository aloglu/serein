import assert from 'node:assert/strict';
import test from 'node:test';
import { watchForDateChange } from '../assets/scripts/shared/date-refresh.mjs';

function harness({ fixedDate = false } = {}) {
  const doc = new EventTarget();
  doc.visibilityState = 'visible';
  const win = new EventTarget();
  let current = new Date(2026, 9, 21, 23, 59, 59);
  let reloads = 0;
  let timer;
  let delay;
  const stop = watchForDateChange({
    getDate: () => fixedDate ? '2026-10-21' : `${current.getFullYear()}-${current.getMonth()}-${current.getDate()}`,
    onChange: () => reloads++, doc, win, now: () => current,
    schedule: (fn, ms) => { timer = fn; delay = ms; return 1; },
    cancel: () => { timer = null; }
  });
  return {
    doc, win, stop,
    advance: () => { current = new Date(2026, 9, 22, 0, 0, 1); },
    fire: () => timer(),
    get timer() { return timer; },
    get delay() { return delay; },
    get reloads() { return reloads; }
  };
}

test('visible homepage refreshes once at local midnight', () => {
  const h = harness();
  assert.equal(h.delay, 1050);
  h.advance(); h.fire();
  h.win.dispatchEvent(new Event('pageshow'));
  assert.equal(h.reloads, 1);
  assert.equal(h.timer, null);
  h.stop();
});

test('returning to a sleeping or restored tab rechecks the date', () => {
  for (const event of ['visibilitychange', 'pageshow']) {
    const h = harness();
    h.doc.visibilityState = 'hidden';
    h.doc.dispatchEvent(new Event('visibilitychange'));
    assert.equal(h.timer, null);
    h.advance();
    h.doc.visibilityState = 'visible';
    (event === 'pageshow' ? h.win : h.doc).dispatchEvent(new Event(event));
    assert.equal(h.reloads, 1);
    h.stop();
  }
});

test('same-day focus and fixed preview dates do not reload; cleanup removes listeners', () => {
  const h = harness({ fixedDate: true });
  h.win.dispatchEvent(new Event('pageshow'));
  assert.equal(h.reloads, 0);
  h.advance(); h.fire();
  assert.equal(h.reloads, 0);
  h.stop();
  assert.equal(h.timer, null);
  h.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(h.timer, null);
});
