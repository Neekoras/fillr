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

// ── Haiku vs Sonnet routing patterns ─────────────────────────────────────
const STRUCTURED_FIELD_PATTERNS = /job\s*title|company|years?\s*(of\s*)?exp|linkedin|github|twitter|website|phone|zip|postal|country|state\b|city\b|address/i;
const GENERATIVE_FIELD_PATTERNS = /what\s+(are|is|have|did|will|would|do)\s+you|tell\s+us|why\s+(do|are|want|would|should)|describe\s+(your|yourself)|background|motivation|vision|goals?|plan\s*to|built|building|working\s+on|pitch|idea/i;

// ── Keep-alive alarm listener ──────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'fillr-keepalive') { /* no-op — keeps service worker alive */ }
});

// ── Service worker restart recovery ───────────────────────────────────────
async function checkInFlightSignup() {
  try {
    const data = await chrome.storage.session.get('quickSignupInFlight').catch(() => ({}));
    const state = data.quickSignupInFlight;
    if (!state) return;
    await chrome.storage.session.remove('quickSignupInFlight').catch(() => {});
    const elapsed = Date.now() - (state.startedAt || 0);
    if (elapsed > 35000) {
      if (state.tabId) chrome.tabs.remove(state.tabId).catch(() => {});
      return;
    }
    if (!state.tabId) return;
    chrome.tabs.get(state.tabId, tab => {
      if (chrome.runtime.lastError || !tab) return;
      chrome.tabs.sendMessage(state.tabId, { action: 'fillAndSubmit' }, () => {
        if (chrome.runtime.lastError) return;
        chrome.tabs.remove(state.tabId).catch(() => {});
      });
    });
  } catch {}
}

chrome.runtime.onStartup.addListener(checkInFlightSignup);

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

function buildFieldListCapped(fields) {
  return fields.slice(0, 30).map(f => {
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

// ── extractJSON — code block parsing first ────────────────────────────────
function extractJSON(rawText) {
  // Try JSON code block first (most reliable)
  const codeMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeMatch) {
    try { return JSON.parse(codeMatch[1]); } catch {}
  }
  // Try direct parse
  try { return JSON.parse(rawText.trim()); } catch {}
  // Fall back to brace-depth counting
  const start = rawText.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in response');
  let depth = 0, inString = false, escape = false;
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

// ── LRU cache (max 50 entries, 10 min TTL) ────────────────────────────────
class LRUMap {
  constructor(maxSize) { this.map = new Map(); this.maxSize = maxSize; }
  get(key) {
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key);
    this.map.delete(key); this.map.set(key, v); // move to end
    return v;
  }
  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.maxSize) this.map.delete(this.map.keys().next().value);
    this.map.set(key, value);
  }
  delete(key) { return this.map.delete(key); }
}

const fillCache = new LRUMap(50);
const CACHE_TTL = 10 * 60 * 1000;

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

// ── AI usage dashboard tracking ────────────────────────────────────────────
async function trackApiUsage({ pass, inputTokens, outputTokens, model }) {
  try {
    const data = await chrome.storage.session.get('aiUsage').catch(() => ({}));
    const aiUsage = data.aiUsage || { calls: {}, inputTokens: 0, outputTokens: 0, totalCost: 0, mostExpensive: null };
    if (pass) aiUsage.calls[pass] = (aiUsage.calls[pass] || 0) + 1;
    aiUsage.inputTokens += inputTokens || 0;
    aiUsage.outputTokens += outputTokens || 0;
    const PRICING = {
      'claude-sonnet-4-6': { input: 3 / 1e6, output: 15 / 1e6 },
      'claude-haiku-4-5-20251001': { input: 0.25 / 1e6, output: 1.25 / 1e6 }
    };
    const prices = PRICING[model] || PRICING['claude-sonnet-4-6'];
    aiUsage.totalCost = (aiUsage.totalCost || 0) + (inputTokens || 0) * prices.input + (outputTokens || 0) * prices.output;
    await chrome.storage.session.set({ aiUsage }).catch(() => {});
  } catch {}
}

// ── Anthropic API call with retry + exponential backoff ────────────────────
async function callAnthropicAPI(apiKey, messages, { system, model, maxTokens } = {}) {
  const delays = [0, 1000, 3000];
  let lastError = 'Request failed';
  const useModel = model || 'claude-sonnet-4-6';
  const useCaching = !!system;

  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) await new Promise(r => setTimeout(r, delays[attempt]));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    let response;

    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    };
    if (useCaching) headers['anthropic-beta'] = 'prompt-caching-2024-07-31';

    const bodyObj = { model: useModel, max_tokens: maxTokens || 512, messages };
    if (system) bodyObj.system = system;

    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers, body: JSON.stringify(bodyObj), signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') { lastError = 'Request timed out'; continue; }
      return { error: `Network error: ${err.message}` };
    }
    clearTimeout(timer);

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

    // Track usage for analytics
    if (data.usage) {
      trackApiUsage({ inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens, model: useModel }).catch(() => {});
    }

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

    await chrome.storage.session.set({ quickSignupInFlight: { tabId, url, startedAt: Date.now() } }).catch(() => {});

    chrome.alarms.create('fillr-keepalive', { periodInMinutes: 0.4 });

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
    chrome.alarms.clear('fillr-keepalive').catch(() => {});
    await chrome.storage.session.remove('quickSignupInFlight').catch(() => {});
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

// ── Prompt caching helpers ─────────────────────────────────────────────────
function buildCachedSystemBlock(profileDesc, contextBlock) {
  return [
    {
      type: 'text',
      text: `You are helping autofill a web form. Return a JSON object (or a JSON code block) mapping each field's id (or name if no id) to the correct value.\n\nUser profile:\n${profileDesc}\n${contextBlock}\n\nRules:\n- Use the field's "id" as the JSON key; if id is empty, use its "name".\n- For simple profile fields (name, email, etc.): return the matching profile key (e.g. "firstName", "email").\n- For open-ended questions (e.g. "What will you build?", "Why do you want to attend?", "Tell us about yourself"): write a compelling, specific, first-person answer (2-4 sentences) that fits the user profile. Return the answer text directly.\n- For "How did you hear about us?" style fields: return "Twitter / X", "LinkedIn", "A friend", or similar.\n- For select/dropdown fields (type="select"): pick one of the provided options. Never leave blank.\n- For checkbox fields (type="checkbox"): return "yes" to check it, or omit to leave unchecked.\n- For radio-group fields (type="radio-group"): return the EXACT option text or value.\n- For a "full name" field, use "fullName".\n- Always return a value for every field. Return ONLY valid JSON or a JSON code block, no prose.`,
      cache_control: { type: 'ephemeral' }
    }
  ];
}

function buildSonnetPrompt(fields, profileDesc, availableKeys, contextBlock, pageCtxBlock) {
  const fieldDesc = buildFieldListCapped(fields);
  return `${pageCtxBlock}Form fields (unmatched so far):\n${fieldDesc}\n\nProfile keys available: ${availableKeys}\n\nExample output:\n\`\`\`json\n{"applicant_first": "firstName", "contact_email": "email", "is_founder": "Yes", "build_description": "I'm building an AI-powered form autofill extension."}\n\`\`\``;
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
  const pageCtxBlock = buildPageContextBlock(pageContext);

  // Chunk large field lists (>30 fields) into sequential 30-field batches
  if (fields.length > 30 && provider !== 'replicate') {
    const chunks = [];
    for (let i = 0; i < fields.length; i += 30) chunks.push(fields.slice(i, i + 30));
    const allMappings = {};
    let batchError = null;
    for (const chunk of chunks) {
      const r = await handleClaudeFill({ fields: chunk, profile, pageContext }, hostname);
      if (r.mapping) Object.assign(allMappings, r.mapping);
      if (r.error) batchError = r.error;
    }
    if (Object.keys(allMappings).length > 0) return { mapping: allMappings };
    return batchError ? { error: batchError } : { mapping: {} };
  }

  if (provider === 'replicate') {
    // Replicate has one model — send all fields together
    const messages = [{ role: 'user', content: buildSonnetPrompt(fields, profileDesc, availableKeys, contextBlock, pageCtxBlock) }];
    const result = await callReplicateAPI(key, messages);
    if (result.mapping && !(result.mapping.error && Object.keys(result.mapping).length === 1)) setCache(fields, result.mapping, hostname);
    return result;
  }

  // Classify fields: structured → Haiku, generative → Sonnet, rest → Sonnet
  const structuredFields = fields.filter(f => STRUCTURED_FIELD_PATTERNS.test(f.label || f.name || ''));
  const generativeFields = fields.filter(f => !STRUCTURED_FIELD_PATTERNS.test(f.label || f.name || '') && GENERATIVE_FIELD_PATTERNS.test(f.label || f.name || ''));
  const restFields = fields.filter(f => !structuredFields.includes(f) && !generativeFields.includes(f));
  const sonnetFields = [...generativeFields, ...restFields];

  // Build prompts
  const buildPrompt = (subset) => buildSonnetPrompt(subset, profileDesc, availableKeys, contextBlock, pageCtxBlock);

  const calls = [];
  if (structuredFields.length > 0) {
    calls.push(
      callAnthropicAPI(key, [{ role: 'user', content: buildPrompt(structuredFields) }], {
        system: buildCachedSystemBlock(profileDesc, contextBlock),
        model: 'claude-haiku-4-5-20251001',
        maxTokens: 512
      }).then(r => { if (r.mapping) trackApiUsage({ pass: 'p3-haiku', model: 'claude-haiku-4-5-20251001' }).catch(() => {}); return r; })
    );
  }
  if (sonnetFields.length > 0) {
    calls.push(
      callAnthropicAPI(key, [{ role: 'user', content: buildPrompt(sonnetFields) }], {
        system: buildCachedSystemBlock(profileDesc, contextBlock),
        model: 'claude-sonnet-4-6',
        maxTokens: 512
      }).then(r => { if (r.mapping) trackApiUsage({ pass: 'p3-sonnet', model: 'claude-sonnet-4-6' }).catch(() => {}); return r; })
    );
  }

  const results = await Promise.all(calls);
  const merged = {};
  let hasError = null;
  for (const r of results) {
    if (r.mapping) Object.assign(merged, r.mapping);
    if (r.error) hasError = r.error;
  }
  if (Object.keys(merged).length > 0) {
    if (!(merged.error && Object.keys(merged).length === 1)) setCache(fields, merged, hostname);
    return { mapping: merged };
  }
  return hasError ? { error: hasError } : { mapping: {} };
}

// ── Vision screenshot downscale ────────────────────────────────────────────
async function downscaleScreenshot(dataUrl) {
  try {
    const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!match) return dataUrl;
    const byteStr = atob(match[2]);
    const bytes = new Uint8Array(byteStr.length);
    for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i);
    const blob = new Blob([bytes], { type: match[1] });
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(0.5, 1280 / bitmap.width);
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const outBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
    const reader = new FileReader();
    return await new Promise(resolve => {
      reader.onload = e => resolve(e.target.result);
      reader.readAsDataURL(outBlob);
    });
  } catch { return dataUrl; }
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

  screenshotDataUrl = await downscaleScreenshot(screenshotDataUrl);

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

// ── Essay answer generator ─────────────────────────────────────────────────
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

  const systemBlock = [
    {
      type: 'text',
      text: `You are helping someone sign up for an event or program. Write a response to a form field on their behalf.\n\nUser profile:\n${profileDesc}\n${contextBlock}\nInstructions:\n- For open-ended questions ("What have you built?", "What do you plan to build?", "Why do you want to attend?", "Tell us about yourself"): write 2–4 compelling, specific, first-person sentences tailored to the event context and user profile. Sound like a real, ambitious person — be concrete and exciting.\n- For "How did you hear about us?" or discovery fields: reply with a short natural phrase like "Twitter / X", "LinkedIn", "A friend", or "Online".\n- For dropdown fields: reply with EXACTLY one option string from the list — nothing else.\n- Reply with ONLY the answer text. No JSON, no quotes, no preamble, no explanation.`,
      cache_control: { type: 'ephemeral' }
    }
  ];

  const userContent = `Field label: "${label}"${optionsBlock}\n\nEvent/page context:\n- Title: ${title}\n- URL: ${url}${headings.length ? `\n- Headings: ${headings.join(' | ')}` : ''}`;

  // Use Haiku for speed/cost — essay answers don't need Sonnet
  let response;
  let attempts = 0;
  while (attempts < 3) {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: systemBlock,
        messages: [{ role: 'user', content: userContent }]
      })
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

// ── Handler timeout helper ─────────────────────────────────────────────────
function handlerTimeout(ms, action) {
  return new Promise((_, reject) => setTimeout(() => reject({ error: `Request timed out after ${ms/1000}s`, action }), ms));
}

// ── HANDLERS map ───────────────────────────────────────────────────────────
const HANDLERS = {
  claudeFill: (msg, sender, sendResponse) => {
    if (!sender.tab || !/^https?:\/\//.test(sender.tab.url || '')) { sendResponse({ error: 'Unauthorized' }); return false; }
    const tabHostname = (() => { try { return new URL(sender.tab.url).hostname; } catch { return ''; } })();
    Promise.race([handleClaudeFill(msg, tabHostname), handlerTimeout(45000, 'claudeFill')])
      .then(sendResponse).catch(err => sendResponse({ error: err.error || err.message || 'Unknown error' }));
    return true;
  },
  claudeVisionFill: (msg, sender, sendResponse) => {
    if (!sender.tab || !/^https?:\/\//.test(sender.tab.url || '')) { sendResponse({ error: 'Unauthorized' }); return false; }
    Promise.race([handleClaudeVisionFill({ ...msg, windowId: sender.tab?.windowId }), handlerTimeout(45000, 'claudeVisionFill')])
      .then(sendResponse).catch(err => sendResponse({ error: err.error || err.message || 'Unknown error' }));
    return true;
  },
  setBadge: (msg, sender, sendResponse) => { setBadge(msg.count); sendResponse({ ok: true }); return false; },
  testApiKey: (msg, sender, sendResponse) => {
    Promise.race([testApiKey(msg.apiKey), handlerTimeout(15000, 'testApiKey')])
      .then(sendResponse).catch(err => sendResponse({ error: err.error || err.message }));
    return true;
  },
  testReplicateKey: (msg, sender, sendResponse) => {
    Promise.race([testReplicateKey(msg.replicateApiKey), handlerTimeout(20000, 'testReplicateKey')])
      .then(sendResponse).catch(err => sendResponse({ error: err.error || err.message }));
    return true;
  },
  quickSignup: (msg, sender, sendResponse) => {
    Promise.race([handleQuickSignup(msg.url), handlerTimeout(45000, 'quickSignup')])
      .then(sendResponse).catch(err => sendResponse({ error: err.error || err.message || 'Signup failed' }));
    return true;
  },
  saveFillAnalytics: (msg, sender, sendResponse) => { saveFillAnalytics(msg.data).catch(() => {}); sendResponse({ ok: true }); return false; },
  generateEssayAnswer: (msg, sender, sendResponse) => {
    if (!sender.tab) { sendResponse({}); return false; }
    Promise.race([handleGenerateEssayAnswer(msg), handlerTimeout(30000, 'generateEssayAnswer')])
      .then(sendResponse).catch(() => sendResponse({}));
    return true;
  },
  getAiUsage: (msg, sender, sendResponse) => {
    chrome.storage.session.get('aiUsage').then(d => sendResponse(d.aiUsage || null)).catch(() => sendResponse(null));
    return true;
  },
  fillProgress: (msg, sender, sendResponse) => { sendResponse({ ok: true }); return false; },
  signupProgress: (msg, sender, sendResponse) => { sendResponse({ ok: true }); return false; },
  saveFormRecording: (msg, sender, sendResponse) => {
    chrome.storage.local.get('formRecordings', data => {
      const recordings = data.formRecordings || {};
      recordings[msg.hostname] = msg.recording;
      if (Object.keys(recordings).length > 50) {
        const oldest = Object.keys(recordings)[0];
        delete recordings[oldest];
      }
      chrome.storage.local.set({ formRecordings: recordings });
    });
    sendResponse({ ok: true });
    return false;
  },
};

const ALLOWED_ACTIONS = new Set(Object.keys(HANDLERS));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!ALLOWED_ACTIONS.has(message.action)) return false;
  if (sender.id !== chrome.runtime.id) return false;
  return HANDLERS[message.action](message, sender, sendResponse);
});

// ── Keyboard shortcut handler ──────────────────────────────────────────────
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

// ── Context menu ───────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  checkInFlightSignup();
  chrome.contextMenus.create({
    id: 'fillr-fill',
    title: 'Fill this form with Fillr',
    contexts: ['page', 'editable']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'fillr-fill' || !tab?.id) return;
  if (!/^https?:\/\//i.test(tab.url || '')) return;
  const hostname = (() => { try { return new URL(tab.url).hostname.toLowerCase(); } catch { return ''; } })();
  const { blockedSites = [] } = await chrome.storage.local.get('blockedSites');
  if (blockedSites.some(d => hostname === d || hostname.endsWith('.' + d))) return;
  chrome.tabs.sendMessage(tab.id, { action: 'fill' }, result => {
    if (chrome.runtime.lastError) return;
    if (result?.filled > 0) setBadge(result.filled);
  });
});
