chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.target !== 'mf-audio') return false;
  if (message.type === 'STOP') { MF_AUDIO.stop(); respond({ ok: true }); return false; }
  if (message.type !== 'PLAY') return false;
  // Keep the response channel open until the media clock confirms playback.
  // Retrying the same cue shares an in-flight/successful result; failures retry.
  MF_AUDIO.play(message.gentle, { cueId: message.cueId }).then(result => respond({ ok: true, ...result }),
    error => respond({ ok: false, error: error.message }));
  return true;
});
