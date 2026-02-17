import { GENERATE_TITLES } from '../../lib/message-types.js';

const consoleEl = document.getElementById('console-output');
const titlesOutput = document.getElementById('titles-output');
const tfidfOutput = document.getElementById('tfidf-output');
const btnGenerate = document.getElementById('btn-generate');
const btnTfidf = document.getElementById('btn-tfidf');

function log(text, type = '') {
  const line = document.createElement('div');
  line.className = `console-line ${type ? 'console-' + type : ''}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  consoleEl.appendChild(line);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

// Generate titles
btnGenerate.addEventListener('click', async () => {
  const title = document.getElementById('product-title').value.trim();
  if (!title) {
    log('Please enter a product title.', 'error');
    return;
  }

  const description = document.getElementById('product-description').value.trim();
  const competitorTitlesText = document.getElementById('competitor-titles').value.trim();

  btnGenerate.disabled = true;
  log('Starting title generation...', 'info');

  // Run TF-IDF if competitor titles provided
  let keywords = [];
  if (competitorTitlesText) {
    if (!window.TfIdf) {
      log('TF-IDF library not loaded.', 'error');
    } else {
      log('Running TF-IDF analysis on competitor titles...', 'info');
      const competitorTitles = competitorTitlesText.split('\n').filter(t => t.trim());
      const tfidfResults = window.TfIdf.analyze(competitorTitles);
      keywords = tfidfResults.slice(0, 20).map(r => r.term);
      displayTfIdf(tfidfResults);
      log(`Found ${tfidfResults.length} keywords, top: ${keywords.slice(0, 5).join(', ')}`, 'success');
    }
  }

  // Call backend for AI title generation
  log('Requesting AI-generated titles...', 'info');
  try {
    const response = await chrome.runtime.sendMessage({
      type: GENERATE_TITLES,
      title,
      description,
      keywords
    });

    if (!response) {
      log('No response from background worker.', 'error');
      return;
    }

    if (response.error) {
      log(`Error: ${response.error}`, 'error');
      return;
    }

    if (response.titles) {
      displayTitles(response.titles);
      log(`Generated ${response.titles.length} titles successfully!`, 'success');
    }
  } catch (error) {
    log(`Error: ${error.message}`, 'error');
  } finally {
    btnGenerate.disabled = false;
  }
});

// TF-IDF only
btnTfidf.addEventListener('click', () => {
  const competitorTitlesText = document.getElementById('competitor-titles').value.trim();
  if (!competitorTitlesText) {
    log('Please enter competitor titles for analysis.', 'error');
    return;
  }

  if (!window.TfIdf) {
    log('TF-IDF library not loaded.', 'error');
    return;
  }

  const competitorTitles = competitorTitlesText.split('\n').filter(t => t.trim());
  log(`Running TF-IDF on ${competitorTitles.length} titles...`, 'info');

  const results = window.TfIdf.analyze(competitorTitles);
  displayTfIdf(results);
  log(`Analysis complete: ${results.length} keywords found.`, 'success');
});

function displayTitles(titles) {
  titlesOutput.innerHTML = '';
  titles.forEach((title, i) => {
    const item = document.createElement('div');
    item.className = 'title-item';

    const len = title.length;
    let lengthClass = 'good';
    if (len > 80) lengthClass = 'bad';
    else if (len > 75) lengthClass = 'warning';
    else if (len < 50) lengthClass = 'warning';

    const titleText = document.createElement('div');
    titleText.className = 'title-text';
    titleText.textContent = `${i + 1}. ${title}`;

    const lengthSpan = document.createElement('span');
    lengthSpan.className = `title-length ${lengthClass}`;
    lengthSpan.textContent = `${len}/80 characters`;

    item.append(titleText, lengthSpan);

    // Click to copy
    item.addEventListener('click', () => {
      navigator.clipboard.writeText(title);
      item.style.borderColor = '#4caf50';
      setTimeout(() => { item.style.borderColor = ''; }, 1000);
    });

    titlesOutput.appendChild(item);
  });
}

function displayTfIdf(results) {
  if (results.length === 0) {
    tfidfOutput.textContent = 'No keywords found.';
    return;
  }

  const maxScore = results[0].score;
  const table = document.createElement('table');
  table.className = 'tfidf-table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  ['#', 'Keyword', 'TF-IDF Score', 'DF', 'Visual'].forEach(text => {
    const th = document.createElement('th');
    th.textContent = text;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  results.slice(0, 30).forEach((r, i) => {
    const row = document.createElement('tr');
    const barWidth = Math.max(2, (r.score / maxScore) * 100);

    const tdNum = document.createElement('td');
    tdNum.textContent = i + 1;
    const tdTerm = document.createElement('td');
    tdTerm.textContent = r.term;
    const tdScore = document.createElement('td');
    tdScore.textContent = r.score;
    const tdDf = document.createElement('td');
    tdDf.textContent = r.df;
    const tdBar = document.createElement('td');
    const bar = document.createElement('div');
    bar.className = 'score-bar';
    bar.style.width = `${barWidth}%`;
    tdBar.appendChild(bar);

    row.append(tdNum, tdTerm, tdScore, tdDf, tdBar);
    tbody.appendChild(row);
  });
  table.appendChild(tbody);

  tfidfOutput.innerHTML = '';
  tfidfOutput.appendChild(table);
}
