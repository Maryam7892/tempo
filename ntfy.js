// Sends a push notification to the user's phone via ntfy.sh.
// The user installs the free "ntfy" app and subscribes to a private topic name
// they choose in Tempo's settings. No account, no backend server required.

async function sendNtfy(topic, title, message) {
  if (!topic || !topic.trim()) return { ok: false, reason: 'no-topic' };
  try {
    const res = await fetch('https://ntfy.sh/' + encodeURIComponent(topic.trim()), {
      method: 'POST',
      headers: {
        'Title': title || 'Tempo',
        'Priority': 'default',
        'Tags': 'sparkles'
      },
      body: message || ''
    });
    return { ok: res.ok };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

module.exports = { sendNtfy };
