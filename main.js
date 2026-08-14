const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, screen, globalShortcut, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const Store = require('./store');
const { sendNtfy } = require('./ntfy');
const { breakdownTask, weeklyHype, quickAdd, dailyReport } = require('./ai');
const activity = require('./activity');

let store;
let tray = null;
let dashboardWin = null;
let nowBarWin = null;
const stickyWindows = new Map(); // id -> BrowserWindow

// Ambient nudge lines — original copy, tone: confident, present-tense, a little
// playful about "building the stack." Not tied to any specific event; these are
// the occasional check-ins, not the deadline/session alerts (those have their
// own copy further down).
const HYPE_LINES = [
  "You're here. That's the move.",
  "Stop hesitating — pick the next one.",
  "Look how far this streak's come.",
  "One task, +1 to the stack.",
  "Present, focused, doing the thing.",
  "Small rep now, bigger total later.",
  "Still building. Still on beat.",
  "Nobody's watching the first draft. Just move."
];

const IDLE_THRESHOLD_SECONDS = 180; // 3 minutes of no input = away
const HOSTS_MARK_START = '# TEMPO-FOCUS-BLOCK-START';
const HOSTS_MARK_END = '# TEMPO-FOCUS-BLOCK-END';
const DEFAULT_BLOCKLIST = ['youtube.com', 'www.youtube.com', 'instagram.com', 'www.instagram.com',
  'facebook.com', 'www.facebook.com', 'twitter.com', 'x.com', 'reddit.com', 'www.reddit.com',
  'tiktok.com', 'www.tiktok.com', 'netflix.com', 'www.netflix.com'];

function todayStr() { return new Date().toISOString().slice(0, 10); }

// ---------- session state (in-memory, mirrored to disk so it survives a restart) ----------
let currentSession = null; // { taskId, taskTitle, startedAt, paused, pausedAt, accumulatedMs, interrupted, autoPausedByIdle }

function persistSession() {
  store.set('currentSession', currentSession);
}

function broadcastSession() {
  const payload = { currentSession, sessions: store.get('sessions') || [] };
  if (dashboardWin && !dashboardWin.isDestroyed()) dashboardWin.webContents.send('session:update', payload);
  if (nowBarWin && !nowBarWin.isDestroyed()) nowBarWin.webContents.send('session:update', payload);
}

function elapsedMs(session) {
  if (!session) return 0;
  if (session.paused) return session.accumulatedMs;
  return session.accumulatedMs + (Date.now() - session.lastResumeAt);
}

function finishCurrentSession(status) {
  if (!currentSession) return;
  const sessions = store.get('sessions') || [];
  const settings = store.get('settings') || {};
  const activitySummary = settings.activityTracking
    ? activity.getSummarySince(new Date(currentSession.startedAt).getTime())
    : null;
  sessions.push({
    id: 'sess_' + Date.now().toString(36),
    taskId: currentSession.taskId,
    taskTitle: currentSession.taskTitle,
    start: currentSession.startedAt,
    end: new Date().toISOString(),
    durationMs: elapsedMs(currentSession),
    interrupted: !!currentSession.interrupted,
    status: status || 'stopped',
    activity: activitySummary // { activeMinutes, totalMinutes, keystrokes, clicks, moveDistance, activityScore } or null
  });
  store.set('sessions', sessions);
  currentSession = null;
  persistSession();
}

function startSession(taskId, taskTitle) {
  if (currentSession) finishCurrentSession('switch');
  currentSession = {
    taskId, taskTitle,
    startedAt: new Date().toISOString(),
    paused: false,
    pausedAt: null,
    accumulatedMs: 0,
    lastResumeAt: Date.now(),
    interrupted: false,
    autoPausedByIdle: false
  };
  store.set('lastActivity', { taskId, taskTitle, at: new Date().toISOString() });
  persistSession();
  broadcastSession();
}

// Guards against a dangling session pointing at a task that no longer exists
// on the board (e.g. it was deleted while a session was running through some
// path that didn't go through the normal stop flow). Without this the Now Bar
// can keep showing a ticking timer for a task that's gone.
function pruneStaleSession() {
  if (!currentSession) return;
  const tasks = store.get('tasks') || [];
  const stillOnBoard = tasks.some(t => t.id === currentSession.taskId);
  if (!stillOnBoard) {
    currentSession = null;
    persistSession();
    broadcastSession();
  }
}

function pauseSession() {
  if (!currentSession || currentSession.paused) return;
  currentSession.accumulatedMs = elapsedMs(currentSession);
  currentSession.paused = true;
  currentSession.pausedAt = new Date().toISOString();
  persistSession();
  broadcastSession();
}

function resumeSession() {
  if (!currentSession || !currentSession.paused) return;
  currentSession.paused = false;
  currentSession.autoPausedByIdle = false;
  currentSession.lastResumeAt = Date.now();
  persistSession();
  broadcastSession();
}

function stopSession(status) {
  finishCurrentSession(status);
  broadcastSession();
}

// ---------- activity tracking (local-only keystroke/mouse rate) ----------
function applyActivityTrackingSetting() {
  const settings = store.get('settings') || {};
  if (settings.activityTracking) {
    activity.start();
  } else {
    activity.stop();
    activity.reset();
  }
}

// ---------- idle detection (auto-pause + interruption counting) ----------
function startIdleWatch() {
  setInterval(() => {
    if (!currentSession || currentSession.paused) return;
    let idleSecs = 0;
    try { idleSecs = powerMonitor.getSystemIdleTime(); } catch (e) { return; }
    if (idleSecs >= IDLE_THRESHOLD_SECONDS && !currentSession.autoPausedByIdle) {
      currentSession.interrupted = true;
      currentSession.autoPausedByIdle = true;
      currentSession.accumulatedMs = elapsedMs({ ...currentSession, paused: false });
      currentSession.paused = true;
      currentSession.pausedAt = new Date().toISOString();
      persistSession();
      broadcastSession();
      fireReminder('Tempo paused it', 'Stepped away from "' + currentSession.taskTitle + '"? Saved right where you left it.');
    } else if (idleSecs < 5 && currentSession.autoPausedByIdle) {
      fireReminder('Welcome back', 'Resume "' + currentSession.taskTitle + '"? You already put in the work — keep it going.');
      currentSession.autoPausedByIdle = false; // only fire once per idle period
      persistSession();
    }
  }, 20 * 1000);
}

// ---------- dashboard window ----------
function createDashboard() {
  if (dashboardWin && !dashboardWin.isDestroyed()) { dashboardWin.show(); dashboardWin.focus(); return; }
  dashboardWin = new BrowserWindow({
    width: 1160,
    height: 820,
    backgroundColor: '#0E0E13',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload-dashboard.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  dashboardWin.loadFile(path.join(__dirname, 'renderer', 'dashboard.html'));
  dashboardWin.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault();
      dashboardWin.hide();
    }
  });
}

// ---------- Now Bar (always-visible current-task overlay) ----------
function createNowBar() {
  if (nowBarWin && !nowBarWin.isDestroyed()) return;
  const display = screen.getPrimaryDisplay();
  const { width } = display.workAreaSize;
  const w = 340, h = 92;
  nowBarWin = new BrowserWindow({
    width: w,
    height: h,
    x: width - w - 24,
    y: 24,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload-nowbar.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  nowBarWin.setAlwaysOnTop(true, 'floating');
  try { nowBarWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (e) {}
  nowBarWin.loadFile(path.join(__dirname, 'renderer', 'nowbar.html'));
  nowBarWin.on('closed', () => { nowBarWin = null; });
}

function toggleNowBar() {
  if (nowBarWin && !nowBarWin.isDestroyed()) { nowBarWin.close(); return false; }
  createNowBar();
  return true;
}

// ---------- sticky note windows ----------
function createStickyWindow(note) {
  const win = new BrowserWindow({
    width: 320,
    height: 360,
    x: note.x != null ? note.x : Math.round(60 + Math.random() * 200),
    y: note.y != null ? note.y : Math.round(80 + Math.random() * 160),
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload-sticky.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setAlwaysOnTop(true, 'floating');
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (e) {}
  win.loadFile(path.join(__dirname, 'renderer', 'sticky.html'), { query: { id: note.id } });

  win.on('moved', () => {
    const [x, y] = win.getPosition();
    const stickies = store.get('stickies') || [];
    const idx = stickies.findIndex(s => s.id === note.id);
    if (idx >= 0) { stickies[idx].x = x; stickies[idx].y = y; store.set('stickies', stickies); }
  });

  stickyWindows.set(note.id, win);
  win.on('closed', () => stickyWindows.delete(note.id));
  return win;
}

function loadAllStickies() {
  const stickies = store.get('stickies') || [];
  const settings = store.get('settings') || {};
  stickies.forEach(s => {
    if (s.open === false) return; // hidden from a previous session — stays hidden until reopened from the list
    const win = createStickyWindow(s);
    if (settings.focusMode) win.hide();
  });
}

// Hides a note's floating window and remembers it as hidden — does NOT
// delete the note. Reopen it from the Sticky notes list on the dashboard.
function hideSticky(id) {
  const stickies = store.get('stickies') || [];
  const idx = stickies.findIndex(s => s.id === id);
  if (idx >= 0) { stickies[idx].open = false; store.set('stickies', stickies); }
  const win = stickyWindows.get(id);
  if (win && !win.isDestroyed()) win.close();
  return stickies;
}

// Opens (or focuses, if already open) a specific note's floating window.
function showSticky(id) {
  const stickies = store.get('stickies') || [];
  const idx = stickies.findIndex(s => s.id === id);
  if (idx < 0) return false;
  stickies[idx].open = true;
  store.set('stickies', stickies);
  let win = stickyWindows.get(id);
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
  } else {
    win = createStickyWindow(stickies[idx]);
  }
  return true;
}

function setStickiesVisible(visible) {
  stickyWindows.forEach(win => {
    if (win.isDestroyed()) return;
    if (visible) win.showInactive(); else win.hide();
  });
}

// ---------- focus mode + website blocking ----------
function setHostsBlock(enable, domains) {
  return new Promise((resolve) => {
    let current;
    try { current = fs.readFileSync('/etc/hosts', 'utf-8'); } catch (e) { resolve({ ok: false, reason: 'cannot read /etc/hosts' }); return; }
    const startIdx = current.indexOf(HOSTS_MARK_START);
    const endIdx = current.indexOf(HOSTS_MARK_END);
    let base = current;
    if (startIdx !== -1 && endIdx !== -1) {
      base = current.slice(0, startIdx) + current.slice(endIdx + HOSTS_MARK_END.length);
    }
    let next = base;
    if (enable) {
      const lines = (domains && domains.length ? domains : DEFAULT_BLOCKLIST)
        .map(d => '127.0.0.1 ' + d.trim()).join('\n');
      next = base.trimEnd() + '\n' + HOSTS_MARK_START + '\n' + lines + '\n' + HOSTS_MARK_END + '\n';
    }
    if (next === current) { resolve({ ok: true, unchanged: true }); return; }
    const tmpPath = path.join(os.tmpdir(), 'tempo-hosts-' + Date.now() + '.tmp');
    try { fs.writeFileSync(tmpPath, next, 'utf-8'); } catch (e) { resolve({ ok: false, reason: e.message }); return; }
    const cmd = 'pkexec cp "' + tmpPath + '" /etc/hosts';
    exec(cmd, (err) => {
      try { fs.unlinkSync(tmpPath); } catch (e) {}
      if (err) resolve({ ok: false, reason: 'pkexec failed or was cancelled' });
      else resolve({ ok: true });
    });
  });
}

// AI calls will run through Tempo's own hosted key once that's built — not
// wired up yet, so this always falls back to the built-in non-AI behavior
// (see ai.js). No user-facing API key setting anymore.
function aiConfig() {
  return { provider: 'anthropic', apiKey: '' };
}

// ---------- system DND (best effort, GNOME/KDE only, driven entirely by focus mode) ----------
function setSystemDND(enable) {
  return new Promise((resolve) => {
    const de = (process.env.XDG_CURRENT_DESKTOP || process.env.DESKTOP_SESSION || '').toLowerCase();
    if (de.includes('gnome') || de.includes('unity') || de.includes('cinnamon')) {
      exec('gsettings set org.gnome.desktop.notifications show-banners ' + (enable ? 'false' : 'true'), (err) => {
        resolve({ ok: !err, target: 'gnome' });
      });
      return;
    }
    if (de.includes('kde') || de.includes('plasma')) {
      exec('kwriteconfig5 --file plasmanotifyrc --group Global --key DoNotDisturb ' + (enable ? 'true' : 'false') +
        ' && qdbus org.kde.KWin /KWin reconfigure', (err) => {
        resolve({ ok: !err, target: 'kde' });
      });
      return;
    }
    resolve({ ok: false, reason: 'unrecognized desktop environment (' + (de || 'unknown') + ')' });
  });
}

let focusTimer = null;
function setFocusMode(enabled, durationMinutes) {
  const settings = store.get('settings') || {};
  settings.focusMode = enabled;
  settings.focusUntil = (enabled && durationMinutes) ? Date.now() + durationMinutes * 60000 : null;
  store.set('settings', settings);
  setStickiesVisible(!enabled);
  if (tray) tray.setToolTip(enabled ? 'Tempo — focus mode on' : 'Tempo — momentum, not shame.');
  rebuildTrayMenu();
  if (settings.blockSites) setHostsBlock(enabled, settings.blockList);
  if (focusTimer) { clearInterval(focusTimer); focusTimer = null; }
  if (enabled && settings.focusUntil) {
    focusTimer = setInterval(() => {
      const s = store.get('settings') || {};
      if (s.focusUntil && Date.now() >= s.focusUntil) {
        fireReminder('Focus session done', "That's one for the log. Focus mode just turned itself off.");
        setFocusMode(false);
      }
    }, 15000);
  }
  // Focus mode IS the DND control now — one switch, not two. Best-effort:
  // flips the OS's own do-not-disturb alongside Tempo's own nudge silencing.
  return setSystemDND(enabled);
}

function rebuildTrayMenu() {
  const settings = store.get('settings') || {};
  const menu = Menu.buildFromTemplate([
    { label: 'Open Tempo', click: () => createDashboard() },
    { label: nowBarWin ? 'Hide Now Bar' : 'Show Now Bar', click: () => toggleNowBar() },
    { label: 'New sticky note', click: () => addSticky('text') },
    { label: 'New checklist note', click: () => addSticky('list') },
    { type: 'separator' },
    {
      label: 'Focus mode (DND)',
      type: 'checkbox',
      checked: !!settings.focusMode,
      click: (item) => setFocusMode(item.checked)
    },
    {
      label: 'Nudges',
      type: 'checkbox',
      checked: !!settings.nudges,
      click: (item) => {
        const s = store.get('settings') || {};
        s.nudges = item.checked;
        store.set('settings', s);
      }
    },
    { type: 'separator' },
    { label: 'Quit Tempo', click: () => { app.isQuiting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
}

// ---------- tray ----------
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  tray = new Tray(iconPath);
  tray.setToolTip('Tempo — momentum, not shame.');
  rebuildTrayMenu();
  tray.on('click', () => createDashboard());
}

const NOTE_COLORS = ['note-yellow', 'note-pink', 'note-blue', 'note-green', 'note-lavender', 'note-dark', 'note-plum'];

function addSticky(type) {
  const stickies = store.get('stickies') || [];
  const note = {
    id: 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    type: type === 'list' ? 'list' : 'text',
    text: '',
    items: [],
    color: NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)],
    x: null,
    y: null,
    open: true
  };
  stickies.push(note);
  store.set('stickies', stickies);
  const win = createStickyWindow(note);
  const settings = store.get('settings') || {};
  if (settings.focusMode) win.hide();
}

// ---------- reminders ----------
function fireReminder(title, body) {
  const settings = store.get('settings') || {};
  if (Notification.isSupported()) {
    new Notification({ title, body, icon: path.join(__dirname, 'assets', 'icon.png') }).show();
  }
  if (settings.ntfyTopic) sendNtfy(settings.ntfyTopic, title, body);
}

function startReminderLoop() {
  setInterval(() => {
    const settings = store.get('settings') || {};
    if (!settings.nudges || settings.focusMode) return;
    if (Math.random() < 0.12) {
      const line = HYPE_LINES[Math.floor(Math.random() * HYPE_LINES.length)];
      fireReminder('Tempo', line);
    }
  }, 60 * 1000);

  setInterval(() => {
    const settings = store.get('settings') || {};
    if (!settings.nudges || settings.focusMode) return;
    const tasks = store.get('tasks') || [];
    const now = new Date();
    let changed = false;
    tasks.forEach(t => {
      if (t.done || !t.deadline || t._nudged) return;
      const diff = new Date(t.deadline) - now;
      if (diff > 0 && diff < 2 * 3600000) {
        t._nudged = true;
        changed = true;
        fireReminder('Coming up', '"' + t.title + '" is due in under 2 hours. Stop hesitating — do it.');
      }
    });
    if (changed) store.set('tasks', tasks);
  }, 5 * 60 * 1000);
}

// ---------- autostart (Linux XDG) ----------
function autostartFilePath() {
  return path.join(os.homedir(), '.config', 'autostart', 'tempo.desktop');
}
function setAutostart(enabled) {
  const filePath = autostartFilePath();
  if (!enabled) {
    try { fs.unlinkSync(filePath); } catch (e) {}
    return;
  }
  const exec = app.isPackaged
    ? (process.env.APPIMAGE || process.execPath)
    : process.execPath + ' ' + path.resolve(__dirname);
  const content = `[Desktop Entry]
Type=Application
Name=Tempo
Comment=Momentum, not shame.
Exec=${exec}
Icon=${path.join(__dirname, 'assets', 'icon.png')}
X-GNOME-Autostart-enabled=true
Hidden=false
`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
  } catch (e) {
    console.error('Could not write autostart file:', e);
  }
}

// ---------- ClickUp import (personal API token, no OAuth needed) ----------
async function importFromClickUp(token, listId) {
  if (!token || !listId) return { ok: false, reason: 'missing token or list id' };
  try {
    const res = await fetch('https://api.clickup.com/api/v2/list/' + listId + '/task?archived=false', {
      headers: { 'Authorization': token }
    });
    if (!res.ok) return { ok: false, reason: 'ClickUp API error ' + res.status };
    const data = await res.json();
    const existing = store.get('tasks') || [];
    const existingClickUpIds = new Set(existing.filter(t => t.clickupId).map(t => t.clickupId));
    const TASK_COLORS = ['#FF6A4D', '#6EE7B7', '#FFC24B', '#6BB6FF', '#C9A6FF', '#FF8FB3', '#4FD1C5'];
    let imported = 0;
    (data.tasks || []).forEach(ct => {
      if (existingClickUpIds.has(ct.id)) return;
      existing.unshift({
        id: 'cu_' + ct.id,
        clickupId: ct.id,
        title: ct.name,
        deadline: ct.due_date ? new Date(parseInt(ct.due_date, 10)).toISOString() : null,
        estMinutes: 60,
        color: TASK_COLORS[Math.floor(Math.random() * TASK_COLORS.length)],
        subtasks: [],
        status: 'todo',
        done: false,
        completedAt: null,
        createdAt: new Date().toISOString()
      });
      imported += 1;
    });
    store.set('tasks', existing);
    return { ok: true, imported };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// ---------- global shortcuts ----------
function registerShortcuts() {
  globalShortcut.register('CommandOrControl+Alt+T', () => {
    if (dashboardWin && !dashboardWin.isDestroyed() && dashboardWin.isVisible()) dashboardWin.hide();
    else createDashboard();
  });
  globalShortcut.register('CommandOrControl+Alt+F', () => {
    const settings = store.get('settings') || {};
    setFocusMode(!settings.focusMode);
  });
  globalShortcut.register('CommandOrControl+Alt+N', () => addSticky('text'));
  globalShortcut.register('CommandOrControl+Alt+Space', () => {
    if (!currentSession) return;
    if (currentSession.paused) resumeSession(); else pauseSession();
  });
  globalShortcut.register('CommandOrControl+Alt+B', () => toggleNowBar());
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('store:get', (e, key) => store.get(key));
  ipcMain.handle('store:set', (e, key, value) => { store.set(key, value); return true; });

  ipcMain.handle('sticky:create', (e, type) => { addSticky(type); return store.get('stickies'); });
  ipcMain.handle('sticky:delete', (e, id) => {
    const stickies = (store.get('stickies') || []).filter(s => s.id !== id);
    store.set('stickies', stickies);
    const win = stickyWindows.get(id);
    if (win) win.close();
    return stickies;
  });
  ipcMain.handle('sticky:hide', (e, id) => hideSticky(id));
  ipcMain.handle('sticky:show', (e, id) => showSticky(id));
  ipcMain.handle('sticky:update', (e, id, patch) => {
    const stickies = store.get('stickies') || [];
    const idx = stickies.findIndex(s => s.id === id);
    if (idx >= 0) stickies[idx] = { ...stickies[idx], ...patch };
    store.set('stickies', stickies);
    return stickies;
  });

  ipcMain.handle('ai:breakdown', async (e, title) => {
    return breakdownTask(aiConfig(), title);
  });
  ipcMain.handle('ai:hype', async (e, stats) => {
    return weeklyHype(aiConfig(), stats);
  });
  ipcMain.handle('ai:quick-add', async (e, text) => {
    return quickAdd(aiConfig(), text);
  });
  ipcMain.handle('ai:daily-report', async (e, stats) => {
    return dailyReport(aiConfig(), stats);
  });

  ipcMain.handle('notify:test', () => { fireReminder('Tempo', 'This is a test nudge — desktop and phone.'); return true; });

  ipcMain.handle('settings:set-autostart', (e, enabled) => { setAutostart(enabled); return true; });
  ipcMain.handle('settings:set-focus', async (e, enabled, minutes) => setFocusMode(enabled, minutes));
  ipcMain.handle('settings:set-activity-tracking', (e, enabled) => {
    const settings = store.get('settings') || {};
    settings.activityTracking = !!enabled;
    store.set('settings', settings);
    applyActivityTrackingSetting();
    return activity.isRunning();
  });

  ipcMain.handle('activity:get-live', () => {
    const settings = store.get('settings') || {};
    if (!settings.activityTracking || !activity.isRunning()) return null;
    return activity.getLiveLevel();
  });

  ipcMain.handle('session:start', (e, taskId, taskTitle) => { startSession(taskId, taskTitle); return currentSession; });
  ipcMain.handle('session:pause', () => { pauseSession(); return currentSession; });
  ipcMain.handle('session:resume', () => { resumeSession(); return currentSession; });
  ipcMain.handle('session:stop', (e, status) => { stopSession(status); return { currentSession, sessions: store.get('sessions') || [] }; });
  ipcMain.handle('session:get-state', () => { pruneStaleSession(); return { currentSession, sessions: store.get('sessions') || [] }; });

  ipcMain.handle('nowbar:toggle', () => toggleNowBar());

  ipcMain.handle('clickup:import', async (e, token, listId) => importFromClickUp(token, listId));
}

// ---------- app lifecycle ----------
app.whenReady().then(() => {
  store = new Store(app);
  currentSession = store.get('currentSession') || null;
  pruneStaleSession();
  registerIpc();
  createTray();
  loadAllStickies();
  startReminderLoop();
  startIdleWatch();
  applyActivityTrackingSetting();
  registerShortcuts();
  createDashboard();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  activity.stop();
});

app.on('window-all-closed', (e) => {
  // keep running in the tray — this is the whole point of Tempo
  e.preventDefault();
});
