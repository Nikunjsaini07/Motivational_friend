# Motivation Friend

A small Chrome extension that keeps you focused with a cute accountability mascot.

## What it does

- Waits **2 minutes** after you enter a website.
- Shows a motivational quote and a question.
- Uses a cute mascot, tapping animation, and sound to catch your attention.
- Reopens an unanswered reminder every **30 seconds**.
- Works locally—no account, AI, API key, or tracking.

## Distraction sites

Default list:

- Instagram
- X / Twitter
- Facebook
- Reddit
- TikTok
- Snapchat

On a listed site:

- The mascot gives a direct distraction reminder.
- Choose **1, 2, 3, 4, 5, or 10 minutes** to leave.
- When the timer ends, the extension closes **all listed-site tabs**, including pinned tabs.
- You can cancel the closing timer from **Settings**.

> Save unfinished work before choosing a timer. Closed tabs may contain unsaved work.

## Other sites

- The mascot gently asks: **“Are you studying right now?”**
- **Yes, I am** → another supportive check after 2 minutes.
- **Not really** → a firmer accountability check after 2 minutes.
- Study reminders can be snoozed for **20, 30, or 40 minutes**.
- Non-listed tabs are never closed by the extension.

## How to install

1. Download or clone this repository.
2. Extract the ZIP if needed.
3. Open `chrome://extensions` in Chrome 127 or newer.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the folder containing `manifest.json`.
7. Pin **Motivation Friend** from Chrome’s extensions menu.

## How to use

- Browse normally—the first reminder appears after 2 minutes.
- Answer the question or choose a timer.
- Click the gear icon to open Settings.
- Use **Preview sound** to test the attention sound.
- A coral **!** badge means a reminder is waiting.
- If the popup closes, it will try to reopen after 30 seconds.

## Settings

- Change the mascot’s name.
- Add or remove distraction sites.
- Turn reminder sounds on or off.
- Preview the sound.
- Cancel an active tab-closing timer.

## Important behavior

- Switching between sites in the same category does not reset the timer.
- Switching between a distraction site and another site starts a new 2-minute session.
- Minimizing Chrome or switching apps does not pause timers.
- Chrome settings, the Chrome Web Store, and other restricted pages are unsupported.
- Chrome may delay reminders while the computer is asleep or the browser is closed.
- YouTube is not a distraction site by default.

## Privacy

- No login.
- No ads or analytics.
- No browsing history is uploaded.
- No page content is read.
- No external server or LLM is used.
- Settings and active timers stay in Chrome’s local extension storage.

## Built with

- Manifest V3
- JavaScript
- HTML and CSS
- Local SVG graphics
- Local WAV sounds
