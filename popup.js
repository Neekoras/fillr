'use strict';

const PROFILE_KEYS = [
  'firstName', 'lastName', 'email', 'phone',
  'address1', 'address2', 'city', 'state', 'zip', 'country',
  'linkedin', 'github', 'website', 'bio',
  'yearsExp', 'jobTitle', 'company'
];

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
  // Force reflow so transition triggers
  void toast.offsetWidth;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), isError ? 4000 : 2800);
}

// ── Load stored values on popup open ─────────────────────────────────────────
chrome.storage.local.get([...PROFILE_KEYS, 'apiKey', 'floatingBtn'], data => {
  PROFILE_KEYS.forEach(key => {
    const el = document.getElementById(key);
    if (el && data[key] !== undefined) el.value = data[key];
  });
  if (data.apiKey) document.getElementById('apiKey').value = data.apiKey;
  document.getElementById('floatingBtn').checked = !!data.floatingBtn;
});

// ── Save Details ──────────────────────────────────────────────────────────────
document.getElementById('saveDetails').addEventListener('click', () => {
  const profile = {};
  PROFILE_KEYS.forEach(key => {
    const el = document.getElementById(key);
    if (el) profile[key] = el.value.trim();
  });
  chrome.storage.local.set(profile, () => {
    showToast('Details saved');
  });
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

// ── Floating button toggle ────────────────────────────────────────────────────
document.getElementById('floatingBtn').addEventListener('change', e => {
  const enabled = e.target.checked;
  chrome.storage.local.set({ floatingBtn: enabled }, () => {
    // Notify the active tab's content script
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleFloatingBtn', enabled })
          .catch(() => {}); // Content script may not be loaded on non-web pages
      }
    });
  });
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
