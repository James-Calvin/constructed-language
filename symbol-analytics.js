(function (root) {
  "use strict";
  const grouping = typeof module !== "undefined" && module.exports
    ? require("./meaning-requests.js") : root.SECRET_MEANING_REQUESTS;
  const categories = ["defined", "candidate", "undefined"];
  function inventory(config) {
    const seen = new Set();
    return ["vowels", "consonants"].flatMap(type => (config[type] || []).flatMap(entry => {
      const symbol = entry.symbol;
      if (typeof symbol !== "string" || !symbol || seen.has(symbol)) return [];
      seen.add(symbol);
      return [{ symbol, type }];
    }));
  }
  // Dynamic programming memoizes suffix counts, capped at two. Reconstruct only
  // a unique path; never prefer a longest match or enumerate exponential paths.
  function tokenize(word, symbols) {
    symbols = [...new Set(symbols.filter(Boolean))];
    const counts = new Uint8Array(word.length + 1);
    const next = new Array(word.length);
    counts[word.length] = 1;
    for (let i = word.length - 1; i >= 0; i--) {
      for (const symbol of symbols) {
        if (!word.startsWith(symbol, i) || !counts[i + symbol.length]) continue;
        counts[i] = Math.min(2, counts[i] + counts[i + symbol.length]);
        next[i] = symbol;
        if (counts[i] === 2) break;
      }
    }
    if (!word || !counts[0]) return { reason: "Unknown symbols or incomplete configured symbols", tokens: null };
    if (counts[0] > 1) return { reason: "Ambiguous symbol tokenization", tokens: null };
    const tokens = [];
    for (let i = 0; i < word.length; i += next[i].length) tokens.push(next[i]);
    return { tokens, reason: null };
  }
  function analyze(raw, config, options = {}) {
    const selected = new Set(options.categories || categories);
    const position = options.position || "all";
    const entries = inventory(config);
    const counts = new Map(entries.map(entry => [entry.symbol, { ...entry,
      defined: 0, candidate: 0, undefined: 0, total: 0, percentage: 0 }]));
    const words = grouping.groupWords(raw).filter(word => selected.has(!word.hasDefinition
      ? "undefined" : word.definitionReview?.status === "candidate" ? "candidate" : "defined"));
    const excluded = [];
    let analyzed = 0;
    let occurrences = 0;
    for (const word of words) {
      const result = tokenize(word.word, entries.map(entry => entry.symbol));
      if (!result.tokens) { excluded.push({ word: word.word, reason: result.reason }); continue; }
      analyzed++;
      const category = !word.hasDefinition ? "undefined" : word.definitionReview?.status === "candidate" ? "candidate" : "defined";
      const tokens = position === "start" ? result.tokens.slice(0, 1)
        : position === "end" ? result.tokens.slice(-1) : result.tokens;
      for (const token of tokens) { counts.get(token)[category]++; counts.get(token).total++; occurrences++; }
    }
    const symbols = [...counts.values()].map(entry => ({ ...entry,
      percentage: occurrences ? entry.total / occurrences * 100 : 0
    })).sort((a, b) => b.total - a.total || a.symbol.localeCompare(b.symbol));
    return { symbols, occurrences, selected: words.length, analyzed, excluded };
  }
  const api = { analyze, tokenize, inventory, categories };
  root.SECRET_SYMBOL_ANALYTICS = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
