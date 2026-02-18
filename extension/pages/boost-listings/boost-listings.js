/**
 * DropFlow — Boost My Listings page script
 * Matches EcomSniper's Boost My Listings UI behavior.
 */

import {
  END_LOW_PERFORMERS, BULK_REVISE,
  SEND_OFFERS, REVIEW_OFFERS, SCHEDULE_BOOST, CANCEL_SCHEDULE,
  BOOST_PROGRESS, BOOST_COMPLETE, CANCEL_BOOST
} from '../../lib/message-types.js';

// ============================================================
// Storage keys for boost settings
// ============================================================
const STORAGE_KEYS = {
  minSold: 'boostMinSoldQuantity',
  minViews: 'boostMinViewCount',
  filterByHours: 'boostFilterByHours',
  autoClose: 'boostAutoCloseSellSimilarTab',
  autoRepeat: 'boostAutoRepeatSellSimilarTab',
  offersDropdown: 'boostOffersDropdownOption',
  switchOffer: 'boostSwitchOffer',
  scheduleEnabled: 'boostScheduleSellSimilar',
  scheduledTime: 'boostScheduledTimeSellSimilar',
  scheduledInterval: 'boostScheduledInterval',
  sellSimilarAutomation: 'boostSellSimilarScheduleAutomation',
  reviseAutomation: 'boostReviseListingScheduleAutomation',
  watcherOfferPercent: 'boostWatcherOfferPercent',
  markupMultiplier: 'boostBestOfferMarkupMultiplier'
};

// ============================================================
// Logging
// ============================================================
const logList = document.getElementById('log_list');
const statusMessage = document.getElementById('status_message');
const loadingProgress = document.getElementById('loading_progress');

function addLog(text) {
  const li = document.createElement('li');
  const time = new Date().toLocaleTimeString();
  li.textContent = `[${time}] ${text}`;
  logList.prepend(li);
  // Keep max 200 logs
  while (logList.children.length > 200) {
    logList.removeChild(logList.lastChild);
  }
}

function setStatus(text) {
  if (statusMessage) statusMessage.textContent = text;
  addLog(text);
}

function setProgress(percent) {
  if (loadingProgress) {
    loadingProgress.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  }
}

// ============================================================
// Modal handling (same as EcomSniper)
// ============================================================
document.querySelectorAll('[data-modal-target]').forEach(btn => {
  btn.addEventListener('click', () => {
    const modal = document.querySelector(btn.dataset.modalTarget);
    if (modal) modal.style.display = 'block';
  });
});

document.querySelectorAll('.modal .close').forEach(closeBtn => {
  closeBtn.addEventListener('click', () => {
    closeBtn.closest('.modal').style.display = 'none';
  });
});

window.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal')) {
    e.target.style.display = 'none';
  }
});

// ============================================================
// Current Time & Countdown
// ============================================================
function updateCurrentTime() {
  const el = document.getElementById('current_time');
  if (el) el.textContent = new Date().toLocaleTimeString();
}
setInterval(updateCurrentTime, 1000);
updateCurrentTime();

let countdownInterval = null;

function startCountdown(targetTime) {
  const countdownEl = document.getElementById('countdown');
  const containerEl = document.getElementById('time_until_schedule');
  if (!countdownEl || !containerEl) return;

  containerEl.style.display = 'block';

  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    const now = new Date();
    const diff = targetTime - now;
    if (diff <= 0) {
      countdownEl.textContent = 'Running now...';
      return;
    }
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    countdownEl.textContent = `${hours}h ${minutes}m ${seconds}s`;
  }, 1000);
}

function stopCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);
  const containerEl = document.getElementById('time_until_schedule');
  if (containerEl) containerEl.style.display = 'none';
}

// ============================================================
// Load / Save Settings
// ============================================================
async function loadSettings() {
  const result = await chrome.storage.local.get(Object.values(STORAGE_KEYS));

  const get = (key, def) => result[STORAGE_KEYS[key]] ?? def;

  document.getElementById('minSold').value = get('minSold', 0);
  document.getElementById('minViews').value = get('minViews', 1000);
  document.getElementById('timeLeft').value = get('filterByHours', 24);
  document.getElementById('autoCloseToggle').checked = get('autoClose', true);
  document.getElementById('autoRepeatToggle').checked = get('autoRepeat', true);
  document.getElementById('offers_dropdown').value = get('offersDropdown', 1);
  document.getElementById('switchOfferToggle').checked = get('switchOffer', true);
  document.getElementById('schedule_toggle').checked = get('scheduleEnabled', false);
  document.getElementById('scheduled_time').value = get('scheduledTime', '');
  document.getElementById('scheduled_interval').value = get('scheduledInterval', 24);
  document.getElementById('sell_similar_toggle_schedule_automation').checked = get('sellSimilarAutomation', true);
  document.getElementById('revise_listing_toggle_schedule_automation').checked = get('reviseAutomation', false);
  document.getElementById('offer_percent_input').value = get('watcherOfferPercent', 5);
  document.getElementById('best_offer_markup_multiplier').value = get('markupMultiplier', 50);
}

function saveSettings() {
  const data = {};
  data[STORAGE_KEYS.minSold] = parseInt(document.getElementById('minSold').value) || 0;
  data[STORAGE_KEYS.minViews] = parseInt(document.getElementById('minViews').value) || 1000;
  data[STORAGE_KEYS.filterByHours] = parseInt(document.getElementById('timeLeft').value) || 24;
  data[STORAGE_KEYS.autoClose] = document.getElementById('autoCloseToggle').checked;
  data[STORAGE_KEYS.autoRepeat] = document.getElementById('autoRepeatToggle').checked;
  data[STORAGE_KEYS.offersDropdown] = parseInt(document.getElementById('offers_dropdown').value);
  data[STORAGE_KEYS.switchOffer] = document.getElementById('switchOfferToggle').checked;
  data[STORAGE_KEYS.scheduleEnabled] = document.getElementById('schedule_toggle').checked;
  data[STORAGE_KEYS.scheduledTime] = document.getElementById('scheduled_time').value;
  data[STORAGE_KEYS.scheduledInterval] = parseInt(document.getElementById('scheduled_interval').value) || 24;
  data[STORAGE_KEYS.sellSimilarAutomation] = document.getElementById('sell_similar_toggle_schedule_automation').checked;
  data[STORAGE_KEYS.reviseAutomation] = document.getElementById('revise_listing_toggle_schedule_automation').checked;
  data[STORAGE_KEYS.watcherOfferPercent] = parseFloat(document.getElementById('offer_percent_input').value) || 5;
  data[STORAGE_KEYS.markupMultiplier] = parseFloat(document.getElementById('best_offer_markup_multiplier').value) || 50;
  chrome.storage.local.set(data);
}

// Auto-save on input change
document.querySelectorAll('input, select').forEach(el => {
  el.addEventListener('change', saveSettings);
});

// ============================================================
// End & Sell Similar
// ============================================================
const endAndSellBtn = document.getElementById('end_and_sell_similar_button');
const cancelBoostBtn = document.getElementById('cancel_boost_button');
let isRunning = false;

endAndSellBtn.addEventListener('click', async () => {
  if (isRunning) return;
  isRunning = true;
  endAndSellBtn.disabled = true;
  cancelBoostBtn.style.display = 'inline-block';
  setProgress(0);

  const settings = {
    minSold: parseInt(document.getElementById('minSold').value) || 0,
    minViews: parseInt(document.getElementById('minViews').value) || 1000,
    hoursRemaining: parseInt(document.getElementById('timeLeft').value) || 24,
    autoRelist: true,
    autoRepeat: document.getElementById('autoRepeatToggle').checked,
    autoClose: document.getElementById('autoCloseToggle').checked
  };

  setStatus('Starting End & Sell Similar...');

  try {
    const response = await chrome.runtime.sendMessage({ type: END_LOW_PERFORMERS, ...settings });
    setStatus(response?.message || response?.error || 'Complete');
    setProgress(100);

    // Auto-close the boost tab when the setting is enabled and work was done
    if (settings.autoClose && response?.success && response?.ended > 0) {
      setStatus('Auto-closing tab in 3 seconds...');
      await new Promise(r => setTimeout(r, 3000));
      window.close();
      return;
    }
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  }

  isRunning = false;
  endAndSellBtn.disabled = false;
  cancelBoostBtn.style.display = 'none';
});

cancelBoostBtn.addEventListener('click', async () => {
  setStatus('Cancelling...');
  await chrome.runtime.sendMessage({ type: CANCEL_BOOST }).catch(() => {});
  isRunning = false;
  endAndSellBtn.disabled = false;
  cancelBoostBtn.style.display = 'none';
});

// ============================================================
// Bulk Revise Listing
// ============================================================
const bulkReviseBtn = document.getElementById('bulk_revise_listing_button');

bulkReviseBtn.addEventListener('click', async () => {
  if (isRunning) return;
  isRunning = true;
  bulkReviseBtn.disabled = true;

  const offersOption = parseInt(document.getElementById('offers_dropdown').value);
  const switchOffer = document.getElementById('switchOfferToggle').checked;

  setStatus('Starting Bulk Revise Listing...');

  try {
    const response = await chrome.runtime.sendMessage({
      type: BULK_REVISE,
      toggleOffers: offersOption === 0,
      switchOffer
    });
    setStatus(response?.message || response?.error || 'Complete');

    // If switchOffer enabled, flip the dropdown
    if (switchOffer) {
      const dropdown = document.getElementById('offers_dropdown');
      dropdown.value = offersOption === 0 ? '1' : '0';
      saveSettings();
    }
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  }

  isRunning = false;
  bulkReviseBtn.disabled = false;
});

// ============================================================
// Send Offers
// ============================================================
const sendOffersBtn = document.getElementById('send_offers_button');

sendOffersBtn.addEventListener('click', async () => {
  if (isRunning) return;
  isRunning = true;
  sendOffersBtn.classList.add('is-loading');
  sendOffersBtn.disabled = true;

  const percent = parseFloat(document.getElementById('offer_percent_input').value) || 5;
  setStatus(`Sending offers at ${percent}%...`);

  try {
    const response = await chrome.runtime.sendMessage({ type: SEND_OFFERS, discountPct: percent });
    setStatus(response?.message || response?.error || 'Complete');
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  }

  sendOffersBtn.classList.remove('is-loading');
  sendOffersBtn.classList.add('completed');
  setTimeout(() => sendOffersBtn.classList.remove('completed'), 600);
  sendOffersBtn.disabled = false;
  isRunning = false;
});

// ============================================================
// Review Offers
// ============================================================
const reviewOffersBtn = document.getElementById('review_offers_button');

reviewOffersBtn.addEventListener('click', async () => {
  if (isRunning) return;
  isRunning = true;
  reviewOffersBtn.classList.add('is-loading');
  reviewOffersBtn.disabled = true;

  const markupPct = parseFloat(document.getElementById('best_offer_markup_multiplier').value) || 50;
  // Convert percentage to multiplier: 50% markup = 1.5x
  const markupMultiplier = 1 + (markupPct / 100);

  setStatus(`Reviewing offers (min markup: ${markupPct}%)...`);

  try {
    const response = await chrome.runtime.sendMessage({ type: REVIEW_OFFERS, minMarkup: markupPct });
    setStatus(response?.message || response?.error || 'Complete');
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  }

  reviewOffersBtn.classList.remove('is-loading');
  reviewOffersBtn.classList.add('completed');
  setTimeout(() => reviewOffersBtn.classList.remove('completed'), 600);
  reviewOffersBtn.disabled = false;
  isRunning = false;
});

// ============================================================
// Schedule Automation
// ============================================================
const scheduleToggle = document.getElementById('schedule_toggle');

scheduleToggle.addEventListener('change', async () => {
  if (scheduleToggle.checked) {
    const time = document.getElementById('scheduled_time').value;
    const interval = parseInt(document.getElementById('scheduled_interval').value) || 24;
    const sellSimilarEnabled = document.getElementById('sell_similar_toggle_schedule_automation').checked;
    const reviseEnabled = document.getElementById('revise_listing_toggle_schedule_automation').checked;

    if (!time) {
      setStatus('Please set a scheduled start time first.');
      scheduleToggle.checked = false;
      return;
    }

    // Calculate next run time
    const [hours, minutes] = time.split(':').map(Number);
    const now = new Date();
    const nextRun = new Date();
    nextRun.setHours(hours, minutes, 0, 0);
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }

    const schedule = {
      intervalHours: interval,
      action: 'scheduled-boost',
      scheduledTime: time,
      sellSimilarEnabled,
      reviseEnabled,
      settings: {
        minSold: parseInt(document.getElementById('minSold').value) || 0,
        minViews: parseInt(document.getElementById('minViews').value) || 1000,
        hoursRemaining: parseInt(document.getElementById('timeLeft').value) || 24,
        autoRelist: true,
        autoRepeat: document.getElementById('autoRepeatToggle').checked,
        toggleOffers: parseInt(document.getElementById('offers_dropdown').value) === 0,
        switchOffer: document.getElementById('switchOfferToggle').checked
      }
    };

    const response = await chrome.runtime.sendMessage({ type: SCHEDULE_BOOST, schedule });
    if (response?.success) {
      setStatus(`Schedule set: every ${interval}h starting at ${time}`);
      startCountdown(nextRun);
    } else {
      setStatus(response?.error || 'Failed to set schedule');
      scheduleToggle.checked = false;
    }
  } else {
    await chrome.runtime.sendMessage({ type: CANCEL_SCHEDULE });
    setStatus('Schedule cancelled');
    stopCountdown();
  }
  saveSettings();
});

// ============================================================
// Progress & Complete Listeners
// ============================================================
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === BOOST_PROGRESS) {
    const { current, total, status } = message;
    if (total > 0) {
      setProgress((current / total) * 100);
    }
    if (status) {
      statusMessage.textContent = status;
      addLog(status);
    }
  }
  if (message.type === BOOST_COMPLETE) {
    setProgress(100);
    const text = message.summary || `Complete! Processed ${message.total} items.`;
    setStatus(text);
  }
});

// ============================================================
// Restore state on load
// ============================================================
(async () => {
  await loadSettings();

  // Check for active schedule
  const result = await chrome.storage.local.get('boostSchedule');
  const schedule = result.boostSchedule;
  if (schedule) {
    scheduleToggle.checked = true;
    if (schedule.scheduledTime) {
      const [hours, minutes] = schedule.scheduledTime.split(':').map(Number);
      const nextRun = new Date();
      nextRun.setHours(hours, minutes, 0, 0);
      if (nextRun <= new Date()) {
        nextRun.setDate(nextRun.getDate() + 1);
      }
      startCountdown(nextRun);
    }
  }

  // Update info links based on domain
  try {
    const settings = await chrome.storage.local.get('settings');
    const domain = settings?.settings?.ebayDomain || 'com.au';
    const activeLink = document.getElementById('activeListingLink');
    const endedLink = document.getElementById('endedListingLink');
    if (activeLink) activeLink.href = `https://www.ebay.${domain}/sh/lst/active?action=pagination&sort=timeRemaining&limit=200`;
    if (endedLink) endedLink.href = `https://www.ebay.${domain}/sh/lst/ended?status=UNSOLD_NOT_RELISTED`;
  } catch (_) {}
})();
