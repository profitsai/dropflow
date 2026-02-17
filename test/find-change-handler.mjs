import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Check what event listeners are on the file input
const cdp = await ebayPage.createCDPSession();

// Find the input element's node ID
const { root } = await cdp.send('DOM.getDocument');
const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#fehelix-uploader' });

// Get event listeners
const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: (await cdp.send('DOM.resolveNode', { nodeId })).object.objectId });

for (const l of listeners) {
  console.log(`Event: ${l.type}, handler line: ${l.lineNumber}, column: ${l.columnNumber}`);
  console.log(`  Script: ${l.scriptId}`);
}

browser.disconnect();
