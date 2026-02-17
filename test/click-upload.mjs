import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Click the "Upload photos" button and watch for file inputs being created
const result = await ebayPage.evaluate(async () => {
  // Set up a MutationObserver to catch any new file inputs
  const newInputs = [];
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1) {
          if (node.tagName === 'INPUT' && node.type === 'file') {
            newInputs.push({ id: node.id, accept: node.accept, name: node.name });
          }
          const inputs = node.querySelectorAll?.('input[type="file"]');
          if (inputs) {
            for (const i of inputs) {
              newInputs.push({ id: i.id, accept: i.accept, name: i.name });
            }
          }
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Find and click the "Upload photos" button
  const btn = Array.from(document.querySelectorAll('button')).find(b => 
    b.textContent.includes('Upload photos')
  );
  
  if (!btn) return { error: 'Upload photos button not found' };
  
  btn.click();
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  
  await new Promise(r => setTimeout(r, 2000));
  
  observer.disconnect();
  
  // Check for new file inputs
  const allInputs = Array.from(document.querySelectorAll('input[type="file"]'));
  
  return {
    clicked: true,
    newInputsDetected: newInputs,
    allFileInputsNow: allInputs.map(i => ({ id: i.id, accept: i.accept, type: i.type, hidden: i.offsetParent === null })),
  };
});

console.log(JSON.stringify(result, null, 2));

browser.disconnect();
