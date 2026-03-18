'use strict';

const PROFILE_KEYS = [
  'firstName', 'lastName',
  'email', 'phone',
  'address1', 'address2', 'city', 'state', 'zip', 'country',
  'linkedin', 'github', 'website', 'twitter', 'instagram', 'bio',
  'yearsExp', 'jobTitle', 'company'
];

// ── Multi-profile state ───────────────────────────────────────────────────────
let profiles = [];
let activeProfile = 0;

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

// ── Load stored values on popup open ─────────────────────────────────────────
chrome.storage.local.get(['profiles', 'activeProfile', 'apiKey', 'floatingBtn', 'blockedSites'], data => {
  if (data.profiles && data.profiles.length > 0) {
    profiles = data.profiles;
    activeProfile = Math.min(data.activeProfile || 0, profiles.length - 1);
  } else {
    // Migration: build first profile from legacy flat storage
    const p = emptyProfile('Default');
    PROFILE_KEYS.forEach(k => { p[k] = data[k] || ''; });
    profiles = [p];
    activeProfile = 0;
  }

  populateProfileSelect();
  loadProfileIntoForm(profiles[activeProfile]);

  if (data.apiKey) document.getElementById('apiKey').value = data.apiKey;
  document.getElementById('floatingBtn').checked = !!data.floatingBtn;
  if (data.blockedSites) document.getElementById('blockedSites').value = data.blockedSites.join('\n');
});

// ── Profile selector ──────────────────────────────────────────────────────────
document.getElementById('profileSelect').addEventListener('change', e => {
  readFormIntoProfile();
  activeProfile = parseInt(e.target.value, 10);
  loadProfileIntoForm(profiles[activeProfile]);
  saveProfiles();
});

document.getElementById('newProfile').addEventListener('click', () => {
  const name = window.prompt('Profile name:', `Profile ${profiles.length + 1}`);
  if (!name) return;
  readFormIntoProfile();
  const newProf = emptyProfile(name.trim());
  profiles.push(newProf);
  activeProfile = profiles.length - 1;
  populateProfileSelect();
  loadProfileIntoForm(profiles[activeProfile]);
  saveProfiles();
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
  // yearsExp validation
  const yearsExpEl = document.getElementById('yearsExp');
  const yearsExpVal = yearsExpEl ? yearsExpEl.value.trim() : '';
  const exp = parseInt(yearsExpVal, 10);
  if (yearsExpVal !== '' && (isNaN(exp) || exp < 0 || exp > 99)) {
    showToast('Years experience must be 0–99', true);
    return;
  }

  readFormIntoProfile();
  if (yearsExpVal !== '') profiles[activeProfile].yearsExp = isNaN(exp) ? '' : String(exp);

  saveProfiles(() => showToast('Details saved'));
});

// ── Save API Key ──────────────────────────────────────────────────────────────
document.getElementById('saveApiKey').addEventListener('click', () => {
  const apiKey = document.getElementById('apiKey').value.trim();
  if (!apiKey) {
    showToast('Enter an API key first', true);
    return;
  }
  chrome.storage.local.set({ apiKey }, () => {
    showToast('API key saved');
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
        chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleFloatingBtn', enabled })
          .catch(() => {});
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
      }
    } catch {}
  });
});

// ── Import / Export ───────────────────────────────────────────────────────────
document.getElementById('exportData').addEventListener('click', () => {
  chrome.storage.local.get(['profiles', 'activeProfile', 'blockedSites'], data => {
    const exportObj = {
      profiles: data.profiles || profiles,
      activeProfile: data.activeProfile ?? activeProfile,
      blockedSites: data.blockedSites || []
    };
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fillr-backup.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported successfully');
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
      chrome.storage.local.set({ profiles, activeProfile, blockedSites }, () => {
        populateProfileSelect();
        loadProfileIntoForm(profiles[activeProfile]);
        document.getElementById('blockedSites').value = blockedSites.join('\n');
        showToast('Imported successfully');
      });
    } catch {
      showToast('Failed to parse file', true);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ── Fill This Page ────────────────────────────────────────────────────────────
let isFilling = false;

function triggerFill() {
  if (isFilling) return;
  isFilling = true;

  const fillBtn = document.getElementById('fillPage');
  const fillBtnTop = document.getElementById('fillPageTop');
  if (fillBtn) { fillBtn.disabled = true; fillBtn.textContent = 'Filling…'; }
  if (fillBtnTop) fillBtnTop.disabled = true;

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    function resetButtons() {
      isFilling = false;
      if (fillBtn) { fillBtn.disabled = false; fillBtn.textContent = 'Fill This Page'; }
      if (fillBtnTop) fillBtnTop.disabled = false;
    }

    if (!tabs[0]) { resetButtons(); return; }

    chrome.tabs.sendMessage(tabs[0].id, { action: 'fill' }, response => {
      resetButtons();
      if (chrome.runtime.lastError) {
        showToast('Cannot fill this page', true);
        return;
      }
      if (response && response.filled !== undefined) {
        if (response.apiError) {
          showToast(response.apiError, true);
        } else if (response.filled === 0) {
          showToast('No fillable fields found', true);
        } else {
          showToast(`Filled ${response.filled} field${response.filled !== 1 ? 's' : ''}`);
        }
      }
    });
  });
}

document.getElementById('fillPage').addEventListener('click', triggerFill);
document.getElementById('fillPageTop').addEventListener('click', triggerFill);

// ── Auto-save on typing ───────────────────────────────────────────────────────
let autoSaveTimer = null;
function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    readFormIntoProfile();
    saveProfiles();
  }, 800);
}

document.getElementById('tab-details').querySelectorAll('input, textarea').forEach(el => {
  el.addEventListener('input', scheduleAutoSave);
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
