// ---------- activity.js ----------
// Local-only keystroke/mouse activity tracking.
//
// Privacy design, on purpose:
//   - We NEVER store which key was pressed, only that a key event happened.
//   - We NEVER persist raw mouse coordinates, only movement distance deltas.
//   - Nothing here leaves the machine. This module has no network calls.
//   - Everything is kept in memory as per-minute counters, rolled up into
//     small aggregate summaries. Raw event timestamps are discarded once
//     they've been folded into a bucket.
//
// This is intentionally a *rate* signal (how much input is happening),
// not a *content* signal (what was typed or clicked). That's the line that
// keeps this "activity tracking" instead of "keylogging."

const { uIOhook, UiohookKey } = require('uiohook-napi');

const BUCKET_MS = 60 * 1000;      // one bucket per minute
const MAX_BUCKETS = 180;          // keep 3 hours of history in memory
const MOUSE_SAMPLE_MS = 200;      // throttle mousemove sampling

let running = false;
let buckets = [];                 // [{ startedAt, keystrokes, clicks, moveEvents, moveDistance }]
let lastMousePos = null;
let lastMouseSampleAt = 0;
let rolloverTimer = null;

function currentBucket() {
  const now = Date.now();
  let b = buckets[buckets.length - 1];
  if (!b || now - b.startedAt >= BUCKET_MS) {
    b = { startedAt: now, keystrokes: 0, clicks: 0, moveEvents: 0, moveDistance: 0 };
    buckets.push(b);
    if (buckets.length > MAX_BUCKETS) buckets.shift();
  }
  return b;
}

function onKeyDown() {
  // Deliberately not reading e.keycode into anything persistent.
  currentBucket().keystrokes += 1;
}

function onMouseDown() {
  currentBucket().clicks += 1;
}

function onMouseMove(e) {
  const now = Date.now();
  if (now - lastMouseSampleAt < MOUSE_SAMPLE_MS) return; // throttle: uiohook fires very often
  lastMouseSampleAt = now;
  const b = currentBucket();
  b.moveEvents += 1;
  if (lastMousePos) {
    const dx = e.x - lastMousePos.x;
    const dy = e.y - lastMousePos.y;
    b.moveDistance += Math.sqrt(dx * dx + dy * dy);
  }
  lastMousePos = { x: e.x, y: e.y }; // kept only for the next delta, never persisted
}

function start() {
  if (running) return true;
  try {
    uIOhook.on('keydown', onKeyDown);
    uIOhook.on('mousedown', onMouseDown);
    uIOhook.on('mousemove', onMouseMove);
    uIOhook.start();
    running = true;
    if (!rolloverTimer) {
      rolloverTimer = setInterval(currentBucket, BUCKET_MS); // guarantees empty buckets for idle minutes too
    }
    return true;
  } catch (e) {
    console.error('Tempo activity tracking failed to start:', e.message);
    running = false;
    return false;
  }
}

function stop() {
  if (!running) return;
  try {
    uIOhook.off('keydown', onKeyDown);
    uIOhook.off('mousedown', onMouseDown);
    uIOhook.off('mousemove', onMouseMove);
    uIOhook.stop();
  } catch (e) { /* already stopped */ }
  running = false;
  lastMousePos = null;
}

function isRunning() { return running; }

// Clears history without stopping the hook (used when tracking is disabled
// via settings, so a re-enable doesn't resurrect old data).
function reset() {
  buckets = [];
  lastMousePos = null;
}

// Live snapshot for a small "activity" indicator in the Now Bar/dashboard.
// windowMs defaults to the last 2 minutes.
function getLiveLevel(windowMs = 2 * 60 * 1000) {
  const cutoff = Date.now() - windowMs;
  const recent = buckets.filter(b => b.startedAt >= cutoff);
  const keystrokes = recent.reduce((s, b) => s + b.keystrokes, 0);
  const clicks = recent.reduce((s, b) => s + b.clicks, 0);
  const moveEvents = recent.reduce((s, b) => s + b.moveEvents, 0);
  // Rough 0-100 "how much input activity" score. Not a productivity judgment
  // by itself — just raw input rate, meant to be combined with idle time and
  // window-relevance in the higher-level focus score.
  const raw = keystrokes * 2 + clicks * 3 + moveEvents;
  const level = Math.max(0, Math.min(100, Math.round((raw / 40) * 100)));
  return { level, keystrokes, clicks, moveEvents };
}

// Aggregate summary for a finished focus session — this is what's safe to
// persist to disk (counts only, no raw input, no coordinates).
function getSummarySince(startedAtMs) {
  const relevant = buckets.filter(b => b.startedAt >= startedAtMs);
  if (relevant.length === 0) {
    return { activeMinutes: 0, totalMinutes: 0, keystrokes: 0, clicks: 0, moveDistance: 0, activityScore: null };
  }
  const activeMinutes = relevant.filter(b => b.keystrokes + b.clicks + b.moveEvents > 0).length;
  const totalMinutes = relevant.length;
  const keystrokes = relevant.reduce((s, b) => s + b.keystrokes, 0);
  const clicks = relevant.reduce((s, b) => s + b.clicks, 0);
  const moveDistance = Math.round(relevant.reduce((s, b) => s + b.moveDistance, 0));
  const activityScore = totalMinutes > 0 ? Math.round((activeMinutes / totalMinutes) * 100) : null;
  return { activeMinutes, totalMinutes, keystrokes, clicks, moveDistance, activityScore };
}

module.exports = { start, stop, isRunning, reset, getLiveLevel, getSummarySince };
