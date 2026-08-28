// UI-only fixture. This stub is never referenced from manifest.json or shipped surfaces.
(() => {
  const listeners = new Set();
  const state = {
    ok: true, available: true,
    settings: { mascotName: 'Momo', listedDomains: ['instagram.com', 'x.com', 'twitter.com', 'facebook.com', 'reddit.com', 'tiktok.com', 'snapchat.com'], responseTimeoutMs: 18000, soundEnabled: true },
    session: { id: 'preview', zone: 'distraction', state: 'listed_prompt', nextAt: null, prompt: null }
  };
  const minutes = (values, prefix) => values.map(n => ({ label: n + ' min', action: prefix + '_' + n }));
  function scenario(name) {
    state.closeJob = null;
    state.session.state = name === 'quiet' ? 'snoozed' : name === 'yapping' ? 'yapping' : name === 'gentle' ? 'study_check' : 'listed_prompt';
    state.session.zone = name === 'gentle' || name === 'quiet' ? 'neutral' : 'distraction';
    state.session.nextAt = name === 'quiet' ? Date.now() + 1200000 : null;
    state.session.prompt = name === 'quiet' ? null : {
      id: crypto.randomUUID(), kind: name === 'gentle' ? 'study-check' : 'distraction',
      mood: name === 'gentle' ? 'gentle' : name === 'yapping' ? 'yapping' : 'cute-angry', shownAt: Date.now(),
      quote: name === 'gentle' ? 'Nothing great was ever achieved without enthusiasm.' : 'Lost time is never found again.',
      quoteInfo: name === 'gentle' ? MF_VERIFIED_QUOTES.find(q => q.author === 'Ralph Waldo Emerson') : MF_VERIFIED_QUOTES[0],
      closesListed: name !== 'gentle',
      statement: name === 'gentle' ? 'Are you studying right now?' : 'How much longer here?',
      options: name === 'gentle' ? [{ action: 'study_yes', label: 'Yes, I am' }, { action: 'study_no', label: 'Not really' }] : minutes([1, 2, 3, 4, 5, 10], 'distraction'),
      yappingLines: name === 'yapping' ? ['You saw me. Pick a number.', 'A little less scrolling. A little more doing.'] : null
    };
    if (name === 'audio-recovery') state.session.prompt.audioError = 'Simulated playback restriction.';
  }
  scenario('listed');
  let toolbar;
  function sync() {
    toolbar?.update(structuredClone(state));
    listeners.forEach(fn => fn({ type: 'SYNC_STATE', ...structuredClone(state) }, {}, () => {}));
  }
  async function send(message) {
    if (message.type === 'POPUP_AUDIO_STARTED' && state.session.prompt?.id === message.promptId) {
      state.session.prompt.audioError = null;
      state.session.prompt.cue = message.cue;
    }
    if (message.type === 'PREVIEW_SOUND') {
      try { return { ok: true, ...await MF_AUDIO.play(true) }; }
      catch (error) { return { ok: false, error: error.message }; }
    }
    if (message.type === 'CANCEL_CLOSING') { state.closeJob = null; state.session.state = 'entry_wait'; }
    if (message.type === 'SAVE_SETTINGS') {
      if (message.settings.soundEnabled != null) { state.settings.soundEnabled = message.settings.soundEnabled; if (!state.settings.soundEnabled) MF_AUDIO.stop(); }
      if (message.settings.mascotName != null) state.settings.mascotName = message.settings.mascotName.trim().slice(0, 24) || 'Momo';
      if (message.settings.listedDomains) {
        const domains = [];
        for (const value of message.settings.listedDomains) {
          if (/\s/.test(value)) return { ok: false, error: 'Enter a domain like instagram.com.' };
          const domain = new URL(value.includes('://') ? value : 'https://' + value).hostname.replace(/^www\./, '');
          if (!domain.includes('.')) return { ok: false, error: 'Enter a complete domain, such as x.com.' };
          domains.push(domain);
        }
        state.settings.listedDomains = [...new Set(domains)];
      }
    }
    if (message.type === 'PROMPT_ACTION') {
      if (message.action === 'study_yes') {
        state.session.state = 'study_prompt';
        state.session.prompt = { id: crypto.randomUUID(), kind: 'study', mood: 'gentle',
          quote: 'The quiet work counts. Keep going.', statement: 'Want a little quiet?',
          options: [{ action: 'study_snooze', label: 'Snooze' }, { action: 'study_keep_checking', label: 'Keep checking' }] };
      } else if (message.action === 'study_snooze') {
        state.session.prompt = { ...state.session.prompt, id: crypto.randomUUID(), kind: 'snooze', statement: 'How long should I snooze?', options: minutes([20, 30, 40], 'snooze') };
      } else {
        state.session.state = message.action.startsWith('snooze') ? 'snoozed' : 'listed_wait';
        const delay = Number(message.action.split('_')[1]) || 5;
        state.session.nextAt = Date.now() + delay * 60000;
        if (message.action.startsWith('distraction') && state.session.zone === 'distraction') {
          state.closeJob = { id: crypto.randomUUID(), deadline: state.session.nextAt };
          state.session.state = 'closing_wait';
        }
        state.session.prompt = null;
      }
    }
    if (message.type === 'PROMPT_IDLE') scenario('yapping');
    sync();
    return structuredClone(state);
  }
  globalThis.chrome = {
    runtime: { id: 'visual-test', getURL: path => new URL('../' + path, location.href).href,
      sendMessage: send, onMessage: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) } }
  };
  function playSound(gentle, options) {
    const playback = MF_AUDIO.play(gentle, options);
    document.getElementById('audio-status').textContent = 'Starting audio…';
    return playback.then(result => {
      document.getElementById('audio-status').textContent = 'Media playback confirmed: ' + result.audioStatus + '.';
      return result;
    }, error => {
      document.getElementById('audio-status').textContent = 'Audio failed: ' + error.message;
      throw error;
    });
  }
  toolbar = MF_UI.mount(document.getElementById('toolbar-demo'), { send, playSound, stopSound: () => MF_AUDIO.stop() });
  document.querySelectorAll('[data-scenario]').forEach(button => button.addEventListener('click', async () => {
    scenario(button.dataset.scenario); sync();
    if (button.dataset.scenario === 'quiet' || button.dataset.scenario === 'audio-recovery') { MF_AUDIO.stop(); return; }
    let cue = { startAt: Date.now() + 350 };
    if (state.settings.soundEnabled) {
      try { cue = await playSound(button.dataset.scenario === 'gentle'); }
      catch (error) { state.session.prompt.audioError = error.message; sync(); }
    }
    toolbar.tap(cue);
  }));
  sync();
})();
