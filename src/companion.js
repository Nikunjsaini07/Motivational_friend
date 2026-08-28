(() => {
  const gear = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m9.5 3-.7 2.1-2 .9-2-.4L2.7 9l1.4 1.7v2.6L2.7 15l2.1 3.4 2-.4 2 .9.7 2.1h5l.7-2.1 2-.9 2 .4 2.1-3.4-1.4-1.7v-2.6L21.3 9l-2.1-3.4-2 .4-2-.9-.7-2.1Z"/><circle cx="12" cy="12" r="3.2"/></svg>';
  const back = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m14 6-6 6 6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function mount(root, config) {
    root.className = 'mf-widget';
    root.innerHTML = [
      '<button class="mf-icon mf-settings-toggle" type="button" aria-label="Customize your friend" title="Settings">' + gear + '</button>',
      '<section class="mf-main" aria-label="Your motivation friend">',
      '<p class="mf-quote" aria-live="polite"></p><a class="mf-author" target="_blank" rel="noopener noreferrer" hidden></a>',
      '<div class="mf-mascot-wrap"></div><span class="mf-name"></span>',
      '<p class="mf-question"></p><div class="mf-options"></div><p class="mf-countdown"></p></section>',
      '<section class="mf-settings" aria-label="Customize your friend" hidden>',
      '<div class="mf-settings-header"><button class="mf-icon mf-back" type="button" aria-label="Back to your friend">' + back + '</button><h2 tabindex="-1">Make it yours</h2></div>',
      '<form class="mf-name-form mf-setting-group"><label class="mf-field-label" for="mf-name-input">Your friend’s name</label>',
      '<div class="mf-inline-form"><input id="mf-name-input" maxlength="24" required autocomplete="off" placeholder="Momo"><button class="mf-option" type="submit">Save</button></div></form>',
      '<section class="mf-setting-group" aria-label="Sound settings"><label class="mf-sound-label"><span>Taps &amp; gentle chimes</span><input class="mf-sound" type="checkbox"></label>',
      '<p class="mf-help">A little nudge, not an alarm.</p><button class="mf-option mf-preview-sound" type="button">Preview sound</button><p class="mf-sound-feedback" role="status"></p><div class="mf-audio-slot"></div></section>',
      '<div class="mf-sites mf-setting-group"><label class="mf-field-label" for="mf-domain-input">Distraction sites</label>',
      '<p class="mf-help">YouTube stays off unless you add it.</p>',
      '<form class="mf-inline-form mf-domain-form"><input id="mf-domain-input" required autocomplete="off" spellcheck="false" placeholder="e.g. instagram.com"><button class="mf-option" type="submit" aria-label="Add distraction site">Add</button></form>',
      '<details class="mf-sites-details"><summary>Listed sites <span class="mf-site-count"></span></summary><ul class="mf-domains"></ul></details></div>',
      '<p class="mf-feedback" role="status"></p><button class="mf-option mf-cancel" type="button" hidden>Cancel tab-closing timer</button>',
      '<footer class="mf-settings-footer"><p class="mf-timer"></p><p class="mf-help mf-connection"></p></footer>',
      '</section><div class="mf-alerts"><p class="mf-audio-error" role="status" hidden></p><button class="mf-option mf-enable-sound" type="button" hidden>Enable sound</button><p class="mf-error" role="alert" hidden></p></div>'
    ].join('');
    const $ = selector => root.querySelector(selector);
    const main = $('.mf-main');
    const settingsPanel = $('.mf-settings');
    const toggle = $('.mf-settings-toggle');
    let state = { settings: { mascotName: 'Momo', listedDomains: [] }, session: null, available: true };
    let settingsOpen = false;
    let renderedKey = null;
    let domainsKey = null;
    let yapTimer;
    let tapTimer;
    let lastCue = null;

    function error(message) {
      $('.mf-error').textContent = message || '';
      $('.mf-error').hidden = !message;
    }

    function visibility() {
      root.hidden = false;
      root.classList.toggle('mf-settings-open', settingsOpen);
      main.hidden = settingsOpen;
      toggle.hidden = settingsOpen;
      settingsPanel.hidden = !settingsOpen;
      const audioSlot = settingsOpen ? $('.mf-audio-slot') : $('.mf-alerts');
      if ($('.mf-audio-error').parentElement !== audioSlot) {
        audioSlot.append($('.mf-audio-error'), $('.mf-enable-sound'));
      }
      config.onVisibility?.(!root.hidden);
    }

    async function request(message) {
      error('');
      const response = await config.send(message);
      if (!response || response.ok === false) throw new Error(response?.error || 'Could not connect. Reload the extension and refresh the page.');
      if (response.settings) update(response);
      return response;
    }

    async function runRequest(message, button, after) {
      if (button) button.disabled = true;
      try { await request(message); after?.(); }
      catch (err) { error(err.message); }
      finally { if (button) button.disabled = false; }
    }

    function renderDomains() {
      const domains = state.settings.listedDomains;
      $('.mf-site-count').textContent = domains.length;
      const key = JSON.stringify(domains);
      if (key === domainsKey) return;
      domainsKey = key;
      const list = $('.mf-domains');
      list.replaceChildren();
      if (!domains.length) {
        const empty = document.createElement('li');
        empty.className = 'mf-empty';
        empty.textContent = 'No distraction sites yet.';
        list.append(empty);
      }
      domains.forEach(domain => {
        const item = document.createElement('li');
        item.className = 'mf-domain';
        const label = document.createElement('span');
        label.textContent = domain;
        const remove = document.createElement('button');
        remove.className = 'mf-icon';
        remove.type = 'button';
        remove.textContent = '×';
        remove.setAttribute('aria-label', 'Remove ' + domain);
        remove.addEventListener('click', () => runRequest({
          type: 'SAVE_SETTINGS', settings: { listedDomains: state.settings.listedDomains.filter(d => d !== domain) }
        }, remove, () => { $('.mf-feedback').textContent = 'Site removed.'; $('.mf-domain-form input').focus(); }));
        item.append(label, remove);
        list.append(item);
      });
    }

    function timerText() {
      const session = state.session;
      if (state.closeJob) {
        const seconds = Math.max(0, Math.ceil((state.closeJob.deadline - Date.now()) / 1000));
        return 'All listed tabs close in ' + Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
      }
      if (state.available === false) return unavailableCopy().detail;
      if (session?.deliveryError) return 'Click the pinned toolbar icon for your reminder.';
      if (session?.prompt) return 'Waiting for your answer.';
      if (!session?.nextAt) return 'Ready when you are.';
      const seconds = Math.max(1, Math.ceil((session.nextAt - Date.now()) / 1000));
      const duration = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
      return (session.state === 'snoozed' ? 'Quiet for ' : 'Next check in ') + duration;
    }

    function unavailableCopy() {
      if (state.unavailableReason === 'loading') return {
        quote: 'Just a moment.', detail: 'Waiting for this tab to finish loading.'
      };
      if (state.unavailableReason === 'no_tab') return {
        quote: 'Let’s find your tab.', detail: 'Open a webpage, then reopen your friend.'
      };
      return {
        quote: 'This page can’t show check-ins.',
        detail: state.pageLabel ? 'Open a website instead of ' + state.pageLabel + '.' : 'Open a normal website, such as x.com.'
      };
    }

    function renderMain(force = false) {
      const session = state.session;
      const prompt = state.available === false ? null : session?.prompt;
      const sleeping = session?.state === 'snoozed' && state.available !== false;
      const key = [prompt?.id, prompt?.mood, state.closeJob?.id].join(':') + (prompt?.id || [session?.state, session?.zone, state.available, state.unavailableReason, state.pageLabel].join(':'));
      $('.mf-name').textContent = state.settings.mascotName;
      if (!force && renderedKey === key) return;
      renderedKey = key;
      clearInterval(yapTimer);
      root.classList.remove('mf-enter');
      const mood = state.available === false ? 'gentle' : prompt?.mood || (sleeping ? 'sleeping' : session?.zone === 'distraction' ? 'cute-angry' : 'gentle');
      main.className = 'mf-main mf-mood-' + mood;
      $('.mf-mascot-wrap').innerHTML = MF_MASCOT_SVG(mood);
      $('.mf-quote').textContent = prompt?.quote ||
        (state.available === false ? unavailableCopy().quote : sleeping
          ? 'Your focus has the floor.' : session?.zone === 'distraction'
            ? 'The feed can wait.\nYour future can’t.' : 'One small start.\nThen keep going.');
      const author = $('.mf-author');
      author.hidden = !prompt?.quoteInfo;
      author.textContent = prompt?.quoteInfo ? '— ' + prompt.quoteInfo.author : '';
      if (prompt?.quoteInfo) {
        author.href = prompt.quoteInfo.sourceUrl;
        author.title = prompt.quoteInfo.work + (prompt.quoteInfo.translation ? ' · ' + prompt.quoteInfo.translation : '');
      } else author.removeAttribute('href');
      $('.mf-question').textContent = prompt?.statement || (state.available === false
        ? unavailableCopy().detail : sleeping ? 'I’ll stay quiet.' : state.closeJob ? 'A promise to yourself. Make it count.' : 'I’ll check on you automatically.');
      const options = $('.mf-options');
      options.replaceChildren();
      const choices = prompt?.options || [];
      options.classList.toggle('mf-options-six', choices.length === 6);
      choices.forEach(option => {
        const button = document.createElement('button');
        button.className = 'mf-option';
        button.type = 'button';
        button.textContent = option.label;
        button.addEventListener('click', () => runRequest({ type: 'PROMPT_ACTION', sessionId: session.id, promptId: prompt.id, action: option.action, confirmClose: prompt.closesListed === true }, button));
        options.append(button);
      });
      if (prompt && !settingsOpen) {
        // Replay only for a new prompt, never on status polling or a name edit.
        void root.offsetWidth;
        root.classList.add('mf-enter');
        if (prompt.yappingLines?.length) {
          let index = 0;
          yapTimer = setInterval(() => {
            index += 1;
            if (index >= prompt.yappingLines.length) return clearInterval(yapTimer);
            $('.mf-question').textContent = prompt.yappingLines[index] + ' How much longer here?';
          }, 2600);
        }
      }
    }

    function update(nextState) {
      state = nextState;
      visibility();
      renderMain();
      renderDomains();
      $('.mf-timer').textContent = timerText();
      $('.mf-timer').hidden = !state.closeJob;
      $('.mf-settings-footer').hidden = !state.closeJob && !state.version;
      $('.mf-countdown').textContent = state.closeJob || (!state.session?.prompt && state.available !== false) ? timerText() : '';
      $('.mf-sound').checked = state.settings.soundEnabled !== false;
      $('.mf-cancel').hidden = !state.closeJob;
      const audioError = state.session?.prompt?.audioError;
      $('.mf-audio-error').textContent = audioError || '';
      $('.mf-audio-error').hidden = !audioError;
      $('.mf-enable-sound').hidden = !audioError || state.settings.soundEnabled === false;
      $('.mf-connection').textContent = [state.version ? 'v' + state.version : '', state.pageLabel].filter(Boolean).join(' · ');
      if (state.session?.deliveryError) error(state.session.deliveryError);
    }

    function openSettings() {
      settingsOpen = true;
      clearInterval(yapTimer);
      $('.mf-name-form input').value = state.settings.mascotName;
      $('.mf-feedback').textContent = '';
      $('.mf-sound-feedback').textContent = '';
      visibility();
      root.scrollTop = 0;
      $('.mf-settings-header h2').focus({ preventScroll: true });
    }

    function closeSettings() {
      settingsOpen = false;
      root.scrollTop = 0;
      error('');
      visibility();
      renderMain(true);
      if (!root.hidden) toggle.focus({ preventScroll: true });
      else config.onClosed?.();
    }

    toggle.addEventListener('click', openSettings);
    $('.mf-back').addEventListener('click', closeSettings);
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape' && settingsOpen) { event.stopPropagation(); closeSettings(); }
    });
    $('.mf-name-form').addEventListener('submit', event => {
      event.preventDefault();
      runRequest({ type: 'SAVE_SETTINGS', settings: { mascotName: $('.mf-name-form input').value } },
        $('.mf-name-form button'), () => { $('.mf-feedback').textContent = 'Name saved.'; });
    });
    $('.mf-domain-form').addEventListener('submit', event => {
      event.preventDefault();
      const input = $('.mf-domain-form input');
      runRequest({ type: 'SAVE_SETTINGS', settings: { listedDomains: [...state.settings.listedDomains, input.value] } },
        $('.mf-domain-form button'), () => { input.value = ''; $('.mf-feedback').textContent = 'Site saved.'; $('.mf-sites-details').open = true; });
    });
    $('.mf-sound').addEventListener('change', event => {
      if (!event.target.checked) config.stopSound?.();
      runRequest({ type: 'SAVE_SETTINGS', settings: { soundEnabled: event.target.checked } }, event.target);
    });
    $('.mf-preview-sound').addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      $('.mf-sound-feedback').textContent = 'Starting…';
      try {
        // Call play directly in the click handler, before any browser-message await.
        error('');
        const result = config.playSound ? await config.playSound(true) : await request({ type: 'PREVIEW_SOUND' });
        if (result.audioError || result.audioStatus !== 'started') {
          $('.mf-sound-feedback').textContent = '';
          error(result.audioError || 'Playback did not start. Please try again.');
        }
        else $('.mf-sound-feedback').textContent = 'Playing. Nothing yet? Check Chrome’s volume.';
      } catch (err) { $('.mf-sound-feedback').textContent = ''; error(err.message); }
      finally { button.disabled = false; }
    });
    $('.mf-enable-sound').addEventListener('click', async event => {
      const button = event.currentTarget;
      const prompt = state.session?.prompt;
      if (!prompt || !config.playSound) return;
      button.disabled = true;
      error('');
      try {
        const cue = await config.playSound(prompt.kind !== 'distraction', { cueId: prompt.id });
        if (cue.audioStatus !== 'started') throw new Error('Playback did not start. Please try again.');
        tap(cue);
        await request({ type: 'POPUP_AUDIO_STARTED', promptId: prompt.id, cue });
      } catch (err) { error(err.message); }
      finally { button.disabled = false; }
    });
    $('.mf-cancel').addEventListener('click', event => runRequest({ type: 'CANCEL_CLOSING' }, event.currentTarget,
      () => { $('.mf-feedback').textContent = 'Closing timer cancelled. Your tabs stay open.'; }));

    function tap(cue) {
      if (!cue || lastCue === cue.startAt || settingsOpen) return;
      lastCue = cue.startAt;
      clearTimeout(tapTimer);
      root.classList.remove('mf-tap');
      tapTimer = setTimeout(() => {
        void root.offsetWidth;
        root.classList.add('mf-tap');
      }, Math.max(0, cue.startAt - Date.now()));
      if (cue.audioError) error(cue.audioError);
    }

    update(state);
    return { update, openSettings, error, tap, dispose() { clearInterval(yapTimer); clearTimeout(tapTimer); } };
  }

  globalThis.MF_UI = { mount, gear };
})();
