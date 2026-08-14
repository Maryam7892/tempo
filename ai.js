// Calls the user's chosen AI provider directly (this is a standalone desktop
// app, not running inside claude.ai, so it needs the user's own API key).
// Every function has a local, non-AI fallback so the app still works with no key set.
//
// cfg is { provider: 'anthropic' | 'groq', apiKey: string }

const FALLBACK_SUBTASKS = ['Just start', 'Push it forward', 'Close the loop'];
const GROQ_MODEL = 'llama-3.3-70b-versatile';

async function callAI(cfg, userMessage, maxTokens) {
  if (cfg.provider === 'groq') {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.apiKey
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: userMessage }]
      })
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error('Groq API error ' + res.status + ': ' + errText);
    }
    const data = await res.json();
    return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  }

  // default: Anthropic
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: userMessage }]
    })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error('Anthropic API error ' + res.status + ': ' + errText);
  }
  const data = await res.json();
  return (data.content || []).map(b => b.text || '').join('');
}

function hasKey(cfg) { return cfg && cfg.apiKey; }

async function breakdownTask(cfg, title) {
  if (!hasKey(cfg)) return { subtasks: FALLBACK_SUBTASKS, usedFallback: true };
  try {
    const txt = await callAI(
      cfg,
      'Break this task into 3-4 concrete, small subtasks. Task: "' + title + '". ' +
      'Respond with ONLY a JSON array of short strings, no markdown, no preamble.',
      300
    );
    const clean = txt.replace(/```json|```/g, '').trim();
    const arr = JSON.parse(clean);
    if (Array.isArray(arr) && arr.length) return { subtasks: arr.slice(0, 5), usedFallback: false };
    return { subtasks: FALLBACK_SUBTASKS, usedFallback: true };
  } catch (e) {
    return { subtasks: FALLBACK_SUBTASKS, usedFallback: true, error: e.message };
  }
}

async function weeklyHype(cfg, stats) {
  const fallback = {
    title: 'Look how far this came.',
    line: 'That is, in fact, the whole game. Keep the pace going next week.'
  };
  if (!hasKey(cfg)) return { ...fallback, usedFallback: true };
  try {
    const txt = await callAI(
      cfg,
      'Write a short, genuinely encouraging (not cheesy, a bit deadpan-cool and quietly confident — like someone ' +
      'proud of the distance covered, not hyping themselves up) weekly recap for an app called Tempo. ' +
      'Stats: attempted ' + stats.attempted + ' tasks, finished ' + stats.completed +
      ', showed up ' + stats.daysShownUp + ' days this week. ' +
      'Respond with ONLY JSON: {"title":"...","line":"..."}. Title under 6 words. Line under 28 words. ' +
      'Credit effort and showing up, not just finishing everything. No emoji.',
      200
    );
    const clean = txt.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return {
      title: parsed.title || fallback.title,
      line: parsed.line || fallback.line,
      usedFallback: false
    };
  } catch (e) {
    return { ...fallback, usedFallback: true, error: e.message };
  }
}

// Parses a free-text task description ("finish slides by friday 6pm") into
// structured fields. Falls back to a no-deadline task with the raw text as
// the title if there's no key or parsing fails — never blocks task creation.
async function quickAdd(cfg, text, nowIso) {
  const fallback = { title: text, deadline: null, estMinutes: 60, usedFallback: true };
  if (!hasKey(cfg)) return fallback;
  try {
    const now = nowIso || new Date().toISOString();
    const txt = await callAI(
      cfg,
      'The current date/time is ' + now + '. Parse this task description into structured fields: "' + text + '". ' +
      'Respond with ONLY JSON: {"title":"short clean task title, no date words in it","deadline":"ISO 8601 datetime or null if none mentioned","estMinutes": a reasonable number of minutes for this kind of task}. ' +
      'If a relative date like "tomorrow" or "friday" is mentioned, resolve it against the current date/time given above. Respond with ONLY the JSON object, nothing else.',
      250
    );
    const clean = txt.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return {
      title: parsed.title || text,
      deadline: parsed.deadline || null,
      estMinutes: parsed.estMinutes || 60,
      usedFallback: false
    };
  } catch (e) {
    return { ...fallback, error: e.message };
  }
}

// End-of-day reflection. Falls back to a plain, still-kind summary with no key.
async function dailyReport(cfg, stats) {
  const fallback = {
    title: 'Day logged.',
    line: 'You finished ' + stats.completed + ' and put in ' + stats.focusMinutes + ' focused minutes. That counts.'
  };
  if (!hasKey(cfg)) return { ...fallback, usedFallback: true };
  try {
    const txt = await callAI(
      cfg,
      'Write a short, honest, warm (not cheesy) end-of-day reflection for a productivity app called Tempo. ' +
      'Stats: completed ' + stats.completed + ' tasks, ' + stats.focusMinutes + ' focused minutes, ' +
      stats.interruptions + ' interruptions, ' + stats.switches + ' task switches, longest uninterrupted stretch ' +
      stats.longestMinutes + ' minutes, momentum score ' + stats.momentum + '/100. ' +
      'Respond with ONLY JSON: {"title":"...","line":"..."}. Title under 6 words. Line under 32 words. ' +
      'Be specific to the numbers, not generic. No emoji.',
      220
    );
    const clean = txt.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return { title: parsed.title || fallback.title, line: parsed.line || fallback.line, usedFallback: false };
  } catch (e) {
    return { ...fallback, usedFallback: true, error: e.message };
  }
}

module.exports = { breakdownTask, weeklyHype, quickAdd, dailyReport };
