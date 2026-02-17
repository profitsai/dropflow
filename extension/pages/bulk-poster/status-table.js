import { BULK_LISTING_RESULT, BULK_LISTING_COMPLETE } from '../../lib/message-types.js';

const tableBody = document.getElementById('table-body');

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === BULK_LISTING_RESULT) {
    addRow(message.result);
  }
  if (message.type === BULK_LISTING_COMPLETE) {
    document.title = 'DropFlow - Listing Complete';
  }
});

function addRow(result) {
  const row = document.createElement('tr');

  const tdIndex = document.createElement('td');
  tdIndex.textContent = result.index + 1;

  const tdLink = document.createElement('td');
  const linkEl = document.createElement('a');
  linkEl.href = result.link;
  linkEl.target = '_blank';
  linkEl.textContent = result.link;
  tdLink.appendChild(linkEl);

  const tdStatus = document.createElement('td');
  tdStatus.className = result.status === 'success' ? 'status-success' : 'status-error';
  tdStatus.textContent = result.status;

  const tdMessage = document.createElement('td');
  tdMessage.textContent = result.message;

  const tdEbay = document.createElement('td');
  if (result.ebayUrl) {
    const ebayLink = document.createElement('a');
    ebayLink.href = result.ebayUrl;
    ebayLink.target = '_blank';
    ebayLink.textContent = 'View on eBay';
    tdEbay.appendChild(ebayLink);
  } else {
    tdEbay.textContent = '-';
  }

  row.append(tdIndex, tdLink, tdStatus, tdMessage, tdEbay);
  tableBody.appendChild(row);
}
