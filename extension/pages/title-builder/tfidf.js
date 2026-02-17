/**
 * Client-side TF-IDF implementation for keyword analysis.
 * Used by the Title Builder to analyze competitor titles.
 */

window.TfIdf = (function () {
  /**
   * Tokenize a string into words.
   */
  function tokenize(text) {
    return text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 1);
  }

  /**
   * Compute term frequency for a document.
   */
  function termFrequency(tokens) {
    const tf = {};
    for (const token of tokens) {
      tf[token] = (tf[token] || 0) + 1;
    }
    // Normalize by document length
    const len = tokens.length;
    for (const term in tf) {
      tf[term] = tf[term] / len;
    }
    return tf;
  }

  /**
   * Compute TF-IDF across a corpus of documents.
   * @param {string[]} documents - Array of document strings
   * @returns {Array<{term: string, score: number, tf: number, idf: number, df: number}>}
   */
  function analyze(documents) {
    const N = documents.length;
    if (N === 0) return [];

    const tokenizedDocs = documents.map(tokenize);

    // Document frequency
    const df = {};
    for (const tokens of tokenizedDocs) {
      const unique = new Set(tokens);
      for (const term of unique) {
        df[term] = (df[term] || 0) + 1;
      }
    }

    // TF-IDF scores (max across all documents)
    const scores = {};
    for (const tokens of tokenizedDocs) {
      const tf = termFrequency(tokens);
      for (const [term, tfVal] of Object.entries(tf)) {
        const idf = Math.log(N / (df[term] || 1));
        const tfidf = tfVal * idf;
        if (!scores[term] || tfidf > scores[term].score) {
          scores[term] = { term, score: tfidf, tf: tfVal, idf, df: df[term] };
        }
      }
    }

    return Object.values(scores)
      .sort((a, b) => b.score - a.score)
      .map(s => ({
        ...s,
        score: Math.round(s.score * 10000) / 10000,
        tf: Math.round(s.tf * 10000) / 10000,
        idf: Math.round(s.idf * 10000) / 10000
      }));
  }

  return { analyze, tokenize, termFrequency };
})();
