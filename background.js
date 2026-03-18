'use strict';

/**
 * Background service worker.
 * Handles Claude API calls on behalf of content.js (which cannot call
 * cross-origin APIs directly without host_permissions complications).
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'claudeFill') {
    handleClaudeFill(message).then(sendResponse).catch(err => {
      sendResponse({ error: err.message || 'Unknown error' });
    });
    return true;
  }

  if (message.action === 'claudeVisionFill') {
    handleClaudeVisionFill({ ...message, windowId: sender.tab?.windowId }).then(sendResponse).catch(err => {
      sendResponse({ error: err.message || 'Unknown error' });
    });
    return true;
  }

  if (message.action === 'setBadge') {
    chrome.action.setBadgeText({ text: String(message.count) });
    chrome.action.setBadgeBackgroundColor({ color: '#C9A96E' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 4000);
    sendResponse({ ok: true });
  }
});

// Keyboard shortcut: Ctrl+Shift+F / Cmd+Shift+F
chrome.commands.onCommand.addListener(command => {
  if (command === 'trigger-fill') {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: 'fill' });
    });
  }
});

async function handleClaudeFill({ fields, profile, pageContext }) {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (!apiKey) return { error: 'No API key configured' };

  // Only include non-empty profile fields for privacy
  const profileEntries = Object.entries(profile).filter(([, v]) => v);
  const profileDesc = profileEntries.map(([k, v]) => `${k}: "${v}"`).join('\n');
  const availableKeys = profileEntries.map(([k]) => k).join(', ');

  // Build field list for the prompt
  const fieldDesc = fields
    .map(f => {
      let line = `id="${f.id}" name="${f.name}" placeholder="${f.placeholder}" label="${f.label}" type="${f.type}"`;
      if (f.options && f.options.length) line += ` options=[${f.options.map(o => `"${o}"`).join(', ')}]`;
      return line;
    })
    .join('\n');

  // Build page context block
  let pageCtxBlock = '';
  if (pageContext) {
    const parts = [];
    if (pageContext.title) parts.push(`Page title: ${pageContext.title}`);
    if (pageContext.metaDesc) parts.push(`Description: ${pageContext.metaDesc}`);
    if (pageContext.headings?.length) parts.push(`Headings: ${pageContext.headings.join(' | ')}`);
    if (pageContext.nearbyText) parts.push(`Page text: ${pageContext.nearbyText}`);
    if (parts.length) pageCtxBlock = `\nPage context (use this to understand what the form is about):\n${parts.join('\n')}\n`;
  }

  const prompt = `You are helping autofill a web form. Given the user's profile and page context, return a JSON object mapping each field's id (or name if no id) to the correct value.

User profile:
${profileDesc}
${pageCtxBlock}
Form fields (unmatched so far):
${fieldDesc}

Profile keys available: ${availableKeys}

Rules:
- Use the field's "id" as the JSON key; if id is empty, use its "name".
- For simple profile fields (name, email, etc.): return the matching profile key (e.g. "firstName", "email").
- For open-ended questions (e.g. "What will you build?", "Why do you want to attend?", "Tell us about yourself"): read the page context to understand the event/company, then write a compelling, specific, first-person answer (2–4 sentences) that fits the user's profile. Return the answer text directly as the JSON value, not a profile key.
- For "How did you hear about us?" style fields: return a natural short answer like "Twitter / X" or "A friend referred me".
- For select/dropdown fields (type="select"): return the EXACT option text. Use the profile to infer — e.g. if asked "Are you a founder?" and jobTitle is "Founder", return "Yes" or "Founder" depending on options.
- For a "full name" field, use "fullName".
- Only include fields you are confident about. Return ONLY valid JSON, no markdown, no explanation.

Example output:
{"applicant_first": "firstName", "contact_email": "email", "is_founder": "Yes", "build_description": "I'm building an AI-powered form autofill extension that uses Claude to intelligently match and fill web forms, saving founders hours of repetitive application work."}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 30000);
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
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: controller.signal
    });
  } catch (err) {
    if (err.name === 'AbortError') return { error: 'Request timed out' };
    return { error: `Network error: ${err.message}` };
  } finally {
    clearTimeout(t);
  }

  if (!response.ok) {
    let errorText;
    try {
      const errJson = await response.json();
      errorText = errJson.error?.message || response.statusText;
    } catch {
      errorText = response.statusText;
    }
    return { error: `API error ${response.status}: ${errorText}` };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return { error: 'Failed to parse API response' };
  }

  const rawText = data?.content?.[0]?.text?.trim();
  if (!rawText) {
    return { error: 'Empty response from Claude' };
  }

  // Strip markdown code fences if present
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  let mapping;
  try {
    mapping = JSON.parse(cleaned);
  } catch {
    return { error: `Could not parse Claude response as JSON: ${rawText.slice(0, 100)}` };
  }

  return { mapping };
}

async function handleClaudeVisionFill({ fields, profile, pageContext, windowId }) {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (!apiKey) return { error: 'No API key configured' };

  // Take a screenshot of the visible tab
  let screenshotDataUrl;
  try {
    screenshotDataUrl = await chrome.tabs.captureVisibleTab(windowId ?? null, { format: 'jpeg', quality: 80 });
  } catch (err) {
    return { error: `Screenshot failed: ${err.message}` };
  }

  // Strip the data URL prefix to get raw base64
  const base64Image = screenshotDataUrl.replace(/^data:image\/jpeg;base64,/, '');

  // Only include non-empty profile fields for privacy
  const profileEntries = Object.entries(profile).filter(([, v]) => v);
  const profileDesc = profileEntries.map(([k, v]) => `${k}: "${v}"`).join('\n');
  const availableKeys = profileEntries.map(([k]) => k).join(', ');

  const fieldDesc = fields
    .map(f => {
      let line = `id="${f.id}" name="${f.name}" placeholder="${f.placeholder}" label="${f.label}" type="${f.type}"`;
      if (f.options && f.options.length) line += ` options=[${f.options.map(o => `"${o}"`).join(', ')}]`;
      return line;
    })
    .join('\n');

  // Build page context block
  let pageCtxBlock = '';
  if (pageContext) {
    const parts = [];
    if (pageContext.title) parts.push(`Page title: ${pageContext.title}`);
    if (pageContext.metaDesc) parts.push(`Description: ${pageContext.metaDesc}`);
    if (pageContext.headings?.length) parts.push(`Headings: ${pageContext.headings.join(' | ')}`);
    if (pageContext.nearbyText) parts.push(`Page text: ${pageContext.nearbyText}`);
    if (parts.length) pageCtxBlock = `\nPage context:\n${parts.join('\n')}\n`;
  }

  const prompt = `You are helping autofill a web form. I am sending you a screenshot of the current page along with a list of form fields that could not be matched automatically.

Look at the screenshot to understand what each field is asking for, then return a JSON mapping of each field to the correct value.

User profile:
${profileDesc}
${pageCtxBlock}
Unmatched form fields:
${fieldDesc}

Profile keys available: ${availableKeys}

Rules:
- Use the screenshot and page context to visually identify what each field is asking.
- Use the field "id" as the JSON key; if id is empty, use "name".
- For simple profile fields (name, email, etc.): return the matching profile key.
- For open-ended questions (e.g. "What will you build?", "Why do you want to attend?"): write a compelling, specific, first-person answer (2–4 sentences) that fits the user's profile and the event shown. Return the answer text directly.
- For select/dropdown fields (type="select"): return the EXACT option text. Use the screenshot and profile to infer — e.g. jobTitle "Founder" → "Yes" for "Are you a founder?".
- Only include fields you are confident about.
- Return ONLY valid JSON, no markdown, no explanation.

Example: {"field_abc": "company", "field_xyz": "jobTitle", "is_founder": "Yes", "build_plan": "I'm building a developer tool that..."}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 30000);
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
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: base64Image
              }
            },
            {
              type: 'text',
              text: prompt
            }
          ]
        }]
      }),
      signal: controller.signal
    });
  } catch (err) {
    if (err.name === 'AbortError') return { error: 'Request timed out' };
    return { error: `Network error: ${err.message}` };
  } finally {
    clearTimeout(t);
  }

  if (!response.ok) {
    let errorText;
    try {
      const errJson = await response.json();
      errorText = errJson.error?.message || response.statusText;
    } catch {
      errorText = response.statusText;
    }
    return { error: `API error ${response.status}: ${errorText}` };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return { error: 'Failed to parse API response' };
  }

  const rawText = data?.content?.[0]?.text?.trim();
  if (!rawText) return { error: 'Empty response from Claude' };

  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  let mapping;
  try {
    mapping = JSON.parse(cleaned);
  } catch {
    return { error: `Could not parse Claude response as JSON: ${rawText.slice(0, 100)}` };
  }

  return { mapping };
}
