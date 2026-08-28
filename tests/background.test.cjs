const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function harness(seed = {}, options = {}) {
  let time = options.time ?? 1_800_000_000_000;
  let activeTab = { id: 1, windowId: 1, active: true, url: 'https://x.com/home' };
  let focused = true;
  const data = structuredClone(seed);
  const alarms = new Map();
  const receivers = new Set();
  const delivered = [];
  const injected = [];
  const opened = [], closed = [], sounds = [], badges = [], playbacks = [];
  const audioReplies = [], audioDocuments = [], contextQueries = [];
  const playedCues = new Map();
  const otherTabs = new Map();
  let audioExists = false;
  const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
  const chrome = {
    runtime: { id: 'test', getURL: p => `chrome-extension://test/${p}`,
      onInstalled: event(), onStartup: event(), onMessage: event(),
      async getContexts(query) { contextQueries.push(query); return audioExists ? [{}] : []; },
      async sendMessage(message) {
        sounds.push(structuredClone(message));
        if (message.type === 'STOP') return { ok: true };
        if (!audioExists) throw new Error('Could not establish connection. Receiving end does not exist.');
        if (audioReplies.length) {
          const reply = audioReplies.shift();
          if (reply instanceof Error) throw reply;
          return reply;
        }
        if (!playedCues.has(message.cueId)) {
          playedCues.set(message.cueId, { ok: true, startAt: time, audioStatus: 'started' });
          playbacks.push(structuredClone(message));
        }
        return playedCues.get(message.cueId);
      } },
    action: { async openPopup(options) { opened.push(options); }, async setBadgeText(badge) { badges.push(badge.text); }, async setBadgeBackgroundColor() {} },
    offscreen: { async createDocument(options) { audioDocuments.push(options); audioExists = true; } },
    storage: { local: {
      async get(keys) { return Object.fromEntries(keys.map(k => [k, structuredClone(data[k])])); },
      async set(values) { Object.assign(data, structuredClone(values)); },
      async remove(key) { delete data[key]; }
    } },
    alarms: { onAlarm: event(), async get(name) { return alarms.get(name); },
      async clear(name) { return alarms.delete(name); },
      async create(name, info) { alarms.set(name, { name, scheduledTime: info.when }); } },
    tabs: { onActivated: event(), onUpdated: event(), onRemoved: event(),
      async query(query) { return query.active ? (activeTab ? [structuredClone(activeTab)] : []) : structuredClone([...(activeTab ? [activeTab] : []), ...otherTabs.values()]); },
      async get(id) { const tab = id === activeTab?.id ? activeTab : otherTabs.get(id); if (!tab) throw new Error('Tab not found'); return structuredClone(tab); },
      async remove(id) { closed.push(id); otherTabs.delete(id); if (activeTab?.id === id) activeTab = null; },
      async sendMessage(id, message) {
        if (!receivers.has(id)) throw new Error('Receiving end does not exist');
        delivered.push({ id, ...structuredClone(message) });
        return { ok: true, version: '0.2.1' };
      } },
    windows: { WINDOW_ID_NONE: -1, onFocusChanged: event(), async get() { return { focused }; } },
    scripting: { async executeScript(args) { injected.push(args); receivers.add(args.target.tabId); } }
  };
  class Clock extends Date { static now() { return time; } }
  const context = vm.createContext({ chrome, URL, crypto: { randomUUID }, Date: Clock, console });
  context.importScripts = name => vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', name), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/background.js'), 'utf8'), context);
  async function message(type, extra = {}, fromTab = false) {
    const sender = fromTab ? { id: 'test', tab: activeTab } : { id: 'test', url: 'chrome-extension://test/src/popup.html' };
    return new Promise(resolve => chrome.runtime.onMessage.listeners[0]({ type, ...extra }, sender, resolve));
  }
  return { data, alarms, receivers, delivered, injected, opened, closed, sounds, otherTabs, message, chrome,
    badges, playbacks, audioReplies, audioDocuments, contextQueries,
    now() { return time; },
    dropAudioDocument() { audioExists = false; playedCues.clear(); },
    async fire(name) {
      alarms.delete(name);
      await Promise.all(chrome.alarms.onAlarm.listeners.map(fn => fn({ name })));
    },
    async focus(value) {
      focused = value;
      await Promise.all(chrome.windows.onFocusChanged.listeners.map(fn => fn(value ? 1 : -1)));
    },
    async entry() { await this.state(); this.advance(120000); return this.state(); },
    async present() { return message('PROMPT_PRESENTED', { promptId: data.mf_session.prompt.id }); },
    advance(ms) { time += ms; },
    setTab(url, id = 1) { activeTab = { id, windowId: 1, active: true, url }; },
    setNoTab() { activeTab = null; },
    setFocused(value) { focused = value; },
    async state() { return message('GET_UI_STATE'); },
    async act(action) { const s = data.mf_session; return message('PROMPT_ACTION', { sessionId: s.id, promptId: s.prompt.id, action, confirmClose: true }); }
  };
}

test('no page injection or manual check-in is needed', async () => {
  const h = harness();
  await h.state();
  assert.equal(h.injected.length, 0);
  assert.equal(h.opened.length, 0);
  assert.equal((await h.message('CHECK_IN_NOW')).ok, false);
  await h.entry();
  assert.equal(h.opened.length, 1);
});

test('an overdue timer is recovered even if the alarm disappeared', async () => {
  const h = harness();
  await h.state();
  h.advance(120001);
  h.alarms.clear();
  const result = await h.state();
  assert.equal(result.session.state, 'listed_prompt');
  assert.equal(result.session.prompt.kind, 'distraction');
  assert.equal(h.opened.length, 1);
});

test('switching between listed sites preserves the deadline; zone changes clear the old card', async () => {
  const h = harness();
  await h.state();
  const deadline = h.data.mf_session.nextAt;
  h.advance(30000);
  h.setTab('https://www.instagram.com/reels/', 2);
  await h.state();
  assert.equal(h.data.mf_session.nextAt, deadline);
  h.advance(100000);
  await h.state();
  h.setTab('https://docs.google.com/document', 2);
  await h.state();
  assert.equal(h.data.mf_session.zone, 'neutral');
  assert.equal(h.data.mf_session.prompt, null);
  assert.equal(h.opened.length, 1);
});

test('study confirmation, snooze, tab continuity, and snooze expiry', async () => {
  const h = harness();
  h.setTab('https://youtube.com/watch?v=study');
  await h.state();
  h.advance(120000);
  assert.equal((await h.state()).session.prompt.kind, 'study-check');
  await h.act('study_yes');
  h.advance(120000);
  assert.equal((await h.state()).session.state, 'study_prompt');
  await h.act('study_snooze');
  await h.act('snooze_20');
  const deadline = h.data.mf_session.nextAt;
  h.setTab('https://stackoverflow.com/questions', 4);
  await h.state();
  assert.equal(h.data.mf_session.nextAt, deadline);
  assert.equal(h.data.mf_session.prompt, null);
  h.advance(1200000);
  assert.equal((await h.state()).session.state, 'study_prompt');
});

test('a No answer enters accountability after two minutes and rejects unlisted time choices and never closes neutral tabs', async () => {
  const h = harness();
  h.setTab('https://example.com');
  await h.state();
  h.advance(120000);
  await h.state();
  await h.act('study_no');
  h.advance(120000);
  await h.state();
  const prompt = structuredClone(h.data.mf_session.prompt);
  assert.equal(prompt.kind, 'distraction');
  assert.equal((await h.act('distraction_999')).ok, false);
  assert.equal(h.data.mf_session.prompt.id, prompt.id);
  await h.act('distraction_1');
  assert.equal(h.data.mf_session.state, 'listed_wait');
  h.advance(60000);
  assert.equal((await h.state()).session.state, 'listed_prompt');
});

test('ignore escalation validates the active prompt and happens after 18 seconds', async () => {
  const h = harness();
  await h.state();
  h.advance(120000);
  await h.state();
  const s = h.data.mf_session;
  await h.present();
  await h.state();
  assert.equal(h.data.mf_session.state, 'listed_prompt');
  h.advance(18000);
  await h.present();
  await h.state();
  assert.equal(h.data.mf_session.state, 'yapping');
  assert.equal(h.data.mf_session.prompt.mood, 'yapping');
});

test('unsupported pages still pause but returning to an unfocused website keeps counting', async () => {
  const h = harness();
  await h.state();
  h.advance(10000);
  h.setTab('chrome://extensions');
  await h.state();
  assert.equal(h.data.mf_session.activeTabId, null);
  assert.equal(h.data.mf_session.nextAt, null);
  h.advance(500000);
  h.setTab('https://x.com');
  await h.state();
  assert.equal(h.data.mf_session.state, 'entry_wait');
  h.setFocused(false);
  await h.state();
  assert.equal(h.data.mf_session.nextAt, h.now() + 110000);
  assert.equal(h.alarms.get('mf-session-timer').scheduledTime, h.data.mf_session.nextAt);
});

test('name settings migrate without erasing the listed domains', async () => {
  const h = harness();
  await h.state();
  await h.message('SAVE_SETTINGS', { settings: { mascotName: '  Mochi  ' } });
  const result = await h.state();
  assert.equal(result.settings.mascotName, 'Mochi');
  assert.ok(result.settings.listedDomains.includes('instagram.com'));
  assert.ok(!result.settings.listedDomains.includes('youtube.com'));
  const invalid = await h.message('SAVE_SETTINGS', { settings: { listedDomains: ['not a domain'] } });
  assert.equal(invalid.ok, false);
});

test('closing requires a fresh explicit selection after the warning', async () => {
  const h = harness();
  await h.entry();
  const s = h.data.mf_session;
  const result = await h.message('PROMPT_ACTION', { sessionId: s.id, promptId: s.prompt.id, action: 'distraction_2' });
  assert.equal(result.ok, false);
  assert.equal(h.data.mf_closeJob, undefined);
  await h.act('distraction_2');
  assert.equal(h.data.mf_session.state, 'closing_wait');
});

test('missing future alarm is recreated without restarting the session', async () => {
  const h = harness();
  await h.state();
  const nextAt = h.data.mf_session.nextAt;
  h.advance(30000);
  h.alarms.clear();
  await h.state();
  assert.equal(h.alarms.get('mf-session-timer').scheduledTime, nextAt);
});

test('popup refusal leaves a badge reminder and never loops open attempts', async () => {
  const h = harness();
  let attempts = 0;
  h.chrome.action.openPopup = async () => { attempts++; throw new Error('No active window'); };
  await h.entry();
  assert.match(h.data.mf_session.deliveryError, /toolbar icon/);
  await h.state(); await h.state();
  assert.equal(attempts, 1);
  await h.present();
  assert.equal(h.sounds.length, 1);
});

test('duplicate simultaneous answers cannot overwrite the first chosen deadline', async () => {
  const h = harness();
  await h.entry();
  const s = h.data.mf_session;
  const action = { sessionId: s.id, promptId: s.prompt.id, action: 'distraction_2', confirmClose: true };
  const results = await Promise.all([h.message('PROMPT_ACTION', action), h.message('PROMPT_ACTION', action)]);
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.equal(h.data.mf_session.state, 'closing_wait');
});

test('listed domains match subdomains but not lookalikes', async () => {
  const h = harness();
  h.setTab('https://m.instagram.com');
  assert.equal((await h.state()).session.zone, 'distraction');
  h.setTab('https://notinstagram.com');
  assert.equal((await h.state()).session.zone, 'neutral');
});

test('returning to a listed site interrupts study snooze with a fresh entry', async () => {
  const h = harness();
  h.setTab('https://example.com');
  await h.entry();
  await h.act('study_yes');
  h.advance(120000);
  await h.state();
  await h.act('study_snooze');
  await h.act('snooze_30');
  h.setTab('https://instagram.com');
  const state = await h.state();
  assert.equal(state.session.state, 'entry_wait');
  assert.equal(state.session.snoozedUntil, null);
  assert.equal(state.session.zone, 'distraction');
});

test('snooze duration expires by wall clock even while the browser is unfocused', async () => {
  const h = harness();
  h.setTab('https://example.com');
  await h.entry();
  await h.act('study_yes');
  h.advance(120000);
  await h.state();
  await h.act('study_snooze');
  await h.act('snooze_20');
  h.setFocused(false);
  await h.state();
  h.advance(1200000);
  h.setFocused(true);
  assert.equal((await h.state()).session.state, 'study_prompt');
});

test('malformed domains saved by version 0.1 do not break startup', async () => {
  const h = harness();
  await h.state();
  h.data.mf_settings = { listedDomains: ['not a website', 'x.com'] };
  const result = await h.state();
  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(result.settings.listedDomains), ['x.com']);
});

test('focused toolbar popup can operate its webpage when the parent window reports unfocused', async () => {
  const h = harness();
  await h.state();
  h.setFocused(false);
  const popup = { popupTabId: 1, popupFocused: true };
  const state = await h.message('GET_UI_STATE', popup);
  assert.equal(state.available, true);
  assert.equal(state.session.hostname, 'x.com');
  h.advance(120000);
  assert.equal((await h.message('GET_UI_STATE', popup)).session.state, 'listed_prompt');
});

test('toolbar uses its own current window tab instead of an unrelated last-focused window', async () => {
  const h = harness();
  await h.state();
  h.chrome.tabs.query = async () => [{ id: 99, windowId: 2, active: true, url: 'chrome://extensions' }];
  const state = await h.message('GET_UI_STATE', { popupTabId: 1, popupFocused: true });
  assert.equal(state.available, true);
  assert.equal(state.pageLabel, 'https://x.com');
});

test('unfocused websites remain available; restricted pages and loading still do not', async () => {
  const h = harness();
  await h.state();
  h.setFocused(false);
  assert.equal((await h.state()).available, true);
  assert.equal((await h.state()).unavailableReason, null);
  h.setTab('chrome://extensions');
  const restricted = await h.message('GET_UI_STATE', { popupTabId: 1, popupFocused: true });
  assert.equal(restricted.available, false);
  assert.equal(restricted.unavailableReason, 'restricted_page');
  assert.equal(restricted.pageLabel, 'chrome://extensions');
  h.setTab('');
  assert.equal((await h.state()).unavailableReason, 'loading');
});

test('a content script cannot claim the toolbar focus exception', async () => {
  const h = harness();
  await h.state();
  h.setFocused(false);
  const state = await h.message('GET_UI_STATE', { popupTabId: 1, popupFocused: true }, true);
  assert.equal(state.ok, false);
  assert.match(state.error, /extension popup/);
});

test('all 1–5 and 10 minute choices have the exact durable closing deadline', async () => {
  for (const minutes of [1, 2, 3, 4, 5, 10]) {
    const h = harness();
    await h.entry();
    const now = h.data.mf_session.prompt;
    assert.ok(now.options.some(o => o.action === 'distraction_' + minutes));
    await h.act('distraction_' + minutes);
    assert.equal(h.data.mf_closeJob.deadline, 1_800_000_120_000 + minutes * 60000);
  }
});

test('expiry closes all listed tabs across windows but not YouTube, lookalikes or neutral tabs', async () => {
  const h = harness();
  await h.entry();
  h.otherTabs.set(2, { id: 2, windowId: 2, url: 'https://m.instagram.com/reels', pinned: true });
  h.otherTabs.set(3, { id: 3, windowId: 3, url: 'https://youtube.com/watch' });
  h.otherTabs.set(4, { id: 4, windowId: 2, url: 'https://notinstagram.com' });
  h.otherTabs.set(5, { id: 5, windowId: 3, url: 'https://docs.google.com' });
  await h.act('distraction_1');
  h.advance(60000);
  await h.state();
  assert.deepEqual(h.closed, [1, 2]);
  assert.equal(h.data.mf_closeJob, null);
  await h.state();
  assert.deepEqual(h.closed, [1, 2]);
});

test('zone changes, unfocused windows and missing alarms cannot reset a closing commitment', async () => {
  const h = harness();
  await h.entry(); await h.act('distraction_10');
  const deadline = h.data.mf_closeJob.deadline;
  h.otherTabs.set(2, { id: 2, windowId: 2, url: 'https://reddit.com' });
  h.setTab('https://docs.google.com');
  await h.state();
  h.setFocused(false);
  h.alarms.clear();
  await h.state();
  assert.equal(h.alarms.get('mf-close-listed').scheduledTime, deadline);
  h.advance(600000);
  await h.state();
  assert.deepEqual(h.closed, [2]);
});

test('cancel protects every tab and does not leave a closing alarm', async () => {
  const h = harness();
  await h.entry(); await h.act('distraction_1');
  await h.message('CANCEL_CLOSING');
  h.advance(60000); await h.state();
  assert.deepEqual(h.closed, []);
  assert.equal(h.alarms.has('mf-close-listed'), false);
});

test('settings additions cannot widen consent and removals protect matching tabs', async () => {
  const h = harness();
  await h.entry(); await h.act('distraction_1');
  h.otherTabs.set(2, { id: 2, windowId: 2, url: 'https://example.com' });
  await h.message('SAVE_SETTINGS', { settings: { listedDomains: ['example.com'] } });
  h.advance(60000); await h.state();
  assert.deepEqual(h.closed, []);
});

test('tab navigation is rechecked before closing and pending neutral navigation is protected', async () => {
  const h = harness();
  await h.entry(); await h.act('distraction_1');
  h.otherTabs.set(2, { id: 2, url: 'https://x.com', pendingUrl: 'https://example.com' });
  const get = h.chrome.tabs.get;
  h.chrome.tabs.get = async id => id === 1 ? { id, url: 'https://docs.google.com' } : get(id);
  h.advance(60000); await h.state();
  assert.deepEqual(h.closed, []);
});

test('legacy non-destructive timer migration never grants tab-close consent', async () => {
  const h = harness();
  await h.state();
  Object.assign(h.data.mf_session, { state: 'listed_wait', nextAt: 1, prompt: null });
  await h.state();
  assert.equal(h.data.mf_session.state, 'listed_prompt');
  assert.deepEqual(h.closed, []);
});

test('sound plays automatically once per prompt, never on polling, presentation or snooze picker', async () => {
  const h = harness();
  h.setTab('https://example.com');
  await h.entry();
  assert.equal(h.sounds.filter(m => m.type === 'PLAY').length, 1);
  await h.present(); await h.present(); await h.state();
  assert.equal(h.sounds.filter(m => m.type === 'PLAY').length, 1);
  assert.equal(h.sounds[0].gentle, true);
  await h.act('study_yes'); h.advance(120000); await h.state(); await h.present();
  await h.act('study_snooze'); await h.present();
  assert.equal(h.sounds.filter(m => m.type === 'PLAY').length, 2);
});

test('mute persists, stops existing sound and still returns animation timing', async () => {
  const h = harness();
  await h.message('SAVE_SETTINGS', { settings: { soundEnabled: false } });
  await h.entry();
  const response = await h.present();
  assert.ok(response.session.prompt.cue.startAt);
  assert.equal(response.session.prompt.cue.audioStatus, 'muted');
  assert.equal(response.session.prompt.cueIssued, true);
  assert.equal(h.alarms.has('mf-audio-retry'), false);
  assert.equal(h.sounds.filter(m => m.type === 'PLAY').length, 0);
  assert.equal(h.sounds[0].type, 'STOP');
});

test('sound failure does not lose the prompt or interrupt its buttons', async () => {
  const h = harness();
  h.chrome.offscreen.createDocument = async () => { throw new Error('Unavailable'); };
  await h.entry();
  const response = await h.present();
  assert.equal(response.session.prompt.audioError, 'Unavailable');
  assert.equal(response.session.prompt.cueIssued, false);
  assert.equal((await h.act('distraction_1')).ok, true);
});

test('quote attribution survives yapping and recent quotes survive zone switches', async () => {
  const h = harness();
  await h.entry(); await h.present();
  const first = h.data.mf_session.prompt.quoteInfo;
  h.advance(18000); await h.state();
  assert.equal(h.data.mf_session.prompt.quoteInfo.id, first.id);
  h.setTab('https://example.com'); await h.entry();
  assert.ok(h.data.mf_session.usedQuotes.classics.includes(first.id));
  assert.ok(h.data.mf_session.prompt.quoteInfo.sourceUrl.startsWith('https://'));
});

test('an individual tab-close failure does not block other targets or cause replay', async () => {
  const h = harness();
  await h.entry(); await h.act('distraction_1');
  h.otherTabs.set(2, { id: 2, url: 'https://reddit.com' });
  const remove = h.chrome.tabs.remove;
  h.chrome.tabs.remove = async id => { if (id === 1) throw new Error('Already gone'); await remove(id); };
  h.advance(60000); await h.state(); await h.state();
  assert.deepEqual(h.closed, [2]);
  assert.equal(h.data.mf_closeResult.failed, 1);
});

test('legacy visible prompt is replaced with warning and cannot close tabs without consent', async () => {
  const h = harness();
  await h.entry();
  delete h.data.mf_session.version;
  delete h.data.mf_session.prompt.closesListed;
  const legacyId = h.data.mf_session.prompt.id;
  await h.state();
  assert.notEqual(h.data.mf_session.prompt.id, legacyId);
  assert.equal(h.data.mf_session.prompt.closesListed, true);
  assert.equal(h.data.mf_closeJob, undefined);
});

test('a new worker restores a persisted closing job without changing its deadline', async () => {
  const first = harness();
  await first.entry(); await first.act('distraction_1');
  const second = harness(first.data);
  await second.state();
  assert.equal(second.alarms.get('mf-close-listed').scheduledTime, first.data.mf_closeJob.deadline);
  second.advance(180000);
  await second.state();
  assert.deepEqual(second.closed, [1]);
});

test('study snooze cannot cancel an already chosen closing commitment', async () => {
  const h = harness();
  await h.entry(); await h.act('distraction_10');
  h.otherTabs.set(2, { id: 2, url: 'https://instagram.com' });
  h.setTab('https://example.com');
  await h.entry(); await h.act('study_yes');
  h.advance(120000); await h.state(); await h.act('study_snooze'); await h.act('snooze_40');
  h.advance(360000); await h.state();
  assert.deepEqual(h.closed, [2]);
  assert.equal(h.data.mf_session.state, 'snoozed');
});

test('entry deadlines and alarms keep counting while Chrome is unfocused', async () => {
  const h = harness();
  await h.state();
  const deadline = h.data.mf_session.nextAt;
  h.advance(45000);
  await h.focus(false);
  const away = await h.state();
  assert.equal(away.available, true);
  assert.equal(away.unavailableReason, null);
  assert.equal(away.session.activeTabId, 1);
  assert.equal(away.session.nextAt, deadline);
  assert.equal(h.alarms.get('mf-session-timer').scheduledTime, deadline);
  h.advance(75000);
  await h.fire('mf-session-timer');
  assert.equal(h.data.mf_session.state, 'listed_prompt');
  assert.equal(h.playbacks.length, 1);
  assert.equal(h.data.mf_session.prompt.shownAt, null);
  assert.equal(h.data.mf_session.prompt.cueIssued, true);
});

test('off-browser popup failure still sounds, then retries opening once when focus returns', async () => {
  const h = harness();
  await h.focus(false);
  let attempts = 0;
  h.chrome.action.openPopup = async () => {
    attempts++;
    if (attempts === 1) throw new Error('Browser window is not active.');
  };
  await h.entry();
  assert.equal(attempts, 1);
  assert.equal(h.badges.at(-1), '!');
  assert.match(h.data.mf_session.deliveryError, /toolbar icon/);
  assert.equal(h.playbacks.length, 1);
  await h.state(); await h.state();
  assert.equal(attempts, 1);
  await h.focus(true);
  assert.equal(attempts, 2);
  assert.equal(h.data.mf_session.deliveryError, null);
  await h.focus(false); await h.focus(true); await h.state();
  assert.equal(attempts, 2);
  assert.equal(h.playbacks.length, 1);
});

test('a failed focus-return attempt never loops or steals focus on later polls/events', async () => {
  const h = harness();
  let attempts = 0;
  h.chrome.action.openPopup = async () => { attempts++; throw new Error('Popup blocked.'); };
  await h.entry();
  await h.focus(false); await h.focus(true);
  await h.focus(false); await h.focus(true); await h.state();
  assert.equal(attempts, 2);
  assert.equal(h.badges.at(-1), '!');
  assert.equal(h.data.mf_session.prompt.openRetryOnFocus, false);
  assert.equal(h.playbacks.length, 1);
});

test('popup opening is attempted before audio, and a refusal does not skip audio', async () => {
  const h = harness();
  const sequence = [];
  const send = h.chrome.runtime.sendMessage;
  h.chrome.action.openPopup = async () => { sequence.push('popup'); throw new Error('No active window'); };
  h.chrome.runtime.sendMessage = async message => { sequence.push('audio'); return send(message); };
  await h.entry();
  assert.deepEqual(sequence, ['popup', 'audio']);
  assert.equal(h.data.mf_session.prompt.cue.audioStatus, 'started');
});

test('failed playback retries only on its independent alarm and keeps the same cueId', async () => {
  const h = harness();
  h.audioReplies.push({ ok: false, error: 'NotAllowedError: playback needs a user gesture.' });
  const first = await h.entry();
  const prompt = first.session.prompt;
  assert.equal(prompt.audioError, 'NotAllowedError: playback needs a user gesture.');
  assert.equal(prompt.cueIssued, false);
  assert.equal(prompt.cue, null);
  assert.equal(prompt.audioAttempts, 1);
  assert.equal(h.alarms.get('mf-audio-retry').scheduledTime, h.now() + 30000);
  await h.state(); await h.state();
  h.advance(30000);
  await h.state(); // Even an overdue poll must not replay audio.
  assert.equal(h.sounds.length, 1);
  await h.fire('mf-audio-retry');
  assert.equal(h.sounds.length, 2);
  assert.equal(h.sounds[0].cueId, h.sounds[1].cueId);
  assert.equal(h.opened.length, 1);
  assert.equal(h.data.mf_session.prompt.cueIssued, true);
  assert.equal(h.data.mf_session.prompt.audioError, null);
  assert.equal(h.data.mf_session.prompt.cue.startAt, h.now());
  assert.equal(h.data.mf_session.prompt.cue.audioStatus, 'started');
  assert.equal(h.alarms.has('mf-audio-retry'), false);
  await h.present(); await h.present(); await h.fire('mf-audio-retry');
  assert.equal(h.sounds.length, 2);
});

test('audio retries stop after three attempts and policy failures never recreate the document', async () => {
  const h = harness();
  h.audioReplies.push(...Array.from({ length: 3 }, () => ({ ok: false, error: 'Autoplay policy refused playback.' })));
  await h.entry();
  h.advance(30000); await h.fire('mf-audio-retry');
  assert.equal(h.alarms.get('mf-audio-retry').scheduledTime, h.now() + 60000);
  h.advance(60000); await h.fire('mf-audio-retry');
  assert.equal(h.data.mf_session.prompt.audioAttempts, 3);
  assert.equal(h.data.mf_session.prompt.cueIssued, false);
  assert.equal(h.data.mf_session.prompt.audioError, 'Autoplay policy refused playback.');
  assert.equal(h.alarms.has('mf-audio-retry'), false);
  h.advance(90000); await h.fire('mf-audio-retry'); await h.state();
  assert.equal(h.sounds.length, 3);
  assert.equal(h.audioDocuments.length, 1);
  assert.equal(h.opened.length, 1);
});

test('early retry alarms cannot bypass backoff', async () => {
  const h = harness();
  h.audioReplies.push({ ok: false, error: 'Temporarily unavailable.' });
  await h.entry();
  const deadline = h.data.mf_session.prompt.audioRetryAt;
  h.advance(5000); await h.fire('mf-audio-retry');
  assert.equal(h.sounds.length, 1);
  assert.equal(h.alarms.get('mf-audio-retry').scheduledTime, deadline);
});

test('an offscreen document that disappears between lookup and delivery is recovered once', async () => {
  const h = harness();
  const contexts = h.chrome.runtime.getContexts;
  let stale = true;
  h.chrome.runtime.getContexts = async query => {
    if (stale) { stale = false; return [{}]; }
    return contexts(query);
  };
  await h.entry();
  assert.equal(h.sounds.length, 2);
  assert.equal(h.sounds[0].cueId, h.sounds[1].cueId);
  assert.equal(h.audioDocuments.length, 1);
  assert.equal(h.playbacks.length, 1);
  assert.equal(h.data.mf_session.prompt.cueIssued, true);
  assert.equal(h.alarms.has('mf-audio-retry'), false);
});

test('lost transport replies use an idempotent cueId without replaying already-started media', async () => {
  const h = harness();
  const send = h.chrome.runtime.sendMessage;
  let loseReply = true;
  h.chrome.runtime.sendMessage = async message => {
    const response = await send(message);
    if (loseReply) { loseReply = false; throw new Error('The message port closed before a response was received.'); }
    return response;
  };
  await h.entry();
  assert.equal(h.sounds.length, 2);
  assert.equal(h.playbacks.length, 1);
  assert.equal(h.audioDocuments.length, 1);
  assert.equal(h.data.mf_session.prompt.cueIssued, true);
});

test('a successful response without actual started status is treated as a failure', async () => {
  const h = harness();
  h.audioReplies.push({ ok: true, startAt: h.now() });
  await h.entry();
  assert.equal(h.data.mf_session.prompt.cueIssued, false);
  assert.equal(h.data.mf_session.prompt.cue, null);
  assert.match(h.data.mf_session.prompt.audioError, /started/);
  assert.equal(h.alarms.has('mf-audio-retry'), true);
});

test('the worker does not mark a cue issued while media startup is still pending', { timeout: 2000 }, async () => {
  const h = harness();
  await h.state();
  let started, release;
  const waiting = new Promise(resolve => { started = resolve; });
  h.chrome.runtime.sendMessage = () => new Promise(resolve => { release = resolve; started(); });
  h.advance(120000);
  const response = h.state();
  await waiting;
  const pending = structuredClone(h.data.mf_session.prompt);
  const startAt = h.now() + 350;
  release({ ok: true, startAt, audioStatus: 'started' });
  const result = await response;
  assert.equal(pending.cueIssued, false);
  assert.equal(pending.audioAttempts, 1);
  assert.equal(result.session.prompt.cueIssued, true);
  assert.equal(result.session.prompt.cue.startAt, startAt);
});

test('offscreen-target messages bypass the worker queue and cannot deadlock their own replies', async () => {
  const h = harness();
  const send = h.chrome.runtime.sendMessage;
  const handled = [];
  h.chrome.runtime.sendMessage = async message => {
    handled.push(h.chrome.runtime.onMessage.listeners[0](message,
      { url: 'chrome-extension://test/src/offscreen.html' }, () => assert.fail('Worker must not reply to audio messages.')));
    return send(message);
  };
  await h.entry();
  assert.deepEqual(handled, [false]);
  assert.equal(h.data.mf_session.prompt.cueIssued, true);
});

test('a restart restores a pending sound retry without reopening the popup or losing backoff', async () => {
  const first = harness();
  first.audioReplies.push({ ok: false, error: 'Output device was unavailable.' });
  await first.entry();
  const prompt = structuredClone(first.data.mf_session.prompt);
  const next = harness(first.data, { time: first.now() + 10000 });
  await next.state();
  assert.equal(next.alarms.get('mf-audio-retry').scheduledTime, prompt.audioRetryAt);
  assert.equal(next.sounds.length, 0);
  assert.equal(next.opened.length, 0);
  next.advance(20000); await next.fire('mf-audio-retry');
  assert.equal(next.sounds[0].cueId, prompt.cueId);
  assert.equal(next.data.mf_session.prompt.cueIssued, true);
  assert.equal(next.opened.length, 0);
});

test('a successfully played prompt stays silent after worker restart and reopening the popup', async () => {
  const first = harness();
  await first.entry();
  const next = harness(first.data, { time: first.now() + 1000 });
  await next.state(); await next.present(); await next.state();
  assert.equal(next.sounds.length, 0);
  assert.equal(next.opened.length, 0);
  assert.equal(next.data.mf_session.prompt.cue.startAt, first.data.mf_session.prompt.cue.startAt);
});

test('unmuting allows the current silently issued prompt to play exactly once', async () => {
  const h = harness({ mf_settings: { soundEnabled: false } });
  await h.entry();
  assert.equal(h.sounds.length, 0);
  assert.equal(h.audioDocuments.length, 0);
  const muted = h.data.mf_session.prompt;
  assert.equal(muted.cue.audioStatus, 'muted');
  const result = await h.message('SAVE_SETTINGS', { settings: { soundEnabled: true } });
  assert.equal(result.session.prompt.id, muted.id);
  assert.equal(result.session.prompt.cue.audioStatus, 'started');
  assert.equal(h.playbacks.length, 1);
  await h.present(); await h.state();
  assert.equal(h.playbacks.length, 1);
});

test('muting cancels failed sound retries, but toggling mute after success does not replay it', async () => {
  const h = harness();
  h.audioReplies.push({ ok: false, error: 'Playback blocked.' });
  await h.entry();
  await h.message('SAVE_SETTINGS', { settings: { soundEnabled: false } });
  assert.equal(h.alarms.has('mf-audio-retry'), false);
  assert.equal(h.data.mf_session.prompt.audioError, null);
  assert.equal(h.data.mf_session.prompt.cue.audioStatus, 'muted');
  h.advance(30000); await h.fire('mf-audio-retry');
  assert.equal(h.sounds.filter(m => m.type === 'PLAY').length, 1);
  await h.message('SAVE_SETTINGS', { settings: { soundEnabled: true } });
  assert.equal(h.playbacks.length, 1);
  await h.message('SAVE_SETTINGS', { settings: { soundEnabled: false } });
  await h.message('SAVE_SETTINGS', { settings: { soundEnabled: true } });
  assert.equal(h.playbacks.length, 1);
});

test('direct popup audio ACK records actual timing, clears the error and cancels retries', async () => {
  const h = harness();
  h.audioReplies.push({ ok: false, error: 'User gesture required.' });
  await h.entry();
  const startAt = h.now() - 10;
  const result = await h.message('POPUP_AUDIO_STARTED', {
    promptId: h.data.mf_session.prompt.id, cue: { startAt }
  });
  assert.equal(result.ok, true);
  assert.equal(result.session.prompt.cueIssued, true);
  assert.equal(result.session.prompt.cue.startAt, startAt);
  assert.equal(result.session.prompt.cue.audioStatus, 'started');
  assert.equal(result.session.prompt.audioError, null);
  assert.equal(h.alarms.has('mf-audio-retry'), false);
  await h.present(); await h.fire('mf-audio-retry'); await h.state();
  assert.equal(h.sounds.length, 1);
});

test('stale, malformed and non-popup audio ACKs cannot cancel the current retry', async () => {
  const h = harness();
  h.audioReplies.push({ ok: false, error: 'User gesture required.' });
  await h.entry();
  const ack = { promptId: h.data.mf_session.prompt.id, cue: { startAt: h.now() } };
  assert.equal((await h.message('POPUP_AUDIO_STARTED', { ...ack, promptId: 'old' })).ok, false);
  assert.equal((await h.message('POPUP_AUDIO_STARTED', { ...ack, cue: { startAt: 'now' } })).ok, false);
  assert.equal((await h.message('POPUP_AUDIO_STARTED', ack, true)).ok, false);
  assert.equal(h.alarms.has('mf-audio-retry'), true);
  assert.equal(h.data.mf_session.prompt.cueIssued, false);
});

test('restricted pages and no-tab states still suppress new prompts and audio retries', async () => {
  const h = harness();
  h.audioReplies.push({ ok: false, error: 'Try again later.' });
  await h.entry();
  h.setFocused(false);
  h.setTab('chrome://extensions');
  assert.equal((await h.state()).unavailableReason, 'restricted_page');
  h.advance(30000); await h.fire('mf-audio-retry');
  assert.equal(h.sounds.length, 1);
  h.setNoTab();
  assert.equal((await h.state()).unavailableReason, 'no_tab');
  await h.fire('mf-session-timer'); await h.fire('mf-audio-retry');
  assert.equal(h.sounds.length, 1);
});

test('study snooze stays silent while away and its expiry automatically delivers a gentle cue', async () => {
  const h = harness();
  h.setTab('https://example.com');
  await h.entry(); await h.act('study_yes');
  h.advance(120000); await h.state();
  await h.act('study_snooze'); await h.act('snooze_20');
  const before = h.playbacks.length;
  await h.focus(false);
  h.advance(1199999); await h.state();
  assert.equal(h.playbacks.length, before);
  h.advance(1); await h.fire('mf-session-timer');
  assert.equal(h.data.mf_session.state, 'study_prompt');
  assert.equal(h.playbacks.length, before + 1);
  assert.equal(h.playbacks.at(-1).gentle, true);
});

test('answering a failed-sound prompt cancels only its retry, not a confirmed closing timer', async () => {
  const h = harness();
  h.audioReplies.push({ ok: false, error: 'Playback unavailable.' });
  await h.entry(); await h.act('distraction_10');
  const deadline = h.data.mf_closeJob.deadline;
  assert.equal(h.alarms.has('mf-audio-retry'), false);
  await h.fire('mf-audio-retry');
  assert.equal(h.sounds.length, 1);
  assert.equal(h.data.mf_closeJob.deadline, deadline);
  assert.equal(h.alarms.get('mf-close-listed').scheduledTime, deadline);
});

test('0.3.1 preserves current consent/timers but repairs the old premature sound flag', async () => {
  const first = harness();
  await first.entry();
  const id = first.data.mf_session.prompt.id;
  first.data.mf_session.version = '0.3.0';
  delete first.data.mf_session.prompt.cue;
  delete first.data.mf_session.prompt.audioAttempts;
  const next = harness(first.data, { time: first.now() });
  const state = await next.state();
  assert.equal(state.version, '0.3.2');
  assert.equal(state.session.prompt.id, id);
  assert.equal(state.session.prompt.closesListed, true);
  assert.equal(state.session.prompt.cue.audioStatus, 'started');
  assert.equal(next.playbacks.length, 1);
  await next.act('distraction_10');
  const job = structuredClone(next.data.mf_closeJob);
  next.data.mf_session.version = '0.3.0';
  const again = harness(next.data, { time: next.now() });
  await again.state();
  assert.deepEqual(again.data.mf_closeJob, job);
  assert.equal(again.data.mf_session.state, 'closing_wait');
});
test('non-listed Yes, No and keep-checking follow-ups fire at exactly two minutes', async () => {
  for (const action of ['study_yes', 'study_no', 'study_keep_checking']) {
    const h = harness();
    h.setTab('https://example.com');
    await h.entry();
    if (action === 'study_keep_checking') {
      await h.act('study_yes');
      h.advance(120000);
      await h.state();
    }
    const now = h.now();
    await h.act(action);
    assert.equal(h.data.mf_session.nextAt, now + 120000);
    h.advance(119999);
    assert.equal((await h.state()).session.prompt, null);
    h.advance(1);
    await h.fire('mf-session-timer');
    assert.equal(h.data.mf_session.prompt.kind, action === 'study_no' ? 'distraction' : 'study');
    assert.equal(h.closed.length, 0);
  }
});
