async function sendFromPopup(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return chrome.runtime.sendMessage({
    ...message, popupTabId: tab?.id, popupFocused: document.hasFocus()
  });
}
const widget = MF_UI.mount(document.getElementById('companion'), {
  send: sendFromPopup,
  playSound: (gentle, options) => MF_AUDIO.play(gentle, options),
  stopSound: () => MF_AUDIO.stop()
});
let loading = false;
let presentedId = null;
async function refresh() {
  if (loading) return;
  loading = true;
  try {
    const result = await sendFromPopup({ type: 'GET_UI_STATE' });
    if (result.ok === false) throw new Error(result.error);
    widget.update(result);
    const prompt = result.available && result.session?.prompt;
    if (prompt?.cue?.startAt && Date.now() - prompt.cue.startAt < 700) widget.tap(prompt.cue);
    if (prompt && prompt.id !== presentedId && prompt.kind !== 'snooze') {
      const presented = await sendFromPopup({ type: 'PROMPT_PRESENTED', promptId: prompt.id });
      if (!presented.ok) throw new Error(presented.error);
      presentedId = prompt.id;
      widget.update(presented);
      if (presented.cue?.startAt && Date.now() - presented.cue.startAt < 700) widget.tap(presented.cue);
    }
  } catch (error) {
    widget.error(error.message || 'Reload the extension, then open a webpage.');
  } finally { loading = false; }
}
refresh();
// Refresh actual worker state, not a stale countdown captured when the popup opened.
const poll = setInterval(refresh, 1000);
window.addEventListener('unload', () => { clearInterval(poll); widget.dispose(); MF_AUDIO.stop(); });
