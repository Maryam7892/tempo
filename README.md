# Tempo — momentum, not shame.

A background companion, not a browser tab: a tray app that tracks focus sessions,
floats sticky notes over your whole screen, keeps a "Now Bar" always visible,
and nudges you on desktop and phone — all running continuously, the way a real
app does.

---

## What's in it

**Tasks & sessions**
- Add tasks with a deadline, an estimate, and AI-suggested subtasks
- **Quick add**: type `"finish slides by friday 6pm"` and AI parses it into a
  title, deadline, and time estimate for you
- Task states: to do → in progress → done, or blocked, with one-click controls
- Starting a task begins a live focus session, trackable from the board or the
  Now Bar
- Edit any task's title, deadline, estimate, or color after the fact
- Overload warning if today's estimates add up to more than your usual capacity

**The Now Bar**
- A small, always-on-top overlay showing your current task and a live timer —
  the "one prominent task on screen" piece. Drag it anywhere; it stays out of
  the way but always reachable. Toggle with the tray menu, the dashboard
  button, or `Ctrl+Alt+B`.
- Pause / resume, mark done, mark blocked, or switch tasks directly from it

**Today panel**
- Current focus streak, tasks completed today, interruptions, total focus
  time, longest uninterrupted stretch, average gap between tasks, and a daily
  momentum score — all computed fresh from your actual session history, never
  a running counter that can drift out of sync

**Automatic session detection**
- Tempo watches system idle time. Step away for 3+ minutes during an active
  session and it auto-pauses and logs an interruption; come back and it sends
  a "welcome back, resume this?" nudge instead of silently counting your
  coffee break as focused work

**Welcome-back banner**
- Reopen Tempo after a while and it reminds you what you were last working on
  and how long ago, instead of dropping you into a blank board

**End-of-day report**
- One button, generates a short AI reflection plus the day's real numbers
  (completed, focus time, momentum) and a timestamped log of every task you
  worked on that day — the "switch log" for reviewing how the day actually went

**Sticky notes**
- Plain text or checklist mode (toggle per note), five pastel colors plus two
  dark ones, draggable, resizable-by-design at 240×260
- Checklist notes can pull in an open task from your board directly as a list
  item (📋 button), on top of typing your own items

**Focus mode (DND)**
- Silences Tempo's own nudges and hides every sticky note until you turn it
  back off
- **Timed sessions**: "Focus for 25 min" turns it on and switches itself back
  off automatically, with a notification either way
- **Optional site blocking**: redirects a list of distracting domains via
  `/etc/hosts` while focus mode is on (see the honest limitations section
  below before turning this on)
- Toggle from the header button, Settings, or the tray menu — or `Ctrl+Alt+F`

**Reminders**
- Desktop notifications (native, real OS pop-ups) plus phone push via
  [ntfy.sh](https://ntfy.sh) — free, no account, no backend server

**Integrations**
- **ClickUp**: pull open tasks from one list into Tempo's board using a
  personal API token (Settings → ClickUp Apps) — no OAuth setup
- Jira uses the same token+REST pattern and isn't built yet — say the word if
  you want it added, it's a small follow-on from the ClickUp code

**Keyboard shortcuts**
| Shortcut | Action |
|---|---|
| `Ctrl+Alt+T` | Show/hide the dashboard |
| `Ctrl+Alt+F` | Toggle focus mode |
| `Ctrl+Alt+N` | New sticky note |
| `Ctrl+Alt+Space` | Pause/resume the active session |
| `Ctrl+Alt+B` | Show/hide the Now Bar |

---

## Honest limitations

A few things in the original wishlist aren't implemented, on purpose, because
faking them would be worse than not having them:

- **Muting all OS notifications** — Tempo can silence its own notifications
  (that's what focus mode does), but there's no safe, reliable way for a
  regular app to mute *every other app's* notifications across different
  Linux desktop environments. GNOME, KDE, and others each handle this
  differently with no common API.
- **Hiding other apps' windows** — same problem: no generic, safe way to do
  this across window managers without risking interfering with unrelated
  apps.
- **Site blocking** only blocks at the DNS/hosts level, which is trivially
  reversible by anyone who knows to edit `/etc/hosts` back — it's friction,
  not a hard lock. It also asks for your admin password via a system prompt
  (`pkexec`) every time focus mode toggles with blocking enabled, which is a
  real, slightly annoying trade-off of doing this safely instead of running
  as root all the time.

---

## 1. Install Node.js (if you don't have it)

```bash
sudo apt update && sudo apt install -y nodejs npm
# or, for a more current version:
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install --lts
```

Check Node 18+: `node -v`

## 2. Install dependencies

```bash
cd tempo-app
npm install
```

## 3. Try it in dev mode first

```bash
npm start
```

Closing the dashboard window does **not** quit Tempo — it keeps running in the
tray. Use the tray menu → "Quit Tempo" to actually stop it.

## 4. Install it as a real app (recommended)

```bash
sudo apt install -y fakeroot   # needed once, for the .deb build
npm run build:linux
```

Produces `dist/*.deb` and `dist/*.AppImage`.

```bash
sudo dpkg -i dist/tempo_0.1.0_amd64.deb
```

Tempo now shows up in your app launcher like any other app. Open it once,
toggle "Launch at login" in settings, and you're done with the terminal.

---

## Setting up phone notifications (free, no account)

1. Install the **ntfy** app (Play Store / F-Droid).
2. Subscribe to a topic name only you know (e.g. `maha-tempo-8f2k` — not
   something guessable, since anyone who knows the exact name can see
   messages sent to it).
3. Paste that topic into Settings → "Phone notifications (ntfy)" → Save.
4. "Send test notification" should reach your phone within seconds.

## Adding AI features (optional but recommended)

Subtask breakdown, Quick Add parsing, the weekly hype, and the EOD report all
use Claude. Without a key, Tempo still works — Quick Add just uses the raw
text as the title with no date parsing, and the recaps use simple built-in
fallback text.

1. Get a key at console.anthropic.com (uses your own API credits — not free).
2. Paste it into Settings → "Anthropic API key" → Save.

Stored only in Tempo's local data file on this machine, sent only to
`api.anthropic.com` directly from your device.

## Connecting ClickUp

1. In ClickUp: Settings → Apps → generate a personal API token.
2. Find your List ID (open the list in ClickUp, it's in the URL).
3. Paste both into Settings → "ClickUp import", then "Import open tasks".

## Launch at login

Toggle in Settings — writes a standard XDG autostart entry to
`~/.config/autostart/tempo.desktop`. Points at the packaged binary once
installed via `.deb`/AppImage, not the dev folder.

---

## Known Linux quirks

- **Tray icon on vanilla GNOME**: GNOME removed the system tray by default.
  Install "AppIndicator and KStatusNotifierItem Support" from
  extensions.gnome.org if you don't see it. KDE, XFCE, and most others show
  it natively.
- **Transparent sticky notes / Now Bar** need a compositor running (on by
  default in GNOME/KDE; on lightweight WMs you may need something like
  `picom`). Without one, they render with a solid black background instead
  of transparent.
- **Always-on-top across workspaces** works by default on GNOME/KDE. Tiling
  WMs may need a window-manager-specific rule.
- **Site blocking** needs `pkexec` (present by default on most desktop
  Linux installs). If it's missing, the toggle will just silently fail to
  apply — check for a `polkit` package if you want this feature.
- If you ever see a log line like
  `GLib-GObject: ../../../gobject/gsignal.c:2685: instance '...' has no
  handler with id '...'` — that's a benign Chromium/GTK warning from
  Electron's system-tray integration on Linux, not a Tempo bug. Safe to
  ignore unless it comes with an actual crash.

## Working on this repo with Claude Code

Copying files back and forth from chat gets old fast. If you install
[Claude Code](https://claude.com/product/claude-code) in VS Code (or the
terminal), it can work directly in this cloned repo — edit files, run
`npm start`, run `git diff`/`commit`/`push` — without any copy-pasting. Point
it at this folder and it can pick up right where this README leaves off.

## Packaging into a proper installable app

```bash
npm run build:linux
```

Produces an AppImage and `.deb` in `dist/`.
test
