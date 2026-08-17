const DEFAULTS = {
  scrollDelay: 2000,
  preferredQuality: 'highest',
  autoZipMetadata: true,
  watermarkCleaningEnabled: true,
  apiBase: 'http://localhost:3010',
  apiToken: ''
};

function showStatus(msg, isError = false, elId = 'saveStatus') {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.className = 'status ' + (isError ? 'status-err' : 'status-ok');
  el.style.display = 'block';
  setTimeout(() => {
    el.style.display = 'none';
  }, 4000);
}

async function loadSettings() {
  try {
    const res = await chrome.storage.local.get([
      'scrollDelay',
      'preferredQuality',
      'autoZipMetadata',
      'watermarkCleaningEnabled',
      'apiBase',
      'apiToken'
    ]);
    document.getElementById('scrollDelay').value = res.scrollDelay ?? DEFAULTS.scrollDelay;
    document.getElementById('preferredQuality').value = res.preferredQuality ?? DEFAULTS.preferredQuality;
    document.getElementById('autoZipMetadata').checked = res.autoZipMetadata ?? DEFAULTS.autoZipMetadata;
    document.getElementById('watermarkCleaningEnabled').checked = res.watermarkCleaningEnabled ?? DEFAULTS.watermarkCleaningEnabled;
    document.getElementById('apiBase').value = res.apiBase ?? DEFAULTS.apiBase;
    document.getElementById('apiToken').value = res.apiToken ?? DEFAULTS.apiToken;
  } catch (e) {
    console.warn('chrome.storage unavailable, using defaults', e);
    document.getElementById('scrollDelay').value = DEFAULTS.scrollDelay;
    document.getElementById('preferredQuality').value = DEFAULTS.preferredQuality;
    document.getElementById('autoZipMetadata').checked = DEFAULTS.autoZipMetadata;
    document.getElementById('watermarkCleaningEnabled').checked = DEFAULTS.watermarkCleaningEnabled;
    document.getElementById('apiBase').value = DEFAULTS.apiBase;
    document.getElementById('apiToken').value = DEFAULTS.apiToken;
  }
}

async function validateToken(apiBase, apiToken) {
  if (!apiToken) return { ok: false, error: 'Token is empty' };
  try {
    const url = apiBase.replace(/\/$/, '') + '/api/auth/validate-token?token=' + encodeURIComponent(apiToken);
    const res = await fetch(url, { cache: 'no-store' });
    const json = await res.json();
    return json;
  } catch (e) {
    return { ok: false, error: 'Could not reach the server: ' + e.message };
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();

  document.getElementById('saveBtn').addEventListener('click', async () => {
    const settings = {
      scrollDelay: parseInt(document.getElementById('scrollDelay').value, 10) || DEFAULTS.scrollDelay,
      preferredQuality: document.getElementById('preferredQuality').value,
      autoZipMetadata: document.getElementById('autoZipMetadata').checked,
      watermarkCleaningEnabled: document.getElementById('watermarkCleaningEnabled').checked
    };
    try {
      await chrome.storage.local.set(settings);
      showStatus('Settings saved — applied to new scrapes.');
    } catch (e) {
      showStatus('Failed to save settings: ' + e.message, true);
    }
  });

  document.getElementById('validateTokenBtn').addEventListener('click', async () => {
    const apiBase = document.getElementById('apiBase').value.trim() || DEFAULTS.apiBase;
    const apiToken = document.getElementById('apiToken').value.trim();
    const result = await validateToken(apiBase, apiToken);
    if (result.valid) {
      try {
        await chrome.storage.local.set({ apiBase, apiToken });
        showStatus('Token valid — ' + result.email + ' · ' + result.credits + ' credits. Scraping enabled!', false, 'tokenStatus');
      } catch (e) {
        showStatus('Could not save: ' + e.message, true, 'tokenStatus');
      }
    } else {
      showStatus(result.error || 'Token invalid — get a new one from the dashboard.', true, 'tokenStatus');
    }
  });
});
