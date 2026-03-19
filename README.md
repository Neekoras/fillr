# Fillr

A Chrome extension that automatically fills web forms using stored profile data, with Claude AI as a fallback — matching profile fields for standard inputs and generating context-aware answers for open-ended questions.

---

## How it works

Fillr runs four passes when filling a page:

1. **Exact match** — normalizes the field's `name`, `id`, and `autocomplete` attribute and looks them up in a keyword map.
2. **Fuzzy match** — searches the field's label, placeholder, `aria-label`, and nearby DOM text for known keywords using pre-compiled word-boundary regular expressions.
3. **Claude AI (text)** — sends any unmatched fields to `claude-sonnet-4-6` along with your profile and page context (title, headings, nearby text). Claude returns a JSON mapping: profile keys for standard fields, or generated first-person answers for open-ended questions (e.g. "What will you build?").
4. **Claude AI (vision)** — takes a screenshot of the visible tab and sends it alongside unmatched fields and page context to Claude's vision model for visual context. Same response format as Pass 3.

Passes 3 and 4 only run if an Anthropic API key is stored. Each pass is independent — a failure in Pass 3 does not prevent Pass 4 from running.

---

## Features

- Fills standard personal, address, and professional fields without any AI call
- Claude generates context-aware answers for open-ended fields by reading the page title, headings, and surrounding text
- Multi-profile support: create, switch, and delete named profiles
- Site blacklist: specify domains where Fillr should never run
- JSON import/export for profile backup (API key excluded from export)
- Keyboard shortcut `Cmd+Shift+F` / `Ctrl+Shift+F` triggers fill without opening the popup
- Extension badge shows the fill count for 4 seconds after each fill
- Show/hide toggle on the API key field
- Auto-saves profile fields 800 ms after typing stops — no manual save required
- `Cmd/Ctrl+S` saves the active tab (Details or Settings)
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
6. Fill in your details on the **My Details** tab — fields save automatically as you type.

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
| Twitter / Instagram | Social handles (e.g. `@jane`) |
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
  background.js       Service worker — handles Claude API calls and keyboard shortcut
  content.js          Injected into pages — field detection and filling
  popup.html          Extension popup UI
  popup.js            Popup logic — multi-profile management, auto-save, fill trigger
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
