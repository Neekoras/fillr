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
  'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]):not([type=file]):not([type=checkbox]):not([type=radio])',
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

// ── Label text cache (prevents calling getLabelText 3x per field) ─────────────
const labelCache = new WeakMap();

// ── Collect visible, fillable fields ─────────────────────────────────────────
function collectFields() {
  const main = Array.from(document.querySelectorAll(FIELD_SELECTOR));

  // Basic one-level shadow DOM support
  const shadow = [];
  document.querySelectorAll('*').forEach(el => {
    if (el.shadowRoot) {
      Array.from(el.shadowRoot.querySelectorAll(FIELD_SELECTOR)).forEach(f => shadow.push(f));
    }
  });

  return [...main, ...shadow].filter(el => {
    if (el.disabled || el.readOnly) return false;
    const currentVal = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
      ? el.value
      : el.textContent;
    if (stripInvisible(currentVal) !== '') return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    return true;
  });
}

// ── Get a label text for a field ─────────────────────────────────────────────
const INPUT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']);

function getLabelText(el) {
  if (labelCache.has(el)) return labelCache.get(el);

  let result = '';

  // 1. Explicit <label for="id">
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) { result = label.textContent.trim(); }
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

  labelCache.set(el, result);
  return result;
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

// ── Fill a single field ───────────────────────────────────────────────────────
function fillField(el, value) {
  if (value === null || value === undefined) return false;

  const strVal = String(value);
  const isContentEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '';

  if (isContentEditable) {
    el.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, strVal);
    if (stripInvisible(el.textContent) !== strVal) el.textContent = strVal;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (el.type === 'date' && strVal) {
    const d = new Date(strVal);
    if (!isNaN(d)) el.value = d.toISOString().split('T')[0];
    else el.value = strVal;
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
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
    label: getLabelText(el), // reads from cache
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
function applyClaudeValue(el, claudeValue, profile) {
  if (!claudeValue) return false;
  if (el.tagName === 'SELECT') {
    if (fillField(el, claudeValue)) return true;
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
async function autofill() {
  if (isFilling) return { filled: 0 };
  isFilling = true;
  try {
  const storageData = await new Promise(resolve =>
    chrome.storage.local.get(['profiles', 'activeProfile', 'apiKey', 'blockedSites'], resolve)
  );

  const blockedSites = (storageData.blockedSites || []).map(s => s.toLowerCase());
  const hostname = location.hostname.toLowerCase();
  if (blockedSites.some(d => hostname === d || hostname.endsWith('.' + d))) {
    return { filled: 0, blocked: true };
  }

  let profileData;
  const profiles = storageData.profiles;
  if (profiles && profiles.length > 0) {
    const activeIdx = Math.min(storageData.activeProfile || 0, profiles.length - 1);
    profileData = profiles[activeIdx];
  } else {
    profileData = storageData;
  }

  const profile = getProfile(profileData || {});
  const apiKey = storageData.apiKey || '';
  let apiError = null;

  const fields = collectFields();
  let filledCount = 0;
  let firstFilledEl = null;
  const unmatched = [];

  // Snapshot original values for undo (before any fills)
  const originalValues = new Map();
  for (const el of fields) {
    originalValues.set(el, el.tagName === 'SELECT' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
      ? el.value : el.textContent);
  }

  // Pre-populate label cache for all fields in one pass
  fields.forEach(el => getLabelText(el));

  for (const el of fields) {
    const profileKey = exactMatch(el) || fuzzyMatch(el);
    if (profileKey) {
      const val = profileValue(profile, profileKey);
      if (val && fillField(el, val)) {
        if (!firstFilledEl) firstFilledEl = el;
        filledCount++;
      }
    } else {
      unmatched.push(el);
    }
  }

  if (unmatched.length > 0) {
    unmatched.forEach((el, i) => {
      if (!el.id && !el.name) el.dataset.__fillrIdx = String(i);
    });

    let stillUnmatched = [...unmatched];

    // Build once, reuse in both Pass 3 and Pass 4
    const profileWithFullName = {
      ...profile,
      fullName: [profile.firstName, profile.lastName].filter(Boolean).join(' ')
    };

    if (apiKey) {
      try {
        // Notify popup that Pass 3 is starting
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
            if (claudeVal && applyClaudeValue(el, claudeVal, profile)) {
              if (!firstFilledEl) firstFilledEl = el;
              filledCount++;
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
        // Notify popup that Pass 4 is starting
        chrome.runtime.sendMessage({ action: 'fillProgress', stage: 'ai-vision' }).catch(() => {});

        const descriptors = stillUnmatched.map(fieldDescriptor).slice(0, 20);
        const visionResponse = await chrome.runtime.sendMessage({
          action: 'claudeVisionFill',
          fields: descriptors,
          profile: profileWithFullName,
          pageContext: getPageContext(),
        });
        if (visionResponse && visionResponse.mapping) {
          for (const el of stillUnmatched) {
            const key = el.id || el.name || el.dataset.__fillrIdx || '';
            const claudeVal = visionResponse.mapping[key];
            if (claudeVal && applyClaudeValue(el, claudeVal, profile)) {
              if (!firstFilledEl) firstFilledEl = el;
              filledCount++;
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

  // Build undo stack — only fields whose value actually changed
  undoStack = [];
  for (const [el, original] of originalValues) {
    const current = el.tagName === 'SELECT' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
      ? el.value : el.textContent;
    if (current !== original) undoStack.push({ el, original });
  }

  // Scroll once to the first filled field (not per-field — prevents jarring multi-scroll)
  if (firstFilledEl) {
    firstFilledEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  return { filled: filledCount, apiError, hasUndo: undoStack.length > 0 };
  } finally {
    isFilling = false;
  }
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
      } catch (e) {
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

// Disconnect observer on page unload to prevent memory leak
window.addEventListener('beforeunload', () => {
  spaObserver.disconnect();
  clearTimeout(_spaDebounce);
});

// ── Message listener ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'fill') {
    autofill().then(result => {
      if (result.filled > 0) {
        chrome.runtime.sendMessage({ action: 'setBadge', count: result.filled }).catch(() => {});
      }
      sendResponse(result);
    }).catch(() => sendResponse({ filled: 0 }));
    return true;
  }

  if (message.action === 'undoFill') {
    let restored = 0;
    for (const { el, original } of undoStack) {
      if (fillField(el, original)) restored++;
    }
    undoStack = [];
    sendResponse({ restored });
    return true;
  }

  if (message.action === 'toggleFloatingBtn') {
    if (message.enabled) createFloatingButton();
    else removeFloatingButton();
    sendResponse({ ok: true });
  }
});
