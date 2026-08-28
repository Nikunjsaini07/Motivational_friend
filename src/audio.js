// Local PCM cues. The 350ms lead-in leaves time to synchronize the visible paw.
// Invoke play() directly from a click handler: audio.play() runs synchronously,
// before the returned promise is awaited, to preserve browser user activation.
(() => {
  const LEAD_IN_MS = 350;
  const START_TIMEOUT_MS = 4000;
  const VOLUME = .82;
  const scriptURL = typeof document !== 'undefined' ? document.currentScript?.src : null;
  const cues = new Map();
  let active = null;

  function assetURL(gentle) {
    const file = gentle ? 'gentle.wav' : 'taps.wav';
    if (typeof globalThis.chrome?.runtime?.getURL === 'function') {
      return chrome.runtime.getURL('assets/' + file);
    }
    if (scriptURL) return new URL('../assets/' + file, scriptURL).href;
    throw new Error('Local sound files could not be located. Reload the extension.');
  }

  function playbackError(message, name = 'AudioPlaybackError') {
    const error = new Error(message);
    error.name = name;
    return error;
  }

  function mediaError(media) {
    const reasons = {
      1: 'Sound loading was interrupted.',
      2: 'The local sound file could not be loaded.',
      3: 'The local sound file could not be decoded.',
      4: 'The local WAV sound file is missing or unsupported.'
    };
    return playbackError(reasons[media.error?.code] || 'The browser could not play the local sound.');
  }

  function halt(media) {
    if (!media) return;
    // Clearing the source and resetting the media element also aborts a play()
    // that has not resolved yet. A late play-promise callback halts it again.
    try { media.pause(); } catch { /* An already-disposed element is stopped. */ }
    try { media.removeAttribute('src'); media.load(); } catch { /* No source remains. */ }
  }

  function clearWatchers(record) {
    clearTimeout(record.startTimer);
    clearInterval(record.clockTimer);
    clearTimeout(record.finishTimer);
    for (const [name, handler] of record.listeners) record.media.removeEventListener(name, handler);
    record.listeners = [];
  }

  function release(record) {
    clearWatchers(record);
    const media = record.media;
    record.media = null;
    if (active === record) active = null;
    halt(media);
  }

  function fail(record, error) {
    if (record.phase === 'failed' || record.phase === 'finished') return;
    const wasPending = record.phase === 'pending';
    record.phase = 'failed';
    if (record.cueId && cues.get(record.cueId) === record) cues.delete(record.cueId);
    release(record);
    if (wasPending) record.reject(error);
  }

  function stop() {
    if (active) fail(active, playbackError('Sound playback was stopped.', 'AbortError'));
  }

  function play(gentle = true, options = {}) {
    const cueId = typeof options?.cueId === 'string' && options.cueId ? options.cueId : null;
    // Keep successful identities for this document's lifetime, not just while
    // the sound is playing. Failed/interrupted identities are safe to retry.
    if (cueId && cues.has(cueId)) return cues.get(cueId).promise;
    if (active) fail(active, playbackError('Sound playback was replaced by a newer cue.', 'AbortError'));

    const record = { cueId, phase: 'pending', media: null, listeners: [], playAccepted: false, legacyPlay: false, sawPlaying: false };
    record.promise = new Promise((resolve, reject) => { record.resolve = resolve; record.reject = reject; });
    active = record;
    if (cueId) cues.set(cueId, record);

    try {
      const media = new Audio();
      record.media = media;
      media.preload = 'auto';
      media.loop = false;
      media.muted = false;
      media.volume = VOLUME;
      media.src = assetURL(Boolean(gentle));
      const initialTime = Number(media.currentTime) || 0;

      function observeClock() {
        if (record.phase !== 'pending') return;
        if (!record.playAccepted && !(record.legacyPlay && record.sawPlaying)) return;
        if (media.error) { fail(record, mediaError(media)); return; }
        if (media.muted || media.volume === 0) {
          fail(record, playbackError('Sound playback was muted before it could start.'));
          return;
        }
        const time = Number(media.currentTime);
        // A resolved play() promise, a playing event, or an elapsed timeout on
        // its own does not prove playback: the media clock must advance too.
        if (media.paused || media.ended || media.seeking || media.readyState < 2 || !Number.isFinite(time) || time - initialTime < .008) return;
        record.phase = 'started';
        clearTimeout(record.startTimer);
        clearInterval(record.clockTimer);
        record.resolve({ startAt: Date.now() + LEAD_IN_MS - time * 1000, audioStatus: 'started' });
        // A decode/stall failure after confirmation must not leave an element
        // or deduplication identity stuck forever. "started" is not "ended".
        const remaining = Number.isFinite(media.duration) ? media.duration - time : 1.2;
        record.finishTimer = setTimeout(() => fail(record, playbackError('Sound playback did not finish.')),
          Math.min(5000, Math.max(0, remaining * 1000) + 2000));
      }

      function listen(name, handler) {
        media.addEventListener(name, handler);
        record.listeners.push([name, handler]);
      }

      function finish() {
        if (record.phase === 'pending') { fail(record, playbackError('Sound ended before playback could be confirmed.')); return; }
        if (record.phase !== 'started') return;
        record.phase = 'finished';
        release(record);
      }

      listen('playing', () => { record.sawPlaying = true; observeClock(); });
      listen('timeupdate', observeClock);
      listen('error', () => fail(record, mediaError(media)));
      listen('abort', () => fail(record, playbackError('Sound loading was interrupted.', 'AbortError')));
      listen('pause', () => media.ended ? finish() : fail(record, playbackError('Sound playback was interrupted.', 'AbortError')));
      listen('ended', finish);

      record.startTimer = setTimeout(() => fail(record,
        playbackError('Sound did not start within 4 seconds. Try Preview sound again.', 'TimeoutError')), START_TIMEOUT_MS);
      record.clockTimer = setInterval(observeClock, 25);

      // Do not put an await, message round trip, or deferred task before this.
      const playback = media.play();
      if (playback && typeof playback.then === 'function') {
        Promise.resolve(playback).then(() => {
          if (record.phase === 'failed' || record.phase === 'finished') { halt(media); return; }
          record.playAccepted = true;
          observeClock();
        }, error => {
          const blocked = error?.name === 'NotAllowedError';
          fail(record, playbackError(blocked ? 'The browser blocked sound. Click Preview sound to enable it.' :
            (error?.message || 'The browser rejected sound playback.'), error?.name || 'AudioPlaybackError'));
        });
      } else {
        record.legacyPlay = true;
        observeClock();
      }
    } catch (error) {
      fail(record, playbackError(error?.message || 'Local audio is unavailable.', error?.name || 'AudioPlaybackError'));
    }
    return record.promise;
  }

  globalThis.MF_AUDIO = { play, stop };
})();
