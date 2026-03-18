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
});

async function handleClaudeFill({ fields, profile }) {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (!apiKey) return { error: 'No API key configured' };

  // Build a concise profile description for the prompt
  const profileDesc = Object.entries(profile)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: "${v}"`)
    .join('\n');

  // Build field list for the prompt
  const fieldDesc = fields
    .map(f => {
      let line = `id="${f.id}" name="${f.name}" placeholder="${f.placeholder}" label="${f.label}" type="${f.type}"`;
      if (f.options && f.options.length) line += ` options=[${f.options.map(o => `"${o}"`).join(', ')}]`;
      return line;
    })
    .join('\n');

  const prompt = `You are helping autofill a web form. Given the user's profile data and a list of form fields, return a JSON object mapping each field's id (or name if no id) to the correct value.

User profile:
${profileDesc}

Form fields (unmatched so far):
${fieldDesc}

Profile keys available: firstName, lastName, fullName, email, phone, address1, address2, city, state, zip, country, linkedin, github, website, bio, yearsExp, jobTitle, company

Rules:
- Use the field's "id" as the JSON key; if id is empty, use its "name".
- For regular text/input fields: the JSON value must be one of the profile keys listed above.
- For select/dropdown fields (type="select"): the JSON value must be the EXACT option text to select (e.g. "Yes", "No", "Full-time"). Use the profile data to infer the correct option — for example if the label asks "Are you a founder?" and the profile shows jobTitle "Founder", return "Yes".
- For a "full name" field, use "fullName".
- Only map a field if you are confident. Return ONLY valid JSON, no markdown, no explanation.

Example output:
{"applicant_first": "firstName", "applicant_last": "lastName", "contact_email": "email", "is_founder": "Yes"}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 30000);
  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
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

async function handleClaudeVisionFill({ fields, profile, windowId }) {
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

  const profileDesc = Object.entries(profile)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: "${v}"`)
    .join('\n');

  const fieldDesc = fields
    .map(f => {
      let line = `id="${f.id}" name="${f.name}" placeholder="${f.placeholder}" label="${f.label}" type="${f.type}"`;
      if (f.options && f.options.length) line += ` options=[${f.options.map(o => `"${o}"`).join(', ')}]`;
      return line;
    })
    .join('\n');

  const prompt = `You are helping autofill a web form. I am sending you a screenshot of the current page along with a list of form fields that could not be matched automatically.

Look at the screenshot to understand what each field is asking for, then return a JSON mapping of each field to the correct value.

User profile:
${profileDesc}

Unmatched form fields:
${fieldDesc}

Profile keys available: firstName, lastName, fullName, email, phone, address1, address2, city, state, zip, country, linkedin, github, website, bio, yearsExp, jobTitle, company

Rules:
- Use the screenshot to visually identify what each field is asking.
- Use the field "id" as the JSON key; if id is empty, use "name".
- For regular text/input fields: the JSON value must be one of the profile keys listed above.
- For select/dropdown fields (type="select"): the JSON value must be the EXACT option text to select (e.g. "Yes", "No", "Founder"). Use the screenshot and profile to infer the right option — e.g. if the question is "Are you a founder?" and profile shows jobTitle "Founder", return "Yes".
- Only include fields you are confident about.
- Return ONLY valid JSON, no markdown, no explanation.

Example: {"field_abc": "company", "field_xyz": "jobTitle", "is_founder": "Yes"}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 30000);
  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
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
