const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/audio.js'), 'utf8');
const offscreenSource = fs.readFileSync(path.join(root, 'src/offscreen.js'), 'utf8');
const builder = require('../assets/build-audio.cjs');
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

function makeClock() {
  let now = 1700000000000;
  let nextId = 0;
  const tasks = new Map();
  function schedule(fn, delay, repeat = false) {
    const id = ++nextId;
    tasks.set(id, { fn, at: now + delay, interval: repeat ? delay : 0 });
    return id;
  }
  return {
    now: () => now,
    timers: tasks,
    setTimeout: (fn, delay = 0) => schedule(fn, delay),
    setInterval: (fn, delay) => schedule(fn, delay, true),
    clear: id => tasks.delete(id),
    async tick(ms) {
      const target = now + ms;
      for (;;) {
        const next = [...tasks].filter(([, task]) => task.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, task] = next;
        now = task.at;
        if (task.interval) task.at += task.interval;
        else tasks.delete(id);
        task.fn();
        await flush();
      }
      now = target;
      await flush();
    }
  };
}

function setup({ extension = true, constructorError = false, playError = false, legacy = false, scriptURL = 'http://127.0.0.1:4173/src/audio.js' } = {}) {
  const clock = makeClock();
  const instances = [];
  const messageHandlers = [];
  class Audio {
    constructor() {
      if (constructorError) throw new Error('No audio device API');
      this.currentTime = 0;
      this.duration = 1.2;
      this.readyState = 0;
      this.paused = true;
      this.ended = false;
      this.seeking = false;
      this.muted = false;
      this.volume = 1;
      this.src = '';
      this.playCalls = 0;
      this.pauseCalls = 0;
      this.loadCalls = 0;
      this.events = new Map();
      this.playPromise = new Promise((resolve, reject) => { this.resolvePlay = resolve; this.rejectPlay = reject; });
      instances.push(this);
    }
    addEventListener(name, handler) {
      if (!this.events.has(name)) this.events.set(name, new Set());
      this.events.get(name).add(handler);
    }
    removeEventListener(name, handler) { this.events.get(name)?.delete(handler); }
    emit(name) { for (const handler of [...(this.events.get(name) || [])]) handler(); }
    play() {
      this.playCalls++;
      if (playError) throw new Error('Synchronous media failure');
      return legacy ? undefined : this.playPromise;
    }
    accept(emitPlaying = true) {
      this.paused = false;
      this.readyState = 4;
      if (emitPlaying) this.emit('playing');
      this.resolvePlay();
    }
    pause() { this.pauseCalls++; this.paused = true; this.emit('pause'); }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
    load() { this.loadCalls++; this.currentTime = 0; this.emit('abort'); }
    end(pauseFirst = false) {
      this.ended = true;
      this.paused = true;
      if (pauseFirst) this.emit('pause');
      this.emit('ended');
    }
    fail(code) { this.error = { code }; this.emit('error'); }
  }
  const document = { currentScript: scriptURL ? { src: scriptURL } : null };
  const runtime = { getURL: file => 'chrome-extension://momo/' + file, onMessage: { addListener: handler => messageHandlers.push(handler) } };
  const context = vm.createContext({ Audio, URL, Date: { now: clock.now }, document,
    setTimeout: clock.setTimeout, clearTimeout: clock.clear,
    setInterval: clock.setInterval, clearInterval: clock.clear,
    ...(extension ? { chrome: { runtime } } : {}) });
  vm.runInContext(source, context, { filename: 'src/audio.js' });
  const api = context.MF_AUDIO;
  return {
    api, clock, instances, document,
    async confirm(media = instances.at(-1), time = .025) {
      media.accept();
      await flush();
      media.currentTime = time;
      await clock.tick(25);
    },
    loadOffscreen() { vm.runInContext(offscreenSource, context, { filename: 'src/offscreen.js' }); },
    message(message) {
      const responses = [];
      let resolve;
      const response = new Promise(done => { resolve = done; });
      const keepOpen = messageHandlers[0](message, {}, value => { responses.push(value); resolve(value); });
      return { keepOpen, response, responses };
    }
  };
}

test('play reaches HTMLAudioElement synchronously, preserving direct click activation', async () => {
  const env = setup();
  const promise = env.api.play();
  assert.equal(env.instances.length, 1);
  assert.equal(env.instances[0].playCalls, 1);
  assert.equal(env.instances[0].src, 'chrome-extension://momo/assets/gentle.wav');
  assert.equal(env.instances[0].muted, false);
  assert.ok(env.instances[0].volume >= .6 && env.instances[0].volume <= .85);
  await env.confirm();
  assert.equal((await promise).audioStatus, 'started');
  env.api.stop();
});

test('confirmation requires play acceptance AND advancing playback time, not events alone', async () => {
  const env = setup();
  let settled = false;
  const promise = env.api.play(false).then(result => { settled = true; return result; });
  const media = env.instances[0];
  media.accept();
  await env.clock.tick(500);
  assert.equal(settled, false);
  media.currentTime = .025;
  await env.clock.tick(25);
  assert.equal((await promise).audioStatus, 'started');
  assert.equal(settled, true);
  env.api.stop();
});

test('a playing event and clock movement cannot mask an unfulfilled play promise', async () => {
  const env = setup();
  let settled = false;
  const promise = env.api.play().then(result => { settled = true; return result; });
  const media = env.instances[0];
  media.paused = false;
  media.readyState = 4;
  media.currentTime = .04;
  media.emit('playing');
  await env.clock.tick(100);
  assert.equal(settled, false);
  media.resolvePlay();
  await flush();
  assert.equal((await promise).audioStatus, 'started');
  env.api.stop();
});

test('startAt accounts for time already consumed from the 350ms lead-in', async () => {
  const env = setup();
  const promise = env.api.play(false);
  await env.confirm(undefined, .137);
  const result = await promise;
  assert.equal(result.startAt, env.clock.now() + 350 - 137);
  env.api.stop();
});

test('script URL is captured at load, including local preview subdirectories', async () => {
  const env = setup({ extension: false, scriptURL: 'http://127.0.0.1:4173/project/src/audio.js?rev=2' });
  env.document.currentScript = null;
  const promise = env.api.play(false);
  assert.equal(env.instances[0].src, 'http://127.0.0.1:4173/project/assets/taps.wav');
  await env.confirm();
  await promise;
  env.api.stop();
});

test('autoplay rejection is actionable and the same failed cueId can retry', async () => {
  const env = setup();
  const first = env.api.play(true, { cueId: 'retry' });
  const rejected = assert.rejects(first, { name: 'NotAllowedError', message: /blocked sound.*Preview sound/ });
  env.instances[0].rejectPlay(Object.assign(new Error('Not allowed'), { name: 'NotAllowedError' }));
  await rejected;
  assert.equal(env.instances[0].src, '');
  assert.equal(env.clock.timers.size, 0);
  const retry = env.api.play(true, { cueId: 'retry' });
  assert.notEqual(first, retry);
  assert.equal(env.instances.length, 2);
  await env.confirm();
  await retry;
  env.api.stop();
});

test('each genuine media error rejects, releases the source, and allows retry', async () => {
  for (const [code, text] of [[1, /interrupted/], [2, /loaded/], [3, /decoded/], [4, /missing or unsupported/]]) {
    const env = setup();
    const first = env.api.play(false, { cueId: 'error' });
    const rejected = assert.rejects(first, text);
    env.instances[0].fail(code);
    await rejected;
    assert.equal(env.instances[0].src, '');
    const retry = env.api.play(false, { cueId: 'error' });
    await env.confirm();
    await retry;
    env.api.stop();
  }
});

test('a frozen clock times out even if play and playing were successful', async () => {
  const env = setup();
  const promise = env.api.play(false, { cueId: 'frozen' });
  const rejected = assert.rejects(promise, { name: 'TimeoutError', message: /did not start/ });
  env.instances[0].accept();
  await env.clock.tick(4000);
  await rejected;
  assert.equal(env.instances[0].paused, true);
  assert.equal(env.instances[0].src, '');
  assert.equal(env.clock.timers.size, 0);
  const retry = env.api.play(false, { cueId: 'frozen' });
  await env.confirm();
  await retry;
  env.api.stop();
});

test('a play promise that never settles times out and a late success stays stopped', async () => {
  const env = setup();
  const promise = env.api.play();
  const rejected = assert.rejects(promise, { name: 'TimeoutError' });
  await env.clock.tick(4000);
  await rejected;
  env.instances[0].accept();
  await flush();
  assert.equal(env.instances[0].paused, true);
  assert.equal(env.instances[0].src, '');
  assert.equal(env.clock.timers.size, 0);
});

test('simultaneous duplicate cueIds share one promise and one media element', async () => {
  const env = setup();
  const first = env.api.play(true, { cueId: 'same' });
  const duplicate = env.api.play(true, { cueId: 'same' });
  assert.equal(duplicate, first);
  assert.equal(env.instances.length, 1);
  await env.confirm();
  assert.equal(await duplicate, await first);
  env.api.stop();
});

test('completed cueIds remain deduplicated, including native pause-before-ended', async () => {
  for (const pauseFirst of [false, true]) {
    const env = setup();
    const first = env.api.play(true, { cueId: 'complete' });
    await env.confirm();
    const result = await first;
    env.instances[0].end(pauseFirst);
    assert.equal(env.clock.timers.size, 0);
    const duplicate = env.api.play(true, { cueId: 'complete' });
    assert.equal(duplicate, first);
    assert.equal(await duplicate, result);
    assert.equal(env.instances.length, 1);
  }
});

test('an old completed duplicate does not interrupt a different currently playing cue', async () => {
  const env = setup();
  const first = env.api.play(true, { cueId: 'old' });
  await env.confirm();
  await first;
  env.instances[0].end();
  const next = env.api.play(false, { cueId: 'new' });
  await env.confirm();
  await next;
  assert.equal(env.api.play(true, { cueId: 'old' }), first);
  assert.equal(env.instances[1].paused, false);
  env.api.stop();
});

test('stop cancels pending audio immediately; late play resolution cannot restart it', async () => {
  const env = setup();
  const first = env.api.play(true, { cueId: 'mute-race' });
  const rejected = assert.rejects(first, { name: 'AbortError', message: /stopped/ });
  env.api.stop();
  await rejected;
  const old = env.instances[0];
  assert.equal(old.paused, true);
  assert.equal(old.src, '');
  assert.equal(env.clock.timers.size, 0);
  old.accept();
  old.currentTime = .1;
  await flush();
  await env.clock.tick(5000);
  assert.equal(old.paused, true);
  assert.equal(old.src, '');
  const retry = env.api.play(true, { cueId: 'mute-race' });
  await env.confirm();
  await retry;
  env.api.stop();
});

test('stop after confirmation during the silent lead-in releases audio and permits retry', async () => {
  const env = setup();
  const first = env.api.play(true, { cueId: 'lead-in' });
  await env.confirm();
  await first;
  env.api.stop();
  env.api.stop();
  assert.equal(env.instances[0].paused, true);
  assert.equal(env.instances[0].src, '');
  assert.equal(env.clock.timers.size, 0);
  const retry = env.api.play(true, { cueId: 'lead-in' });
  assert.notEqual(retry, first);
  await env.confirm();
  await retry;
  env.api.stop();
});

test('replacement cancels the old cue without letting its late success stop the new one', async () => {
  const env = setup();
  const first = env.api.play(false, { cueId: 'old' });
  const rejected = assert.rejects(first, { name: 'AbortError', message: /newer cue/ });
  const next = env.api.play(true, { cueId: 'new' });
  await rejected;
  await env.confirm();
  await next;
  env.instances[0].accept();
  await flush();
  assert.equal(env.instances[0].paused, true);
  assert.equal(env.instances[1].paused, false);
  env.api.stop();
});

test('muted media never returns a false started result', async () => {
  const env = setup();
  const promise = env.api.play();
  const rejected = assert.rejects(promise, /muted/);
  env.instances[0].muted = true;
  env.instances[0].accept();
  await rejected;
  assert.equal(env.instances[0].src, '');
});

test('paused, seeking, or unready media cannot confirm from a changed time alone', async () => {
  for (const values of [{ paused: true }, { seeking: true }, { readyState: 1 }]) {
    const env = setup();
    const promise = env.api.play();
    const rejected = assert.rejects(promise, { name: 'TimeoutError' });
    env.instances[0].accept();
    Object.assign(env.instances[0], values, { currentTime: .04 });
    await env.clock.tick(4000);
    await rejected;
  }
});

test('constructor, missing asset base, and synchronous play errors reject normally', async () => {
  for (const [options, match] of [[{ constructorError: true }, /No audio device API/],
    [{ extension: false, scriptURL: null }, /could not be located/], [{ playError: true }, /Synchronous media failure/]]) {
    const env = setup(options);
    await assert.rejects(env.api.play(), match);
    assert.equal(env.clock.timers.size, 0);
  }
});

test('premature end and unexpected pause reject pending playback', async () => {
  for (const event of ['end', 'pause']) {
    const env = setup();
    const promise = env.api.play();
    const rejected = assert.rejects(promise, /before playback|interrupted/);
    env.instances[0][event]();
    await rejected;
    assert.equal(env.clock.timers.size, 0);
  }
});

test('failure or a stall after start releases the active cue so it can be retried', async () => {
  for (const failAfterStart of [true, false]) {
    const env = setup();
    const first = env.api.play(true, { cueId: 'late-error' });
    await env.confirm();
    await first;
    if (failAfterStart) env.instances[0].fail(3);
    else await env.clock.tick(4000);
    assert.equal(env.instances[0].src, '');
    const retry = env.api.play(true, { cueId: 'late-error' });
    assert.notEqual(retry, first);
    await env.confirm();
    await retry;
    env.api.stop();
  }
});

test('legacy non-promise media still requires both playing and clock progress', async () => {
  const env = setup({ legacy: true });
  const promise = env.api.play();
  await env.confirm();
  assert.equal((await promise).audioStatus, 'started');
  env.api.stop();
});

test('offscreen replies only after confirmation and forwards cueId for deduplication', async () => {
  const env = setup();
  env.loadOffscreen();
  const message = { target: 'mf-audio', type: 'PLAY', gentle: false, cueId: 'offscreen' };
  const first = env.message(message);
  const duplicate = env.message(message);
  assert.equal(first.keepOpen, true);
  assert.equal(duplicate.keepOpen, true);
  assert.equal(first.responses.length, 0);
  assert.equal(env.instances.length, 1);
  await env.confirm();
  const response = await first.response;
  assert.equal(response.ok, true);
  assert.equal(response.audioStatus, 'started');
  assert.equal((await duplicate.response).startAt, response.startAt);
  assert.equal(first.responses.length, 1);
  env.api.stop();
});

test('offscreen returns a real playback failure and allows a same-id retry', async () => {
  const env = setup();
  env.loadOffscreen();
  const message = { target: 'mf-audio', type: 'PLAY', cueId: 'offscreen-retry' };
  const first = env.message(message);
  env.instances[0].fail(4);
  const failure = await first.response;
  assert.equal(failure.ok, false);
  assert.match(failure.error, /missing or unsupported/);
  assert.equal(failure.audioStatus, undefined);
  const retry = env.message(message);
  await env.confirm();
  assert.equal((await retry.response).ok, true);
  env.api.stop();
});

test('offscreen STOP acknowledges immediately and fails a pending PLAY without late audio', async () => {
  const env = setup();
  env.loadOffscreen();
  const first = env.message({ target: 'mf-audio', type: 'PLAY', cueId: 'stop' });
  const stopped = env.message({ target: 'mf-audio', type: 'STOP' });
  assert.equal(stopped.keepOpen, false);
  assert.equal((await stopped.response).ok, true);
  assert.equal((await first.response).ok, false);
  assert.match(first.responses[0].error, /stopped/);
  env.instances[0].accept();
  await flush();
  assert.equal(env.instances[0].paused, true);
  assert.equal(first.responses.length, 1);
});

test('offscreen ignores unrelated, missing, and unknown messages', () => {
  const env = setup();
  env.loadOffscreen();
  for (const message of [null, {}, { target: 'another', type: 'PLAY' }, { target: 'mf-audio', type: 'OTHER' }]) {
    const result = env.message(message);
    assert.equal(result.keepOpen, false);
    assert.equal(result.responses.length, 0);
  }
  assert.equal(env.instances.length, 0);
});

test('bundled WAVs are deterministic local PCM with safe levels and audible contact energy', () => {
  const { SAMPLE_RATE, DURATION, LEAD_IN, CONTACTS, buildCue, encodeWav } = builder;
  for (const gentle of [false, true]) {
    const samples = buildCue(gentle);
    const encoded = encodeWav(samples);
    const bundled = fs.readFileSync(path.join(root, 'assets', gentle ? 'gentle.wav' : 'taps.wav'));
    assert.deepEqual(bundled, encoded);
    assert.deepEqual(encodeWav(buildCue(gentle)), encoded);
    assert.equal(encoded.toString('ascii', 0, 4), 'RIFF');
    assert.equal(encoded.toString('ascii', 8, 12), 'WAVE');
    assert.equal(encoded.readUInt16LE(20), 1);
    assert.equal(encoded.readUInt16LE(22), 1);
    assert.equal(encoded.readUInt32LE(24), SAMPLE_RATE);
    assert.equal(encoded.readUInt16LE(34), 16);
    assert.equal(encoded.readUInt32LE(40), SAMPLE_RATE * DURATION * 2);
    assert.equal(samples.length, SAMPLE_RATE * DURATION);
    const firstContact = Math.round((LEAD_IN + CONTACTS[0]) * SAMPLE_RATE);
    assert.ok(samples.subarray(0, firstContact + 1).every(value => value === 0));
    assert.ok(samples[firstContact + 1] !== 0);
    let peak = 0;
    let sum = 0;
    for (const value of samples) { peak = Math.max(peak, Math.abs(value)); sum += value * value; }
    assert.ok(peak > .5 && peak <= .6);
    assert.ok(Math.sqrt(sum / samples.length) > .045);
    assert.ok(samples.subarray(samples.length - 100).every(value => value === 0));
    for (const contact of CONTACTS) {
      const onset = Math.round((LEAD_IN + contact) * SAMPLE_RATE);
      const window = samples.subarray(onset, onset + Math.round(.025 * SAMPLE_RATE));
      assert.ok(Math.max(...window.map(Math.abs)) > .3);
      if (!gentle) assert.ok(samples.subarray(onset - 100, onset + 1).every(value => value === 0));
    }
  }
});

test('gentle chime extends the taps without clipping or copying external audio', () => {
  const taps = builder.buildCue(false);
  const gentle = builder.buildCue(true);
  const tailStart = Math.round(.95 * builder.SAMPLE_RATE);
  assert.ok(taps.subarray(tailStart).every(value => value === 0));
  assert.ok(gentle.subarray(tailStart).some(value => Math.abs(value) > .01));
  assert.notDeepEqual(builder.encodeWav(taps), builder.encodeWav(gentle));
});
