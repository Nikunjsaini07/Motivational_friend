importScripts('quotes.js');

const VERSION = '0.3.2';
const CLOSE_ALARM = 'mf-close-listed';
const IDLE_ALARM = 'mf-idle-prompt';
const AUDIO_ALARM = 'mf-audio-retry';
const AUDIO_RETRY_MS = [30000, 60000];
const MAX_AUDIO_ATTEMPTS = AUDIO_RETRY_MS.length + 1;
const ALARM = 'mf-session-timer';
const ENTRY_MS = 120000;
const STUDY_MS = 120000;
const DEFAULTS = {
  mascotName: 'Momo',
  soundEnabled: true,
  listedDomains: ['instagram.com', 'x.com', 'twitter.com', 'facebook.com', 'reddit.com', 'tiktok.com', 'snapchat.com'],
  responseTimeoutMs: 18000
};

// Serialize events so concurrent clicks, tab changes and alarms cannot overwrite state.
let workQueue = Promise.resolve();
function enqueue(task) {
  const result = workQueue.then(task);
  workQueue = result.catch(error => console.warn('Motivation Friend:', error.message));
  return result;
}

function domainFrom(value) {
  const input = String(value).trim();
  if (!input || /\s/.test(input)) throw new Error('Enter a domain like instagram.com.');
  let url;
  try { url = new URL(input.includes('://') ? input : 'https://' + input); }
  catch { throw new Error('Enter a domain like instagram.com.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Enter a website domain, without a username or password.');
  }
  const domain = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (domain !== 'localhost' && !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]+$/.test(domain)) {
    throw new Error('Enter a complete domain, such as x.com.');
  }
  return domain;
}

function settingsFrom(raw = {}) {
  return {
    mascotName: String(raw.mascotName || DEFAULTS.mascotName).trim().slice(0, 24) || DEFAULTS.mascotName,
    listedDomains: Array.isArray(raw.listedDomains)
      ? [...new Set(raw.listedDomains.map(domainFrom))] : [...DEFAULTS.listedDomains],
    soundEnabled: raw.soundEnabled !== false,
    responseTimeoutMs: DEFAULTS.responseTimeoutMs
  };
}

async function readState() {
  const data = await chrome.storage.local.get(['mf_settings', 'mf_session']);
  // The first release accepted arbitrary domain text. Keep valid saved entries
  // when upgrading instead of letting one malformed entry stop the worker.
  const raw = { ...data.mf_settings };
  if (Array.isArray(raw.listedDomains)) raw.listedDomains = raw.listedDomains.flatMap(value => {
    try { return [domainFrom(value)]; } catch { return []; }
  });
  return { settings: settingsFrom(raw), session: data.mf_session || null };
}
async function saveSession(session) { await chrome.storage.local.set({ mf_session: session }); }

function zoneFor(hostname, settings) {
  return settings.listedDomains.some(d => hostname === d || hostname.endsWith('.' + d))
    ? 'distraction' : 'neutral';
}

function supported(url = '') {
  try {
    const parsed = new URL(url);
    return ['https:', 'http:'].includes(parsed.protocol) &&
      parsed.hostname !== 'chromewebstore.google.com' &&
      !(parsed.hostname === 'chrome.google.com' && parsed.pathname.startsWith('/webstore')) &&
      !(parsed.hostname === 'microsoftedge.microsoft.com' && parsed.pathname.startsWith('/addons'));
  } catch { return false; }
}

function newSession(tab, zone) {
  return {
    id: crypto.randomUUID(), version: VERSION, activeTabId: tab.id, hostname: domainFrom(tab.url), zone,
    mode: zone === 'distraction' ? 'listed' : 'study', state: 'entry_wait',
    nextAt: Date.now() + ENTRY_MS, prompt: null, snoozedUntil: null,
    usedQuotes: {}, deliveryError: null
  };
}

function pick(category, session) {
  session.usedQuotes ||= {};
  const bank = MF_QUOTES[category];
  const recent = session.usedQuotes[category] || [];
  const available = bank.filter(q => !recent.includes(q));
  const pool = available.length ? available : bank;
  const quote = pool[Math.floor(Math.random() * pool.length)];
  session.usedQuotes[category] = [...recent, quote].slice(-6);
  return quote;
}

function setPrompt(session, kind) {
  const choices = (values, prefix) => values.map(n => ({ action: prefix + '_' + n, label: n + ' min' }));
  const templates = {
    distraction: { state: 'listed_prompt', category: 'distraction_callout', mood: 'cute-angry',
      statement: 'How much longer here?', options: choices([1, 2, 3, 4, 5, 10], 'distraction') },
    'study-check': { state: 'study_check', category: 'study_check', mood: 'gentle',
      statement: 'Are you studying right now?', options: [
        { action: 'study_yes', label: 'Yes, I am' }, { action: 'study_no', label: 'Not really' }] },
    study: { state: 'study_prompt', category: 'hardwork_obsession', mood: 'gentle',
      statement: 'Want a little quiet?', options: [
        { action: 'study_snooze', label: 'Snooze' }, { action: 'study_keep_checking', label: 'Keep checking' }] },
    snooze: { state: 'snooze_picker', category: null, mood: 'gentle',
      statement: 'How long should I snooze?', options: choices([20, 30, 40], 'snooze') }
  };
  const template = templates[kind];
  const quoteInfo = kind === 'snooze' ? session.prompt?.quoteInfo : pickVerified(kind, session);
  session.prompt = {
    id: crypto.randomUUID(), kind, mood: template.mood,
    quote: quoteInfo?.text || session.prompt?.quote || 'Make room for the work.', quoteInfo,
    closesListed: kind === 'distraction' && session.zone === 'distraction',
    statement: template.statement, options: template.options, shownAt: null,
    openAttempted: kind === 'snooze', cueIssued: kind === 'snooze',
    cue: null, audioError: null, audioAttempts: 0, audioRetryAt: null
  };
  session.state = template.state;
  session.nextAt = null;
  session.snoozedUntil = null;
}

function processDeadline(session) {
  if (!session.nextAt || Date.now() < session.nextAt) return;
  if (session.state === 'entry_wait') setPrompt(session, session.zone === 'distraction' ? 'distraction' : 'study-check');
  else if (['listed_wait', 'accountability_wait'].includes(session.state)) setPrompt(session, 'distraction');
  else if (['study_confirmed_wait', 'snoozed'].includes(session.state)) setPrompt(session, 'study');
}

async function repairAlarm(session) {
  const alarm = await chrome.alarms.get(ALARM);
  if (!session?.nextAt) {
    if (alarm) await chrome.alarms.clear(ALARM);
  } else if (!alarm || Math.abs(alarm.scheduledTime - session.nextAt) > 500) {
    await chrome.alarms.create(ALARM, { when: session.nextAt });
  }
}

async function repairIdleAlarm(session) {
  const when = session?.activeTabId != null && session.state === 'listed_prompt' && session.prompt?.shownAt
    ? session.prompt.shownAt + DEFAULTS.responseTimeoutMs : null;
  const alarm = await chrome.alarms.get(IDLE_ALARM);
  if (!when) {
    if (alarm) await chrome.alarms.clear(IDLE_ALARM);
  } else if (!alarm || alarm.scheduledTime !== when) {
    await chrome.alarms.create(IDLE_ALARM, { when });
  }
}

async function repairAudioAlarm(session) {
  const prompt = session?.prompt;
  const when = session?.activeTabId != null && prompt && !prompt.cueIssued &&
    prompt.audioAttempts > 0 && prompt.audioAttempts < MAX_AUDIO_ATTEMPTS ? prompt.audioRetryAt : null;
  const alarm = await chrome.alarms.get(AUDIO_ALARM);
  if (!when) {
    if (alarm) await chrome.alarms.clear(AUDIO_ALARM);
  } else if (!alarm || alarm.scheduledTime !== when) {
    await chrome.alarms.create(AUDIO_ALARM, { when });
  }
}

// A cue is delivered independently of the popup, including while Chrome is away.
// Polls repair its alarm but never perform a retry or pretend playback succeeded.
async function deliverAudio(settings, session, { retry = false } = {}) {
  const prompt = session?.prompt;
  if (!prompt || prompt.kind === 'snooze' || session.activeTabId == null) {
    await repairAudioAlarm(null);
    return;
  }
  if (prompt.cueIssued && prompt.cue?.audioStatus === 'muted' && settings.soundEnabled) {
    prompt.cueIssued = false;
    prompt.cue = null;
    prompt.audioAttempts = 0;
    prompt.audioRetryAt = null;
  }
  if (prompt.cueIssued) {
    await repairAudioAlarm(session);
    return;
  }
  if (!settings.soundEnabled) {
    prompt.cueIssued = true;
    prompt.cue = { startAt: Date.now(), audioStatus: 'muted' };
    prompt.audioError = null;
    prompt.audioRetryAt = null;
    await saveSession(session);
    await repairAudioAlarm(session);
    return;
  }
  const attempts = prompt.audioAttempts || 0;
  if (attempts >= MAX_AUDIO_ATTEMPTS || (attempts > 0 &&
      (!retry || !prompt.audioRetryAt || Date.now() < prompt.audioRetryAt))) {
    await repairAudioAlarm(session);
    return;
  }
  prompt.cueId ||= prompt.id;
  prompt.audioAttempts = attempts + 1;
  prompt.audioRetryAt = AUDIO_RETRY_MS[attempts] ? Date.now() + AUDIO_RETRY_MS[attempts] : null;
  // Persist the attempt/backoff before awaiting media, but only ACK real starts.
  // If the worker restarts, the offscreen document deduplicates this same cueId.
  await saveSession(session);
  await repairAudioAlarm(session);
  const result = await cue(settings, prompt.kind !== 'distraction', prompt.cueId);
  if (result.ok) {
    prompt.cueIssued = true;
    prompt.cue = { startAt: result.startAt, audioStatus: result.audioStatus };
    prompt.audioError = null;
    prompt.audioRetryAt = null;
  } else {
    prompt.cueIssued = false;
    prompt.cue = null;
    prompt.audioError = result.audioError;
    prompt.audioRetryAt = AUDIO_RETRY_MS[attempts] ? Date.now() + AUDIO_RETRY_MS[attempts] : null;
  }
  await saveSession(session);
  await repairAudioAlarm(session);
}

async function retryAudio() {
  const { settings, session } = await readState();
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!session || session.activeTabId == null || !supported(tab?.url) ||
      zoneFor(domainFrom(tab.url), settings) !== session.zone) {
    await repairAudioAlarm(null);
    return;
  }
  // Do not reconcile/open a popup as a side effect of a sound-only alarm.
  await deliverAudio(settings, session, { retry: true });
}

// Try the native popup once, plus one focus-return retry if opening failed.
async function deliver(settings, session, context = {}) {
  // Load the popup shell first, then play even when opening failed or was skipped.
  await deliverPopup(session, context);
  await deliverAudio(settings, session);
}

async function deliverPopup(session, { focused = false, focusReturned = false } = {}) {
  const prompt = session.prompt;
  await chrome.action.setBadgeBackgroundColor({ color: '#ED857C' });
  await chrome.action.setBadgeText({ text: prompt ? '!' : '' });
  if (!prompt || session.activeTabId == null) return;
  const focusRetry = focused && focusReturned && prompt.openRetryOnFocus && !prompt.openFocusRetryUsed;
  if (prompt.openAttempted && !focusRetry) return;
  if (focusRetry) prompt.openFocusRetryUsed = true;
  prompt.openAttempted = true; // Never steal focus again on each status poll.
  await saveSession(session);
  try {
    const tab = await chrome.tabs.get(session.activeTabId);
    await chrome.action.openPopup({ windowId: tab.windowId });
    session.deliveryError = null;
    prompt.openRetryOnFocus = false;
  } catch {
    session.deliveryError = 'Your reminder is ready. Pin Momo and click the toolbar icon to see it.';
    prompt.openRetryOnFocus = !prompt.openFocusRetryUsed;
  }
  await saveSession(session);
}

function matches(url, domains) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) &&
      domains.some(d => domainFrom(url) === d || domainFrom(url).endsWith('.' + d));
  } catch { return false; }
}

// A closing commitment is independent of focus, study snooze and zone changes.
// Only newly confirmed choices can create one; old listed_wait sessions stay safe.
async function reconcileClosing() {
  const { mf_closeJob: job } = await chrome.storage.local.get(['mf_closeJob']);
  if (!job) { await chrome.alarms.clear(CLOSE_ALARM); return null; }
  if (job.deadline > Date.now()) {
    const alarm = await chrome.alarms.get(CLOSE_ALARM);
    if (!alarm || alarm.scheduledTime !== job.deadline) await chrome.alarms.create(CLOSE_ALARM, { when: job.deadline });
    return job;
  }
  const { settings } = await readState();
  const eligible = url => matches(url, job.domains) && matches(url, settings.listedDomains);
  const targets = (await chrome.tabs.query({})).filter(t => eligible(t.url));
  // Consume before closing: a worker restart must not close newly opened tabs twice.
  await chrome.storage.local.set({ mf_closeJob: null });
  await chrome.alarms.clear(CLOSE_ALARM);
  let closed = 0, failed = 0;
  for (const target of targets) {
    try {
      const current = await chrome.tabs.get(target.id);
      if (!eligible(current.url) || (current.pendingUrl && !eligible(current.pendingUrl))) continue;
      await chrome.tabs.remove(target.id);
      closed++;
    } catch { failed++; }
  }
  await chrome.storage.local.set({ mf_closeResult: { at: Date.now(), closed, failed } });
  return null;
}

async function cue(settings, gentle, cueId = 'preview-' + crypto.randomUUID()) {
  if (!settings.soundEnabled) return { ok: true, startAt: Date.now(), audioStatus: 'muted' };
  const missingReceiver = /receiving end does not exist|could not establish connection|message (?:port|channel) closed|no offscreen document/i;
  for (let recovery = 0; recovery < 2; recovery++) {
    let sending = false;
    try {
      const url = chrome.runtime.getURL('src/offscreen.html');
      const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
      if (!contexts.length) await chrome.offscreen.createDocument({
        url: 'src/offscreen.html', reasons: ['AUDIO_PLAYBACK'],
        justification: 'Play a brief local tapping cue when your motivation reminder appears.'
      });
      sending = true;
      const result = await chrome.runtime.sendMessage({ target: 'mf-audio', type: 'PLAY', gentle, cueId });
      if (result?.ok === true && result.audioStatus === 'started' && Number.isFinite(result.startAt)) {
        return { ok: true, startAt: result.startAt, audioStatus: 'started' };
      }
      // A media/policy error is not a missing document. Preserve it for the UI,
      // and let the bounded alarm retry; never recreate working documents for it.
      const audioError = result?.error || 'Audio playback did not report a started state.';
      return { ok: false, error: audioError, audioError };
    } catch (error) {
      const audioError = error.message || String(error);
      // The AUDIO_PLAYBACK document can disappear after 30 seconds of silence.
      // Re-read/create once only for transport loss, with the identical cueId.
      if (sending && recovery === 0 && missingReceiver.test(audioError)) continue;
      return { ok: false, error: audioError, audioError };
    }
  }
}

async function reconcile({ popupTabId = null, focusReturned = false } = {}) {
  const closeJob = await reconcileClosing();
  const { settings, session: previous } = await readState();
  let [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  let popupOwnsFocus = false;
  if (Number.isInteger(popupTabId)) {
    try {
      const popupTab = await chrome.tabs.get(popupTabId);
      if (popupTab.active) {
        tab = popupTab;
        popupOwnsFocus = true;
      }
    } catch { /* Popup's tab closed between query and message; use current browser state. */ }
  }
  // A focused toolbar popup can temporarily own focus instead of its parent window.
  // Only messages from our verified popup can supply this explicit active-tab context.
  let focused = popupOwnsFocus;
  if (!focused && tab) {
    try { focused = (await chrome.windows.get(tab.windowId)).focused; }
    catch { /* A disappearing window must not turn focus into a timer pause. */ }
  }
  let pageLabel = '';
  try { const url = new URL(tab?.url); pageLabel = url.protocol + '//' + url.host; } catch { /* Loading or absent tab. */ }
  const unavailableReason = !tab ? 'no_tab' : !tab.url ? 'loading' : !supported(tab.url)
    ? 'restricted_page' : null;
  if (!tab || !supported(tab.url)) {
    if (previous?.activeTabId != null) {
      previous.activeTabId = null;
      if (previous.nextAt && previous.state !== 'snoozed') previous.remainingMs = Math.max(0, previous.nextAt - Date.now());
      previous.nextAt = null;
      await saveSession(previous);
    }
    await repairAlarm(null);
    await repairIdleAlarm(null);
    await repairAudioAlarm(null);
    return { closeJob, settings, session: previous, available: false, unavailableReason, pageLabel, version: VERSION };
  }
  const hostname = domainFrom(tab.url);
  const zone = zoneFor(hostname, settings);
  let session = previous;
  if (!session || session.zone !== zone) {
    session = newSession(tab, zone);
    session.usedQuotes = previous?.usedQuotes || {};
  } else {
    if (session.state === 'snoozed' && session.snoozedUntil) {
      // Quiet time is a wall-clock promise; it does not extend when the browser loses focus.
      session.nextAt = session.snoozedUntil;
      delete session.remainingMs;
    } else if (session.remainingMs != null) {
      session.nextAt = Date.now() + session.remainingMs;
      delete session.remainingMs;
    }
    session.activeTabId = tab.id;
    session.hostname = hostname;
  }
  if (session.version !== VERSION) {
    // Only pre-0.3 prompts need new consent semantics. Keep current prompts and
    // all existing closing commitments intact during this sound/focus update.
    if (session.prompt?.kind && session.prompt.closesListed == null) setPrompt(session, session.prompt.kind);
    if (session.prompt?.kind !== 'snooze' && session.prompt?.cueIssued && !session.prompt.cue) {
      session.prompt.cueIssued = false; // 0.3.0 marked playback before it succeeded.
    }
    session.version = VERSION;
  }
  processDeadline(session);
  if (closeJob && session.zone === 'distraction') {
    session.prompt = null;
    session.state = 'closing_wait';
    session.nextAt = null;
  } else if (session.state === 'closing_wait') {
    session.state = 'entry_wait';
    session.nextAt = Date.now() + ENTRY_MS;
  }
  if (session.state === 'listed_prompt' && session.prompt?.shownAt &&
      Date.now() - session.prompt.shownAt >= settings.responseTimeoutMs) {
    session.state = 'yapping';
    session.prompt.mood = 'yapping';
    session.prompt.yappingLines = Array.from({ length: 4 }, () => pick('yapping_escalation', session));
    session.prompt.statement = session.prompt.yappingLines[0] + ' How much longer here?';
    session.prompt.id = crypto.randomUUID();
    session.prompt.openAttempted = false;
    session.prompt.openRetryOnFocus = false;
    session.prompt.openFocusRetryUsed = false;
    session.prompt.cueIssued = false;
    session.prompt.cueId = session.prompt.id;
    session.prompt.cue = null;
    session.prompt.audioError = null;
    session.prompt.audioAttempts = 0;
    session.prompt.audioRetryAt = null;
  }
  await saveSession(session);
  await repairAlarm(session);
  await repairIdleAlarm(session);
  await deliver(settings, session, { focused, focusReturned });
  return { closeJob, settings, session, available: true, unavailableReason: null, pageLabel, version: VERSION };
}

function allowedSender(sender, session) {
  return !sender.tab && sender.url === chrome.runtime.getURL('src/popup.html');
}

async function respondToPrompt(message, sender, current) {
  const { session, settings } = current;
  if (!session?.prompt || !allowedSender(sender, session) || session.id !== message.sessionId ||
      session.prompt.id !== message.promptId || !session.prompt.options.some(o => o.action === message.action)) {
    throw new Error('This check-in has changed. Please try the current buttons.');
  }
  const action = message.action;
  if (session.zone === 'distraction' && action.startsWith('distraction_') && message.confirmClose !== true) throw new Error('Choose a timer only after acknowledging that all listed tabs will close.');
  if (action === 'study_snooze') {
    setPrompt(session, 'snooze');
  } else {
    session.prompt = null;
    session.snoozedUntil = null;
    if (action.startsWith('distraction_')) {
      session.state = 'listed_wait';
      session.mode = session.zone === 'distraction' ? 'listed' : 'accountability';
      session.nextAt = Date.now() + Number(action.split('_')[1]) * 60000;
      if (session.zone === 'distraction') {
        current.closeJob = { id: crypto.randomUUID(), deadline: session.nextAt, domains: [...settings.listedDomains] };
        await chrome.storage.local.set({ mf_closeJob: current.closeJob });
        await chrome.alarms.create(CLOSE_ALARM, { when: current.closeJob.deadline });
        session.state = 'closing_wait';
        session.nextAt = null;
      }
    } else if (action.startsWith('snooze_')) {
      session.state = 'snoozed';
      session.nextAt = Date.now() + Number(action.split('_')[1]) * 60000;
      session.snoozedUntil = session.nextAt;
    } else {
      session.mode = action === 'study_no' ? 'accountability' : 'study';
      session.state = action === 'study_no' ? 'accountability_wait' : 'study_confirmed_wait';
      session.nextAt = Date.now() + STUDY_MS;
    }
  }
  await saveSession(session);
  await repairAlarm(session);
  await repairIdleAlarm(session);
  await deliver(settings, session);
  return { ok: true, ...current };
}

async function handleMessage(message, sender) {
  if (sender.url !== chrome.runtime.getURL('src/popup.html') || sender.tab) throw new Error('Open the extension popup to use this action.');
  if (message.type === 'CANCEL_CLOSING') {
    await chrome.storage.local.set({ mf_closeJob: null });
    await chrome.alarms.clear(CLOSE_ALARM);
  }
  if (message.type === 'PREVIEW_SOUND') return { ok: true, ...await cue({ soundEnabled: true }, true) };
  const context = sender.url === chrome.runtime.getURL('src/popup.html') && message.popupFocused === true
    ? { popupTabId: message.popupTabId } : {};
  if (message.type === 'POPUP_AUDIO_STARTED') {
    const { session } = await readState();
    if (!session?.prompt || session.prompt.id !== message.promptId || session.prompt.kind === 'snooze' ||
        !Number.isFinite(message.cue?.startAt)) {
      throw new Error('This sound belongs to an older reminder. Use the current popup.');
    }
    // Record a successful, user-gesture playback before reconciling, so a pending
    // automatic retry cannot start again while we acknowledge the popup's cue.
    session.prompt.cueIssued = true;
    session.prompt.cue = { startAt: message.cue.startAt, audioStatus: 'started' };
    session.prompt.audioError = null;
    session.prompt.audioRetryAt = null;
    await saveSession(session);
    await repairAudioAlarm(session);
    return { ok: true, ...await reconcile(context) };
  }
  if (message.type === 'SAVE_SETTINGS') {
    const { settings } = await readState();
    const updated = settingsFrom({ ...settings, ...message.settings });
    await chrome.storage.local.set({ mf_settings: updated });
    if (!updated.soundEnabled) {
      try { await chrome.runtime.sendMessage({ target: 'mf-audio', type: 'STOP' }); } catch { /* No audio document. */ }
    }
    return { ok: true, ...await reconcile(context) };
  }
  const current = await reconcile(context);
  if (['GET_UI_STATE', 'TIMER_DUE', 'CANCEL_CLOSING'].includes(message.type)) return { ok: true, ...current };
  if (message.type === 'PROMPT_ACTION') return respondToPrompt(message, sender, current);
  if (message.type === 'PROMPT_PRESENTED') {
    const { session } = current;
    if (!current.available || !session?.prompt || session.prompt.id !== message.promptId ||
        session.prompt.kind === 'snooze') return { ok: true, ...current };
    session.prompt.shownAt ||= Date.now();
    session.prompt.openRetryOnFocus = false;
    session.deliveryError = null;
    await saveSession(session);
    await repairIdleAlarm(session);
    return { ok: true, ...current, cue: session.prompt.cue };
  }
  throw new Error('Unknown request. Reload the extension and refresh this page.');
}

const onChange = () => enqueue(reconcile);
chrome.runtime.onInstalled.addListener(onChange);
chrome.runtime.onStartup.addListener(onChange);
chrome.alarms.onAlarm.addListener(alarm => alarm.name === AUDIO_ALARM ? enqueue(retryAudio)
  : [ALARM, CLOSE_ALARM, IDLE_ALARM].includes(alarm.name) ? onChange() : undefined);
chrome.tabs.onActivated.addListener(onChange);
chrome.tabs.onRemoved.addListener(onChange);
chrome.tabs.onUpdated.addListener((_id, changes) => changes.url || changes.status === 'complete' ? onChange() : undefined);
chrome.windows.onFocusChanged.addListener(windowId => enqueue(() => reconcile({
  focusReturned: windowId !== chrome.windows.WINDOW_ID_NONE
})));
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === 'mf-audio') return false;
  enqueue(() => handleMessage(message, sender)).then(sendResponse,
    error => sendResponse({ ok: false, error: error.message }));
  return true;
});

// Chrome may clear alarms between worker lifetimes; repair and catch up on every start.
enqueue(reconcile);
