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

// ── Answer library state ──────────────────────────────────────────────────────
let answerLibrary = [];

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
chrome.storage.local.get(['profiles', 'activeProfile', 'apiKey', 'floatingBtn', 'blockedSites', 'onboardingSeen', 'answerLibrary', 'siteAssignments'], data => {
  if (data.profiles && data.profiles.length > 0) {
    profiles = data.profiles;
    activeProfile = Math.min(data.activeProfile || 0, profiles.length - 1);
  } else {
    const p = emptyProfile('Default');
    PROFILE_KEYS.forEach(k => { p[k] = data[k] || ''; });
    profiles = [p];
    activeProfile = 0;
  }

  answerLibrary = data.answerLibrary || [];
  siteAssignments = data.siteAssignments || {};

  populateProfileSelect();
  loadProfileIntoForm(profiles[activeProfile]);

  if (data.apiKey) document.getElementById('apiKey').value = data.apiKey;
  document.getElementById('floatingBtn').checked = !!data.floatingBtn;
  if (data.blockedSites) document.getElementById('blockedSites').value = data.blockedSites.join('\n');

  renderAnswerList();
  populateSiteAssignSelect();
  renderSiteAssignList();

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
  if (!data.onboardingSeen) {
    const allEmpty = PROFILE_KEYS.every(k => !profiles[activeProfile][k]);
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

document.getElementById('newProfile').addEventListener('click', () => {
  const raw = window.prompt('Profile name:', `Profile ${profiles.length + 1}`);
  if (raw === null) return; // cancelled
  const name = raw.trim();
  if (!name) {
    showToast('Name cannot be empty', true);
    return;
  }
  if (profiles.some(p => p.name.toLowerCase() === name.toLowerCase())) {
    showToast('A profile with that name already exists', true);
    return;
  }
  readFormIntoProfile();
  const newProf = emptyProfile(name);
  profiles.push(newProf);
  activeProfile = profiles.length - 1;
  populateProfileSelect();
  loadProfileIntoForm(profiles[activeProfile]);
  saveProfiles();
});

document.getElementById('renameProfile').addEventListener('click', () => {
  const current = profiles[activeProfile].name || `Profile ${activeProfile + 1}`;
  const raw = window.prompt('Rename profile:', current);
  if (raw === null) return;
  const name = raw.trim();
  if (!name) {
    showToast('Name cannot be empty', true);
    return;
  }
  if (profiles.some((p, i) => i !== activeProfile && p.name.toLowerCase() === name.toLowerCase())) {
    showToast('A profile with that name already exists', true);
    return;
  }
  profiles[activeProfile].name = name;
  populateProfileSelect();
  saveProfiles(() => showToast('Profile renamed'));
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

// ── Save API Key ──────────────────────────────────────────────────────────────
document.getElementById('saveApiKey').addEventListener('click', () => {
  const apiKey = document.getElementById('apiKey').value.trim();
  if (!apiKey) {
    showToast('Enter an API key first', true);
    return;
  }
  chrome.storage.local.set({ apiKey }, () => showToast('API key saved'));
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
  chrome.storage.local.get(['profiles', 'activeProfile', 'blockedSites', 'answerLibrary', 'siteAssignments'], data => {
    const exportObj = {
      profiles: data.profiles || profiles,
      activeProfile: data.activeProfile ?? activeProfile,
      blockedSites: data.blockedSites || [],
      answerLibrary: data.answerLibrary || [],
      siteAssignments: data.siteAssignments || {}
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
      answerLibrary = data.answerLibrary || [];
      siteAssignments = data.siteAssignments || {};
      chrome.storage.local.set({ profiles, activeProfile, blockedSites, answerLibrary, siteAssignments }, () => {
        populateProfileSelect();
        loadProfileIntoForm(profiles[activeProfile]);
        document.getElementById('blockedSites').value = blockedSites.join('\n');
        renderAnswerList();
        renderSiteAssignList();
        showToast('Imported successfully');
      });
    } catch {
      showToast('Failed to parse file', true);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ── Answer Library ────────────────────────────────────────────────────────────
function renderAnswerList() {
  const list = document.getElementById('answerList');
  if (!list) return;
  list.innerHTML = '';
  if (answerLibrary.length === 0) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.style.marginTop = '8px';
    hint.textContent = 'No saved answers yet. Add one to help Claude fill open-ended questions verbatim.';
    list.appendChild(hint);
    return;
  }
  answerLibrary.forEach(({ question, answer }, i) => {
    const item = document.createElement('div');
    item.className = 'answer-item';

    const content = document.createElement('div');
    content.className = 'answer-item-content';

    const qDiv = document.createElement('div');
    qDiv.className = 'answer-question';
    qDiv.textContent = question;

    const aDiv = document.createElement('div');
    aDiv.className = 'answer-answer';
    aDiv.textContent = answer;

    content.appendChild(qDiv);
    content.appendChild(aDiv);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-icon answer-delete';
    delBtn.setAttribute('aria-label', 'Delete answer');
    delBtn.title = 'Delete';
    delBtn.textContent = '×';
    delBtn.addEventListener('click', () => {
      answerLibrary.splice(i, 1);
      chrome.storage.local.set({ answerLibrary });
      renderAnswerList();
    });

    item.appendChild(content);
    item.appendChild(delBtn);
    list.appendChild(item);
  });
}

document.getElementById('addAnswer').addEventListener('click', () => {
  const question = window.prompt('Question (e.g. "Why do you want to join?"):');
  if (question === null || !question.trim()) return;
  const answer = window.prompt('Your answer:');
  if (answer === null || !answer.trim()) return;
  answerLibrary.push({ question: question.trim(), answer: answer.trim() });
  chrome.storage.local.set({ answerLibrary });
  renderAnswerList();
  showToast('Answer saved');
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

// ── Quick Signup ──────────────────────────────────────────────────────────────
(function () {
  const btn = document.getElementById('signupBtn');
  const urlInput = document.getElementById('signupUrl');
  const statusEl = document.getElementById('signupStatus');
  let isRunning = false;

  function setStatus(msg, isError = false) {
    statusEl.textContent = msg;
    statusEl.className = 'signup-status' + (isError ? ' signup-status-error' : ' signup-status-ok');
    statusEl.style.display = msg ? 'block' : 'none';
  }

  // Progress updates from background while signup is running
  function signupProgressListener(message) {
    if (!isRunning) return;
    if (message.action === 'signupProgress') {
      btn.textContent = message.stage === 'loading' ? 'Loading page…' : 'Filling form…';
    }
  }
  chrome.runtime.onMessage.addListener(signupProgressListener);

  // Pre-fill with current tab URL if it looks like an event link
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
      isRunning = false;
      btn.disabled = false;
      btn.textContent = 'Sign Up';

      if (!response) {
        setStatus('No response — the page may have timed out.', true);
        return;
      }
      if (response.error) {
        setStatus(response.error, true);
        return;
      }
      if (response.success) {
        setStatus(`Signed up! ${response.filled} field${response.filled !== 1 ? 's' : ''} filled.`);
        urlInput.value = '';
      } else {
        setStatus(`Filled ${response.filled || 0} field${response.filled !== 1 ? 's' : ''} but couldn't confirm signup — check your email or the site.`, true);
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

// Flush auto-save and remove the progress listener when popup is hidden
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    chrome.runtime.onMessage.removeListener(progressListener);
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
