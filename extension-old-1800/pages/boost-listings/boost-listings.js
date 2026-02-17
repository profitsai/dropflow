import {
  END_LOW_PERFORMERS, BULK_REVISE,
  SEND_OFFERS, REVIEW_OFFERS, SCHEDULE_BOOST, CANCEL_SCHEDULE,
  BOOST_PROGRESS, BOOST_COMPLETE, CANCEL_BOOST
} from '../../lib/message-types.js';

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

const logEl = document.getElementById('log-output');

function log(text) {
  const line = document.createElement('div');
  line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

// Track which operation is running
let activeOperation = null;

function setRunning(operation, startBtn, stopBtn) {
  activeOperation = operation;
  if (startBtn) startBtn.disabled = true;
  if (stopBtn) stopBtn.disabled = false;
}

function setIdle(startBtn, stopBtn) {
  activeOperation = null;
  if (startBtn) startBtn.disabled = false;
  if (stopBtn) stopBtn.disabled = true;
}

function updateProgress(section, current, total, text) {
  const progressEl = document.getElementById(`progress-${section}`);
  const fillEl = document.getElementById(`progress-fill-${section}`);
  const textEl = document.getElementById(`progress-text-${section}`);

  if (progressEl) progressEl.style.display = 'block';
  if (fillEl && total > 0) fillEl.style.width = `${Math.round((current / total) * 100)}%`;
  if (textEl) textEl.textContent = text || `${current}/${total}`;
}

function hideProgress(section) {
  const progressEl = document.getElementById(`progress-${section}`);
  if (progressEl) {
    setTimeout(() => { progressEl.style.display = 'none'; }, 5000);
  }
}

// ============================
// End & Sell Similar
// ============================
const btnEndSell = document.getElementById('btn-end-sell');
const btnStopEnd = document.getElementById('btn-stop-end');

btnEndSell.addEventListener('click', async () => {
  const settings = {
    minSold: parseInt(document.getElementById('min-sold').value) || 0,
    minViews: parseInt(document.getElementById('min-views').value) || 0,
    hoursRemaining: parseInt(document.getElementById('hours-remaining').value) || 24,
    autoRelist: document.getElementById('auto-relist').checked,
    autoRepeat: document.getElementById('auto-repeat').checked
  };

  setRunning('end-sell', btnEndSell, btnStopEnd);
  log('Starting End & Sell Similar...');
  updateProgress('end-sell', 0, 0, 'Scanning listings...');

  const response = await chrome.runtime.sendMessage({ type: END_LOW_PERFORMERS, ...settings }).catch(e => ({ error: e.message }));
  log(response?.message || response?.error || 'Done');
  setIdle(btnEndSell, btnStopEnd);
  hideProgress('end-sell');
});

btnStopEnd.addEventListener('click', async () => {
  log('Stopping End & Sell Similar...');
  await chrome.runtime.sendMessage({ type: CANCEL_BOOST }).catch(() => {});
  setIdle(btnEndSell, btnStopEnd);
});

// ============================
// Bulk Revise
// ============================
const btnBulkRevise = document.getElementById('btn-bulk-revise');
const btnStopRevise = document.getElementById('btn-stop-revise');

btnBulkRevise.addEventListener('click', async () => {
  const toggleOffers = document.getElementById('toggle-offers-after').checked;
  setRunning('bulk-revise', btnBulkRevise, btnStopRevise);
  log('Starting Bulk Revise...');
  updateProgress('bulk-revise', 0, 0, 'Scanning listings...');

  const response = await chrome.runtime.sendMessage({ type: BULK_REVISE, toggleOffers }).catch(e => ({ error: e.message }));
  log(response?.message || response?.error || 'Done');
  setIdle(btnBulkRevise, btnStopRevise);
  hideProgress('bulk-revise');
});

btnStopRevise.addEventListener('click', async () => {
  log('Stopping Bulk Revise...');
  await chrome.runtime.sendMessage({ type: CANCEL_BOOST }).catch(() => {});
  setIdle(btnBulkRevise, btnStopRevise);
});

// ============================
// Send Offers
// ============================
const btnSendOffers = document.getElementById('btn-send-offers');

btnSendOffers.addEventListener('click', async () => {
  const discountPct = parseInt(document.getElementById('discount-pct').value) || 10;
  btnSendOffers.disabled = true;
  log(`Sending offers at ${discountPct}% discount...`);
  updateProgress('send-offers', 0, 0, 'Opening eligible listings...');

  const response = await chrome.runtime.sendMessage({ type: SEND_OFFERS, discountPct }).catch(e => ({ error: e.message }));
  log(response?.message || response?.error || 'Done');
  btnSendOffers.disabled = false;
  hideProgress('send-offers');
});

// ============================
// Review Offers
// ============================
const btnReviewOffers = document.getElementById('btn-review-offers');

btnReviewOffers.addEventListener('click', async () => {
  const minMarkup = parseInt(document.getElementById('min-markup').value) || 15;
  btnReviewOffers.disabled = true;
  log(`Reviewing offers with ${minMarkup}% minimum markup...`);
  updateProgress('review-offers', 0, 0, 'Loading offers dashboard...');

  const response = await chrome.runtime.sendMessage({ type: REVIEW_OFFERS, minMarkup }).catch(e => ({ error: e.message }));
  log(response?.message || response?.error || 'Done');
  btnReviewOffers.disabled = false;
  hideProgress('review-offers');
});

// ============================
// Schedule
// ============================
document.getElementById('btn-schedule').addEventListener('click', async () => {
  const schedule = {
    intervalHours: parseInt(document.getElementById('schedule-interval').value),
    action: document.getElementById('schedule-action').value,
    // Save current settings so the alarm can use them
    settings: getCurrentSettingsForAction(document.getElementById('schedule-action').value)
  };

  log(`Setting schedule: ${schedule.action} every ${schedule.intervalHours}h`);
  const response = await chrome.runtime.sendMessage({ type: SCHEDULE_BOOST, schedule });

  if (response?.success) {
    showScheduleStatus(schedule);
    log(response.message || 'Schedule set');
  } else {
    log(response?.error || 'Failed to set schedule');
  }
});

document.getElementById('btn-cancel-schedule').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: CANCEL_SCHEDULE });
  document.getElementById('schedule-status').style.display = 'none';
  log('Schedule cancelled');
});

function getCurrentSettingsForAction(action) {
  switch (action) {
    case 'end-sell':
      return {
        minSold: parseInt(document.getElementById('min-sold').value) || 0,
        minViews: parseInt(document.getElementById('min-views').value) || 0,
        hoursRemaining: parseInt(document.getElementById('hours-remaining').value) || 24,
        autoRelist: document.getElementById('auto-relist').checked
      };
    case 'bulk-revise':
      return { toggleOffers: document.getElementById('toggle-offers-after').checked };
    case 'send-offers':
      return { discountPct: parseInt(document.getElementById('discount-pct').value) || 10 };
    default:
      return {};
  }
}

function showScheduleStatus(schedule) {
  const statusEl = document.getElementById('schedule-status');
  statusEl.textContent = `Schedule active: ${schedule.action} every ${schedule.intervalHours} hours`;
  statusEl.style.display = 'block';
}

// ============================
// Progress & Complete Listeners
// ============================
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === BOOST_PROGRESS) {
    const { current, total, status } = message;
    log(`Progress: ${current}/${total} - ${status || ''}`);

    // Update progress bar for whichever operation is active
    if (activeOperation) {
      updateProgress(activeOperation, current, total, status);
    }
  }
  if (message.type === BOOST_COMPLETE) {
    log(`Complete! ${message.summary || `Processed ${message.total} items.`}`);
  }
});

// ============================
// Restore Schedule Status on Load
// ============================
(async () => {
  try {
    const result = await chrome.storage.local.get('boostSchedule');
    const schedule = result.boostSchedule;
    if (schedule) {
      showScheduleStatus(schedule);
    }
  } catch (_) {}
})();
