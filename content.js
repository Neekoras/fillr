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
    .autofill-error {
      outline: 1px solid #EF4444 !important;
      background: rgba(239,68,68,0.08) !important;
      transition: outline 0.3s, background 0.3s;
    }
    .autofill-preview {
      outline: 2px solid #3B82F6 !important;
      background: rgba(59,130,246,0.08) !important;
      transition: outline 0.3s, background 0.3s;
    }
    .autofill-preview-ai {
      outline: 1px solid #EF4444 !important;
      background: rgba(239,68,68,0.06) !important;
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
    #__autofill-float-btn__:focus-visible {
      outline: 2px solid #C9A96E;
      outline-offset: 3px;
    }
    @media (prefers-color-scheme: light) {
      #__autofill-float-btn__ {
        background: #FFFFFF;
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      }
      #__autofill-float-btn__:hover {
        box-shadow: 0 4px 24px rgba(201,169,110,0.4);
      }
    }
  `;
  (document.head || document.documentElement).appendChild(style);
})();

// ── Field selector constant ───────────────────────────────────────────────────
const FIELD_SELECTOR = [
  'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]):not([type=file])',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[contenteditable=""]',
].join(', ');

// ── Keyword map (Pass 1) ──────────────────────────────────────────────────────
const KEYWORD_MAP = {
  // firstName
  'first_name': 'firstName', 'firstname': 'firstName', 'fname': 'firstName',
  'first-name': 'firstName', 'given_name': 'firstName', 'givenname': 'firstName',

  // lastName
  'last_name': 'lastName', 'lastname': 'lastName', 'lname': 'lastName',
  'last-name': 'lastName', 'family_name': 'lastName', 'surname': 'lastName',

  // full name (generic)
  'name': 'fullName',
  'full_name': 'fullName', 'fullname': 'fullName', 'your_name': 'fullName',

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

  // twitter / X
  'twitter': 'twitter', 'twitter_url': 'twitter', 'twitter_handle': 'twitter',

  // instagram
  'instagram': 'instagram', 'instagram_url': 'instagram',

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
};

// Pre-compiled fuzzy patterns for Pass 2
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
    twitter: data.twitter || '',
    instagram: data.instagram || '',
    bio: data.bio || '',
    yearsExp: data.yearsExp || '',
    jobTitle: data.jobTitle || '',
    company: data.company || '',
    context: data.context || '',
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

// ── Simple debounce helper ─────────────────────────────────────────────────────
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── collectFields result cache — rebuilt on DOM mutation, served directly between mutations
let _fieldsCache = null;
let _fieldsCacheValid = false;
let _fieldsCacheFillAll = false;

// Tracks fields filled in this page session — used by skipFilled mode
const _filledThisSession = new WeakSet();

// ── Label text cache (dataset attribute for SPA invalidation) ─────────────

// ── Recursive shadow DOM field collection (item 1) ────────────────────────────
function collectShadowFields(root, depth = 0, maxDepth = 4) {
  if (depth > maxDepth) return [];
  const fields = Array.from(root.querySelectorAll(FIELD_SELECTOR));
  root.querySelectorAll('*').forEach(el => {
    if (el.shadowRoot) fields.push(...collectShadowFields(el.shadowRoot, depth + 1, maxDepth));
  });
  return fields;
}

// ── Collect visible, fillable fields ─────────────────────────────────────────
function collectFields(fillAll = false, skipFilled = false) {
  if (_fieldsCacheValid && _fieldsCacheFillAll === fillAll && !skipFilled) {
    return _fieldsCache;
  }
  const main = Array.from(document.querySelectorAll(FIELD_SELECTOR));
  const shadow = collectShadowFields(document, 0, 4);
  const all = [...main, ...shadow];

  let crossOriginFrameCount = 0;
  for (const frame of document.querySelectorAll('iframe')) {
    try {
      const doc = frame.contentDocument;
      if (doc) Array.from(doc.querySelectorAll(FIELD_SELECTOR)).forEach(f => all.push(f));
    } catch { crossOriginFrameCount++; }
  }
  if (crossOriginFrameCount > 0) window.__fillrCrossOriginFrames = crossOriginFrameCount;

  const filtered = all.filter(el => {
    if (el.disabled || el.readOnly) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    if (skipFilled && _filledThisSession.has(el)) return false;
    if (el.type === 'checkbox') return !el.checked;
    if (el.type === 'radio') {
      if (!el.name) return false;
      const group = Array.from((el.getRootNode() || document).querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`));
      if (group.some(r => r.checked)) return false;
      return group[0] === el;
    }
    const currentVal = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
      ? el.value : el.textContent;
    if (stripInvisible(currentVal) !== '') return false;
    return true;
  });

  let result = filtered;
  if (!fillAll) {
    const inForm = filtered.filter(el => el.closest('form'));
    if (inForm.length > 0) result = inForm;
  }

  if (!skipFilled) {
    _fieldsCache = result;
    _fieldsCacheValid = true;
    _fieldsCacheFillAll = fillAll;
  }
  return result;
}

// ── Get a label text for a field ─────────────────────────────────────────────
const INPUT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']);

function getLabelText(el) {
  // Use dataset attribute for SPA-safe cache invalidation
  if (el.dataset && 'fillrLabel' in el.dataset) return el.dataset.fillrLabel;

  let result = '';

  // 1. Explicit <label for="id">
  if (el.id) {
    const labelEl = (el.getRootNode() instanceof ShadowRoot ? el.getRootNode() : document)
      .querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (labelEl) { result = labelEl.textContent.trim(); }
  }
  if (!result) {
    // 2. Parent <label>
    const parentLabel = el.closest('label');
    if (parentLabel) result = parentLabel.textContent.trim();
  }
  if (!result) {
    // 3. aria-label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) result = ariaLabel.trim();
  }
  if (!result) {
    // 4. aria-labelledby
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy.trim().split(/\s+/)
        .map(id => { const t = document.getElementById(id); return t ? t.textContent.trim() : ''; })
        .filter(Boolean).join(' ');
      if (text) result = text;
    }
  }
  if (!result && el.title) result = el.title.trim();
  if (!result) {
    // 6. data-label / data-field-label attributes
    for (const attr of ['data-label', 'data-field-label', 'data-name', 'data-question']) {
      const v = el.getAttribute(attr);
      if (v) { result = v.trim(); break; }
    }
  }
  if (!result) {
    // 7. Walk up ancestors (max 3 levels)
    let node = el.parentElement;
    for (let depth = 0; depth < 3 && node && node !== document.body; depth++) {
      const inputCount = node.querySelectorAll('input:not([type=hidden]), select, textarea').length;
      if (inputCount > 1) break;
      let sib = node.previousElementSibling;
      while (sib) {
        if (!INPUT_TAGS.has(sib.tagName)) {
          const text = sib.textContent.trim();
          if (text && text.length < 300) { result = text; break; }
        }
        sib = sib.previousElementSibling;
      }
      if (result) break;
      const childText = Array.from(node.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent.trim())
        .filter(Boolean)
        .join(' ');
      if (childText && childText.length < 300) { result = childText; break; }
      node = node.parentElement;
    }
  }

  // Store directly in dataset for SPA invalidation
  if (el.dataset) el.dataset.fillrLabel = result;
  return result;
}

// MutationObserver to clear stale label cache on SPA navigation
const labelCacheObserver = new MutationObserver(debounce(() => {
  _fieldsCacheValid = false; // invalidate fields cache on DOM mutation
  document.querySelectorAll('[data-fillr-label]').forEach(el => {
    delete el.dataset.fillrLabel;
  });
}, 200));
labelCacheObserver.observe(document.body, { childList: true, subtree: true });

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
    getLabelText(el), // reads from cache — no extra DOM traversal
    el.placeholder || '',
    el.name || '',
    el.id || '',
    el.getAttribute('aria-label') || '',
    el.title || '',
    el.getAttribute('data-label') || '',
    el.getAttribute('data-name') || '',
  ].join(' ').toLowerCase();

  for (const { re, profileKey } of FUZZY_PATTERNS) {
    if (re.test(text)) return profileKey;
  }
  return null;
}

// ── Phone number formatting (item 24) ─────────────────────────────────────────
function formatPhone(raw, el) {
  const digits = (raw || '').replace(/\D/g, '');
  const ph = el.placeholder || '';
  // Detect format from placeholder
  if (/\(\d{3}\)\s?\d{3}-\d{4}/.test(ph) || /\(\d{3}\)/.test(ph)) {
    if (digits.length >= 10) return `(${digits.slice(-10,-7)}) ${digits.slice(-7,-4)}-${digits.slice(-4)}`;
  }
  if (/\+1\s?\d{3}\s?\d{3}\s?\d{4}/.test(ph)) {
    if (digits.length >= 11) return `+${digits[0]} ${digits.slice(1,4)} ${digits.slice(4,7)} ${digits.slice(7,11)}`;
  }
  return null; // No detectable format — fill raw
}

// ── Fill a single field (async for contenteditable paste support) ─────────────
async function fillField(el, value) {
  if (value === null || value === undefined) return false;

  const strVal = String(value);
  const isContentEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '';

  if (el.type === 'checkbox') {
    const truthy = /^(yes|true|1|checked|on)$/i.test(strVal.trim());
    const nativeCheckedSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')?.set;
    if (nativeCheckedSetter) nativeCheckedSetter.call(el, truthy); else el.checked = truthy;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.classList.add('autofill-highlight');
    setTimeout(() => el.classList.remove('autofill-highlight'), 1500);
    return true;
  }

  if (el.type === 'radio') {
    if (!el.name) return false;
    const root = el.getRootNode() instanceof ShadowRoot ? el.getRootNode() : document;
    const group = Array.from(root.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`));
    if (!strVal.trim()) {
      group.forEach(r => { r.checked = false; r.dispatchEvent(new Event('change', { bubbles: true })); });
      return true;
    }
    const lower = strVal.toLowerCase().trim();
    const match = group.find(r => r.value.toLowerCase() === lower)
      || group.find(r => getLabelText(r).toLowerCase() === lower)
      || group.find(r => r.value.toLowerCase().startsWith(lower));
    if (!match) return false;
    match.checked = true;
    match.dispatchEvent(new Event('change', { bubbles: true }));
    match.classList.add('autofill-highlight');
    setTimeout(() => match.classList.remove('autofill-highlight'), 1500);
    return true;
  }

  if (isContentEditable) {
    // Use ClipboardEvent paste instead of deprecated execCommand (item 4)
    el.focus();
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', strVal);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    } catch {}
    // Fallback: check if content changed after paste event
    await new Promise(r => setTimeout(r, 0));
    if (stripInvisible(el.textContent) !== strVal) {
      el.textContent = strVal;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (el.type === 'date' && strVal) {
    const d = new Date(strVal);
    if (!isNaN(d.getTime())) {
      el.value = d.toISOString().split('T')[0];
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // Unparseable date — highlight error and skip (item 7)
      el.classList.add('autofill-error');
      setTimeout(() => el.classList.remove('autofill-error'), 3000);
      return false;
    }
  } else if (el.tagName === 'SELECT') {
    const opts = Array.from(el.options).filter(o => o.value !== '');
    const lower = strVal.toLowerCase();
    const match = opts.find(o => o.value.toLowerCase() === lower || o.text.toLowerCase() === lower)
      || opts.find(o => o.text.toLowerCase().startsWith(lower))
      || opts.find(o => lower.startsWith(o.text.toLowerCase()));
    if (match) { el.value = match.value; }
    else return false;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    // Textarea bio truncation at maxLength (item 25)
    let finalVal = strVal;
    if (el.tagName === 'TEXTAREA' && el.maxLength > 0 && strVal.length > el.maxLength) {
      let truncated = strVal.slice(0, el.maxLength - 1);
      const lastSpace = truncated.lastIndexOf(' ');
      if (lastSpace > 0) truncated = truncated.slice(0, lastSpace);
      finalVal = truncated;
    }

    const doc = el.ownerDocument;
    const view = doc.defaultView;
    const proto = el.tagName === 'TEXTAREA'
      ? view.HTMLTextAreaElement.prototype
      : view.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (nativeSetter) nativeSetter.call(el, finalVal); else el.value = finalVal;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: finalVal }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    // React Hook Form + MUI compatibility (item 6)
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    el.dispatchEvent(new Event('focus', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (el.closest?.('.MuiInputBase-root')) {
      const wrapper = el.closest('.MuiInputBase-root');
      wrapper.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  el.classList.add('autofill-highlight');
  setTimeout(() => el.classList.remove('autofill-highlight'), 1500);
  _filledThisSession.add(el);
  return true;
}

// ── Custom dropdown (non-native select) support ────────────────────────────────

function findCustomDropdowns() {
  const results = [];
  const seen = new Set();

  const candidates = [
    ...document.querySelectorAll('[role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="true"]'),
    ...document.querySelectorAll('button, div, span')
  ];

  for (const el of candidates) {
    if (seen.has(el)) continue;
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT') continue;
    if (el.closest('select')) continue;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

    const hasRole = el.getAttribute('role') === 'combobox' ||
      el.getAttribute('aria-haspopup') === 'listbox' ||
      el.getAttribute('aria-haspopup') === 'true';
    const looksLikePlaceholder = /^(select (an?|one|one or more) ?option|choose( an?)?|pick an?)/i.test(el.textContent.trim());

    if (!hasRole && !looksLikePlaceholder) continue;
    seen.add(el);
    results.push(el);
  }
  return results;
}

function getLabelForCustomDropdown(el) {
  if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy.trim().split(/\s+/).map(id => {
      const t = document.getElementById(id); return t ? t.textContent.trim() : '';
    }).filter(Boolean).join(' ');
    if (text) return text;
  }
  let node = el.parentElement;
  for (let depth = 0; depth < 5 && node && node !== document.body; depth++) {
    let sib = node.previousElementSibling;
    while (sib) {
      if (!INPUT_TAGS.has(sib.tagName)) {
        const t = sib.textContent.trim();
        if (t && t.length < 200) return t;
      }
      sib = sib.previousElementSibling;
    }
    const label = node.querySelector('label');
    if (label && !el.contains(label)) {
      const t = label.textContent.trim();
      if (t && t.length < 200) return t;
    }
    node = node.parentElement;
  }
  return el.getAttribute('placeholder') || '';
}

function findVisibleDropdownOptions() {
  const byRole = Array.from(document.querySelectorAll('[role="option"], [role="listbox"] li, [role="listbox"] [role="option"]'))
    .filter(el => {
      const s = window.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    });
  if (byRole.length) return byRole;

  const containers = Array.from(document.querySelectorAll('ul, ol, [class*="dropdown"], [class*="options"], [class*="listbox"], [class*="menu"]'))
    .filter(el => {
      const s = window.getComputedStyle(el);
      return (s.position === 'absolute' || s.position === 'fixed') && s.display !== 'none' && s.visibility !== 'hidden';
    })
    .sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);

  for (const container of containers) {
    const items = Array.from(container.querySelectorAll('li, [class*="option"], [class*="item"]'))
      .filter(el => {
        const s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden';
      });
    if (items.length) return items;
  }
  return [];
}

async function peekDropdownOptions(el) {
  // Check aria-owns/aria-controls for pre-existing hidden listbox
  const ownedId = el.getAttribute('aria-owns') || el.getAttribute('aria-controls');
  if (ownedId) {
    const listbox = document.getElementById(ownedId);
    if (listbox) {
      const opts = Array.from(listbox.querySelectorAll('[role="option"], li'))
        .map(o => o.textContent.trim()).filter(t => t && !/^(?:select|choose)\b/i.test(t));
      if (opts.length) return opts;
    }
  }
  const parentOpts = Array.from((el.parentElement || el).querySelectorAll('[role="option"]'))
    .map(o => o.textContent.trim()).filter(Boolean);
  if (parentOpts.length) return parentOpts;

  // Hide listbox container before opening to prevent visual flicker (item 8)
  const ownedEl = ownedId ? document.getElementById(ownedId) : null;
  const target = ownedEl || el.parentElement;
  if (target) {
    target._prevPointerEvents = target.style.pointerEvents;
    target._prevOpacity = target.style.opacity;
    target.style.pointerEvents = 'none';
    target.style.opacity = '0';
  }
  await new Promise(r => requestAnimationFrame(r));

  el.click();
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await new Promise(r => setTimeout(r, 400));
  const optionEls = findVisibleDropdownOptions();
  const opts = optionEls.map(o => o.textContent.trim()).filter(t => t && !/^(?:select|choose)\b/i.test(t));

  // Restore visibility
  if (target) {
    target.style.pointerEvents = target._prevPointerEvents;
    target.style.opacity = target._prevOpacity;
  }

  // Close
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  document.body.click();
  await new Promise(r => setTimeout(r, 200));
  return opts;
}

async function fillCustomDropdown(el, value) {
  const lower = value.toLowerCase().trim();
  el.click();
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await new Promise(r => setTimeout(r, 400));

  const optionEls = findVisibleDropdownOptions();
  if (!optionEls.length) { document.body.click(); return false; }

  const match =
    optionEls.find(o => o.textContent.trim().toLowerCase() === lower) ||
    optionEls.find(o => o.textContent.trim().toLowerCase().startsWith(lower)) ||
    optionEls.find(o => lower.startsWith(o.textContent.trim().toLowerCase())) ||
    optionEls.find(o => o.textContent.trim().toLowerCase().includes(lower));

  if (!match) {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.body.click();
    await new Promise(r => setTimeout(r, 100));
    return false;
  }

  match.scrollIntoView({ block: 'nearest' });
  match.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  match.click();
  match.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  await new Promise(r => setTimeout(r, 150));

  el.classList.add('autofill-highlight');
  setTimeout(() => el.classList.remove('autofill-highlight'), 1500);
  return true;
}

// ── Typeahead/autocomplete support (item 23) ──────────────────────────────────
async function fillTypeahead(el, value) {
  el.focus();
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  // Type character by character at 30ms intervals
  for (const char of value) {
    const current = el.value;
    if (nativeSetter) nativeSetter.call(el, current + char); else el.value = current + char;
    el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: char }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
    await new Promise(r => setTimeout(r, 30));
  }
  // Race MutationObserver (dropdown appeared) against 600ms timeout
  const label = getLabelText(el);
  const appeared = await new Promise(resolve => {
    const watchTarget = document.querySelector('[role="listbox"]') || el.closest('[class*="autocomplete"]') || document.body;
    let settled = false;
    const obs = new MutationObserver(() => {
      if (settled) return;
      const opts = document.querySelectorAll('[role="option"], [role="listitem"], .autocomplete-suggestion');
      if (opts.length > 0) { settled = true; obs.disconnect(); clearTimeout(timer); resolve(true); }
    });
    obs.observe(watchTarget, { childList: true, subtree: true });
    const timer = setTimeout(() => { if (!settled) { settled = true; obs.disconnect(); resolve(false); } }, 600);
  });

  if (!appeared) {
    console.warn(`[Fillr] typeahead: no dropdown appeared for "${label}"`);
    return false;
  }

  const options = document.querySelectorAll('[role="option"], [role="listitem"], .autocomplete-suggestion');
  const lower = value.toLowerCase();
  const match = Array.from(options).find(o => o.textContent.trim().toLowerCase().startsWith(lower))
    || Array.from(options).find(o => o.textContent.trim().toLowerCase().includes(lower));
  if (match) { match.click(); return true; }
  return false;
}

// ── Collect page context for Claude ──────────────────────────────────────────
function getPageContext() {
  const title = document.title || '';
  const metaDesc = document.querySelector('meta[name="description"]')?.content || '';
  const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
    .slice(0, 8)
    .map(h => h.textContent.trim())
    .filter(Boolean);
  const formEl = document.querySelector('form') || document.querySelector('[role="form"]');
  let nearbyText = '';
  if (formEl) {
    const container = formEl.closest('section, main, article') || formEl.parentElement;
    if (container) {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      const chunks = [];
      let len = 0;
      let node;
      while ((node = walker.nextNode()) && len < 800) {
        const t = node.textContent.trim();
        if (t.length > 20) { chunks.push(t); len += t.length + 1; }
      }
      nearbyText = chunks.join(' ').slice(0, 800);
    }
  }
  return { title, metaDesc, headings, nearbyText };
}

// ── Build descriptor for Claude (Pass 3) ─────────────────────────────────────
function fieldDescriptor(el) {
  const desc = {
    id: el.id || el.dataset.__fillrIdx || '',
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
  if (el.type === 'radio' && el.name) {
    const root = el.getRootNode() instanceof ShadowRoot ? el.getRootNode() : document;
    const group = root.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`);
    desc.options = Array.from(group).map(r => getLabelText(r) || r.value);
    desc.type = 'radio-group';
  }
  return desc;
}

// ── Apply a Claude mapping value to a field ───────────────────────────────────
async function applyClaudeValue(el, claudeValue, profile) {
  if (!claudeValue) return false;
  if (el.tagName === 'SELECT') {
    if (await fillField(el, claudeValue)) return true;
  }
  const profileVal = profileValue(profile, claudeValue);
  if (profileVal) return fillField(el, profileVal);
  return fillField(el, claudeValue);
}

// ── Undo stack ────────────────────────────────────────────────────────────────
let undoStack = [];

// ── Concurrent fill guard ─────────────────────────────────────────────────────
let isFilling = false;

// ── Main autofill function ────────────────────────────────────────────────────
async function autofill({ skipFilled = false, passesStart = 1 } = {}) {
  if (isFilling) return { filled: 0 };
  isFilling = true;
  try {
  const storageData = await new Promise(resolve =>
    chrome.storage.local.get(['profiles', 'activeProfile', 'apiKey', 'blockedSites', 'siteAssignments', 'fieldOverrides', 'fillAll'], resolve)
  );

  const blockedSites = (storageData.blockedSites || []).map(s => s.toLowerCase());
  const hostname = location.hostname.toLowerCase();
  if (blockedSites.some(d => hostname === d || hostname.endsWith('.' + d))) {
    return { filled: 0, blocked: true };
  }

  let profileData;
  const profiles = storageData.profiles;
  if (profiles && profiles.length > 0) {
    const siteAssignments = storageData.siteAssignments || {};
    let activeIdx = Math.min(storageData.activeProfile || 0, profiles.length - 1);
    if (siteAssignments[hostname] !== undefined) {
      activeIdx = Math.min(siteAssignments[hostname], profiles.length - 1);
    }
    profileData = profiles[activeIdx];
  } else {
    profileData = storageData;
  }

  const profile = getProfile(profileData || {});
  const apiKey = storageData.apiKey || '';
  const fieldOverrides = storageData.fieldOverrides || {};
  const fillAll = !!storageData.fillAll;
  let apiError = null;

  // Cross-origin iframe tracking reset
  window.__fillrCrossOriginFrames = 0;

  const fields = collectFields(fillAll, skipFilled);
  let filledCount = 0;
  let firstFilledEl = null;
  const unmatched = [];
  let p1p2Count = 0, p3Count = 0, p4Count = 0, p5Count = 0, errorCount = 0;
  const filledEntries = [];

  // Snapshot original values for undo (before any fills) — use defaultValue for pre-filled detection (item 10)
  const originalValues = new Map();
  for (const el of fields) {
    if (el.type === 'checkbox') {
      originalValues.set(el, el.checked ? 'checked' : 'unchecked');
    } else if (el.type === 'radio' && el.name) {
      const root = el.getRootNode() instanceof ShadowRoot ? el.getRootNode() : document;
      const group = root.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`);
      originalValues.set(el, Array.from(group).find(r => r.checked)?.value || '');
    } else {
      const snapshotVal = el.getAttribute('value') ?? el.defaultValue ?? el.value ?? '';
      originalValues.set(el, snapshotVal || (el.tagName === 'SELECT' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? el.value : el.textContent));
    }
  }

  // Pre-populate label cache for all fields in one pass
  fields.forEach(el => getLabelText(el));

  // Build profileWithFullName once (used in passes 3, 4, 5)
  const profileWithFullName = {
    ...profile,
    fullName: [profile.firstName, profile.lastName].filter(Boolean).join(' ')
  };

  // Pass 1 & 2: Exact and fuzzy keyword matching with per-field override support (item 18)
  // Skip if passesStart >= 3 (resume mode)
  if (passesStart < 3) {
    for (const el of fields) {
      const profileKey = exactMatch(el) || fuzzyMatch(el);
      if (profileKey) {
        // Check per-field override first (item 18)
        const overrideKey = `${hostname}::${profileKey}`;
        const overrideVal = fieldOverrides[overrideKey];

        // Typeahead detection (item 23)
        const needsTypeahead = el.getAttribute('autocomplete') === 'street-address' ||
          /company|university|school|location/i.test(getLabelText(el));

        let val;
        if (overrideVal !== undefined) {
          val = overrideVal;
        } else {
          // Phone formatting (item 24) — apply when filling phone fields
          if (profileKey === 'phone') {
            const rawPhone = profileValue(profile, profileKey);
            const formatted = formatPhone(rawPhone, el);
            val = formatted || rawPhone;
          } else {
            val = profileValue(profile, profileKey);
          }
        }

        if (val) {
          let filled = false;
          if (needsTypeahead) {
            filled = await fillTypeahead(el, val);
            if (!filled) filled = await fillField(el, val);
          } else {
            filled = await fillField(el, val);
          }
          if (filled) {
            if (!firstFilledEl) firstFilledEl = el;
            filledCount++;
            p1p2Count++;
            filledEntries.push({ el, profileKey });
          }
        }
      } else {
        unmatched.push(el);
      }
    }
  } else {
    // passesStart >= 3: skip P1/P2, treat all fields as unmatched
    fields.forEach(el => unmatched.push(el));
  }

  if (unmatched.length > 0) {
    unmatched.forEach((el, i) => {
      if (!el.id && !el.name) el.dataset.__fillrIdx = String(i);
    });

    let stillUnmatched = [...unmatched];

    if (apiKey) {
      try {
        chrome.runtime.sendMessage({ action: 'fillProgress', stage: 'ai-text' }).catch(() => {});

        const descriptors = unmatched.map(fieldDescriptor);
        const response = await chrome.runtime.sendMessage({
          action: 'claudeFill',
          fields: descriptors,
          profile: profileWithFullName,
          pageContext: getPageContext(),
        });

        if (response && response.mapping) {
          stillUnmatched = [];
          for (const el of unmatched) {
            const key = el.id || el.name || el.dataset.__fillrIdx || '';
            const claudeVal = response.mapping[key];
            if (claudeVal && await applyClaudeValue(el, claudeVal, profile)) {
              if (!firstFilledEl) firstFilledEl = el;
              filledCount++;
              p3Count++;
            } else {
              stillUnmatched.push(el);
            }
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
        chrome.runtime.sendMessage({ action: 'fillProgress', stage: 'ai-vision' }).catch(() => {});

        const descriptors = stillUnmatched.map(fieldDescriptor).slice(0, 20);
        const visionResponse = await chrome.runtime.sendMessage({
          action: 'claudeVisionFill',
          fields: descriptors,
          profile: profileWithFullName,
          pageContext: getPageContext(),
        });

        // Vision pass provider skip (item 9)
        if (visionResponse && visionResponse.skipped) {
          apiError = apiError || visionResponse.reason;
        } else if (visionResponse && visionResponse.mapping) {
          for (const el of stillUnmatched) {
            const key = el.id || el.name || el.dataset.__fillrIdx || '';
            const claudeVal = visionResponse.mapping[key];
            if (claudeVal && await applyClaudeValue(el, claudeVal, profile)) {
              if (!firstFilledEl) firstFilledEl = el;
              filledCount++;
              p4Count++;
            }
          }
        } else if (visionResponse && visionResponse.error) {
          apiError = apiError || visionResponse.error;
        }
      } catch (e) {
        console.warn('[Autofill] Pass 4 failed:', e);
      }
    }

    unmatched.forEach(el => { delete el.dataset.__fillrIdx; });
  }

  // ── Pass 5: Custom dropdown fill ──────────────────────────────────────────
  try {
    const customDropdowns = findCustomDropdowns();
    if (customDropdowns.length > 0) {
      const customDescriptors = [];
      for (let i = 0; i < customDropdowns.length; i++) {
        const cEl = customDropdowns[i];
        const label = getLabelForCustomDropdown(cEl);
        const options = await peekDropdownOptions(cEl);
        const idx = `__custom_${i}`;
        cEl.dataset.__fillrCustomIdx = idx;
        customDescriptors.push({ id: idx, name: '', placeholder: '', label, type: 'select', options: options.slice(0, 30) });
      }
      if (customDescriptors.length > 0) {
        chrome.runtime.sendMessage({ action: 'fillProgress', stage: 'ai-text' }).catch(() => {});
        const customResponse = await chrome.runtime.sendMessage({
          action: 'claudeFill',
          fields: customDescriptors,
          profile: profileWithFullName,
          pageContext: getPageContext(),
        });
        if (customResponse && customResponse.mapping) {
          for (let i = 0; i < customDropdowns.length; i++) {
            const cEl = customDropdowns[i];
            const idx = `__custom_${i}`;
            const val = customResponse.mapping[idx];
            if (val && await fillCustomDropdown(cEl, val)) {
              filledCount++;
              p5Count++;
              if (!firstFilledEl) firstFilledEl = cEl;
            }
            delete cEl.dataset.__fillrCustomIdx;
          }
        }
      }
    }
  } catch (e) {
    console.warn('[Autofill] Pass 5 (custom dropdowns) failed:', e);
  }

  // Resolve confirm fields after P1/P2
  const conflictSummary = await resolveConfirmFields(filledEntries);

  // Build undo stack — only fields whose value actually changed
  undoStack = [];
  for (const [el, original] of originalValues) {
    let current;
    if (el.type === 'checkbox') {
      current = el.checked ? 'checked' : 'unchecked';
    } else if (el.type === 'radio' && el.name) {
      const root = el.getRootNode() instanceof ShadowRoot ? el.getRootNode() : document;
      const group = root.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`);
      current = Array.from(group).find(r => r.checked)?.value || '';
    } else {
      current = el.tagName === 'SELECT' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
        ? el.value : el.textContent;
    }
    if (current !== original) undoStack.push({ el, original });
  }

  // Scroll once to the first filled field
  if (firstFilledEl) {
    firstFilledEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Cross-origin iframe warning
  const iframeWarning = (window.__fillrCrossOriginFrames || 0) > 0
    ? `${window.__fillrCrossOriginFrames} field(s) in embedded frames were skipped.`
    : null;

  // Send analytics to background
  chrome.runtime.sendMessage({
    action: 'saveFillAnalytics',
    data: {
      hostname,
      totalFields: fields.length + unmatched.length,
      filledFields: filledCount,
      passBreakdown: {},
      apiCallsMade: apiKey ? 1 : 0,
      durationMs: 0
    }
  }).catch(() => {});

  const confidence = computeConfidence(filledCount, fields.length, p1p2Count, p3Count, p4Count, p5Count, errorCount > 0);
  return { filled: filledCount, apiError, hasUndo: undoStack.length > 0, iframeWarning, confidence, passBreakdown: { p1p2: p1p2Count, p3: p3Count, p4: p4Count, p5: p5Count }, conflictSummary };
  } finally {
    isFilling = false;
  }
}

// ── Fill confidence score ──────────────────────────────────────────────────
function computeConfidence(filledCount, totalFields, p1p2Count, p3Count, p4Count, p5Count, hasErrors) {
  if (totalFields === 0) return 0;
  const filled = filledCount;
  if (filled === 0) return 0;
  const passScore = p1p2Count * 100 + p3Count * 75 + p4Count * 60 + p5Count * 80;
  const passTotal = p1p2Count + p3Count + p4Count + p5Count;
  const avgPassScore = passTotal > 0 ? passScore / passTotal : 75;
  const score = Math.round((filled / totalFields) * avgPassScore * (hasErrors ? 0.8 : 1));
  return Math.min(100, Math.max(0, score));
}

// ── Conflict resolution for duplicate profile matches ─────────────────────
async function resolveConfirmFields(filledEntries) {
  // Group by profile key
  const byKey = {};
  for (const { el, profileKey } of filledEntries) {
    if (!byKey[profileKey]) byKey[profileKey] = [];
    byKey[profileKey].push(el);
  }

  const summary = [];
  for (const [key, els] of Object.entries(byKey)) {
    if (els.length < 2) continue;
    for (let i = 0; i < els.length - 1; i++) {
      const r1 = els[i].getBoundingClientRect();
      const r2 = els[i + 1].getBoundingClientRect();
      if (Math.abs(r2.top - r1.top) > 200) continue;
      const label2 = getLabelText(els[i + 1]).toLowerCase();
      const isConfirm = /confirm|verify|repeat|re.?enter/.test(label2);
      if (isConfirm && els[i].value) {
        await fillField(els[i + 1], els[i].value);
        summary.push(`${key}: confirm field matched`);
      }
    }
  }
  return summary;
}

// ── Preview fill ───────────────────────────────────────────────────────────
async function previewFill() {
  const storageData = await new Promise(resolve =>
    chrome.storage.local.get(['profiles', 'activeProfile', 'blockedSites', 'siteAssignments', 'fieldOverrides', 'fillAll'], resolve)
  );
  const hostname = location.hostname.toLowerCase();
  let profileData;
  const profiles = storageData.profiles;
  if (profiles && profiles.length > 0) {
    const siteAssignments = storageData.siteAssignments || {};
    let activeIdx = Math.min(storageData.activeProfile || 0, profiles.length - 1);
    if (siteAssignments[hostname] !== undefined) activeIdx = Math.min(siteAssignments[hostname], profiles.length - 1);
    profileData = profiles[activeIdx];
  } else { profileData = storageData; }
  const profile = getProfile(profileData || {});
  const fieldOverrides = storageData.fieldOverrides || {};
  const fillAll = !!storageData.fillAll;

  const fields = collectFields(fillAll);
  const results = [];

  for (const el of fields) {
    const profileKey = exactMatch(el) || fuzzyMatch(el);
    const label = getLabelText(el) || el.placeholder || el.name || el.id || 'Field';
    if (profileKey) {
      const overrideKey = `${hostname}::${profileKey}`;
      const overrideVal = fieldOverrides[overrideKey];
      const val = overrideVal !== undefined ? overrideVal : profileValue(profile, profileKey);
      el.classList.add('autofill-preview');
      setTimeout(() => el.classList.remove('autofill-preview'), 5000);
      results.push({ label, value: val || '(empty in profile)', pass: overrideVal !== undefined ? 'Override' : 'P1/P2' });
    } else {
      el.classList.add('autofill-preview-ai');
      setTimeout(() => el.classList.remove('autofill-preview-ai'), 5000);
      results.push({ label, value: null, pass: 'AI required' });
    }
  }

  return {
    preview: results,
    matchedCount: results.filter(r => r.value !== null).length,
    unmatchedCount: results.filter(r => r.value === null).length
  };
}

// ── Quick signup helpers ──────────────────────────────────────────────────────
function isVisibleEl(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && !el.disabled;
}

function findSubmitButton() {
  const explicit = Array.from(
    document.querySelectorAll('button[type=submit]:not(:disabled), input[type=submit]:not(:disabled)')
  ).find(isVisibleEl);
  if (explicit) return explicit;

  const keywords = /\b(register|sign\s*up|rsvp|submit|join|attend|confirm|continue|next)\b/i;
  return Array.from(document.querySelectorAll('button:not(:disabled), [role=button]'))
    .find(b => isVisibleEl(b) && keywords.test(b.textContent.trim())) || null;
}

function hasCaptcha() {
  return !!(
    document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"]') ||
    document.querySelector('.cf-turnstile') ||
    document.querySelector('[data-sitekey]')
  );
}

function detectSignupSuccess() {
  const text = document.body.innerText;
  return /you.?re (registered|going|in|all set)|registration confirmed|rsvp confirmed|see you there|you.?re registered/i.test(text);
}

// Fields about teammates / referrals / collaborators — leave blank rather than filling N/A
const NA_SKIP_PATTERNS = /team(?:mate)?|collaborat|partner|co.?founder|member|colleague|referr|invited?\s*by|who\s*told|recruit|sponsor|recomm/i;

// Fields that look like open-ended essay/question prompts — need AI to generate a real answer
const ESSAY_FIELD_PATTERNS = /what\s+(have|did|are|will|would|do)\s+you|what.*(built|made|created|working\s*on|project|ship|launch)|plan\s*to\s*(build|make|create|do|work)|tell\s*us\s*(about|why|what|how)|why\s+(do|are|want|would|should|you)|describe\s+(your|yourself|a|the|how|what)|how\s+(did|do|have|would)|background|experience.*goal|motivation|vision|pitch|idea|project\s*desc|goals\s+for|looking\s+to|apply\s+because|passionate\s+about|interest\s+in|why.*apply|about\s+yourself/i;

// Call the AI to generate a compelling answer for an open-ended question field
async function generateEssayAnswer(label, el) {
  const options = el.tagName === 'SELECT'
    ? Array.from(el.options).map(o => o.text.trim()).filter(t => t)
    : [];
  const pageContext = {
    title: document.title,
    url: location.href,
    headings: Array.from(document.querySelectorAll('h1,h2')).slice(0, 3).map(h => h.textContent.trim())
  };
  return new Promise(resolve => {
    chrome.runtime.sendMessage(
      { action: 'generateEssayAnswer', label, options, pageContext },
      resp => resolve(resp?.answer || null)
    );
  });
}

// Fill any still-empty required fields before attempting submit.
// Essay/question fields → AI generates a real answer.
// Simple missing fields → "N/A".
// Team/referral/collab fields → left blank for manual completion.
async function fillEmptyRequiredWithNA() {
  const required = Array.from(document.querySelectorAll(
    'input[required], select[required], textarea[required], [aria-required="true"]'
  )).filter(el => {
    if (el.disabled || el.type === 'hidden' || el.type === 'checkbox' || el.type === 'radio') return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return !el.value || !el.value.trim();
  });

  let naFilled = 0;
  for (const el of required) {
    const label = getLabelText(el) || el.placeholder || el.name || '';
    if (NA_SKIP_PATTERNS.test(label)) continue; // leave blank for manual completion

    // Essay/question fields — ask the AI for a real, compelling answer
    const isEssay = el.tagName === 'TEXTAREA' || ESSAY_FIELD_PATTERNS.test(label);
    if (isEssay) {
      const aiAnswer = await generateEssayAnswer(label, el);
      if (aiAnswer) {
        await fillField(el, aiAnswer);
        naFilled++;
        continue;
      }
      // If AI call fails, fall through to N/A for SELECT, skip textarea
      if (el.tagName === 'TEXTAREA') continue;
    }

    if (el.tagName === 'SELECT') {
      const naOption = Array.from(el.options).find(o =>
        /^(n\/?a|none|not applicable|prefer not|skip|other)$/i.test(o.text.trim())
      );
      if (naOption) {
        el.value = naOption.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        naFilled++;
      }
      continue; // skip SELECT if no suitable option — don't pick a wrong value
    }

    await fillField(el, 'N/A');
    naFilled++;
  }
  return naFilled;
}

// Returns labels of required fields that are still empty/unchecked after filling
function getUnfilledRequiredFields() {
  const required = Array.from(document.querySelectorAll(
    'input[required], select[required], textarea[required], [aria-required="true"]'
  ));
  const unfilled = required.filter(el => {
    if (el.disabled || el.type === 'hidden') return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (el.type === 'checkbox') return !el.checked;
    return !el.value || !el.value.trim();
  });
  const labels = unfilled.map(el =>
    getLabelText(el) || el.placeholder || el.name || el.id || 'unnamed field'
  );
  return [...new Set(labels)];
}

// True if the page still has a visible form after a submit attempt.
// The most reliable signal that submission was rejected — works regardless
// of whether the form uses native HTML5 validation, ARIA, or custom JS validation.
function isFormStillVisible() {
  const forms = Array.from(document.querySelectorAll('form, [role="form"]'));
  return forms.some(f => {
    const s = window.getComputedStyle(f);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    // Must contain at least one visible input — rules out hidden honeypot forms
    return !!f.querySelector('input:not([type=hidden]), textarea, select');
  });
}

// After confirming the form is still visible, collect specific field-level error info
// so the popup can show a useful message. Best-effort — falls back gracefully.
function collectFieldErrors() {
  const fields = [];

  // 1. HTML5 native :invalid (works when form does NOT have noValidate)
  Array.from(document.querySelectorAll(':invalid')).forEach(el => {
    if (el.tagName === 'FORM' || el.tagName === 'FIELDSET' || el.disabled || el.type === 'hidden') return;
    const s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return;
    const label = getLabelText(el) || el.placeholder || el.name || el.id || 'a field';
    const msg = el.validationMessage;
    fields.push(msg && msg.length < 80 ? `${label} (${msg})` : label);
  });

  // 2. ARIA invalid — React Hook Form, Formik, etc.
  Array.from(document.querySelectorAll('[aria-invalid="true"]')).forEach(el => {
    const s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return;
    fields.push(getLabelText(el) || el.placeholder || el.name || el.id || 'a field');
  });

  // 3. Required fields that are still empty
  fields.push(...getUnfilledRequiredFields());

  return [...new Set(fields)];
}

// Wait for new (previously unseen) fields to appear
function waitForNewFields(timeout) {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, timeout);
    document.querySelectorAll('input, textarea, select, [contenteditable]').forEach(el => el.dataset.fillrSeen = '1');

    const FIELD_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
    const callback = debounce((mutations) => {
      const hasNew = mutations.some(m =>
        Array.from(m.addedNodes).some(n => {
          if (n.nodeType !== 1) return false;
          if (FIELD_TAGS.has(n.tagName) && !n.dataset.fillrSeen) return true;
          if (n.querySelector) {
            const found = n.querySelector('input:not([data-fillr-seen]), textarea:not([data-fillr-seen]), select:not([data-fillr-seen])');
            return !!found;
          }
          return false;
        })
      );
      if (hasNew) { clearTimeout(timer); obs.disconnect(); resolve(); }
    }, 400);

    const obs = new MutationObserver(callback);
    const watchTarget = document.querySelector('main, [role="main"], form, #content, #app, #root') || document.body;
    obs.observe(watchTarget, { childList: true, subtree: true });
  });
}

// Multi-step fill+submit loop with MutationObserver support
async function fillAndSubmit() {
  if (isFilling) return { error: 'Already filling' };
  if (hasCaptcha()) return { captcha: true };

  const MAX_STEPS = 8;
  const STEP_TIMEOUT_MS = 5000;
  let totalFilled = 0;
  let submitted = false;
  let stepCount = 0;

  while (stepCount < MAX_STEPS) {
    if (detectSignupSuccess()) { submitted = true; break; }

    chrome.runtime.sendMessage({ action: 'signupProgress', stage: 'filling', step: stepCount + 1 }).catch(() => {});

    const result = await autofill({ skipFilled: stepCount > 0 });
    totalFilled += result.filled;

    // No progress on a subsequent step — nothing more to fill
    if (result.filled === 0 && stepCount > 0) break;

    // Give React / framework time to process events before we inspect fields
    await new Promise(r => setTimeout(r, 600));

    // Fill any still-empty required fields with N/A (skip team/referral questions)
    await fillEmptyRequiredWithNA();
    await new Promise(r => setTimeout(r, 300));

    // Pre-submit check: required fields still empty after N/A pass
    const unfilledRequired = getUnfilledRequiredFields();
    if (unfilledRequired.length > 0) {
      return { requiredUnfilled: unfilledRequired, filled: totalFilled };
    }

    const btn = findSubmitButton();
    if (!btn) break;

    const urlBefore = location.href;
    btn.click();
    submitted = true;
    stepCount++;

    // Wait for either new fields (multi-step wizard) or page transition
    await waitForNewFields(STEP_TIMEOUT_MS);

    // ── Success: page navigated or success text appeared ──────────────────
    if (location.href !== urlBefore || detectSignupSuccess()) {
      return { submitted: true, confirmed: true, filled: totalFilled };
    }

    // Page didn't advance — give the DOM a moment to render error/loading states
    await new Promise(r => setTimeout(r, 500));

    // Check again after settling (covers slow SPAs that redirect after a short delay)
    if (location.href !== urlBefore || detectSignupSuccess()) {
      return { submitted: true, confirmed: true, filled: totalFilled };
    }

    // ── Primary failure check: is the form still on screen? ───────────────
    // If yes, the submission was rejected — regardless of validation mechanism.
    // This works even when the form uses noValidate + custom JS error classes.
    if (isFormStillVisible()) {
      const errorFields = collectFieldErrors();
      const fields = errorFields.length > 0
        ? errorFields
        : ['Submission failed — check the form for highlighted errors'];
      return { requiredUnfilled: fields, filled: totalFilled };
    }

    // Form is gone but no success text — likely email-verification flow
    // (form submitted, confirmation will come via email)
    break;
  }

  return { submitted, confirmed: detectSignupSuccess(), filled: totalFilled };
}

// ── In-page toast (item 17) ───────────────────────────────────────────────────
function showPageToast(msg) {
  let el = document.getElementById('__fillr-page-toast__');
  if (!el) {
    el = document.createElement('div');
    el.id = '__fillr-page-toast__';
    Object.assign(el.style, {
      position: 'fixed', bottom: '20px', right: '20px', zIndex: '2147483646',
      background: '#161616', color: '#C9A96E', border: '1px solid #C9A96E',
      borderRadius: '8px', padding: '8px 16px', fontFamily: 'system-ui, sans-serif',
      fontSize: '13px', fontWeight: '500', transition: 'opacity 0.3s', opacity: '0'
    });
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el.__timer);
  el.__timer = setTimeout(() => { el.style.opacity = '0'; }, 3000);
}

// ── Floating button ───────────────────────────────────────────────────────────
function hasFormElements() {
  return document.querySelectorAll('input:not([type=hidden]), textarea, select').length > 0;
}

function createFloatingButton() {
  if (document.getElementById('__autofill-float-btn__')) return;
  if (!hasFormElements()) return;

  chrome.storage.local.get('blockedSites', ({ blockedSites = [] }) => {
    const hostname = location.hostname.toLowerCase();
    if (blockedSites.map(s => s.toLowerCase()).some(d => hostname === d || hostname.endsWith('.' + d))) return;

    const btn = document.createElement('button');
    btn.id = '__autofill-float-btn__';
    btn.innerHTML = 'Autofill';
    btn.title = 'Autofill this page';

    btn.addEventListener('click', async () => {
      if (btn.dataset.filling) return;
      btn.dataset.filling = '1';
      btn.disabled = true;
      btn.textContent = 'Filling...';
      try {
        const result = await autofill();
        const count = result.filled;
        if (count > 0) {
          btn.innerHTML = `${count} filled`;
          chrome.runtime.sendMessage({ action: 'setBadge', count }).catch(() => {});
          setTimeout(() => { if (btn) btn.innerHTML = 'Autofill'; }, 2000);
        } else {
          btn.innerHTML = 'Autofill';
        }
      } catch {
        btn.innerHTML = 'Autofill';
      } finally {
        delete btn.dataset.filling;
        btn.disabled = false;
      }
    });
    document.body.appendChild(btn);
  });
}

function removeFloatingButton() {
  const btn = document.getElementById('__autofill-float-btn__');
  if (btn) btn.remove();
}

chrome.storage.local.get('floatingBtn', ({ floatingBtn }) => {
  if (floatingBtn) createFloatingButton();
});

// MutationObserver: re-show/hide floating button on SPA navigation (item 15)
// Narrowed scope: top-level only for body, plus specific form containers
let _spaDebounce = null;
const spaObserver = new MutationObserver(() => {
  clearTimeout(_spaDebounce);
  _spaDebounce = setTimeout(() => {
    _fieldsCacheValid = false; // invalidate fields cache on navigation
    const hasForm = !!document.querySelector('input:not([type=hidden]),select,textarea');
    const btn = document.getElementById('__autofill-float-btn__');
    chrome.storage.local.get('floatingBtn', ({ floatingBtn }) => {
      if (!floatingBtn) return;
      if (hasForm && !btn) createFloatingButton();
      else if (!hasForm && btn) btn.remove();
    });
  }, 500); // Increased from 300ms to 500ms
});

// Observe body top-level only, then targeted containers
spaObserver.observe(document.body, { childList: true, subtree: false });
['main', '[role="main"]', 'form'].forEach(sel => {
  const el = document.querySelector(sel);
  if (el) spaObserver.observe(el, { childList: true, subtree: true });
});

// Disconnect observers on page unload to prevent memory leak
window.addEventListener('beforeunload', () => {
  spaObserver.disconnect();
  labelCacheObserver.disconnect();
  clearTimeout(_spaDebounce);
});

// ── Record mode support ────────────────────────────────────────────────────
let _recordMode = false;

function startRecordMode() {
  _recordMode = true;
  document.addEventListener('submit', _captureSubmit, true);
}

function stopRecordMode() {
  _recordMode = false;
  document.removeEventListener('submit', _captureSubmit, true);
}

function _captureSubmit(e) {
  if (!_recordMode) return;
  const form = e.target;
  if (!form || form.tagName !== 'FORM') return;
  const recording = {};
  form.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]), textarea, select').forEach(el => {
    const label = getLabelText(el) || el.name || el.id || '';
    if (label && el.value) recording[label] = el.value;
  });
  if (Object.keys(recording).length === 0) return;
  chrome.runtime.sendMessage({ action: 'saveFormRecording', hostname: location.hostname, recording }).catch(() => {});
}

async function replayRecording() {
  const { formRecordings = {} } = await new Promise(resolve => chrome.storage.local.get('formRecordings', resolve));
  const recording = formRecordings[location.hostname];
  if (!recording) return { filled: 0 };
  const fields = collectFields();
  let filled = 0;
  for (const el of fields) {
    const label = getLabelText(el) || el.name || el.id || '';
    const val = recording[label];
    if (val && await fillField(el, val)) filled++;
  }
  return { filled };
}

// ── Message listener ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'fill') {
    autofill({ skipFilled: !!message.skipFilled, passesStart: message.passesStart }).then(result => {
      if (result.filled > 0) {
        chrome.runtime.sendMessage({ action: 'setBadge', count: result.filled }).catch(() => {});
      }
      sendResponse(result);
    }).catch(() => sendResponse({ filled: 0 }));
    return true;
  }

  if (message.action === 'undoFill') {
    let restored = 0;
    const promises = undoStack.map(({ el, original }) =>
      fillField(el, original).then(r => { if (r) restored++; })
    );
    Promise.all(promises).then(() => {
      undoStack = [];
      sendResponse({ restored });
    });
    return true;
  }

  if (message.action === 'toggleFloatingBtn') {
    if (message.enabled) createFloatingButton();
    else removeFloatingButton();
    sendResponse({ ok: true });
  }

  if (message.action === 'ping') {
    sendResponse({ ok: true });
  }

  if (message.action === 'fillAndSubmit') {
    fillAndSubmit().then(sendResponse).catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // In-page toast from keyboard shortcut handler
  if (message.action === 'showPageToast') {
    showPageToast(message.msg);
  }

  if (message.action === 'preview') {
    previewFill().then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (message.action === 'setRecordMode') {
    if (message.enabled) startRecordMode(); else stopRecordMode();
    sendResponse({ ok: true });
    return;
  }

  if (message.action === 'replayRecording') {
    replayRecording().then(sendResponse).catch(() => sendResponse({ filled: 0 }));
    return true;
  }
});
