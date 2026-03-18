# Form Autofill Chrome Extension

A Manifest V3 Chrome extension that fills web forms using stored profile data, with a Claude AI fallback for unusual field names.

---

## File Responsibilities

| File | Role |
|------|------|
| `manifest.json` | Extension manifest (MV3), declares permissions, content script, service worker, and popup |
| `popup.html` | Extension popup UI — two-tab layout (My Details / Settings) |
| `popup.js` | Popup logic: loads stored data, handles saves, tab switching, fill trigger |
| `styles.css` | Popup and injected UI styles |
| `content.js` | Injected into every page — runs autofill pipeline, manages floating button |
| `background.js` | Service worker — proxies Anthropic API calls for Pass 3 (Claude) matching |

---

## Message Passing Diagram

```
popup.js ──{action:'fill'}──────────────────────────► content.js
                                                           │
                                             (unmatched fields exist + apiKey set)
                                                           │
                                    {action:'claudeFill', fields, profile, apiKey}
                                                           │
                                                      background.js
                                                      fetch Anthropic API
                                                           │
                                                    sendResponse({mapping})
                                                           │
                                                     fill fields
                                                           │
                                    sendResponse({filled: N}) ──────────► popup.js
                                                                           (shows toast)

popup.js ──{action:'toggleFloatingBtn', enabled}────► content.js
                                                       inject/remove floating button
```

---

## How Field Matching Works (3-Pass Pipeline)

### Pass 1 — Exact Keyword Match
Normalize the field's `name`, `id`, and `autocomplete` attributes (lowercase, collapse separators to `_`). Check against a hardcoded keyword map of ~60 entries covering common form field naming conventions.

Example: `address_line_1` → `address1`

### Pass 2 — Fuzzy Substring Match
Concatenate the field's label text, placeholder, name, id, and aria-label. Check if any keyword from the map appears as a substring.

Example: A field labelled "Your LinkedIn Profile URL" → `linkedin`

### Pass 3 — Claude AI Match (fallback)
If fields remain unmatched after Passes 1 & 2, and an Anthropic API key is stored, the descriptors (id, name, placeholder, label, type) are sent to `background.js`, which calls the Claude API. Claude returns a JSON mapping `{fieldId: profileKey}`. The content script uses this to fill the remaining fields.

---

## How to Load in Chrome (Developer Mode)

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder (the folder containing `manifest.json`)
5. The extension icon (⚡) appears in the toolbar — pin it for easy access

---

## Storing Profile Data

All profile fields and the API key are stored in `chrome.storage.local` (sandboxed per-extension, never sent anywhere except the Anthropic API during Pass 3). The API key is stored under the key `apiKey`.

---

## Supported Profile Fields

| Key | Description |
|-----|-------------|
| `firstName` | First name |
| `lastName` | Last name |
| `email` | Email address |
| `phone` | Phone / mobile number |
| `address1` | Street address line 1 |
| `address2` | Street address line 2 / apt |
| `city` | City |
| `state` | State / province |
| `zip` | ZIP / postal code |
| `country` | Country |
| `linkedin` | LinkedIn profile URL |
| `github` | GitHub profile URL |
| `website` | Personal website / portfolio |
| `bio` | Bio / professional summary |
| `yearsExp` | Years of experience |
| `jobTitle` | Job title / position |
| `company` | Current company / employer |

---

## React / Vue / Angular Compatibility

After setting `.value`, the content script dispatches both `input` and `change` events with `bubbles: true`. This ensures framework-managed form state is updated correctly.

---

## Claude API Model

Pass 3 uses `claude-sonnet-4-20250514` via `https://api.anthropic.com/v1/messages`. The background service worker holds the fetch call open with `return true` in the `onMessage` listener to support the async response pattern required by Manifest V3.
