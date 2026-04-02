# Fillr

A Chrome extension that automatically fills web forms using stored profile data, with Claude AI (or Replicate Llama) as a fallback — matching profile fields for standard inputs, filling custom dropdowns, and generating context-aware answers for open-ended questions.

---

## How it works

Fillr runs five passes when filling a page:

1. **Exact match** — normalizes the field's `name`, `id`, and `autocomplete` attribute and looks them up in a keyword map.
2. **Fuzzy match** — searches the field's label, placeholder, `aria-label`, and nearby DOM text for known keywords using pre-compiled word-boundary regular expressions.
3. **AI text fill** — sends any unmatched fields to the configured AI provider along with your profile and page context (title, headings, nearby text). The AI returns a JSON mapping: profile keys for standard fields, or generated first-person answers for open-ended questions (e.g. "What will you build?").
4. **AI vision fill** — takes a screenshot of the visible tab and sends it alongside unmatched fields and page context for visual context. Always uses Anthropic Claude (Llama has no vision support).
5. **Custom dropdown fill** — detects non-native dropdown components (`role="combobox"`, `aria-haspopup="listbox"`, and "Select an option" placeholders), opens each to discover options, asks AI to pick the best one, then clicks it.

Passes 3–5 only run if an API key is configured. Each pass is independent.

---

## Features

- Fills standard personal, address, and professional fields without any AI call
- Handles **custom dropdown components** (not just native `<select>`) — common on Luma, Eventbrite, and modern form builders
- AI generates context-aware answers for open-ended fields and always picks the best available dropdown option
- **Multi-provider**: Anthropic Claude Sonnet or Replicate Llama 3.3 70B — switch in Settings
- API key **Test** button for both providers
- Multi-profile support: create, switch, rename (inline — no dialogs), and delete named profiles
- **Quick Signup** tab: paste an event URL and Fillr opens it, fills the form, and submits automatically
- Site blacklist: specify domains where Fillr should never run
- Site assignments: pin a specific profile to a domain
- JSON import/export for profile backup (API keys excluded from export)
- Keyboard shortcut `Cmd+Shift+F` / `Ctrl+Shift+F` triggers fill without opening the popup
- Extension badge shows the fill count for 4 seconds after each fill
- Auto-saves profile fields 800ms after typing stops — no manual save required
- `Cmd/Ctrl+S` saves the active tab (Details or Settings)
- React-compatible field filling using native input setters and `InputEvent`
- Optional floating button on pages with forms, with SPA navigation support via `MutationObserver`
- Keyboard-accessible popup with ARIA roles and `focus-visible` outline ring
- Undo: toast with "Undo" button after each fill reverts all changed fields
- All API calls include timeouts via `AbortController`

---

## Setup

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (top right toggle).
4. Click **Load unpacked** and select the extension folder.
5. Open the Fillr popup, go to **Settings**, choose your AI provider, paste your API key, and click **Save**.
6. Fill in your details on the **Details** tab — fields save automatically as you type.

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
| Additional Context | Extra info for AI — startup description, goals, background |

---

## Permissions

| Permission | Reason |
|---|---|
| `storage` | Stores profile data and API keys locally |
| `activeTab` | Injects content script and captures screenshot on the active tab only |
| `scripting` | Dynamic content script injection on keyboard shortcut |
| `host_permissions: <all_urls>` | Required to inject the content script on arbitrary pages |

---

## Project structure

```
fillr/
  manifest.json       Extension manifest (MV3)
  background.js       Service worker — AI API calls, badge, keyboard shortcut
  content.js          Injected into pages — field detection, filling, custom dropdowns
  popup.html          Extension popup UI
  popup.js            Popup logic — profiles, settings, quick signup, fill trigger
  styles.css          Popup styles (dark theme, gold accent, light mode)
  icons/              Extension icons at 16, 48, and 128px
```

---

## Development

No build step required. Edit source files directly and click **Reload** on `chrome://extensions` after changes.

To regenerate icons (requires Python 3):
```
python3 make_icons.py
```
