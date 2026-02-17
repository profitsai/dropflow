import {
  START_BULK_LISTING, PAUSE_BULK_LISTING, RESUME_BULK_LISTING, TERMINATE_BULK_LISTING,
  BULK_LISTING_PROGRESS, BULK_LISTING_RESULT, BULK_LISTING_COMPLETE
} from '../../lib/message-types.js';
import { parseAmazonLinks } from '../../lib/utils.js';

// DOM elements
const linksInput = document.getElementById('links-input');
const linkCount = document.getElementById('link-count');
const btnStart = document.getElementById('btn-start');
const btnPause = document.getElementById('btn-pause');
const btnResume = document.getElementById('btn-resume');
const btnTerminate = document.getElementById('btn-terminate');
const btnClear = document.getElementById('btn-clear');
const progressSection = document.getElementById('progress-section');
const resultsSection = document.getElementById('results-section');
const progressBar = document.getElementById('progress-bar');
const statPosition = document.getElementById('stat-position');
const statTotal = document.getElementById('stat-total');
const statSuccess = document.getElementById('stat-success');
const statFail = document.getElementById('stat-fail');
const resultsBody = document.getElementById('results-body');

let isRunning = false;

// Update link count as user types
linksInput.addEventListener('input', () => {
  const links = parseAmazonLinks(linksInput.value);
  linkCount.textContent = links.length;
});

// Start listing
btnStart.addEventListener('click', async () => {
  const links = parseAmazonLinks(linksInput.value);
  if (links.length === 0) {
    alert('Please paste at least one Amazon product URL.');
    return;
  }

  const payload = {
    links,
    threadCount: parseInt(document.getElementById('thread-count').value) || 3,
    minPrice: parseFloat(document.getElementById('min-price').value) || undefined,
    maxPrice: parseFloat(document.getElementById('max-price').value) || undefined,
    fbaOnly: document.getElementById('fba-only').checked,
    listingType: document.getElementById('listing-type').value,
    ebayDomain: document.getElementById('ebay-marketplace').value || ''
  };

  const response = await chrome.runtime.sendMessage({ type: START_BULK_LISTING, ...payload });

  if (response.error) {
    alert(response.error);
    return;
  }

  isRunning = true;
  setRunningState(true);
  statTotal.textContent = links.length;
  progressSection.style.display = 'block';
  resultsSection.style.display = 'block';
  resultsBody.innerHTML = '';
});

// Pause
btnPause.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: PAUSE_BULK_LISTING });
  btnPause.disabled = true;
  btnResume.disabled = false;
});

// Resume
btnResume.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: RESUME_BULK_LISTING });
  btnPause.disabled = false;
  btnResume.disabled = true;
});

// Terminate
btnTerminate.addEventListener('click', async () => {
  if (confirm('Are you sure you want to stop all listing operations?')) {
    await chrome.runtime.sendMessage({ type: TERMINATE_BULK_LISTING });
    setRunningState(false);
  }
});

// Clear
btnClear.addEventListener('click', () => {
  linksInput.value = '';
  linkCount.textContent = '0';
  resultsBody.innerHTML = '';
  progressSection.style.display = 'none';
  resultsSection.style.display = 'none';
  progressBar.style.width = '0%';
  progressBar.textContent = '0%';
});

// Open full table
document.getElementById('btn-open-table').addEventListener('click', () => {
  const url = chrome.runtime.getURL('pages/bulk-poster/status-table.html');
  chrome.tabs.create({ url });
});

// Listen for progress updates from background
chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case BULK_LISTING_PROGRESS:
      updateProgress(message);
      break;

    case BULK_LISTING_RESULT:
      addResult(message.result);
      break;

    case BULK_LISTING_COMPLETE:
      setRunningState(false);
      updateProgress(message);
      break;
  }
});

function updateProgress({ current, total, successCount, failCount }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  progressBar.style.width = `${pct}%`;
  progressBar.textContent = `${pct}%`;
  statPosition.textContent = current || 0;
  statTotal.textContent = total || 0;
  statSuccess.textContent = successCount || 0;
  statFail.textContent = failCount || 0;
}

function addResult(result) {
  const row = document.createElement('tr');

  const tdIndex = document.createElement('td');
  tdIndex.textContent = result.index + 1;

  const tdLink = document.createElement('td');
  const linkEl = document.createElement('a');
  linkEl.href = result.link;
  linkEl.target = '_blank';
  linkEl.title = result.link;
  linkEl.textContent = truncateUrl(result.link);
  tdLink.appendChild(linkEl);

  const tdStatus = document.createElement('td');
  tdStatus.className = result.status === 'success' ? 'status-success' : 'status-error';
  tdStatus.textContent = result.status;

  const tdMessage = document.createElement('td');
  tdMessage.textContent = result.message;
  if (result.ebayUrl) {
    const viewLink = document.createElement('a');
    viewLink.href = result.ebayUrl;
    viewLink.target = '_blank';
    viewLink.textContent = ' View';
    tdMessage.appendChild(viewLink);
  }

  row.append(tdIndex, tdLink, tdStatus, tdMessage);
  resultsBody.appendChild(row);
}

function truncateUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname.substring(0, 40) + (u.pathname.length > 40 ? '...' : '');
  } catch {
    return url.substring(0, 40);
  }
}

function setRunningState(running) {
  isRunning = running;
  btnStart.disabled = running;
  btnPause.disabled = !running;
  btnResume.disabled = true;
  btnTerminate.disabled = !running;
  linksInput.disabled = running;
}
