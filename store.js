// Minimal JSON-file store. No external dependency, no version surprises.
const fs = require('fs');
const path = require('path');

class Store {
  constructor(app) {
    this.filePath = path.join(app.getPath('userData'), 'tempo-data.json');
    this.data = this._read();
  }

  _read() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw);
    } catch (e) {
      return {
        tasks: [],
        stickies: [],
        weekLog: {},
        settings: {
          capacityMinutes: 240,
          nudges: false,
          activityTracking: false,
          cameraTracking: false,
          launchAtLogin: false,
          focusMode: false,
          focusUntil: null,
          blockSites: false,
          blockList: [],
          savedBlockDomains: [],
          ntfyTopic: '',
          clickupToken: '',
          clickupListId: ''
        },
        sessions: [],
        currentSession: null,
        lastActivity: null
      };
    }
  }

  _write() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      console.error('Tempo store write failed:', e);
    }
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this._write();
  }
}

module.exports = Store;
