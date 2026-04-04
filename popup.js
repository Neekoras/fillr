'use strict';

// Open port to background so it can detect popup lifecycle (Replicate polling cancellation)
const _fillrPort = chrome.runtime.connect({ name: 'fillr-fill' });

const PROFILE_KEYS = [
  'firstName', 'lastName',
  'email', 'phone',
  'address1', 'address2', 'city', 'state', 'zip', 'country',
  'linkedin', 'github', 'website', 'twitter', 'instagram', 'bio',
  'yearsExp', 'jobTitle', 'company', 'context'
];

// Core keys used for completeness indicator (item 20)
const CORE_PROFILE_KEYS = [
  'firstName', 'lastName', 'email', 'phone',
  'address1', 'city', 'state', 'zip', 'country',
  'jobTitle', 'company', 'yearsExp',
  'linkedin', 'github', 'website', 'twitter', 'instagram'
];

// ── Multi-profile state ───────────────────────────────────────────────────────
let profiles = [];
let activeProfile = 0;

// ── Site assignments state ────────────────────────────────────────────────────
let siteAssignments = {};

// ── Current tab hostname ──────────────────────────────────────────────────────
let currentHostname = '';

function emptyProfile(name) {
  const p = { name };
  PROFILE_KEYS.forEach(k => { p[k] = ''; });
  return p;
}

function loadProfileIntoForm(profile) {
  PROFILE_KEYS.forEach(key => {
    const el = document.getElementById(key);
    if (el) el.value = profile[key] || '';
  });
  updateCompleteness();
}

function readFormIntoProfile() {
  PROFILE_KEYS.forEach(key => {
    const el = document.getElementById(key);
    if (el) profiles[activeProfile][key] = el.value.trim();
  });
}

function populateProfileSelect() {
  const sel = document.getElementById('profileSelect');
  sel.innerHTML = '';
  profiles.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = p.name || `Profile ${i + 1}`;
    sel.appendChild(opt);
  });
  sel.value = activeProfile;
}

function saveProfiles(callback) {
  chrome.storage.local.set({ profiles, activeProfile }, callback);
}

// ── Completeness indicator (item 20) ─────────────────────────────────────────
function updateCompleteness() {
  const profile = profiles[activeProfile] || {};
  const filled = CORE_PROFILE_KEYS.filter(k => profile[k] && String(profile[k]).trim()).length;
  const total = CORE_PROFILE_KEYS.length;
  const pct = filled / total;
  const el = document.getElementById('completenessIndicator');
  if (!el) return;
  el.textContent = `${filled} / ${total}`;
  el.style.color = pct >= 0.8 ? '#C9A96E' : pct >= 0.5 ? '#888' : '#4A4A4A';
  el.title = pct >= 1 ? 'Profile complete' : 'Click to go to first empty field';
}

// Click completeness indicator → scroll to first empty core field
document.getElementById('completenessIndicator')?.addEventListener('click', () => {
  const profile = profiles[activeProfile] || {};
  const emptyKey = CORE_PROFILE_KEYS.find(k => !profile[k] || !String(profile[k]).trim());
  if (emptyKey) {
    const el = document.getElementById(emptyKey);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); }
  }
});

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
    });
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`tab-${target}`).classList.add('active');
    if (target === 'settings') renderFillStats();
  });
});

// ── Toast queue (item 28) ─────────────────────────────────────────────────────
const toastQueue = [];
let toastActive = false;

function showToast(msg, isError = false) {
  toastQueue.push({ msg, isError });
  if (!toastActive) processToastQueue();
}

function processToastQueue() {
  if (!toastQueue.length) { toastActive = false; return; }
  // Collapse many pending notifications
  if (toastQueue.length >= 3) {
    const count = toastQueue.length;
    toastQueue.length = 0;
    toastQueue.push({ msg: `${count} notifications`, isError: false });
  }
  toastActive = true;
  const { msg, isError } = toastQueue.shift();
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (isError ? ' error' : '');
  void el.offsetWidth; // reflow
  el.classList.add('show');
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => processToastQueue(), 300);
  }, isError ? 4000 : 2800);
}

function showToastWithUndo(msg, onUndo) {
  // Flush queue and show immediately
  toastQueue.length = 0;
  toastActive = true;
  const toast = document.getElementById('toast');
  toast.innerHTML = '';
  const text = document.createTextNode(msg + ' ');
  const undoBtn = document.createElement('button');
  undoBtn.className = 'toast-undo-btn';
  undoBtn.textContent = 'Undo';
  undoBtn.addEventListener('click', () => {
    toast.classList.remove('show');
    toastActive = false;
    onUndo();
  });
  toast.appendChild(text);
  toast.appendChild(undoBtn);
  toast.className = 'toast';
  void toast.offsetWidth;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => { toastActive = false; processToastQueue(); }, 300);
  }, 4500);
}

// ── Save indicator ────────────────────────────────────────────────────────────
let saveIndicatorTimer = null;

function showSaveIndicator(state) {
  const ind = document.getElementById('saveIndicator');
  if (!ind) return;
  clearTimeout(saveIndicatorTimer);
  ind.className = 'save-indicator ' + state;
  if (state === 'saved') {
    saveIndicatorTimer = setTimeout(() => { ind.className = 'save-indicator'; }, 1500);
  }
}

// ── Test button state manager (item 30) ──────────────────────────────────────
function setTestBtnState(btn, state) {
  btn.className = btn.className.replace(/\bbtn-(testing|valid|invalid)\b/g, '').trim();
  if (state === 'testing') {
    btn.disabled = true;
    btn.textContent = 'Testing…';
    btn.classList.add('btn-testing');
  } else if (state === 'valid') {
    btn.disabled = false;
    btn.textContent = '✓ Valid';
    btn.classList.add('btn-valid');
    setTimeout(() => setTestBtnState(btn, 'idle'), 3000);
  } else if (state === 'invalid') {
    btn.disabled = false;
    btn.textContent = '✗ Invalid key';
    btn.classList.add('btn-invalid');
    setTimeout(() => setTestBtnState(btn, 'idle'), 3000);
  } else {
    btn.disabled = false;
    btn.textContent = 'Test';
  }
}

// ── Fill stats rendering (item 19) ───────────────────────────────────────────
function renderFillStats() {
  chrome.storage.local.get('fillAnalytics', ({ fillAnalytics = [] }) => {
    const el = document.getElementById('statsContent');
    if (!el) return;
    if (!fillAnalytics.length) {
      el.innerHTML = '<p class="hint">No fills recorded yet.</p>';
      return;
    }

    const totalFills = fillAnalytics.length;
    const avgFields = Math.round(fillAnalytics.reduce((s, e) => s + (e.filledFields || 0), 0) / totalFills);

    // Top 5 domains
    const domainCounts = {};
    fillAnalytics.forEach(e => { if (e.hostname) domainCounts[e.hostname] = (domainCounts[e.hostname] || 0) + 1; });
    const topDomains = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxCount = topDomains[0]?.[1] || 1;

    el.innerHTML = `
      <p class="hint" style="margin-bottom:8px">Total fills: <strong style="color:var(--text-primary)">${totalFills}</strong> · Avg fields: <strong style="color:var(--text-primary)">${avgFields}</strong></p>
      ${topDomains.length ? `
        <div class="stat-bar-wrap">
          ${topDomains.map(([domain, count]) => `
            <div class="stat-bar-row">
              <span style="min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${domain}</span>
              <div class="stat-bar"><div class="stat-bar-fill" style="width:${Math.round((count/maxCount)*100)}%"></div></div>
              <span style="min-width:20px;text-align:right">${count}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
    `;
  });
}

// ── Load stored values on popup open ─────────────────────────────────────────
chrome.storage.local.get(['profiles', 'activeProfile', 'apiKey', 'replicateApiKey', 'aiProvider', 'floatingBtn', 'blockedSites', 'onboardingSeen', 'siteAssignments', 'signupHistory', 'fieldOverrides'], data => {
  if (data.profiles && data.profiles.length > 0) {
    profiles = data.profiles;
    activeProfile = Math.min(data.activeProfile || 0, profiles.length - 1);
  } else {
    const p = emptyProfile('Default');
    PROFILE_KEYS.forEach(k => { p[k] = data[k] || ''; });
    profiles = [p];
    activeProfile = 0;
  }

  siteAssignments = data.siteAssignments || {};
  signupHistory = data.signupHistory || [];

  populateProfileSelect();
  loadProfileIntoForm(profiles[activeProfile]);

  if (data.apiKey) document.getElementById('apiKey').value = data.apiKey;
  if (data.replicateApiKey) document.getElementById('replicateApiKey').value = data.replicateApiKey;
  const provider = data.aiProvider || 'anthropic';
  document.getElementById('aiProvider').value = provider;
  updateProviderUI(provider);
  document.getElementById('floatingBtn').checked = !!data.floatingBtn;
  if (data.blockedSites) document.getElementById('blockedSites').value = data.blockedSites.join('\n');

  populateSiteAssignSelect();
  renderSiteAssignList();
  renderSignupHistory(signupHistory);
  setupOverrideBadges(data.fieldOverrides || {});

  // Load current site info
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]) return;
    try {
      const url = new URL(tabs[0].url);
      currentHostname = url.hostname;
      document.getElementById('siteAssignDomain').textContent = currentHostname;
      const sel = document.getElementById('siteAssignProfile');
      const assigned = siteAssignments[currentHostname];
      sel.value = assigned !== undefined ? String(assigned) : '';

      // Auto-detect signup URL (item 27)
      const urlInput = document.getElementById('signupUrl');
      const hintEl = document.getElementById('signupUrlHint');
      const urlPatterns = /lu\.ma|eventbrite\.com|partiful\.com|rsvp\.|forms\.|airtable\.com|tally\.so|typeform\.com/i;
      const pathPatterns = /\/(register|signup|rsvp|apply)(\/|$|\?)/i;
      const autoDetected = urlPatterns.test(url.hostname) || pathPatterns.test(url.pathname);
      if (autoDetected) {
        urlInput.value = tabs[0].url;
        if (hintEl) hintEl.style.display = 'block';
      }
    } catch {}
  });

  // Onboarding banner
  if (!data.onboardingSeen) {
    const coreKeys = PROFILE_KEYS.filter(k => k !== 'context');
    const allEmpty = coreKeys.every(k => !profiles[activeProfile][k]);
    if (allEmpty) {
      const banner = document.getElementById('onboardingBanner');
      if (banner) banner.style.display = 'block';
    }
  }
});

// ── Per-field override badges (item 18) ──────────────────────────────────────
function setupOverrideBadges(fieldOverrides) {
  if (!currentHostname) return;
  document.querySelectorAll('#tab-details label[for]').forEach(label => {
    const forId = label.getAttribute('for');
    if (!forId) return;
    // Map field id to profile key
    const profileKey = forId; // field ids match profile keys
    const overrideKey = `${currentHostname}::${profileKey}`;
    const badge = label.querySelector('.override-badge');
    if (fieldOverrides[overrideKey] !== undefined) {
      if (!badge) {
        const b = document.createElement('span');
        b.className = 'override-badge';
        b.textContent = '⊕';
        b.title = `Override active for ${currentHostname}: "${fieldOverrides[overrideKey]}"`;
        label.appendChild(b);
      }
    } else if (badge) {
      badge.remove();
    }

    // Right-click to open override editor (item 18)
    label.addEventListener('contextmenu', e => {
      e.preventDefault();
      showOverrideEditor(forId, currentHostname, fieldOverrides);
    });
  });
}

function showOverrideEditor(fieldId, hostname, fieldOverrides) {
  // Remove any existing editor
  document.querySelectorAll('.override-row').forEach(r => r.remove());

  const fieldEl = document.getElementById(fieldId);
  if (!fieldEl) return;
  const overrideKey = `${hostname}::${fieldId}`;
  const currentOverride = fieldOverrides[overrideKey] || '';

  const row = document.createElement('div');
  row.className = 'override-row';
  row.innerHTML = `
    <span style="color:var(--text-muted);font-size:10px;white-space:nowrap">${hostname}</span>
    <input type="text" placeholder="Override value…" value="${currentOverride.replace(/"/g, '&quot;')}" />
    <button class="btn btn-sm btn-primary" title="Save override">Save</button>
    <button class="btn btn-sm btn-ghost" title="Remove override">✕</button>
  `;
  fieldEl.parentElement.insertBefore(row, fieldEl.nextSibling);

  const input = row.querySelector('input');
  const saveBtn = row.querySelectorAll('button')[0];
  const removeBtn = row.querySelectorAll('button')[1];

  saveBtn.addEventListener('click', () => {
    const val = input.value.trim();
    if (val) {
      fieldOverrides[overrideKey] = val;
    } else {
      delete fieldOverrides[overrideKey];
    }
    chrome.storage.local.set({ fieldOverrides }, () => {
      row.remove();
      setupOverrideBadges(fieldOverrides);
      showToast(`Override ${val ? 'saved' : 'removed'} for ${fieldId}`);
    });
  });

  removeBtn.addEventListener('click', () => {
    delete fieldOverrides[overrideKey];
    chrome.storage.local.set({ fieldOverrides }, () => {
      row.remove();
      setupOverrideBadges(fieldOverrides);
      showToast(`Override removed for ${fieldId}`);
    });
  });

  input.focus();
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveBtn.click();
    if (e.key === 'Escape') row.remove();
  });
}

// ── Onboarding banner dismiss ─────────────────────────────────────────────────
const dismissBtn = document.getElementById('dismissOnboarding');
if (dismissBtn) {
  dismissBtn.addEventListener('click', () => {
    const banner = document.getElementById('onboardingBanner');
    if (banner) banner.style.display = 'none';
    chrome.storage.local.set({ onboardingSeen: true });
  });
}

// ── Profile selector ──────────────────────────────────────────────────────────
document.getElementById('profileSelect').addEventListener('change', e => {
  readFormIntoProfile();
  activeProfile = parseInt(e.target.value, 10);
  loadProfileIntoForm(profiles[activeProfile]);
  saveProfiles();
});

// ── Inline profile name editing (item 29) ─────────────────────────────────────
let _profileEditMode = null; // 'new' | 'rename'

function showProfileNameInput(mode) {
  _profileEditMode = mode;
  const sel = document.getElementById('profileSelect');
  const input = document.getElementById('profileNameInput');
  const confirm = document.getElementById('confirmProfileName');
  const cancel = document.getElementById('cancelProfileName');
  const newBtn = document.getElementById('newProfile');
  const renameBtn = document.getElementById('renameProfile');
  const deleteBtn = document.getElementById('deleteProfile');

  sel.style.display = 'none';
  newBtn.style.display = 'none';
  renameBtn.style.display = 'none';
  deleteBtn.style.display = 'none';
  input.style.display = '';
  confirm.style.display = '';
  cancel.style.display = '';

  input.value = mode === 'rename' ? (profiles[activeProfile].name || '') : '';
  input.placeholder = mode === 'rename' ? 'New name…' : `Profile ${profiles.length + 1}`;
  input.focus();
  input.select();
}

function hideProfileNameInput() {
  // Restore original name without saving (item 29)
  _profileEditMode = null;
  document.getElementById('profileSelect').style.display = '';
  document.getElementById('profileNameInput').style.display = 'none';
  document.getElementById('confirmProfileName').style.display = 'none';
  document.getElementById('cancelProfileName').style.display = 'none';
  document.getElementById('newProfile').style.display = '';
  document.getElementById('renameProfile').style.display = '';
  document.getElementById('deleteProfile').style.display = '';
}

function commitProfileName() {
  if (!_profileEditMode) return;
  const name = document.getElementById('profileNameInput').value.trim();
  if (!name) { showToast('Name cannot be empty', true); return; }

  if (_profileEditMode === 'new') {
    if (profiles.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      showToast('A profile with that name already exists', true); return;
    }
    readFormIntoProfile();
    const newProf = emptyProfile(name);
    profiles.push(newProf);
    activeProfile = profiles.length - 1;
    hideProfileNameInput();
    populateProfileSelect();
    loadProfileIntoForm(profiles[activeProfile]);
    saveProfiles();
  } else {
    if (profiles.some((p, i) => i !== activeProfile && p.name.toLowerCase() === name.toLowerCase())) {
      showToast('A profile with that name already exists', true); return;
    }
    profiles[activeProfile].name = name;
    hideProfileNameInput();
    populateProfileSelect();
    saveProfiles(() => showToast('Profile renamed'));
  }
}

document.getElementById('newProfile').addEventListener('click', () => showProfileNameInput('new'));
document.getElementById('renameProfile').addEventListener('click', () => showProfileNameInput('rename'));
document.getElementById('confirmProfileName').addEventListener('click', commitProfileName);
document.getElementById('cancelProfileName').addEventListener('click', hideProfileNameInput);
document.getElementById('profileNameInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); commitProfileName(); }
  if (e.key === 'Escape') { e.preventDefault(); hideProfileNameInput(); }
});
// Blur commits only if edit mode is still active (item 29)
document.getElementById('profileNameInput').addEventListener('blur', () => {
  if (_profileEditMode) commitProfileName();
});

document.getElementById('deleteProfile').addEventListener('click', () => {
  if (profiles.length <= 1) {
    showToast('Cannot delete the last profile', true);
    return;
  }
  const profileName = profiles[activeProfile].name || `Profile ${activeProfile + 1}`;
  if (!confirm(`Delete "${profileName}"?`)) return;
  profiles.splice(activeProfile, 1);
  activeProfile = Math.max(0, activeProfile - 1);
  populateProfileSelect();
  loadProfileIntoForm(profiles[activeProfile]);
  saveProfiles(() => showToast('Profile deleted'));
});

// ── Save Details ──────────────────────────────────────────────────────────────
document.getElementById('saveDetails').addEventListener('click', () => {
  const yearsExpEl = document.getElementById('yearsExp');
  const yearsExpVal = yearsExpEl ? yearsExpEl.value.trim() : '';
  const exp = parseInt(yearsExpVal, 10);
  if (yearsExpVal !== '' && (isNaN(exp) || exp < 0 || exp > 99)) {
    showToast('Years experience must be 0–99', true);
    return;
  }

  clearTimeout(autoSaveTimer);
  readFormIntoProfile();
  if (yearsExpVal !== '') profiles[activeProfile].yearsExp = isNaN(exp) ? '' : String(exp);
  saveProfiles(() => showToast('Details saved'));
});

// ── AI Provider toggle ────────────────────────────────────────────────────────
function updateProviderUI(provider) {
  document.getElementById('anthropicKeyRow').style.display = provider === 'anthropic' ? '' : 'none';
  document.getElementById('replicateKeyRow').style.display = provider === 'replicate' ? '' : 'none';
}

document.getElementById('aiProvider').addEventListener('change', e => {
  const provider = e.target.value;
  updateProviderUI(provider);
  chrome.storage.local.set({ aiProvider: provider });
});

// ── Save API Key ──────────────────────────────────────────────────────────────
document.getElementById('saveApiKey').addEventListener('click', () => {
  const apiKey = document.getElementById('apiKey').value.trim();
  if (!apiKey) { showToast('Enter an API key first', true); return; }
  chrome.storage.local.set({ apiKey }, () => showToast('API key saved'));
});

document.getElementById('saveReplicateKey').addEventListener('click', () => {
  const key = document.getElementById('replicateApiKey').value.trim();
  if (!key) { showToast('Enter a Replicate API key first', true); return; }
  chrome.storage.local.set({ replicateApiKey: key }, () => showToast('Replicate key saved'));
});

// ── Test API Keys (item 30) ───────────────────────────────────────────────────
document.getElementById('testReplicateKey').addEventListener('click', () => {
  const key = document.getElementById('replicateApiKey').value.trim();
  if (!key) { showToast('Enter a Replicate API key first', true); return; }
  const btn = document.getElementById('testReplicateKey');
  setTestBtnState(btn, 'testing');
  chrome.runtime.sendMessage({ action: 'testReplicateKey', replicateApiKey: key }, response => {
    if (response && response.ok) {
      setTestBtnState(btn, 'valid');
    } else {
      setTestBtnState(btn, 'invalid');
      showToast((response && response.error) || 'Replicate key test failed', true);
    }
  });
});

document.getElementById('toggleReplicateKey').addEventListener('click', () => {
  const input = document.getElementById('replicateApiKey');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  document.getElementById('repEyeIcon').style.display = show ? 'none' : '';
  document.getElementById('repEyeOffIcon').style.display = show ? '' : 'none';
});

document.getElementById('testApiKey').addEventListener('click', () => {
  const apiKey = document.getElementById('apiKey').value.trim();
  if (!apiKey) { showToast('Enter an API key first', true); return; }
  const btn = document.getElementById('testApiKey');
  setTestBtnState(btn, 'testing');
  chrome.runtime.sendMessage({ action: 'testApiKey', apiKey }, response => {
    if (response && response.ok) {
      setTestBtnState(btn, 'valid');
    } else {
      setTestBtnState(btn, 'invalid');
      showToast((response && response.error) || 'API key test failed', true);
    }
  });
});

// ── Show/hide API key ─────────────────────────────────────────────────────────
document.getElementById('toggleApiKey').addEventListener('click', () => {
  const input = document.getElementById('apiKey');
  const eyeIcon = document.getElementById('eyeIcon');
  const eyeOffIcon = document.getElementById('eyeOffIcon');
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  eyeIcon.style.display = isHidden ? 'none' : '';
  eyeOffIcon.style.display = isHidden ? '' : 'none';
  document.getElementById('toggleApiKey').setAttribute('aria-label', isHidden ? 'Hide API key' : 'Show API key');
});

// ── Floating button toggle ────────────────────────────────────────────────────
document.getElementById('floatingBtn').addEventListener('change', e => {
  const enabled = e.target.checked;
  chrome.storage.local.set({ floatingBtn: enabled }, () => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleFloatingBtn', enabled }).catch(() => {});
      }
    });
  });
});

// ── Blocked Sites ─────────────────────────────────────────────────────────────
document.getElementById('saveBlockedSites').addEventListener('click', () => {
  const raw = document.getElementById('blockedSites').value;
  const blockedSites = raw.split('\n').map(s => s.trim()).filter(Boolean);
  chrome.storage.local.set({ blockedSites }, () => showToast('Blocked sites saved'));
});

document.getElementById('addCurrentSite').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]) return;
    try {
      const url = new URL(tabs[0].url);
      const textarea = document.getElementById('blockedSites');
      const existing = textarea.value.trim();
      const sites = existing ? existing.split('\n').map(s => s.trim()).filter(Boolean) : [];
      const addCurrentSiteBtn = document.getElementById('addCurrentSite');
      const alreadyExists = sites.includes(url.hostname);

      if (!alreadyExists) sites.push(url.hostname);
      textarea.value = sites.join('\n');

      // Inline confirmation (item 31)
      const oldConfirm = addCurrentSiteBtn.parentElement.querySelector('.site-add-confirm');
      if (oldConfirm) oldConfirm.remove();
      const confirmEl = document.createElement('span');
      confirmEl.className = 'site-add-confirm';
      confirmEl.textContent = alreadyExists ? 'Already blocked' : `${url.hostname} blocked`;
      addCurrentSiteBtn.parentElement.insertBefore(confirmEl, addCurrentSiteBtn.nextSibling);
      setTimeout(() => confirmEl.remove(), 2000);
    } catch {}
  });
});

// ── Import / Export ───────────────────────────────────────────────────────────
document.getElementById('exportData').addEventListener('click', () => {
  chrome.storage.local.get(['profiles', 'activeProfile', 'blockedSites', 'siteAssignments', 'signupHistory', 'fieldOverrides'], data => {
    const exportObj = {
      profiles: data.profiles || profiles,
      activeProfile: data.activeProfile ?? activeProfile,
      blockedSites: data.blockedSites || [],
      siteAssignments: data.siteAssignments || {},
      signupHistory: data.signupHistory || [],
      fieldOverrides: data.fieldOverrides || {}
    };
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fillr-backup.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported (API key not included)');
  });
});

document.getElementById('importData').addEventListener('click', () => {
  document.getElementById('importFile').click();
});

document.getElementById('importFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = evt => {
    try {
      const data = JSON.parse(evt.target.result);
      if (!Array.isArray(data.profiles) || data.profiles.length === 0) {
        showToast('Invalid backup file', true);
        return;
      }
      profiles = data.profiles;
      activeProfile = Math.min(data.activeProfile || 0, profiles.length - 1);
      const blockedSites = data.blockedSites || [];
      siteAssignments = (data.siteAssignments && typeof data.siteAssignments === 'object' && !Array.isArray(data.siteAssignments)) ? data.siteAssignments : {};
      // Validate signupHistory entries
      signupHistory = Array.isArray(data.signupHistory)
        ? data.signupHistory.filter(e => e && typeof e === 'object' && e.url && typeof e.timestamp === 'number' && e.status)
        : [];
      const fieldOverrides = (data.fieldOverrides && typeof data.fieldOverrides === 'object') ? data.fieldOverrides : {};
      chrome.storage.local.set({ profiles, activeProfile, blockedSites, siteAssignments, signupHistory, fieldOverrides }, () => {
        populateProfileSelect();
        loadProfileIntoForm(profiles[activeProfile]);
        document.getElementById('blockedSites').value = blockedSites.join('\n');
        renderSiteAssignList();
        renderSignupHistory(signupHistory);
        setupOverrideBadges(fieldOverrides);
        showToast('Imported successfully');
      });
    } catch {
      showToast('Failed to parse file', true);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ── Site Assignments ──────────────────────────────────────────────────────────
function populateSiteAssignSelect() {
  const sel = document.getElementById('siteAssignProfile');
  if (!sel) return;
  sel.innerHTML = '<option value="">Auto</option>';
  profiles.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = p.name || `Profile ${i + 1}`;
    sel.appendChild(opt);
  });
}

function renderSiteAssignList() {
  const list = document.getElementById('siteAssignList');
  if (!list) return;
  list.innerHTML = '';
  const entries = Object.entries(siteAssignments);
  entries.forEach(([domain, profileIdx]) => {
    const row = document.createElement('div');
    row.className = 'site-assign-saved-row';

    const domainSpan = document.createElement('span');
    domainSpan.className = 'site-assign-domain';
    domainSpan.textContent = domain;

    const profileSpan = document.createElement('span');
    profileSpan.className = 'site-assign-profile-name';
    profileSpan.textContent = profiles[profileIdx]?.name || `Profile ${profileIdx + 1}`;

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-sm btn-ghost';
    delBtn.textContent = 'Remove';
    delBtn.addEventListener('click', () => {
      delete siteAssignments[domain];
      chrome.storage.local.set({ siteAssignments });
      renderSiteAssignList();
      showToast(`Removed assignment for ${domain}`);
    });

    row.appendChild(domainSpan);
    row.appendChild(profileSpan);
    row.appendChild(delBtn);
    list.appendChild(row);
  });
}

document.getElementById('siteAssignSave').addEventListener('click', () => {
  const domain = document.getElementById('siteAssignDomain').textContent;
  if (!domain || domain === '—') return;
  const sel = document.getElementById('siteAssignProfile');
  if (sel.value === '') {
    delete siteAssignments[domain];
    showToast(`Assignment removed for ${domain}`);
  } else {
    siteAssignments[domain] = parseInt(sel.value, 10);
    const profileName = profiles[siteAssignments[domain]]?.name || `Profile ${siteAssignments[domain] + 1}`;
    showToast(`${domain} → ${profileName}`);
  }
  chrome.storage.local.set({ siteAssignments });
  renderSiteAssignList();
});

// ── Signup History ────────────────────────────────────────────────────────────
let signupHistory = [];

function formatHistoryTime(ts) {
  const d = new Date(ts);
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${date}, ${time}`;
}

function renderSignupHistory(history) {
  const section = document.getElementById('signupHistorySection');
  const list = document.getElementById('signupHistory');
  if (!section || !list) return;
  if (!history || history.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';
  list.innerHTML = '';
  history.forEach(({ url, timestamp, status, filled }) => {
    const row = document.createElement('div');
    row.className = 'history-row';

    const dot = document.createElement('span');
    dot.className = `history-dot history-dot-${status}`;
    dot.setAttribute('aria-hidden', 'true');

    const domain = document.createElement('span');
    domain.className = 'history-domain';
    domain.textContent = url;
    domain.title = url;

    const meta = document.createElement('span');
    meta.className = 'history-meta';
    meta.textContent = `${formatHistoryTime(timestamp)} · ${filled}f`;

    row.appendChild(dot);
    row.appendChild(domain);
    row.appendChild(meta);
    list.appendChild(row);
  });
}

function addToSignupHistory(rawUrl, status, filled) {
  let displayUrl = rawUrl;
  try {
    const u = new URL(rawUrl);
    displayUrl = u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, '');
  } catch {}
  signupHistory.unshift({ url: displayUrl, timestamp: Date.now(), status, filled });
  if (signupHistory.length > 20) signupHistory.splice(20);
  chrome.storage.local.set({ signupHistory });
  renderSignupHistory(signupHistory);
}

document.getElementById('clearHistory')?.addEventListener('click', () => {
  signupHistory = [];
  chrome.storage.local.set({ signupHistory });
  renderSignupHistory(signupHistory);
});

// ── Quick Signup ──────────────────────────────────────────────────────────────
let signupProgressListener = null;

(function () {
  const btn = document.getElementById('signupBtn');
  const urlInput = document.getElementById('signupUrl');
  const statusEl = document.getElementById('signupStatus');
  let isRunning = false;

  function setStatus(msg, variant = 'ok') {
    statusEl.textContent = msg;
    statusEl.className = `signup-status signup-status-${variant}`;
    statusEl.style.display = msg ? 'block' : 'none';
  }

  signupProgressListener = function (message) {
    if (!isRunning) return;
    if (message.action === 'signupProgress') {
      if (message.stage === 'loading') {
        btn.textContent = 'Loading page…';
      } else if (message.stage === 'filling') {
        const step = message.step ? ` (step ${message.step})` : '';
        btn.textContent = `Filling form…${step}`;
      } else if (message.stage === 'thinking') {
        const elapsed = message.elapsed ? ` (${message.elapsed}s)` : '';
        const coldNote = message.coldStart ? ' — cold start, hang tight' : '';
        btn.textContent = `AI thinking…${elapsed}${coldNote}`;
      }
    }
  };
  chrome.runtime.onMessage.addListener(signupProgressListener);

  urlInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); btn.click(); }
  });

  btn.addEventListener('click', () => {
    const url = urlInput.value.trim();
    if (!url) { showToast('Enter a URL first', true); return; }
    try { new URL(url); } catch { showToast('Not a valid URL', true); return; }

    isRunning = true;
    btn.disabled = true;
    btn.textContent = 'Opening page…';
    setStatus('');

    chrome.runtime.sendMessage({ action: 'quickSignup', url }, response => {
      chrome.runtime.onMessage.removeListener(signupProgressListener);
      isRunning = false;
      btn.disabled = false;
      btn.textContent = 'Sign Up';

      if (!response) {
        setStatus('No response — the page may have timed out.', 'error');
        return;
      }

      if (response.captcha) {
        setStatus('⚠ CAPTCHA detected — open it manually and use Fill Out instead.', 'warn');
        addToSignupHistory(url, 'captcha', 0);
        return;
      }

      if (response.error) {
        setStatus(`✕ ${response.error}`, response.warn ? 'warn' : 'error');
        addToSignupHistory(url, 'failed', 0);
        return;
      }

      const filled = response.filled || 0;

      // Required fields still empty — tab was kept open for manual completion
      if (response.requiredUnfilled && response.requiredUnfilled.length > 0) {
        const shown = response.requiredUnfilled.slice(0, 3).join(', ');
        const extra = response.requiredUnfilled.length > 3
          ? ` +${response.requiredUnfilled.length - 3} more`
          : '';
        setStatus(
          `✕ ${filled} field${filled !== 1 ? 's' : ''} filled. Still required: ${shown}${extra}. Tab opened for manual completion.`,
          'warn'
        );
        addToSignupHistory(url, 'failed', filled);
        return;
      }

      if (response.confirmed) {
        setStatus(`✓ Signed up! ${filled} field${filled !== 1 ? 's' : ''} filled.`);
        addToSignupHistory(url, 'confirmed', filled);
        urlInput.value = '';
      } else if (response.submitted) {
        // Submitted but no confirmation text visible — likely email-verification flow
        setStatus(`✓ Submitted — check your email to confirm. ${filled} field${filled !== 1 ? 's' : ''} filled.`);
        addToSignupHistory(url, 'submitted', filled);
        urlInput.value = '';
      } else {
        setStatus(`✕ Couldn't submit the form — open it manually and use Fill Out instead.`, 'error');
        addToSignupHistory(url, 'failed', filled);
      }
    });
  });
})();

// ── Fill trigger ──────────────────────────────────────────────────────────────
let isFilling = false;
let lastFillTabId = null;
let autoSaveTimer = null;

function triggerFill() {
  if (isFilling) return;
  isFilling = true;

  const fillBtnTop = document.getElementById('fillPageTop');
  if (fillBtnTop) fillBtnTop.disabled = true;

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    function resetButtons() {
      isFilling = false;
      if (fillBtnTop) fillBtnTop.disabled = false;
    }

    if (!tabs[0]) { resetButtons(); return; }
    lastFillTabId = tabs[0].id;

    const timeout = setTimeout(() => {
      const label = document.querySelector('#fillPageTop .btn-hover-label');
      if (label) label.textContent = 'Fill Out';
      resetButtons();
      showToast('Page took too long — try refreshing');
    }, 12000);

    chrome.tabs.sendMessage(tabs[0].id, { action: 'fill' }, response => {
      clearTimeout(timeout);
      const label = document.querySelector('#fillPageTop .btn-hover-label');
      if (label) label.textContent = 'Fill Out';
      resetButtons();
      if (chrome.runtime.lastError) {
        showToast('Cannot fill this page', true);
        return;
      }
      if (!response || response.filled === undefined) return;

      if (response.blocked) {
        showToast('This site is blocked — remove it in Settings', true);
      } else if (response.iframeWarning) {
        // Yellow-ish warning — use isError=false but different message
        showToast(response.iframeWarning);
        if (response.apiError) showToast(response.apiError, true);
        else if (response.filled > 0) {
          const msg = `Filled ${response.filled} field${response.filled !== 1 ? 's' : ''}`;
          if (response.hasUndo && lastFillTabId) {
            showToastWithUndo(msg, () => {
              chrome.tabs.sendMessage(lastFillTabId, { action: 'undoFill' })
                .then(r => { if (r && r.restored > 0) showToast(`Undid ${r.restored} field${r.restored !== 1 ? 's' : ''}`); })
                .catch(() => {});
            });
          } else {
            showToast(msg);
          }
        }
      } else if (response.apiError) {
        showToast(response.apiError, true);
      } else if (response.filled === 0) {
        showToast('No fillable fields found');
      } else {
        const msg = `Filled ${response.filled} field${response.filled !== 1 ? 's' : ''}`;
        if (response.hasUndo && lastFillTabId) {
          showToastWithUndo(msg, () => {
            chrome.tabs.sendMessage(lastFillTabId, { action: 'undoFill' })
              .then(r => { if (r && r.restored > 0) showToast(`Undid ${r.restored} field${r.restored !== 1 ? 's' : ''}`); })
              .catch(() => {});
          });
        } else {
          showToast(msg);
        }
      }
    });
  });
}

document.getElementById('fillPageTop').addEventListener('click', triggerFill);

// Listen for progress updates from the content script during AI passes.
function progressListener(message) {
  if (message.action === 'fillProgress' && isFilling) {
    const label = document.querySelector('#fillPageTop .btn-hover-label');
    if (label) label.textContent = message.stage === 'ai-text' ? 'AI Match…' : 'AI Vision…';
  }
}
chrome.runtime.onMessage.addListener(progressListener);

// ── Auto-save on typing ───────────────────────────────────────────────────────
let _completenessDebounce = null;
function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  showSaveIndicator('saving');
  autoSaveTimer = setTimeout(() => {
    readFormIntoProfile();
    saveProfiles(() => showSaveIndicator('saved'));
  }, 800);
  // Update completeness indicator with debounce
  clearTimeout(_completenessDebounce);
  _completenessDebounce = setTimeout(updateCompleteness, 200);
}

document.getElementById('tab-details').querySelectorAll('input, textarea').forEach(el => {
  el.addEventListener('input', scheduleAutoSave);
});

// Flush auto-save and remove the progress listeners when popup is hidden
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    chrome.runtime.onMessage.removeListener(progressListener);
    if (signupProgressListener) chrome.runtime.onMessage.removeListener(signupProgressListener);
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
      readFormIntoProfile();
      saveProfiles();
    }
  }
});

// ── Cmd/Ctrl+S shortcut ───────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    if (activeTab === 'details') document.getElementById('saveDetails').click();
    else if (activeTab === 'settings') document.getElementById('saveApiKey').click();
  }
});
