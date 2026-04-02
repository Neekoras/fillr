# Form Autofill Chrome Extension

A Manifest V3 Chrome extension that fills web forms using stored profile data, with Claude AI generating profile-key mappings for standard fields and context-aware answers for open-ended questions.

---

## File Responsibilities

| File | Role |
|------|------|
| `manifest.json` | Extension manifest (MV3), declares permissions, content script, service worker, popup, and keyboard command |
| `popup.html` | Extension popup UI — three-tab layout (My Details / Settings / Blocked Sites) |
| `popup.js` | Popup logic: multi-profile management, auto-save, import/export, blacklist, tab switching, fill trigger |
| `styles.css` | Popup and injected UI styles |
| `content.js` | Injected into every page — runs autofill pipeline, scrapes page context, manages floating button |
| `background.js` | Service worker — proxies Anthropic API calls for Pass 3/4, handles badge, handles keyboard shortcut |

---

## Message Passing Diagram

```
popup.js ──{action:'fill'}────────────────────────────────► content.js
                                                                  │
                                                    (unmatched fields exist + apiKey set)
                                                                  │
                                       {action:'claudeFill', fields, profile, pageContext}
                                                                  │
                                                             background.js
                                                             fetch Anthropic API
                                                                  │
                                                           sendResponse({mapping})
                                                                  │
                                                            fill fields
                                                                  │
                                       {action:'claudeVisionFill', fields, profile, pageContext}
                                                                  │
                                                             background.js
                                                             captureVisibleTab → fetch Anthropic API
                                                                  │
                                                           sendResponse({mapping})
                                                                  │
                                                            fill fields
                                                                  │
                                       sendResponse({filled: N}) ──────────────► popup.js
                                                                                  (shows toast)

content.js ──{action:'setBadge', count}───────────────────► background.js
                                                              sets icon badge for 4 s

popup.js ──{action:'toggleFloatingBtn', enabled}──────────► content.js
                                                              inject/remove floating button
```

---

## How Field Matching Works (4-Pass Pipeline)

### Pass 1 — Exact Keyword Match
Normalize the field's `name`, `id`, and `autocomplete` attributes (lowercase, collapse separators to `_`). Check against a hardcoded keyword map of ~60 entries covering common form field naming conventions.

Example: `address_line_1` → `address1`

### Pass 2 — Fuzzy Substring Match
Concatenate the field's label text, placeholder, name, id, and aria-label. Check if any keyword from the map appears as a substring.

Example: A field labelled "Your LinkedIn Profile URL" → `linkedin`

### Pass 3 — Claude AI Match (text)
If fields remain unmatched after Passes 1 & 2, and an Anthropic API key is stored, the descriptors (id, name, placeholder, label, type, options) are sent to `background.js` along with page context (title, headings, nearby text). Claude returns a JSON mapping `{fieldId: value}` where:
- For standard profile fields (name, email, etc.): value is a profile key string (e.g. `"firstName"`)
- For open-ended questions (e.g. "What will you build?"): value is a generated first-person answer (2–4 sentences) drawn from the user's profile and page context

### Pass 4 — Claude AI Match (vision)
Same as Pass 3, but a screenshot of the visible tab is captured first and included in the request alongside the field descriptors and page context. Useful when labels or context are only visible in the rendered layout.

---

## How to Load in Chrome (Developer Mode)

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder (the folder containing `manifest.json`)
5. The extension icon (⚡) appears in the toolbar — pin it for easy access

---

## Storing Profile Data

All profile fields and the API key are stored in `chrome.storage.local` (sandboxed per-extension, never sent anywhere except the Anthropic API during Passes 3 and 4). The API key is stored separately under the key `apiKey` and is never included in export files.

### Multi-profile storage schema

```json
{
  "profiles": [
    { "name": "Default", "firstName": "Jane", "email": "jane@example.com", ... }
  ],
  "activeProfile": 0
}
```

### Site blacklist

Domains where Fillr will never run (checked in content.js before any fill attempt, and before showing the floating button):

```json
{ "blockedSites": ["example.com", "internal.corp"] }
```

---

## Page Context Scraping

`getPageContext()` in `content.js` collects:

| Field | Source |
|-------|--------|
| `title` | `document.title` |
| `metaDesc` | `<meta name="description">` content |
| `headings` | First 8 `h1`/`h2`/`h3` elements |
| `nearbyText` | Text nodes inside the form's closest `section`, `main`, or `article` ancestor, capped at 800 characters |

This context is passed to Claude in Passes 3 and 4 so it can understand what the form is for before generating answers to open-ended questions.

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
| `twitter` | Twitter / X handle (e.g. `@jane`) |
| `instagram` | Instagram handle (e.g. `@jane`) |
| `bio` | Bio / professional summary |
| `yearsExp` | Years of experience |
| `jobTitle` | Job title / position |
| `company` | Current company / employer |

---

## React / Vue / Angular Compatibility

After setting `.value`, the content script dispatches both `input` and `change` events with `bubbles: true`. This ensures framework-managed form state is updated correctly.

---

## Claude API Model

Passes 3 and 4 use `claude-sonnet-4-6` via `https://api.anthropic.com/v1/messages`. The background service worker holds the fetch call open with `return true` in the `onMessage` listener to support the async response pattern required by Manifest V3.

---

## Auto-save

Profile fields on the Details tab auto-save 800 ms after the last `input` event — no manual save button required. `Cmd/Ctrl+S` also saves the currently active tab immediately.

---

## Keyboard Shortcut

`Ctrl+Shift+F` (Windows/Linux) / `Cmd+Shift+F` (Mac) triggers a fill on the active tab without opening the popup. Handled in `background.js` via `chrome.commands.onCommand`.
