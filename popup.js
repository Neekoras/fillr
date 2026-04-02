'use strict';

const PROFILE_KEYS = [
  'firstName', 'lastName',
  'email', 'phone',
  'address1', 'address2', 'city', 'state', 'zip', 'country',
  'linkedin', 'github', 'website', 'twitter', 'instagram', 'bio',
  'yearsExp', 'jobTitle', 'company', 'context'
];

// ── Multi-profile state ───────────────────────────────────────────────────────
let profiles = [];
let activeProfile = 0;

// ── Site assignments state ────────────────────────────────────────────────────
let siteAssignments = {};

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
  });
});

// ── Toast helper ──────────────────────────────────────────────────────────────
let toastTimer = null;

function showToast(msg, isError = false) {
  clearTimeout(toastTimer);
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = 'toast' + (isError ? ' error' : '');
  void toast.offsetWidth;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), isError ? 4000 : 2800);
}

function showToastWithUndo(msg, onUndo) {
  clearTimeout(toastTimer);
  const toast = document.getElementById('toast');
  toast.innerHTML = '';
  const text = document.createTextNode(msg + ' ');
  const undoBtn = document.createElement('button');
  undoBtn.className = 'toast-undo-btn';
  undoBtn.textContent = 'Undo';
  undoBtn.addEventListener('click', () => {
    toast.classList.remove('show');
    clearTimeout(toastTimer);
    onUndo();
  });
  toast.appendChild(text);
  toast.appendChild(undoBtn);
  toast.className = 'toast';
  void toast.offsetWidth;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 4500);
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

// ── Load stored values on popup open ─────────────────────────────────────────
chrome.storage.local.get(['profiles', 'activeProfile', 'apiKey', 'replicateApiKey', 'aiProvider', 'floatingBtn', 'blockedSites', 'onboardingSeen', 'siteAssignments', 'signupHistory'], data => {
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

  // Load current site's assignment
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]) return;
    try {
      const hostname = new URL(tabs[0].url).hostname;
      document.getElementById('siteAssignDomain').textContent = hostname;
      const sel = document.getElementById('siteAssignProfile');
      const assigned = siteAssignments[hostname];
      sel.value = assigned !== undefined ? String(assigned) : '';
    } catch {}
  });

  // Show onboarding banner if first run (all fields empty, never seen)
  // Exclude 'context' — it's supplemental and shouldn't block the banner
  if (!data.onboardingSeen) {
    const coreKeys = PROFILE_KEYS.filter(k => k !== 'context');
    const allEmpty = coreKeys.every(k => !profiles[activeProfile][k]);
    if (allEmpty) {
      const banner = document.getElementById('onboardingBanner');
      if (banner) banner.style.display = 'block';
    }
  }
});

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

// ── Inline profile name editing ───────────────────────────────────────────────
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

  clearTimeout(autoSaveTimer); // flush any pending auto-save
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
  if (!apiKey) {
    showToast('Enter an API key first', true);
    return;
  }
  chrome.storage.local.set({ apiKey }, () => showToast('API key saved'));
});

document.getElementById('saveReplicateKey').addEventListener('click', () => {
  const key = document.getElementById('replicateApiKey').value.trim();
  if (!key) { showToast('Enter a Replicate API key first', true); return; }
  chrome.storage.local.set({ replicateApiKey: key }, () => showToast('Replicate key saved'));
});

document.getElementById('testReplicateKey').addEventListener('click', () => {
  const key = document.getElementById('replicateApiKey').value.trim();
  if (!key) { showToast('Enter a Replicate API key first', true); return; }
  const btn = document.getElementById('testReplicateKey');
  btn.disabled = true;
  btn.textContent = 'Testing…';
  chrome.runtime.sendMessage({ action: 'testReplicateKey', replicateApiKey: key }, response => {
    btn.disabled = false;
    btn.textContent = 'Test';
    if (response && response.ok) {
      showToast('Replicate key is valid ✓');
    } else {
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

// ── Test API Key ──────────────────────────────────────────────────────────────
document.getElementById('testApiKey').addEventListener('click', () => {
  const apiKey = document.getElementById('apiKey').value.trim();
  if (!apiKey) {
    showToast('Enter an API key first', true);
    return;
  }
  const btn = document.getElementById('testApiKey');
  btn.disabled = true;
  btn.textContent = 'Testing…';
  chrome.runtime.sendMessage({ action: 'testApiKey', apiKey }, response => {
    btn.disabled = false;
    btn.textContent = 'Test';
    if (response && response.ok) {
      showToast('API key is valid ✓');
    } else {
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
      if (!sites.includes(url.hostname)) {
        sites.push(url.hostname);
        textarea.value = sites.join('\n');
        showToast(`Added ${url.hostname}`);
      } else {
        showToast('Site already blocked');
      }
    } catch {}
  });
});

// ── Import / Export ───────────────────────────────────────────────────────────
document.getElementById('exportData').addEventListener('click', () => {
  chrome.storage.local.get(['profiles', 'activeProfile', 'blockedSites', 'siteAssignments', 'signupHistory'], data => {
    const exportObj = {
      profiles: data.profiles || profiles,
      activeProfile: data.activeProfile ?? activeProfile,
      blockedSites: data.blockedSites || [],
      siteAssignments: data.siteAssignments || {},
      signupHistory: data.signupHistory || []
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
      signupHistory = Array.isArray(data.signupHistory) ? data.signupHistory : [];
      chrome.storage.local.set({ profiles, activeProfile, blockedSites, siteAssignments, signupHistory }, () => {
        populateProfileSelect();
        loadProfileIntoForm(profiles[activeProfile]);
        document.getElementById('blockedSites').value = blockedSites.join('\n');
        renderSiteAssignList();
        renderSignupHistory(signupHistory);
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
  // Keep the "Auto" option, repopulate profiles
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
// Declared at module scope so visibilitychange can remove it on popup close
let signupProgressListener = null;

(function () {
  const btn = document.getElementById('signupBtn');
  const urlInput = document.getElementById('signupUrl');
  const statusEl = document.getElementById('signupStatus');
  let isRunning = false;

  function setStatus(msg, variant = 'ok') {
    // variant: 'ok' | 'error' | 'warn'
    statusEl.textContent = msg;
    statusEl.className = `signup-status signup-status-${variant}`;
    statusEl.style.display = msg ? 'block' : 'none';
  }

  signupProgressListener = function (message) {
    if (!isRunning) return;
    if (message.action === 'signupProgress') {
      btn.textContent = message.stage === 'loading' ? 'Loading page…' : 'Filling form…';
    }
  };
  chrome.runtime.onMessage.addListener(signupProgressListener);

  // Pre-fill URL if current tab looks like an event page
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]) return;
    try {
      const url = new URL(tabs[0].url);
      if (/lu\.ma|eventbrite\.com|partiful\.com/i.test(url.hostname)) {
        urlInput.value = tabs[0].url;
      }
    } catch {}
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

      // CAPTCHA detected — yellow warning, no red
      if (response.captcha) {
        setStatus('This page has a CAPTCHA — open it manually and use Fill Out instead.', 'warn');
        addToSignupHistory(url, 'captcha', 0);
        return;
      }

      // Hard error (tab create failed, timeout, cancelled, etc.)
      if (response.error) {
        setStatus(response.error, 'error');
        // Only log as failed if a fill wasn't attempted (error came before submission)
        addToSignupHistory(url, 'failed', 0);
        return;
      }

      const filled = response.filled || 0;

      if (response.confirmed) {
        // DOM text or URL change confirmed success
        setStatus(`Signed up! ${filled} field${filled !== 1 ? 's' : ''} filled.`);
        addToSignupHistory(url, 'confirmed', filled);
        urlInput.value = '';
      } else if (response.submitted) {
        // Form was submitted but no DOM confirmation (email-verification flows)
        setStatus('Submitted.');
        addToSignupHistory(url, 'submitted', filled);
        urlInput.value = '';
      } else {
        // Fill ran but submit button was never found/clicked
        setStatus(`Couldn't submit the form — open it manually and use Fill Out instead.`, 'error');
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

    // 12-second timeout so the button never hangs
    const timeout = setTimeout(() => {
      const label = document.querySelector('#fillPageTop .btn-hover-label');
      if (label) label.textContent = 'Fill Out';
      resetButtons();
      showToast('Page took too long — try refreshing');
    }, 12000);

    chrome.tabs.sendMessage(tabs[0].id, { action: 'fill' }, response => {
      clearTimeout(timeout);
      // Reset progress label back to default before re-enabling
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
// Store the reference so we can remove it when the popup is hidden.
function progressListener(message) {
  if (message.action === 'fillProgress' && isFilling) {
    const label = document.querySelector('#fillPageTop .btn-hover-label');
    if (label) label.textContent = message.stage === 'ai-text' ? 'AI Match…' : 'AI Vision…';
  }
}
chrome.runtime.onMessage.addListener(progressListener);

// ── Auto-save on typing ───────────────────────────────────────────────────────
function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  showSaveIndicator('saving');
  autoSaveTimer = setTimeout(() => {
    readFormIntoProfile();
    saveProfiles(() => showSaveIndicator('saved'));
  }, 800);
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


