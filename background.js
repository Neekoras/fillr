'use strict';

/**
 * Background service worker.
 * Handles Claude API calls, badge management, keyboard shortcut, and context menu.
 */

// ── Provider capabilities ──────────────────────────────────────────────────
const PROVIDER_CAPS = {
  anthropic: { supportsVision: true },
  replicate: { supportsVision: false }
};

// ── Shared prompt-building helpers ────────────────────────────────────────
function buildProfileBlock(profile) {
  const context = profile.context || '';
  const entries = Object.entries(profile).filter(([k, v]) => v && k !== 'context');
  return {
    profileDesc: entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n'),
    availableKeys: entries.map(([k]) => k).join(', '),
    contextBlock: context ? `\nAdditional context the user wants Claude to know:\n${context}\n` : ''
  };
}

function buildFieldList(fields) {
  return fields.map(f => {
    let line = `id=${JSON.stringify(f.id)} name=${JSON.stringify(f.name)} placeholder=${JSON.stringify(f.placeholder)} label=${JSON.stringify(f.label)} type=${JSON.stringify(f.type)}`;
    if (f.options && f.options.length) line += ` options=[${f.options.map(o => JSON.stringify(o)).join(', ')}]`;
    return line;
  }).join('\n');
}

function buildPageContextBlock(pageContext) {
  if (!pageContext) return '';
  const parts = [];
  if (pageContext.title) parts.push(`Page title: ${pageContext.title}`);
  if (pageContext.metaDesc) parts.push(`Description: ${pageContext.metaDesc}`);
  if (pageContext.headings?.length) parts.push(`Headings: ${pageContext.headings.join(' | ')}`);
  if (pageContext.nearbyText) parts.push(`Page text: ${pageContext.nearbyText}`);
  return parts.length ? `\nPage context (use this to understand what the form is about):\n${parts.join('\n')}\n` : '';
}

// Robustly extract the first JSON object from the response text using brace counting.
function extractJSON(rawText) {
  const start = rawText.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in response');
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < rawText.length; i++) {
    const c = rawText[i];
    if (escape) { escape = false; continue; }
    if (c === '\\' && inString) { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth++;
    if (c === '}') { depth--; if (depth === 0) return JSON.parse(rawText.slice(start, i + 1)); }
  }
  throw new Error('No complete JSON object found in response');
}

// ── Form fingerprint cache (skip Claude for repeat fills) ─────────────────
const fillCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function fingerprint(fields, hostname) {
  return (hostname || '') + ':' + fields.map(f => `${encodeURIComponent(f.id || '')}|${encodeURIComponent(f.name || '')}|${encodeURIComponent(f.type || '')}`).sort().join(',');
}

function getCached(fields, hostname) {
  const key = fingerprint(fields, hostname);
  const entry = fillCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { fillCache.delete(key); return null; }
  return entry.mapping;
}

function setCache(fields, mapping, hostname) {
  fillCache.set(fingerprint(fields, hostname), { mapping, ts: Date.now() });
}

// ── Port tracking for Replicate polling cancellation ──────────────────────
let _activeFillerPort = null;
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'fillr-fill') return;
  _activeFillerPort = port;
  port.onDisconnect.addListener(() => { _activeFillerPort = null; });
});

// ── Replicate API call (Llama 3 70B Instruct) ─────────────────────────────
async function callReplicateAPI(apiKey, messages) {
  const prompt = messages[0]?.content || '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 28000);
  let response;
  try {
    response = await fetch('https://api.replicate.com/v1/models/meta/meta-llama-3.1-70b-instruct/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait=25'
      },
      body: JSON.stringify({
        input: {
          prompt,
          system_prompt: 'You only output valid JSON objects. No markdown fences, no explanation, no prose — only the JSON.',
          max_new_tokens: 512,
          temperature: 0.1,
          top_p: 0.9
        }
      }),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') return { error: 'Request timed out' };
    return { error: `Network error: ${err.message}` };
  }
  clearTimeout(timer);

  if (!response.ok) {
    let errorText;
    try { const j = await response.json(); errorText = j.detail || response.statusText; }
    catch { errorText = response.statusText; }
    return { error: `Replicate error ${response.status}: ${errorText}` };
  }

  let data;
  try { data = await response.json(); }
  catch { return { error: 'Failed to parse Replicate response' }; }

  // Cold-start polling: if the model didn't finish within the wait window, poll until done
  if (data.status === 'processing' && data.urls?.get) {
    const pollUrl = data.urls.get;
    const deadline = Date.now() + 90000; // 90s total budget
    const startTime = Date.now();
    let lastProgressSend = Date.now();

    while (Date.now() < deadline) {
      // Check port disconnect — cancel if popup closed
      if (_activeFillerPort === null) {
        return { error: 'Cancelled — popup was closed.' };
      }

      await new Promise(r => setTimeout(r, 2000));

      // Send progress feedback every ~10s
      const now = Date.now();
      if (now - lastProgressSend >= 10000) {
        lastProgressSend = now;
        const elapsed = Math.floor((now - startTime) / 1000);
        const progressMsg = { action: 'signupProgress', stage: 'thinking', elapsed };
        if (elapsed >= 45) progressMsg.coldStart = true;
        chrome.runtime.sendMessage(progressMsg).catch(() => {});
      }

      try {
        const pr = await fetch(pollUrl, { headers: { 'Authorization': `Bearer ${apiKey}` } });
        if (!pr.ok) break;
        data = await pr.json();
        if (data.status === 'succeeded' || data.status === 'failed') break;
      } catch { break; }
    }
  }

  if (data.status !== 'succeeded') {
    return { error: `Replicate: ${data.error || data.status || 'timed out'}` };
  }

  const rawText = (Array.isArray(data.output) ? data.output.join('') : (data.output || '')).trim();
  if (!rawText) return { error: 'Empty response from Replicate' };

  try {
    return { mapping: extractJSON(rawText) };
  } catch {
    return { error: `Could not parse response: ${rawText.slice(0, 100)}` };
  }
}

// ── Anthropic API call with retry + exponential backoff ────────────────────
async function callAnthropicAPI(apiKey, messages) {
  const delays = [0, 1000, 3000];
  let lastError = 'Request failed';

  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) await new Promise(r => setTimeout(r, delays[attempt]));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    let response;

    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 512, messages }),
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') { lastError = 'Request timed out'; continue; }
      return { error: `Network error: ${err.message}` };
    }
    clearTimeout(timer);

    // Retry on 429, 529 (Anthropic overloaded), and 5xx errors
    if (response.status === 429 || response.status === 529 || response.status >= 500) {
      const retryAfterRaw = parseInt(response.headers.get('retry-after') || '0', 10) * 1000;
      const wait = retryAfterRaw > 0 ? retryAfterRaw : 2000;
      if (attempt + 1 < delays.length) delays[attempt + 1] = wait;
      lastError = `API error ${response.status}`;
      continue;
    }

    if (!response.ok) {
      let errorText;
      try { const j = await response.json(); errorText = j.error?.message || response.statusText; }
      catch { errorText = response.statusText; }
      return { error: `API error ${response.status}: ${errorText}` };
    }

    let data;
    try { data = await response.json(); }
    catch { return { error: 'Failed to parse API response' }; }

    const rawText = data?.content?.[0]?.text?.trim();
    if (!rawText) return { error: 'Empty response from Claude' };

    try {
      return { mapping: extractJSON(rawText) };
    } catch {
      return { error: `Could not parse Claude response: ${rawText.slice(0, 100)}` };
    }
  }

  return { error: lastError };
}

// ── Quick Signup ───────────────────────────────────────────────────────────
function waitForContentScript(tabId) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const MAX_ATTEMPTS = 10;
    const BASE = 200;
    const CAP = 3000;

    function tryPing() {
      chrome.tabs.sendMessage(tabId, { action: 'ping' }, response => {
        const err = chrome.runtime.lastError;
        if (!err && response && response.ok) { resolve(); return; }
        if (err && /no tab|closed|removed/i.test(err.message || '')) {
          reject(new Error('Signup cancelled.'));
          return;
        }
        attempt++;
        if (attempt >= MAX_ATTEMPTS) {
          reject(new Error('Page took too long to load — try again.'));
          return;
        }
        setTimeout(tryPing, Math.min(BASE * Math.pow(2, attempt - 1), CAP));
      });
    }
    tryPing();
  });
}

// Private / local IP ranges — block for security
const PRIVATE_HOST = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

async function handleQuickSignup(url) {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return { error: 'Only http/https URLs are supported' };
    if (url.length > 2048) return { error: 'URL too long (max 2048 characters).' };
    if (PRIVATE_HOST.test(parsed.hostname)) return { error: 'Local/private URLs are not supported.' };
  } catch { return { error: 'Invalid URL' }; }

  let tabId;
  let keepTabOpen = false;
  try {
    let tab;
    try {
      tab = await chrome.tabs.create({ url, active: false });
    } catch {
      return { error: 'Signup cancelled.' };
    }
    tabId = tab.id;

    chrome.runtime.sendMessage({ action: 'signupProgress', stage: 'loading' }).catch(() => {});

    await waitForContentScript(tabId);

    chrome.runtime.sendMessage({ action: 'signupProgress', stage: 'filling' }).catch(() => {});

    // 30-second timeout via Promise.race — resolves with timedOut flag instead of rejecting
    const timeout = new Promise(r => setTimeout(() => r({ timedOut: true }), 30000));
    const fillMsg = new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { action: 'fillAndSubmit' }, response => {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message || '';
          reject(new Error(/no tab|closed|removed/i.test(msg) ? 'Signup cancelled.' : msg));
        } else {
          resolve(response);
        }
      });
    });

    const result = await Promise.race([fillMsg, timeout]);
    if (result?.timedOut) {
      return { error: 'Signup timed out — form may have been submitted. Check your email.', warn: true };
    }

    // Required fields still empty — keep tab open so user can fill manually
    if (result?.requiredUnfilled?.length > 0) {
      keepTabOpen = true;
      chrome.tabs.update(tabId, { active: true }).catch(() => {});
      return result;
    }

    // Confirmed or submitted — tab can close
    return result || { error: 'No response from page' };
  } catch (err) {
    return { error: err.message || 'Signup failed' };
  } finally {
    if (tabId !== undefined && !keepTabOpen) {
      try { await chrome.tabs.remove(tabId); }
      catch (e) { if (!/no tab with id/i.test(e.message)) throw e; }
    }
  }
}

// ── Badge ─────────────────────────────────────────────────────────────────
let badgeTimer = null;
function setBadge(count) {
  clearTimeout(badgeTimer);
  chrome.action.setBadgeText({ text: String(count) });
  chrome.action.setBadgeBackgroundColor({ color: '#C9A96E' });
  badgeTimer = setTimeout(() => chrome.action.setBadgeText({ text: '' }), 4000);
}

// ── Analytics save ─────────────────────────────────────────────────────────
async function saveFillAnalytics({ hostname, totalFields, filledFields, passBreakdown, apiCallsMade, durationMs }) {
  const { fillAnalytics = [] } = await chrome.storage.local.get('fillAnalytics');
  fillAnalytics.unshift({ ts: Date.now(), hostname, totalFields, filledFields, passBreakdown, apiCallsMade, durationMs });
  if (fillAnalytics.length > 100) fillAnalytics.length = 100;
  chrome.storage.local.set({ fillAnalytics });
}

// ── Message listener ───────────────────────────────────────────────────────
const ALLOWED_ACTIONS = new Set([
  'claudeFill', 'claudeVisionFill', 'setBadge', 'testApiKey', 'testReplicateKey',
  'quickSignup', 'fillProgress', 'signupProgress', 'saveFillAnalytics', 'generateEssayAnswer'
]);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!ALLOWED_ACTIONS.has(message.action)) return;
  if (sender.id !== chrome.runtime.id) return;

  if (message.action === 'claudeFill') {
    if (!sender.tab) { sendResponse({ error: 'Unauthorized' }); return; }
    if (!/^https?:\/\//.test(sender.tab.url || '')) { sendResponse({ error: 'Unauthorized' }); return; }
    const tabHostname = (() => { try { return new URL(sender.tab.url).hostname; } catch { return ''; } })();
    handleClaudeFill(message, tabHostname).then(sendResponse).catch(err => sendResponse({ error: err.message || 'Unknown error' }));
    return true;
  }
  if (message.action === 'claudeVisionFill') {
    if (!sender.tab) { sendResponse({ error: 'Unauthorized' }); return; }
    if (!/^https?:\/\//.test(sender.tab.url || '')) { sendResponse({ error: 'Unauthorized' }); return; }
    handleClaudeVisionFill({ ...message, windowId: sender.tab?.windowId }).then(sendResponse).catch(err => sendResponse({ error: err.message || 'Unknown error' }));
    return true;
  }
  if (message.action === 'setBadge') {
    setBadge(message.count);
    sendResponse({ ok: true });
  }
  if (message.action === 'testApiKey') {
    testApiKey(message.apiKey).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (message.action === 'testReplicateKey') {
    testReplicateKey(message.replicateApiKey).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (message.action === 'quickSignup') {
    handleQuickSignup(message.url).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (message.action === 'saveFillAnalytics') {
    saveFillAnalytics(message.data).catch(() => {});
    sendResponse({ ok: true });
  }
  if (message.action === 'generateEssayAnswer') {
    if (!sender.tab) { sendResponse({}); return; }
    handleGenerateEssayAnswer(message).then(sendResponse).catch(() => sendResponse({}));
    return true;
  }
});

// ── Keyboard shortcut handler (item 17) ────────────────────────────────────
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'trigger-fill') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const hostname = (() => { try { return new URL(tab.url).hostname.toLowerCase(); } catch { return ''; } })();
  const { blockedSites = [] } = await chrome.storage.local.get('blockedSites');
  if (blockedSites.some(d => hostname === d || hostname.endsWith('.' + d))) return;
  chrome.tabs.sendMessage(tab.id, { action: 'fill' }, result => {
    if (chrome.runtime.lastError) return;
    if (result?.filled > 0) {
      chrome.tabs.sendMessage(tab.id, { action: 'showPageToast', msg: `Fillr: ${result.filled} field${result.filled !== 1 ? 's' : ''} filled` });
      setBadge(result.filled);
    }
  });
});

// ── Context menu (item 21) ─────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'fillr-fill',
    title: 'Fill this form with Fillr',
    contexts: ['page', 'editable']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'fillr-fill' || !tab?.id) return;
  const hostname = (() => { try { return new URL(tab.url).hostname.toLowerCase(); } catch { return ''; } })();
  const { blockedSites = [] } = await chrome.storage.local.get('blockedSites');
  if (blockedSites.some(d => hostname === d || hostname.endsWith('.' + d))) return;
  chrome.tabs.sendMessage(tab.id, { action: 'fill' }, result => {
    if (chrome.runtime.lastError) return;
    if (result?.filled > 0) setBadge(result.filled);
  });
});

// ── Anthropic API key test ─────────────────────────────────────────────────
async function testApiKey(apiKey) {
  if (!apiKey) return { error: 'No API key provided' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') return { error: 'Request timed out' };
    return { error: `Network error: ${err.message}` };
  }
  clearTimeout(timer);
  if (response.ok) return { ok: true };
  let errorText;
  try { const j = await response.json(); errorText = j.error?.message || response.statusText; }
  catch { errorText = response.statusText; }
  return { error: errorText };
}

// ── Replicate API key test ─────────────────────────────────────────────────
async function testReplicateKey(apiKey) {
  if (!apiKey) return { error: 'No API key provided' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch('https://api.replicate.com/v1/models/meta/meta-llama-3.1-70b-instruct/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait=5'
      },
      body: JSON.stringify({ input: { prompt: 'Reply with: {}', system_prompt: 'Output only valid JSON.', max_new_tokens: 8, temperature: 0.1 } }),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') return { error: 'Request timed out' };
    return { error: `Network error: ${err.message}` };
  }
  clearTimeout(timer);
  if (response.status === 401) return { error: 'Invalid API key' };
  if (!response.ok) {
    let errorText;
    try { const j = await response.json(); errorText = j.detail || response.statusText; }
    catch { errorText = response.statusText; }
    return { error: `Replicate error ${response.status}: ${errorText}` };
  }
  // Key is valid even if prediction hasn't completed yet (status: "processing")
  return { ok: true };
}

// ── Essay answer generator (called from fillEmptyRequiredWithNA) ────────────
// Generates a compelling, contextual plain-text answer for an open-ended field.
async function handleGenerateEssayAnswer({ label, options, pageContext }) {
  const { apiKey, replicateApiKey, aiProvider, profiles, activeProfile } =
    await chrome.storage.local.get(['apiKey', 'replicateApiKey', 'aiProvider', 'profiles', 'activeProfile']);
  const provider = aiProvider || 'anthropic';
  // Only Anthropic supports plain-text responses reliably here
  const key = provider === 'replicate' ? replicateApiKey : apiKey;
  if (!key) return {};

  const profile = (profiles || {})[activeProfile || 'default'] || {};
  const { profileDesc, contextBlock } = buildProfileBlock(profile);
  const { title = '', url = '', headings = [] } = pageContext || {};

  const isSelect = options && options.length > 0;
  const optionsBlock = isSelect
    ? `\nThe field is a dropdown. You MUST reply with EXACTLY one of these options: ${options.map(o => JSON.stringify(o)).join(', ')}.`
    : '';

  const prompt = `You are helping someone sign up for an event or program. Write a response to the following form field on their behalf.

Field label: "${label}"${optionsBlock}

Event/page context:
- Title: ${title}
- URL: ${url}
${headings.length ? `- Headings: ${headings.join(' | ')}` : ''}

User profile:
${profileDesc}
${contextBlock}
Instructions:
- For open-ended questions ("What have you built?", "What do you plan to build?", "Why do you want to attend?", "Tell us about yourself"): write 2–4 compelling, specific, first-person sentences tailored to the event context and user profile. Sound like a real, ambitious person — be concrete and exciting.
- For "How did you hear about us?" or discovery fields: reply with a short natural phrase like "Twitter / X", "LinkedIn", "A friend", or "Online".
- For dropdown fields: reply with EXACTLY one option string from the list above — nothing else.
- Reply with ONLY the answer text. No JSON, no quotes, no preamble, no explanation.`;

  // Use Haiku for speed/cost — essay answers don't need Sonnet
  let response;
  let attempts = 0;
  while (attempts < 3) {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 300, messages: [{ role: 'user', content: prompt }] })
    });
    if (response.status === 429 || response.status === 529 || response.status >= 500) {
      const retryAfter = parseInt(response.headers.get('Retry-After') || '0', 10) * 1000;
      await new Promise(r => setTimeout(r, retryAfter > 0 ? retryAfter : 2000));
      attempts++; continue;
    }
    break;
  }
  if (!response.ok) return {};
  const data = await response.json();
  const answer = data.content?.[0]?.text?.trim() || null;
  return answer ? { answer } : {};
}

// ── Pass 3: Claude text fill ───────────────────────────────────────────────
async function handleClaudeFill({ fields, profile, pageContext }, hostname) {
  const { apiKey, replicateApiKey, aiProvider } = await chrome.storage.local.get(['apiKey', 'replicateApiKey', 'aiProvider']);
  const provider = aiProvider || 'anthropic';
  const key = provider === 'replicate' ? replicateApiKey : apiKey;
  if (!key) return { error: provider === 'replicate' ? 'No Replicate API key configured' : 'No API key configured' };

  const cached = getCached(fields, hostname);
  if (cached) return { mapping: cached };

  const { profileDesc, availableKeys, contextBlock } = buildProfileBlock(profile);
  const fieldDesc = buildFieldList(fields);
  const pageCtxBlock = buildPageContextBlock(pageContext);

  const prompt = `You are helping autofill a web form. Given the user's profile and page context, return a JSON object mapping each field's id (or name if no id) to the correct value.

User profile:
${profileDesc}
${contextBlock}${pageCtxBlock}
Form fields (unmatched so far):
${fieldDesc}

Profile keys available: ${availableKeys}

Rules:
- Use the field's "id" as the JSON key; if id is empty, use its "name".
- For simple profile fields (name, email, etc.): return the matching profile key (e.g. "firstName", "email").
- For open-ended questions (e.g. "What will you build?", "Why do you want to attend?", "Tell us about yourself"): read the page context and additional context to write a compelling, specific, first-person answer (2-4 sentences) that fits the user's profile. Return the answer text directly as the JSON value, not a profile key.
- For "How did you hear about us?" style fields: return a natural short answer like "Twitter / X" or "A friend referred me".
- For select/dropdown fields (type="select"): you MUST pick one of the provided options. Choose the best fit based on the user profile. If nothing matches perfectly, pick the most plausible option — never leave it blank.
- For "How did you hear about us?" or discovery fields: return "Twitter / X", "LinkedIn", "A friend", or similar natural answer.
- For checkbox fields (type="checkbox"): return "yes" to check it, or omit the field to leave it unchecked.
- For radio-group fields (type="radio-group"): return the EXACT option text or value of the radio button to select.
- For a "full name" field, use "fullName".
- Always return a value for every field provided — never skip a field. Return ONLY valid JSON, no markdown, no explanation.

Example output:
{"applicant_first": "firstName", "contact_email": "email", "is_founder": "Yes", "newsletter_opt_in": "yes", "funding_stage": "Pre-seed", "build_description": "I'm building an AI-powered form autofill extension that uses Claude to intelligently match and fill web forms, saving founders hours of repetitive application work."}`;

  const messages = [{ role: 'user', content: prompt }];
  const result = provider === 'replicate'
    ? await callReplicateAPI(key, messages)
    : await callAnthropicAPI(key, messages);
  if (result.mapping) setCache(fields, result.mapping, hostname);
  return result;
}

// ── Pass 4: Claude vision fill ─────────────────────────────────────────────
async function handleClaudeVisionFill({ fields, profile, pageContext, windowId }) {
  // Check if current provider supports vision
  const { aiProvider, apiKey } = await chrome.storage.local.get(['aiProvider', 'apiKey']);
  const provider = aiProvider || 'anthropic';
  if (!PROVIDER_CAPS[provider]?.supportsVision) {
    return { skipped: true, reason: `Vision pass skipped (${provider === 'replicate' ? 'Llama 3' : provider} does not support vision).` };
  }

  if (!apiKey) return { error: 'Vision fill requires an Anthropic API key' };

  let screenshotDataUrl;
  try {
    screenshotDataUrl = await chrome.tabs.captureVisibleTab(windowId ?? null, { format: 'jpeg', quality: 80 });
  } catch (err) {
    return { error: `Screenshot failed: ${err.message}` };
  }
  const urlMatch = screenshotDataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!urlMatch) return { error: 'Invalid screenshot data URL' };
  const [, screenshotMediaType, base64Image] = urlMatch;
  const { profileDesc, availableKeys, contextBlock } = buildProfileBlock(profile);
  const fieldDesc = buildFieldList(fields);
  const pageCtxBlock = buildPageContextBlock(pageContext);

  const prompt = `You are helping autofill a web form. I am sending you a screenshot of the current page along with a list of form fields that could not be matched automatically.

Look at the screenshot to understand what each field is asking for, then return a JSON mapping of each field to the correct value.

User profile:
${profileDesc}
${contextBlock}${pageCtxBlock}
Unmatched form fields:
${fieldDesc}

Profile keys available: ${availableKeys}

Rules:
- Use the screenshot and page context to visually identify what each field is asking.
- Use the field "id" as the JSON key; if id is empty, use "name".
- For simple profile fields (name, email, etc.): return the matching profile key.
- For open-ended questions: write a compelling, specific, first-person answer (2-4 sentences). Return the answer text directly.
- For select/dropdown fields (type="select"): return the EXACT option text.
- For checkbox fields (type="checkbox"): return "yes" to check it, or omit to leave unchecked.
- For radio-group fields (type="radio-group"): return the EXACT option text or value to select.
- For select/dropdown fields (type="select"): pick the best available option — never skip.
- Always return a value for every field. Return ONLY valid JSON, no markdown, no explanation.

Example: {"field_abc": "company", "field_xyz": "jobTitle", "is_founder": "Yes", "newsletter": "yes", "build_plan": "I'm building a developer tool that..."}`;

  return await callAnthropicAPI(apiKey, [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: screenshotMediaType, data: base64Image } },
      { type: 'text', text: prompt }
    ]
  }]);
}
