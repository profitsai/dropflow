import { ASK_CHATGPT } from '../../lib/message-types.js';

const promptInput = document.getElementById('prompt-input');
const modelSelect = document.getElementById('model-select');
const btnSend = document.getElementById('btn-send');
const btnClear = document.getElementById('btn-clear');
const chatHistory = document.getElementById('chat-history');

let messagesSent = 0;
let firstMessage = true;

// Send message
btnSend.addEventListener('click', sendMessage);
promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendMessage();
});

async function sendMessage() {
  const prompt = promptInput.value.trim();
  if (!prompt || btnSend.disabled) return;

  // Clear placeholder on first message
  if (firstMessage) {
    chatHistory.innerHTML = '';
    firstMessage = false;
  }

  // Add user message
  addMessage('user', prompt);
  promptInput.value = '';
  btnSend.disabled = true;

  // Add loading indicator
  const loadingEl = addMessage('assistant', 'Thinking...', true);

  const startTime = Date.now();

  try {
    const response = await chrome.runtime.sendMessage({
      type: ASK_CHATGPT,
      prompt,
      model: modelSelect.value
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    loadingEl.remove();

    if (!response) {
      addMessage('assistant', 'Error: No response from background worker.');
    } else if (response.error) {
      addMessage('assistant', `Error: ${response.error}`);
    } else {
      addMessage('assistant', response.response || 'No response received');
      document.getElementById('stat-time').textContent = `${elapsed}s`;
    }

    messagesSent++;
    document.getElementById('stat-sent').textContent = messagesSent;
  } catch (error) {
    loadingEl.remove();
    addMessage('assistant', `Error: ${error.message}`);
  } finally {
    btnSend.disabled = false;
    promptInput.focus();
  }
}

function addMessage(role, content, isLoading = false) {
  const msg = document.createElement('div');
  msg.className = `chat-message ${role}${isLoading ? ' loading' : ''}`;

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `${role === 'user' ? 'You' : 'ChatGPT'} - ${new Date().toLocaleTimeString()}`;

  const contentDiv = document.createElement('div');
  contentDiv.className = 'content';
  contentDiv.textContent = content;

  msg.append(meta, contentDiv);
  chatHistory.appendChild(msg);
  chatHistory.scrollTop = chatHistory.scrollHeight;
  return msg;
}

// Clear
btnClear.addEventListener('click', () => {
  chatHistory.innerHTML = '';
  const placeholder = document.createElement('p');
  placeholder.className = 'placeholder-text';
  placeholder.textContent = 'Messages will appear here...';
  chatHistory.appendChild(placeholder);

  firstMessage = true;
  messagesSent = 0;
  document.getElementById('stat-sent').textContent = '0';
  document.getElementById('stat-time').textContent = '-';
  document.getElementById('stat-tokens').textContent = '0';
});
