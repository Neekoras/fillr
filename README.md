# Fillr

A Chrome extension that eliminates form fatigue. Store your profile once — Fillr fills any web form instantly, from job applications and event RSVPs to startup accelerator applications and conference signups. Five progressive fill passes go from fast keyword matching all the way to AI vision analysis, so even the most unconventional forms get filled correctly. When Fillr can't find an answer in your profile, it generates one — writing compelling, context-aware answers to open-ended questions on your behalf.

---

## How it works

Fillr runs five independent passes on every form. Each pass hands off only what the previous one couldn't handle.

### Pass 1 — Exact match
Normalizes a field's `name`, `id`, and `autocomplete` attribute and looks them up in a keyword map that covers hundreds of real-world field naming patterns. No API call. Instantaneous.

### Pass 2 — Fuzzy match
Searches the field's visible label, `placeholder`, `aria-label`, associated `<legend>`, and surrounding DOM text using pre-compiled word-boundary regular expressions. Catches fields whose labels don't map directly to standard attribute names. No API call.

### Pass 3 — AI text fill
Sends all unmatched fields to the configured AI provider together with your profile and page context (title, meta description, headings, nearby text). The model returns a JSON mapping: profile keys for standard fields, or generated first-person prose for open-ended questions. For "What have you built?" or "What do you plan to work on?", the AI reads the event or program context and writes a compelling, specific answer tailored to the form.

### Pass 4 — AI vision fill
Captures a screenshot of the visible tab and sends it alongside the remaining unmatched fields. Adds spatial context — useful when label text lives far from the input or is embedded in images. Always uses Anthropic Claude (Llama has no vision support).

### Pass 5 — Custom dropdown fill
Detects non-native dropdown components (`role="combobox"`, `aria-haspopup="listbox"`, placeholder patterns). Opens each dropdown invisibly to read its options, asks the AI to pick the best match, then programmatically clicks the right option. Handles React Select, MUI Autocomplete, Headless UI, and most other custom dropdown libraries.

### N/A fallback pass (Quick Signup only)
After all five passes, if required fields are still empty, Fillr makes one more attempt before submitting. Open-ended question fields (textareas, essay prompts) are sent to the AI to generate a relevant answer. Simple missing fields (like a Twitter handle you haven't set) are filled with "N/A". Fields about teammates, referrals, collaborators, or co-founders are left blank — those require real answers.

---

## Features

### Core autofill
- Fills standard personal, address, professional, and social fields with no AI call
- Handles native `<select>`, custom dropdown components, radio groups, checkboxes, and `contenteditable` rich text editors
- React / React Hook Form compatible — uses native input setters, `InputEvent`, and blur/focus cycles so framework state updates correctly
- MUI and other component library compatible — dispatches events on wrapper elements in addition to the underlying input
- Shadow DOM support — recursively traverses shadow roots up to 4 levels deep (Salesforce, ServiceNow, Web Components)
- Same-origin iframe support — collects fields from embedded frames; cross-origin frames are detected and reported in a toast
- Date field parsing — converts natural language dates ("January 2024") to `YYYY-MM-DD`; highlights fields red on failure
- Phone number formatting — reads the field's `placeholder` to detect the expected format (`(555) 555-5555`, `+1 555 555 5555`) and formats accordingly
- Bio/summary truncation — word-boundary truncates long text at a field's `maxLength` limit
- Typeahead support — simulates character-by-character typing for autocomplete inputs (company names, schools, locations)
- `Undo` — reverts all fills via a toast button; snapshots pre-filled values correctly
- Fill summary — collects per-field outcomes (skipped, truncated, error) and surfaces them to the popup

### Profiles
- Multiple named profiles — create, rename inline (no dialog), switch, and delete
- 17 tracked core fields with a completeness indicator showing how many are filled
- Per-field overrides — right-click any label in the Details tab to set a site-specific override for that field (stored as `hostname::fieldKey`)
- Override badges show which fields have active overrides for the current site
- Additional Context field — free-form text the AI always reads, ideal for startup descriptions, research interests, or goals
- Auto-saves 800ms after typing stops — no manual save required
- `Cmd/Ctrl+S` saves the active tab immediately

### Quick Signup
- Paste any event or form URL — Fillr opens it in a background tab, fills every field, and submits
- Multi-step wizard support — up to 8 steps, with `MutationObserver`-based detection of newly appearing fields between steps
- Post-submit failure detection — checks whether the form is still visible after submission (catches `noValidate` React forms that use custom JS validation, not just `:invalid`)
- If submission fails, the tab stays open and comes to the foreground; the popup shows which fields blocked submission
- 30-second timeout — if the form hangs, the tab is closed and the popup shows a specific timeout message
- Auto-detects event URLs — Luma, Eventbrite, Partiful, Typeform, Tally, Airtable, and `/register`, `/signup`, `/rsvp`, `/apply` paths pre-fill the URL input
- `Enter` key in the URL input triggers the signup
- CAPTCHA detection — reports it rather than attempting to bypass it
- Signup history — date, URL, status (confirmed / submitted / failed / captcha), and fill count

### Settings
- AI provider toggle: Anthropic Claude Sonnet or Replicate Llama 3.1 70B
- API key test buttons with live feedback (spinner → ✓ Valid / ✗ Invalid key)
- Site blacklist — domains where Fillr never runs
- Site assignments — pin a profile to a domain so switching happens automatically
- Fill all matching fields toggle — when off (default), fills only the first instance of each field type; when on, fills every matching input
- JSON export/import — full profile and settings backup; API keys are excluded from export; import validates entries before merging

### Fill analytics
- Tracks every fill: timestamp, hostname, total fields, filled fields, pass breakdown, API calls made, duration
- Stats section in Settings: total fills, average fields per fill, top 5 domains, per-pass bar chart
- Capped at 100 entries; oldest entries drop automatically

### UI/UX
- Dark theme with gold accent, full light mode support
- Toast notification queue — collapses rapid notifications (3+) into a single count badge
- Floating button on form pages — toggled in Settings; SPA-aware via `MutationObserver`
- Extension badge shows fill count for 4 seconds after each fill
- Keyboard shortcut `Alt+Shift+F` triggers fill without opening the popup; shows an in-page toast with the fill count
- Right-click context menu — "Fill this form with Fillr" on any page or editable field
- Status icons in Quick Signup: ✓ for success, ⚠ for warnings, ✕ for errors
- Keyboard-accessible popup with ARIA roles and `focus-visible` outline ring

### Security
- Message allowlist — the background service worker only processes explicitly whitelisted action names
- Origin validation — AI fill actions are rejected from non-`http(s)` origins
- Private/local URL blocking — Quick Signup rejects `localhost`, `127.x`, `10.x`, `192.168.x`, and `172.16–31.x` ranges
- URL length limit (2048 chars) on Quick Signup
- All API calls time out via `AbortController`
- Profile data and API keys stored in `chrome.storage.local` only — never transmitted except to the configured AI provider

---

## Setup

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (top right toggle).
4. Click **Load unpacked** and select the extension folder.
5. Open the Fillr popup, go to **Settings**, choose your AI provider, paste your API key, and click **Save**.
6. Fill in your profile on the **Details** tab — fields save automatically as you type.

---

## Profile fields

| Field | Description |
|---|---|
| First Name / Last Name | Used individually or combined as full name |
| Email | |
| Phone | Formatted to match the target field's pattern |
| Address Line 1 / 2 | |
| City / State / ZIP / Country | |
| Job Title | |
| Company | |
| Years Experience | |
| LinkedIn / GitHub / Website | Full URLs |
| Twitter / Instagram | Social handles (`@jane`) |
| Bio / Summary | Long-form text for cover letters, bios, and summary fields |
| Additional Context | Free-form text the AI always reads — startup pitch, research focus, goals |

---

## Permissions

| Permission | Reason |
|---|---|
| `storage` | Stores profile data and settings locally |
| `activeTab` | Injects content script and captures screenshots on the active tab only |
| `scripting` | Dynamic content script injection for keyboard shortcut fill |
| `contextMenus` | Right-click "Fill this form with Fillr" menu item |
| `host_permissions: <all_urls>` | Required to inject the content script on arbitrary pages |

---

## AI providers

| Provider | Model | Vision | Notes |
|---|---|---|---|
| Anthropic | claude-sonnet-4-6 (fill) / claude-haiku-4-5 (essays) | Yes | Default. Haiku is used for fast single-field essay generation. |
| Replicate | meta-llama-3.1-70b-instruct | No | Vision pass is skipped automatically. Essay generation falls back to N/A. |

---

## Project structure

```
fillr/
  manifest.json       Extension manifest (MV3)
  background.js       Service worker — AI API calls, essay generation, badge, shortcuts, analytics
  content.js          Content script — field detection, all fill passes, shadow DOM, iframes, Quick Signup logic
  popup.html          Extension popup UI
  popup.js            Popup logic — profiles, settings, Quick Signup, fill trigger, analytics, overrides
  styles.css          Popup styles (dark theme, gold accent, light mode)
  icons/              Extension icons at 16, 48, and 128px
  make_icons.py       Regenerates PNG icons from source
```

---

## Development

No build step required. Edit source files directly and reload on `chrome://extensions`.

To regenerate icons (requires Python 3):
```
python3 make_icons.py
```

`node --check *.js` validates syntax across all files before loading.
