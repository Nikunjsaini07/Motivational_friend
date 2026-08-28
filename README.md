# Motivation Friend · 0.3.2

A compact, black Chrome extension with a local animated cat, sourced quotations,
automatic reminders and optional-by-selection tab-closing commitments.
JavaScript + HTML + CSS + SVG; no build step, account, API key or dependencies.

## Install / update

1. Download or clone this project. If downloaded as a ZIP, extract it first.
2. In Chrome 127 or newer, open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the folder containing `manifest.json`.
4. Pin Motivation Friend from Chrome's puzzle-piece menu.
5. Visit a normal website. The first reminder is due after two minutes, even if you switch to another app.

To update an existing installation, replace the project files and click **Reload**
on the extension's card at `chrome://extensions`. Saved settings are preserved.
Refresh any tabs that still display an older version's page overlay.
Open the gear → **Preview sound** to test playback.

Reminders now open the **real native popup attached to the toolbar icon**.
There is no manual check-in button and no floating page card.
Chrome closes native popups when focus leaves them; the extension cannot keep them
attached and permanently open. A coral “!” badge means a reminder is waiting for
your answer, not that the extension is broken. If automatic opening fails, click
the pinned icon. Opening failure is shown in Settings/the popup.
Chrome's support and normal popup behavior:
[Action API](https://developer.chrome.com/docs/extensions/reference/api/action).

## What happens

- Defaults: instagram.com, x.com, twitter.com, facebook.com, reddit.com,
  tiktok.com and snapchat.com. Subdomains match; lookalike names do not.
  **YouTube is not listed.**
- Enter either zone → first reminder after two minutes.
  Switching tabs or sites within the same zone keeps the session.
- Listed site → attributed quote, cute-angry Momo, and **1 / 2 / 3 / 4 / 5 / 10 min**.
  An ignored displayed prompt gets firmer after about 18 seconds.
- Non-listed → gentle quote and “Are you studying right now?”
  Yes → supportive reminder two minutes later; No → firmer reminder two minutes later.
  Non-listed countdown choices remain reminders, not permission to close that site.
- Study reminder → snooze 20 / 30 / 40 minutes or keep checking every two minutes.
  Snooze stays silent. Entering a listed zone cancels study snooze and starts a fresh entry.
- Switching apps or minimizing Chrome does not pause reminders or timers.
  Browser-internal pages are still not study/distraction websites.
  Snooze remains wall-clock time and stays silent until its deadline.
  The extension trusts your answer; it does not inspect page content to prove you are studying.

## Important: closing commitments

**Choosing a time on a listed-site reminder schedules automatic closure of ALL listed
tabs in every window of this browser profile, including pinned tabs. Unsaved work
can be lost.** Selecting a duration on a non-listed site never authorizes tab closure.

The closing timer survives tab changes, study snooze, lost focus and worker restarts.
Missing alarms are rebuilt. If Chrome/computer is closed or asleep, an overdue
commitment is processed when the extension next runs; exact-time execution is not guaranteed.
Cancel any time before expiry using **gear → Cancel tab-closing timer**.

The domain scope is captured when you choose a time. Newly added domains do not
expand that commitment; removed domains are excluded. Current URLs are rechecked
before closure, including pending navigation. Non-listed tabs are never targeted.
There remains an unavoidable tiny race between Chrome's URL check and its tab-remove API.
A commitment is consumed before removal, so a crash will not replay a destructive
batch against newly opened tabs. A crash or individual API failure may leave some tabs open.
There is no repeated close attempt. Normal Chrome reopening may recover closed tabs,
but cannot guarantee recovery of unsaved work.

Existing pre-0.3 timers never acquire closing permission automatically.

## Settings and attention cues

The tiny gear opens a separate view for Momo's name, listed domains, sound toggle,
sound preview and cancellation. The main card stays just quote, author, cat and question.
Width: 254 CSS px (65% of the original 390px design).
Settings has a stable 520px height, one scroll surface, and an expandable site list.
Sound controls stay above the list; audio errors stay next to those controls.
The panel never derives its height from the native popup viewport.

Three clearly audible, short taps match the paw animation. Non-listed study cues add
a brief chime. Both sounds are original, bundled WAV files generated locally by
assets/build-audio.cjs; no remote music, network calls or copyrighted recordings.
Mute persists and stops pending audio. Reduced-motion preferences suppress animation.
Playback is only acknowledged after media playback starts. Failed automatic attempts
are retried with a limit; polling and reopening a successfully played prompt do not
repeat its sound. An Enable sound button appears only when playback needs attention.
Preview sound plays directly in the popup, preserving your click's audio permission.
Automatic audio does not depend on the popup successfully opening, so unfocused
Chrome can still give an audible reminder. Chrome may refuse to open its native
toolbar popup while another app is active; the badge remains and the pending popup
can be retried when focus returns. The extension cannot overlay another app.
Snooze selection does not play a cue. System mute, output-device settings or browser
audio policy can still prevent audible output. Check Chrome in your system volume
mixer if playback reports success but your speakers remain silent.
[Offscreen audio API](https://developer.chrome.com/docs/extensions/reference/api/offscreen).

## Quotations

16 short public-domain excerpts from Benjamin Franklin, Epictetus, Marcus Aurelius,
Ralph Waldo Emerson and William Shakespeare. Every entry retains author, work,
source URL and translation where applicable. Click the author's name to inspect its source.
Franklin's eighteenth-century capitalization is lightly normalized where noted.
Shakespeare's line is identified as dialogue from Richard II, not a personal statement.
Momo's original teasing messages are separate and never attributed to a historical author.
A recent-six exclusion follows the session across zone changes to reduce repetition.
All text is bundled locally; source pages are opened only when you click.

## Privacy and permissions

No login, LLM, telemetry, page-content inspection or stored browsing-history list.
Settings, current hostname/session, recent quote IDs and an active closing commitment
are saved in chrome.storage.local. The last close result stores only counts and time.
No full page URLs are persisted or transmitted.

Permissions: storage (local settings), tabs (hostnames and closing selected-domain tabs),
alarms (deadlines), offscreen (short audio). No HTTP host permissions or page scripting.
All pages already open at update work without injection; refresh only removes old injected UI.

## Troubleshooting

- **No sound:** check the sound toggle in Settings, then click Preview sound.
  Check Chrome's volume in your system mixer and your selected audio output.
  Reload the extension after updates. Successful playback does not guarantee
  audible output if the browser or operating system is muted.
- **The popup disappeared:** clicking elsewhere dismisses Chrome's native popup.
  Click the pinned icon to answer the pending reminder.
- **The badge shows “!”:** a question is waiting for an answer; this is not an error.
- **Nothing appears on a browser settings page:** open a normal website instead.
  Unsupported browser pages pause normal session deadlines; switching apps does not.
- **Settings looks outdated:** reload the extension at `chrome://extensions`,
  close its popup and reopen it.
- **A timer ran late:** Chrome alarms may be delayed, especially while the computer
  is asleep or Chrome is closed. They are not precise real-time timers.

### Planned, not implemented

Reopening an unanswered, dismissed popup every **30 seconds** is planned.
The current version does not continuously reopen dismissed popups. Automatic sound
retries are separate from this proposed behavior.

## Project files

| File or folder | Purpose | Needed to run? |
| --- | --- | --- |
| `manifest.json` | Chrome's extension configuration, permissions and entry points | Yes |
| `src/` | Reminder engine, popup, settings, mascot, quotes and audio player | Yes |
| `assets/icon*.png` | Toolbar and extension icons | Yes |
| `assets/taps.wav`, `assets/gentle.wav` | Bundled attention sounds | Yes |
| `assets/build-audio.cjs`, `assets/build-icons.ps1` | Regenerate the sound and icon assets | No |
| `tests/` | Automated checks and browser preview fixtures | No |
| `README.md` | Setup and project documentation | No |
| `.gitignore` | Keeps local/generated files out of Git | No |

Keep tests in the repository: they help verify changes, even though Chrome does
not need them to run the extension. The manifest is essential and must not be removed.

The `.gitignore` excludes dependencies, caches, release archives, test reports,
logs, local environment files, signing keys and editor/OS clutter. It intentionally
does not ignore source code, tests, the manifest, icons or sounds. Ignore rules do
not remove files already tracked by Git and do not control what goes into a ZIP.

For a minimal extension package, include `manifest.json`, `src/`, the four icon PNGs
and both WAV files. Keep `manifest.json` at the package root. Exclude `.git/`, local
secrets, test output and asset-generation scripts from the release package.

## Development and verification

There is no npm install or build step. Node.js is only needed for development
checks and the preview server; the extension runs directly from its source files.

Run with Node.js:

    node --test tests/*.test.cjs

Visual fixture:

    node tests/serve.cjs

Open the [popup preview](http://127.0.0.1:4173/tests/preview.html) or
[settings preview](http://127.0.0.1:4173/tests/settings.html).
It uses the real styles, mascot, quote bank and bundled audio with simulated actions.
It never closes real tabs and is not proof of native Chrome popup/offscreen behavior.
Use disposable listed-site tabs for an optional live smoke test after reloading Chrome.

Regenerate bundled sounds:

    node assets/build-audio.cjs

Regenerate icons in PowerShell:

    ./assets/build-icons.ps1

Reload the installed extension after changing source files or generated assets.
