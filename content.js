'use strict';

// ── Autofill highlight style ───────────────────────────────────────────────────
(function injectHighlightStyle() {
  if (document.getElementById('__autofill-style__')) return;
  const style = document.createElement('style');
  style.id = '__autofill-style__';
  style.textContent = `
    .autofill-highlight {
      outline: 2px solid #C9A96E !important;
      background: rgba(201,169,110,0.08) !important;
      transition: outline 0.3s, background 0.3s;
    }
    #__autofill-float-btn__ {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 2147483647;
      background: #161616;
      color: #C9A96E;
      border: 1.5px solid #C9A96E;
      border-radius: 999px;
      padding: 9px 20px;
      font-size: 12px;
      font-weight: 600;
      font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      letter-spacing: 0.04em;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5), 0 0 0 0 rgba(201,169,110,0);
      display: flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
      user-select: none;
    }
    #__autofill-float-btn__:hover {
      background: #C9A96E;
      color: #0F0F0F;
      box-shadow: 0 4px 24px rgba(201,169,110,0.3), 0 2px 8px rgba(0,0,0,0.4);
      transform: translateY(-1px);
    }
  `;
  (document.head || document.documentElement).appendChild(style);
})();

// ── Keyword map (Pass 1) ──────────────────────────────────────────────────────
const KEYWORD_MAP = {
  // firstName
  'first_name': 'firstName', 'firstname': 'firstName', 'fname': 'firstName',
  'first-name': 'firstName', 'given_name': 'firstName', 'givenname': 'firstName',

  // lastName
  'last_name': 'lastName', 'lastname': 'lastName', 'lname': 'lastName',
  'last-name': 'lastName', 'family_name': 'lastName', 'surname': 'lastName',

  // email
  'email': 'email', 'e-mail': 'email', 'email_address': 'email',
  'emailaddress': 'email',

  // phone
  'phone': 'phone', 'tel': 'phone', 'mobile': 'phone', 'telephone': 'phone',
  'phone_number': 'phone', 'phonenumber': 'phone', 'cell': 'phone',

  // address1
  'address': 'address1', 'addr': 'address1', 'street': 'address1',
  'address1': 'address1', 'address_1': 'address1', 'address_line_1': 'address1',
  'addressline1': 'address1', 'street_address': 'address1',

  // address2
  'address2': 'address2', 'address_2': 'address2', 'address_line_2': 'address2',
  'addressline2': 'address2', 'apt': 'address2', 'suite': 'address2',

  // city
  'city': 'city', 'town': 'city', 'locality': 'city',

  // state
  'state': 'state', 'province': 'state', 'region': 'state',
  'state_province': 'state',

  // zip
  'zip': 'zip', 'postal': 'zip', 'postcode': 'zip', 'postal_code': 'zip',
  'zip_code': 'zip', 'zipcode': 'zip',

  // country
  'country': 'country', 'nation': 'country',

  // linkedin
  'linkedin': 'linkedin', 'linkedin_url': 'linkedin', 'linkedin_profile': 'linkedin',

  // github
  'github': 'github', 'github_url': 'github', 'github_profile': 'github',

  // website
  'website': 'website', 'url': 'website', 'portfolio': 'website',
  'personal_website': 'website', 'web_site': 'website', 'homepage': 'website',

  // bio
  'bio': 'bio', 'about': 'bio', 'summary': 'bio', 'about_me': 'bio',
  'personal_statement': 'bio', 'cover': 'bio',

  // yearsExp
  'experience': 'yearsExp', 'years': 'yearsExp', 'years_experience': 'yearsExp',
  'yearsexp': 'yearsExp', 'years_of_experience': 'yearsExp',

  // jobTitle
  'job_title': 'jobTitle', 'position': 'jobTitle',
  'jobtitle': 'jobTitle', 'role': 'jobTitle', 'occupation': 'jobTitle',

  // company
  'company': 'company', 'employer': 'company', 'organization': 'company',
  'organisation': 'company', 'company_name': 'company', 'companyname': 'company',
  'workplace': 'company',

  // full name (generic)
  'name': 'fullName',
  'full_name': 'fullName', 'fullname': 'fullName', 'your_name': 'fullName',
};

// Pre-compiled fuzzy patterns for Pass 2 (avoids rebuilding ~60 RegExp objects per field)
const FUZZY_PATTERNS = Object.entries(KEYWORD_MAP).map(([kw, profileKey]) => ({
  re: new RegExp('(?<![a-zA-Z0-9_])' + kw.replace(/_/g, '[\\s_-]*') + '(?![a-zA-Z0-9_])', 'i'),
  profileKey
}));

// ── Profile retrieval ─────────────────────────────────────────────────────────
function getProfile(data) {
  return {
    firstName: data.firstName || '',
    lastName: data.lastName || '',
    email: data.email || '',
    phone: data.phone || '',
    address1: data.address1 || '',
    address2: data.address2 || '',
    city: data.city || '',
    state: data.state || '',
    zip: data.zip || '',
    country: data.country || '',
    linkedin: data.linkedin || '',
    github: data.github || '',
    website: data.website || '',
    bio: data.bio || '',
    yearsExp: data.yearsExp || '',
    jobTitle: data.jobTitle || '',
    company: data.company || '',
  };
}

function profileValue(profile, key) {
  if (key === 'fullName') {
    return [profile.firstName, profile.lastName].filter(Boolean).join(' ');
  }
  return profile[key] || '';
}

// Strip invisible/zero-width unicode chars that some form builders use as placeholders
function stripInvisible(str) {
  return (str || '').replace(/[\u200B\u200C\u200D\uFEFF\u00AD\u00A0]/g, '').trim();
}

// ── Collect visible, fillable fields ─────────────────────────────────────────
function collectFields() {
  const selectors = [
    'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]):not([type=file]):not([type=checkbox]):not([type=radio])',
    'textarea',
    'select',
    '[contenteditable="true"]',
    '[contenteditable=""]',
  ].join(', ');

  return Array.from(document.querySelectorAll(selectors)).filter(el => {
    if (el.disabled || el.readOnly) return false;
    // Check if already filled — strip invisible chars before deciding
    const currentVal = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
      ? el.value
      : el.textContent;
    if (stripInvisible(currentVal) !== '') return false;
    // Basic visibility check
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return true;
  });
}

// ── Get a label text for a field ─────────────────────────────────────────────
const INPUT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']);

function getLabelText(el) {
  // 1. Explicit <label for="id">
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) return label.textContent.trim();
  }
  // 2. Parent <label>
  const parentLabel = el.closest('label');
  if (parentLabel) return parentLabel.textContent.trim();
  // 3. aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();
  // 4. aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy.trim().split(/\s+/)
      .map(id => { const t = document.getElementById(id); return t ? t.textContent.trim() : ''; })
      .filter(Boolean).join(' ');
    if (text) return text;
  }
  // 5. title attribute
  if (el.title) return el.title.trim();
  // 6. data-label / data-field-label attributes (used by some form builders)
  for (const attr of ['data-label', 'data-field-label', 'data-name', 'data-question']) {
    const v = el.getAttribute(attr);
    if (v) return v.trim();
  }
  // 7. Walk up ancestors (max 3 levels), collect nearby text excluding other inputs
  let node = el.parentElement;
  for (let depth = 0; depth < 3 && node && node !== document.body; depth++) {
    // Early stop: if this ancestor contains multiple form fields, we've crossed a section boundary
    const inputCount = node.querySelectorAll('input:not([type=hidden]), select, textarea').length;
    if (inputCount > 1) break;

    // Check all previous siblings at this level
    let sib = node.previousElementSibling;
    while (sib) {
      if (!INPUT_TAGS.has(sib.tagName)) {
        const text = sib.textContent.trim();
        if (text && text.length < 300) return text;
      }
      sib = sib.previousElementSibling;
    }
    // Check direct text nodes of this ancestor (excluding child inputs)
    const childText = Array.from(node.childNodes)
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent.trim())
      .filter(Boolean)
      .join(' ');
    if (childText && childText.length < 300) return childText;
    node = node.parentElement;
  }
  return '';
}

// ── Normalize string for matching ─────────────────────────────────────────────
function normalize(str) {
  return (str || '').toLowerCase().replace(/[\s\-_.]+/g, '_').replace(/[^a-z0-9_]/g, '');
}

// ── Pass 1: Exact keyword match ───────────────────────────────────────────────
function exactMatch(el) {
  const candidates = [
    normalize(el.name),
    normalize(el.id),
    normalize(el.getAttribute('autocomplete') || ''),
  ];
  for (const c of candidates) {
    if (c && KEYWORD_MAP[c]) return KEYWORD_MAP[c];
  }
  return null;
}

// ── Pass 2: Fuzzy word-boundary match ────────────────────────────────────────
function fuzzyMatch(el) {
  const text = [
    getLabelText(el),
    el.placeholder || '',
    el.name || '',
    el.id || '',
    el.getAttribute('aria-label') || '',
    el.title || '',
    el.getAttribute('data-label') || '',
    el.getAttribute('data-name') || '',
  ].join(' ').toLowerCase();

  for (const { re, profileKey } of FUZZY_PATTERNS) {
    if (re.test(text)) {
      return profileKey;
    }
  }
  return null;
}

// ── Fill a single field ───────────────────────────────────────────────────────
function fillField(el, value) {
  if (!value && value !== 0) return false;

  const strVal = String(value);
  const isContentEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '';

  if (isContentEditable) {
    el.focus();
    // Select all existing content and replace
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, strVal);
    // Fallback if execCommand not available
    if (stripInvisible(el.textContent) !== strVal) {
      el.textContent = strVal;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (el.tagName === 'SELECT') {
    const opts = Array.from(el.options).filter(o => o.value !== '');
    const lower = strVal.toLowerCase();
    // Try exact match first, then partial/includes match
    const match = opts.find(o => o.value.toLowerCase() === lower || o.text.toLowerCase() === lower)
      || opts.find(o => o.text.toLowerCase().includes(lower) || lower.includes(o.text.toLowerCase()));
    if (match) {
      el.value = match.value;
    } else {
      return false;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    // React-compatible: use native setter + InputEvent so React's synthetic event system fires
    const doc = el.ownerDocument;
    const view = doc.defaultView;
    const proto = el.tagName === 'TEXTAREA'
      ? view.HTMLTextAreaElement.prototype
      : view.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (nativeSetter) nativeSetter.call(el, strVal); else el.value = strVal;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: strVal }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  el.classList.add('autofill-highlight');
  setTimeout(() => el.classList.remove('autofill-highlight'), 1500);

  return true;
}

// ── Build descriptor for Claude (Pass 3) ─────────────────────────────────────
function fieldDescriptor(el) {
  const desc = {
    id: el.id || '',
    name: el.name || '',
    placeholder: el.placeholder || '',
    label: getLabelText(el),
    type: el.tagName === 'SELECT' ? 'select' : (el.type || el.tagName.toLowerCase()),
  };
  if (el.tagName === 'SELECT') {
    desc.options = Array.from(el.options)
      .filter(o => o.value !== '' && o.text.trim() !== '')
      .map(o => o.text.trim())
      .slice(0, 30);
  }
  return desc;
}

// ── Apply a Claude mapping value to a field ───────────────────────────────────
// Claude may return a profile key ("company") or a direct option value ("Yes").
// For selects we try the raw value first, then fall back to profile key lookup.
function applyClaudeValue(el, claudeValue, profile) {
  if (!claudeValue) return false;
  if (el.tagName === 'SELECT') {
    // Try the raw Claude value as a direct option (e.g. "Yes", "No", "Founder")
    if (fillField(el, claudeValue)) return true;
  }
  // Treat as a profile key
  const val = profileValue(profile, claudeValue);
  return val ? fillField(el, val) : false;
}

// ── Main autofill function ────────────────────────────────────────────────────
async function autofill() {
  const storageData = await new Promise(resolve =>
    chrome.storage.local.get(null, resolve)
  );

  const profile = getProfile(storageData);
  const apiKey = storageData.apiKey || '';
  let apiError = null;

  const fields = collectFields();
  let filledCount = 0;
  const unmatched = [];

  for (const el of fields) {
    let profileKey = exactMatch(el) || fuzzyMatch(el);
    if (profileKey) {
      const val = profileValue(profile, profileKey);
      if (val && fillField(el, val)) filledCount++;
    } else {
      unmatched.push(el);
    }
  }

  // Pass 3 + 4: Claude API for unmatched fields
  if (unmatched.length > 0) {
    let stillUnmatched = [...unmatched];

    if (apiKey) {
      try {
        const profileWithFullName = {
          ...profile,
          fullName: [profile.firstName, profile.lastName].filter(Boolean).join(' ')
        };
        const descriptors = unmatched.map(fieldDescriptor);
        const response = await chrome.runtime.sendMessage({
          action: 'claudeFill',
          fields: descriptors,
          profile: profileWithFullName,
        });

        if (response && response.mapping) {
          stillUnmatched = [];
          for (const el of unmatched) {
            const key = el.id || el.name;
            const claudeVal = response.mapping[key];
            if (claudeVal && applyClaudeValue(el, claudeVal, profile)) filledCount++;
            else stillUnmatched.push(el);
          }
        } else if (response && response.error) {
          console.warn('[Autofill] Pass 3 error:', response.error);
          apiError = response.error;
        }
      } catch (e) {
        console.warn('[Autofill] Pass 3 failed:', e);
      }
    }

    if (stillUnmatched.length > 0 && apiKey) {
      try {
        const profileWithFullName = {
          ...profile,
          fullName: [profile.firstName, profile.lastName].filter(Boolean).join(' ')
        };
        const descriptors = stillUnmatched.map(fieldDescriptor);
        const visionResponse = await chrome.runtime.sendMessage({
          action: 'claudeVisionFill',
          fields: descriptors,
          profile: profileWithFullName,
        });
        if (visionResponse && visionResponse.mapping) {
          for (const el of stillUnmatched) {
            const key = el.id || el.name;
            const claudeVal = visionResponse.mapping[key];
            if (claudeVal) applyClaudeValue(el, claudeVal, profile) && filledCount++;
          }
        } else if (visionResponse && visionResponse.error) {
          apiError = apiError || visionResponse.error;
        }
      } catch (e) {
        console.warn('[Autofill] Pass 4 failed:', e);
      }
    }
  }

  return { filled: filledCount, apiError };
}

// ── Floating button ───────────────────────────────────────────────────────────
function hasFormElements() {
  return document.querySelectorAll('input:not([type=hidden]), textarea, select').length > 0;
}

function createFloatingButton() {
  if (document.getElementById('__autofill-float-btn__')) return;
  if (!hasFormElements()) return;

  const btn = document.createElement('button');
  btn.id = '__autofill-float-btn__';
  btn.innerHTML = 'Autofill';
  btn.title = 'Autofill this page';

  let isFilling = false;
  btn.addEventListener('click', async () => {
    if (isFilling) return;
    isFilling = true;
    btn.disabled = true;
    btn.textContent = 'Filling...';
    try {
      const result = await autofill();
      const count = result.filled;
      btn.innerHTML = count > 0 ? `${count} filled` : 'Autofill';
    } catch (e) {
      btn.innerHTML = 'Autofill';
    } finally {
      isFilling = false;
      btn.disabled = false;
    }
    setTimeout(() => { btn.innerHTML = 'Autofill'; }, 2000);
  });
  document.body.appendChild(btn);
}

function removeFloatingButton() {
  const btn = document.getElementById('__autofill-float-btn__');
  if (btn) btn.remove();
}

// Initialize floating button based on stored setting
chrome.storage.local.get('floatingBtn', ({ floatingBtn }) => {
  if (floatingBtn) createFloatingButton();
});

// MutationObserver: re-show/hide floating button on SPA navigation
let _spaDebounce = null;
const spaObserver = new MutationObserver(() => {
  clearTimeout(_spaDebounce);
  _spaDebounce = setTimeout(() => {
    const hasForm = !!document.querySelector('input:not([type=hidden]),select,textarea');
    const btn = document.getElementById('__autofill-float-btn__');
    chrome.storage.local.get('floatingBtn', ({ floatingBtn }) => {
      if (!floatingBtn) return;
      if (hasForm && !btn) createFloatingButton();
      else if (!hasForm && btn) btn.remove();
    });
  }, 300);
});
spaObserver.observe(document.body, { childList: true, subtree: true });

// ── Message listener ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'fill') {
    autofill().then(result => sendResponse(result)).catch(() => sendResponse({ filled: 0 }));
    return true; // async
  }

  if (message.action === 'toggleFloatingBtn') {
    if (message.enabled) {
      createFloatingButton();
    } else {
      removeFloatingButton();
    }
    sendResponse({ ok: true });
  }
});
