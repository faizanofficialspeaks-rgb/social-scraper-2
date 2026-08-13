const DEFAULTS = {
  scrollDelay: 2000,
  preferredQuality: 'highest',
  autoZipMetadata: true,
  watermarkCleaningEnabled: true
};

function showStatus(msg, isError = false) {
  const el = document.getElementById('saveStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = 'status ' + (isError ? 'status-err' : 'status-ok');
  el.style.display = 'block';
  setTimeout(() => {
    el.style.display = 'none';
  }, 3000);
}

async function loadSettings() {
  try {
    const res = await chrome.storage.local.get([
      'scrollDelay',
      'preferredQuality',
      'autoZipMetadata',
      'watermarkCleaningEnabled'
    ]);
    document.getElementById('scrollDelay').value = res.scrollDelay ?? DEFAULTS.scrollDelay;
    document.getElementById('preferredQuality').value = res.preferredQuality ?? DEFAULTS.preferredQuality;
    document.getElementById('autoZipMetadata').checked = res.autoZipMetadata ?? DEFAULTS.autoZipMetadata;
    document.getElementById('watermarkCleaningEnabled').checked = res.watermarkCleaningEnabled ?? DEFAULTS.watermarkCleaningEnabled;
  } catch (e) {
    console.warn('chrome.storage unavailable, using defaults', e);
    document.getElementById('scrollDelay').value = DEFAULTS.scrollDelay;
    document.getElementById('preferredQuality').value = DEFAULTS.preferredQuality;
    document.getElementById('autoZipMetadata').checked = DEFAULTS.autoZipMetadata;
    document.getElementById('watermarkCleaningEnabled').checked = DEFAULTS.watermarkCleaningEnabled;
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
});