import {
  RESEARCH_COMPETITOR, STOP_RESEARCH,
  COMPETITOR_PROGRESS, COMPETITOR_COMPLETE
} from '../../lib/message-types.js';
import { COMPETITOR_LIST, COMPETITOR_SCAN_POSITION } from '../../lib/storage-keys.js';

const usernamesInput = document.getElementById('usernames-input');
const usernameCount = document.getElementById('username-count');
const btnRun = document.getElementById('btn-run');
const btnStop = document.getElementById('btn-stop');
const btnReset = document.getElementById('btn-reset');
const progressCard = document.getElementById('progress-card');
const resultsCard = document.getElementById('results-card');
const progressBar = document.getElementById('progress-bar');

// Update count as user types
usernamesInput.addEventListener('input', () => {
  const names = parseUsernames(usernamesInput.value);
  usernameCount.textContent = names.length;
});

// Load saved state
async function loadState() {
  const result = await chrome.storage.local.get([COMPETITOR_LIST, COMPETITOR_SCAN_POSITION]);
  if (Array.isArray(result[COMPETITOR_LIST])) {
    usernamesInput.value = result[COMPETITOR_LIST].join('\n');
    usernameCount.textContent = result[COMPETITOR_LIST].length;
  }
}

// Run scanner
btnRun.addEventListener('click', async () => {
  const usernames = parseUsernames(usernamesInput.value);
  if (usernames.length === 0) {
    alert('Please enter at least one eBay seller username.');
    return;
  }

  // Save to storage
  await chrome.storage.local.set({ [COMPETITOR_LIST]: usernames });

  const response = await chrome.runtime.sendMessage({
    type: RESEARCH_COMPETITOR,
    usernames,
    filterDays: parseInt(document.getElementById('filter-days').value),
    concurrency: parseInt(document.getElementById('concurrency').value)
  });

  if (response.error) {
    alert(response.error);
    return;
  }

  btnRun.disabled = true;
  btnStop.disabled = false;
  progressCard.style.display = 'block';
  document.getElementById('scan-total').textContent = usernames.length;
});

// Stop
btnStop.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: STOP_RESEARCH });
  btnRun.disabled = false;
  btnStop.disabled = true;
});

// Reset
btnReset.addEventListener('click', async () => {
  await chrome.storage.local.remove([COMPETITOR_LIST, COMPETITOR_SCAN_POSITION]);
  usernamesInput.value = '';
  usernameCount.textContent = '0';
  progressCard.style.display = 'none';
  resultsCard.style.display = 'none';
  progressBar.style.width = '0%';
  progressBar.textContent = '0%';
});

// Listen for progress
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === COMPETITOR_PROGRESS) {
    const { current, total, currentUser } = message;
    const pct = Math.round((current / total) * 100);
    progressBar.style.width = `${pct}%`;
    progressBar.textContent = `${pct}%`;
    document.getElementById('scan-position').textContent = current;
    document.getElementById('scan-total').textContent = total;
    document.getElementById('scan-current').textContent = currentUser || '-';
  }

  if (message.type === COMPETITOR_COMPLETE) {
    btnRun.disabled = false;
    btnStop.disabled = true;
    resultsCard.style.display = 'block';
    document.getElementById('results-output').textContent =
      `Scan complete! Scanned ${message.total} competitors.`;
  }
});

function parseUsernames(text) {
  return [...new Set(
    text.split(/[\n,]+/).map(s => s.trim()).filter(s => s.length > 0)
  )];
}

loadState();
