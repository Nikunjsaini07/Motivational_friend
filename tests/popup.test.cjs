const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/popup.js'), 'utf8');

function harness(seed) {
  let state = seed;
  const calls = [], updates = [], taps = [], errors = [];
  let options, poll, unload, playing = 0, stopped = 0;
  let failPresented = false;
  const chrome = {
    tabs: { query: async () => [{ id: 7 }] },
    runtime: { sendMessage: async message => {
      calls.push(message);
      if (message.type === 'PROMPT_PRESENTED' && failPresented) throw new Error('Temporary connection loss');
      const response = structuredClone(state);
      if (message.type === 'PROMPT_PRESENTED') response.cue = response.session?.prompt?.cue;
      return response;
    } }
  };
  const widget = { update: s => updates.push(s), tap: cue => { if (cue) taps.push(cue); }, error: text => errors.push(text), dispose() {} };
  const context = vm.createContext({
    chrome, Date,
    document: { hasFocus: () => true, getElementById: () => ({}) },
    MF_UI: { mount(_root, config) { options = config; return widget; } },
    MF_AUDIO: { play() { playing++; return Promise.resolve({ audioStatus: 'started', startAt: Date.now() + 350 }); }, stop() { stopped++; } },
    setInterval(fn) { poll = fn; return 1; }, clearInterval() {},
    window: { addEventListener(_name, fn) { unload = fn; } }
  });
  vm.runInContext(source, context);
  return {
    calls, updates, taps, errors,
    async flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); },
    async poll() { await poll(); },
    config: () => options,
    playCount: () => playing, stopCount: () => stopped,
    setState(next) { state = next; }, failPresented(value) { failPresented = value; },
    unload() { unload(); }
  };
}

function state(startAt = Date.now() + 350) {
  return { ok: true, available: true, settings: {}, session: { prompt: {
    id: 'p1', kind: 'distraction', cue: { startAt, audioStatus: 'started' }
  } } };
}

test('popup previews call local audio immediately, without a worker message round trip', async () => {
  const h = harness(state());
  await h.flush();
  const count = h.calls.length;
  const playback = h.config().playSound(true);
  assert.equal(h.playCount(), 1);
  assert.equal(h.calls.length, count);
  assert.equal((await playback).audioStatus, 'started');
});

test('popup polling never replays already started audio or re-reports the same prompt', async () => {
  const h = harness(state());
  await h.flush(); await h.poll(); await h.poll();
  assert.equal(h.playCount(), 0);
  assert.equal(h.calls.filter(m => m.type === 'PROMPT_PRESENTED').length, 1);
  assert.ok(h.taps.length > 0);
});

test('failed presentation reports retry on the next poll instead of permanently suppressing them', async () => {
  const h = harness(state());
  h.failPresented(true);
  await h.flush();
  assert.match(h.errors[0], /connection/);
  h.failPresented(false);
  await h.poll();
  assert.equal(h.calls.filter(m => m.type === 'PROMPT_PRESENTED').length, 2);
});

test('opening an old prompt does not replay its old tap and snooze never requests a presentation cue', async () => {
  const seed = state(Date.now() - 10000);
  const h = harness(seed);
  await h.flush();
  assert.equal(h.taps.length, 0);
  seed.session.prompt.kind = 'snooze'; seed.session.prompt.id = 'quiet';
  h.setState(seed);
  await h.poll();
  assert.equal(h.calls.filter(m => m.type === 'PROMPT_PRESENTED').length, 1);
});

test('closing the popup stops any local preview and disposes polling', async () => {
  const h = harness(state());
  await h.flush();
  h.unload();
  assert.equal(h.stopCount(), 1);
});
