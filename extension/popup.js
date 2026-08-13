document.getElementById('btn-open-options').addEventListener('click', () => {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL('options.html'));
  }
});

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const currentTab = tabs[0];
  const statusEl = document.getElementById('status-text');
  if (currentTab && currentTab.url && currentTab.url.includes('instagram.com')) {
    statusEl.innerHTML = '&#9989; Active on Instagram.<br>Floating panel is visible in bottom-right.';
    statusEl.style.color = '#059669';
  } else {
    statusEl.innerHTML = '&#9888; Open <a href="https://www.instagram.com" target="_blank">instagram.com</a> to use scraper.';
    statusEl.style.color = '#dc2626';
  }
});
