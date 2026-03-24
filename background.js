'use strict';

/**
 * Background service worker.
 * Handles Claude API calls, badge management, and keyboard shortcut.
 */

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

function buildAnswerLibraryBlock(library) {
  if (!library || library.length === 0) return '';
  const lines = library.map(({ question, answer }) => `Q: ${question}\nA: ${answer}`).join('\n\n');
  return `\nThe user has pre-written answers for common questions. If a field closely matches one of these, use the exact pre-written answer verbatim:\n${lines}\n`;
}

// Robustly extract the first JSON object from Claude's response text,
// immune to markdown fences, extra prose, or trailing whitespace.
function extractJSON(rawText) {
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('No JSON object found in response');
  return JSON.parse(rawText.slice(start, end + 1));
}

// ── Form fingerprint cache (skip Claude for repeat fills) ─────────────────
const fillCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function fingerprint(fields, hostname) {
  return (hostname || '') + ':' + fields.map(f => `${f.id}|${f.name}|${f.type}`).sort().join(',');
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

// ── Anthropic API call with retry + exponential backoff ────────────────────
// Retries on 429 (rate limit) and 5xx (server error). Fails immediately on 4xx.
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
          // Required for direct browser-to-API calls from an MV3 service worker
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

    // Retryable: rate limit or server error
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = parseInt(response.headers.get('retry-after') || '0', 10) * 1000;
      if (retryAfter > 0 && attempt + 1 < delays.length) delays[attempt + 1] = retryAfter;
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
// Poll until content.js is alive in the tab (it's injected at document_idle,
// so we retry until the ping succeeds rather than relying on onUpdated).
function waitForContentScript(tabId, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    function attempt() {
      if (Date.now() > deadline) { reject(new Error('Page took too long to load')); return; }
      chrome.tabs.sendMessage(tabId, { action: 'ping' }, response => {
        if (!chrome.runtime.lastError && response && response.ok) { resolve(); return; }
        setTimeout(attempt, 600);
      });
    }
    attempt();
  });
}

async function handleQuickSignup(url) {
  let tabId;
  try {
    // Validate URL
    new URL(url);
  } catch {
    return { error: 'Invalid URL' };
  }

  try {
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id;

    // Notify popup of progress
    chrome.runtime.sendMessage({ action: 'signupProgress', stage: 'loading' }).catch(() => {});

    await waitForContentScript(tabId);

    chrome.runtime.sendMessage({ action: 'signupProgress', stage: 'filling' }).catch(() => {});

    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Signup timed out')), 30000);
      chrome.tabs.sendMessage(tabId, { action: 'fillAndSubmit' }, response => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(response);
      });
    });

    return result || { success: false, error: 'No response from page' };
  } catch (err) {
    return { error: err.message };
  } finally {
    if (tabId) chrome.tabs.remove(tabId).catch(() => {});
  }
}

// ── Badge (debounced — prevents stacking on rapid fills) ──────────────────
let badgeTimer = null;
function setBadge(count) {
  clearTimeout(badgeTimer);
  chrome.action.setBadgeText({ text: String(count) });
  chrome.action.setBadgeBackgroundColor({ color: '#C9A96E' });
  badgeTimer = setTimeout(() => chrome.action.setBadgeText({ text: '' }), 4000);
}

// ── Message listener ───────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only accept messages from this extension's own pages/content scripts
  if (sender.id !== chrome.runtime.id) return;

  if (message.action === 'claudeFill') {
    // Must originate from a tab (content script), not an extension page
    if (!sender.tab) { sendResponse({ error: 'Unauthorized' }); return; }
    const tabHostname = (() => { try { return new URL(sender.tab.url).hostname; } catch { return ''; } })();
    handleClaudeFill(message, tabHostname).then(sendResponse).catch(err => sendResponse({ error: err.message || 'Unknown error' }));
    return true;
  }
  if (message.action === 'claudeVisionFill') {
    if (!sender.tab) { sendResponse({ error: 'Unauthorized' }); return; }
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
  if (message.action === 'quickSignup') {
    handleQuickSignup(message.url).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

// ── Keyboard shortcut: Ctrl+Shift+F / Cmd+Shift+F ─────────────────────────
chrome.commands.onCommand.addListener(command => {
  if (command !== 'trigger-fill') return;
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { action: 'fill' }, () => {
      if (!chrome.runtime.lastError) return;
      // Content script not yet injected — inject it first, then retry
      chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, files: ['content.js'] }, () => {
        if (chrome.runtime.lastError) return;
        chrome.tabs.sendMessage(tabs[0].id, { action: 'fill' });
      });
    });
  });
});

// ── API key test ───────────────────────────────────────────────────────────
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

// ── Pass 3: Claude text fill ───────────────────────────────────────────────
async function handleClaudeFill({ fields, profile, pageContext }, hostname) {
  const { apiKey, answerLibrary } = await chrome.storage.local.get(['apiKey', 'answerLibrary']);
  if (!apiKey) return { error: 'No API key configured' };

  const cached = getCached(fields, hostname);
  if (cached) return { mapping: cached };

  const { profileDesc, availableKeys, contextBlock } = buildProfileBlock(profile);
  const fieldDesc = buildFieldList(fields);
  const pageCtxBlock = buildPageContextBlock(pageContext);
  const libraryBlock = buildAnswerLibraryBlock(answerLibrary);

  const prompt = `You are helping autofill a web form. Given the user's profile and page context, return a JSON object mapping each field's id (or name if no id) to the correct value.

User profile:
${profileDesc}
${contextBlock}${pageCtxBlock}${libraryBlock}
Form fields (unmatched so far):
${fieldDesc}

Profile keys available: ${availableKeys}

Rules:
- Use the field's "id" as the JSON key; if id is empty, use its "name".
- For simple profile fields (name, email, etc.): return the matching profile key (e.g. "firstName", "email").
- For open-ended questions (e.g. "What will you build?", "Why do you want to attend?", "Tell us about yourself"): read the page context and additional context to write a compelling, specific, first-person answer (2–4 sentences) that fits the user's profile. Return the answer text directly as the JSON value, not a profile key.
- For "How did you hear about us?" style fields: return a natural short answer like "Twitter / X" or "A friend referred me".
- For select/dropdown fields (type="select"): return the EXACT option text. Use the profile to infer — e.g. if asked "Are you a founder?" and jobTitle is "Founder", return "Yes" or "Founder" depending on options.
- For checkbox fields (type="checkbox"): return "yes" to check it, or omit the field to leave it unchecked.
- For radio-group fields (type="radio-group"): return the EXACT option text or value of the radio button to select.
- For a "full name" field, use "fullName".
- Only include fields you are confident about. Return ONLY valid JSON, no markdown, no explanation.

Example output:
{"applicant_first": "firstName", "contact_email": "email", "is_founder": "Yes", "newsletter_opt_in": "yes", "funding_stage": "Pre-seed", "build_description": "I'm building an AI-powered form autofill extension that uses Claude to intelligently match and fill web forms, saving founders hours of repetitive application work."}`;

  const result = await callAnthropicAPI(apiKey, [{ role: 'user', content: prompt }]);
  if (result.mapping) setCache(fields, result.mapping, hostname);
  return result;
}

// ── Pass 4: Claude vision fill ─────────────────────────────────────────────
async function handleClaudeVisionFill({ fields, profile, pageContext, windowId }) {
  const { apiKey, answerLibrary } = await chrome.storage.local.get(['apiKey', 'answerLibrary']);
  if (!apiKey) return { error: 'No API key configured' };

  let screenshotDataUrl;
  try {
    screenshotDataUrl = await chrome.tabs.captureVisibleTab(windowId ?? null, { format: 'jpeg', quality: 80 });
  } catch (err) {
    return { error: `Screenshot failed: ${err.message}` };
  }
  const base64Image = screenshotDataUrl.replace(/^data:image\/jpeg;base64,/, '');
  const { profileDesc, availableKeys, contextBlock } = buildProfileBlock(profile);
  const fieldDesc = buildFieldList(fields);
  const pageCtxBlock = buildPageContextBlock(pageContext);
  const libraryBlock = buildAnswerLibraryBlock(answerLibrary);

  const prompt = `You are helping autofill a web form. I am sending you a screenshot of the current page along with a list of form fields that could not be matched automatically.

Look at the screenshot to understand what each field is asking for, then return a JSON mapping of each field to the correct value.

User profile:
${profileDesc}
${contextBlock}${pageCtxBlock}${libraryBlock}
Unmatched form fields:
${fieldDesc}

Profile keys available: ${availableKeys}

Rules:
- Use the screenshot and page context to visually identify what each field is asking.
- Use the field "id" as the JSON key; if id is empty, use "name".
- For simple profile fields (name, email, etc.): return the matching profile key.
- For open-ended questions (e.g. "What will you build?", "Why do you want to attend?"): read the additional context and write a compelling, specific, first-person answer (2–4 sentences) that fits the user's profile. Return the answer text directly.
- For select/dropdown fields (type="select"): return the EXACT option text. Use the screenshot and profile to infer.
- For checkbox fields (type="checkbox"): return "yes" to check it, or omit to leave unchecked.
- For radio-group fields (type="radio-group"): return the EXACT option text or value to select.
- Only include fields you are confident about.
- Return ONLY valid JSON, no markdown, no explanation.

Example: {"field_abc": "company", "field_xyz": "jobTitle", "is_founder": "Yes", "newsletter": "yes", "build_plan": "I'm building a developer tool that..."}`;

  return await callAnthropicAPI(apiKey, [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Image } },
      { type: 'text', text: prompt }
    ]
  }]);
}
