# Fillr

A Chrome extension that automatically fills web forms using stored profile data, with Claude AI as a fallback for fields it cannot match by keyword.

---

## How it works

Fillr runs four passes when filling a page:

1. **Exact match** — normalizes the field's `name`, `id`, and `autocomplete` attribute and looks them up in a keyword map.
2. **Fuzzy match** — searches the field's label, placeholder, `aria-label`, and nearby DOM text for known keywords using pre-compiled word-boundary regular expressions.
3. **Claude AI (text)** — sends any unmatched fields to `claude-sonnet-4-6` with a structured prompt. Claude returns a JSON mapping of field identifiers to profile keys or direct option values (e.g. "Yes", "No").
4. **Claude AI (vision)** — takes a screenshot of the visible tab and sends it alongside unmatched fields to Claude's vision model for visual context.

Passes 3 and 4 only run if an Anthropic API key is stored. Each pass is independent — a failure in Pass 3 does not prevent Pass 4 from running.

---

## Features

- Fills standard personal, address, and professional fields without any AI call
- React-compatible field filling using native input setters and `InputEvent` so React's synthetic event system fires correctly
- Optional floating button that appears on pages containing forms, with SPA navigation support via `MutationObserver`
- Keyboard-accessible popup with ARIA roles, `aria-selected` tab state, and `focus-visible` gold outline ring
- All API calls include a 30-second timeout via `AbortController`
- API key is stored locally in `chrome.storage.local` and never transmitted in extension messages

---

## Setup

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (top right toggle).
4. Click **Load unpacked** and select the extension folder.
5. Open the Fillr popup, go to **Settings**, paste your [Anthropic API key](https://console.anthropic.com/), and click **Save**.
6. Fill in your details on the **My Details** tab and click **Save Details**.

---

## Profile fields

| Field | Description |
|---|---|
| First Name / Last Name | Used individually or combined as full name |
| Email | |
| Phone | |
| Address Line 1 / 2 | |
| City / State / ZIP / Country | |
| Job Title | |
| Company | |
| Years Experience | |
| LinkedIn / GitHub / Website | URLs |
| Bio / Summary | Long-form text for cover and summary fields |

---

## Permissions

| Permission | Reason |
|---|---|
| `storage` | Stores profile data and API key locally |
| `activeTab` | Injects content script and captures screenshot on the active tab only |
| `host_permissions: <all_urls>` | Required to inject the content script on arbitrary pages |

The `scripting` and `tabs` permissions are not requested. `activeTab` is sufficient for both content script injection and `captureVisibleTab`.

---

## Project structure

```
fillr/
  manifest.json       Extension manifest (MV3)
  background.js       Service worker — handles Claude API calls
  content.js          Injected into pages — field detection and filling
  popup.html          Extension popup UI
  popup.js            Popup logic — profile storage, tab switching, fill trigger
  styles.css          Popup styles (dark theme, gold accent)
  icons/              Extension icons at 16, 48, and 128px
```

---

## Development

No build step required. Edit source files directly and click **Reload** on `chrome://extensions` after changes.

To regenerate the icons (requires Python 3, no external dependencies):

```
python3 make_icons.py
```
