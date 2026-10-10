(function (scope) {
  "use strict";
  function tokenizationCount(text, inventory) {
    const counts = Array(text.length + 1).fill(0); counts[0] = 1;
    for (let i = 0; i < text.length; i++) {
      if (!counts[i]) continue;
      for (const { symbol } of inventory) if (text.startsWith(symbol, i)) {
        const end = i + symbol.length;
        counts[end] = Math.min(2, counts[end] + counts[i]);
      }
    }
    return counts[text.length];
  }
  function symbolWeight(weights, symbol, start, end) {
    const positive = value => Number.isFinite(value) && value > 0 ? value : 1;
    const atStart = start && weights.start;
    const atEnd = end && weights.end;
    if (atStart && atEnd) return positive(atStart[symbol]) * positive(atEnd[symbol]);
    return positive((atStart || atEnd || weights.all || {})[symbol]);
  }
  // The optional seventh argument extends the existing prefix-only interface.
  function search(config, rawPrefix, min, max, randomize = false, excluded = new Set(), options = {}) {
    const prefix = rawPrefix.trim();
    const suffix = (options.suffix || "").trim();
    const weights = options.weights || {};
    const random = options.random || Math.random;
    const inventory = [
      ...config.vowels.map(entry => ({ ...entry, type: "V" })),
      ...config.consonants.map(entry => ({ ...entry, type: "C" }))
    ].filter(entry => entry.symbol);
    const prefixCount = tokenizationCount(prefix, inventory);
    const suffixCount = tokenizationCount(suffix, inventory);
    if (!prefixCount || !suffixCount) return { ready: false, reason: "invalid",
      message: "Enter complete configured symbols; the " + (!prefixCount ? "prefix" : "suffix") + " contains an unknown or partial symbol." };
    const syllableBans = new Set(config.syllableEndBans);
    const wordBans = new Set(config.wordEndBans);
    // A trie identifies excluded spellings without keeping every generated
    // prefix in the memo key (which would enumerate the entire word space).
    const trie = [{ children: new Map(), terminal: false }];
    for (const word of excluded) {
      let id = 0;
      for (const character of word) {
        if (!trie[id].children.has(character)) {
          trie[id].children.set(character, trie.length);
          trie.push({ children: new Map(), terminal: false });
        }
        id = trie[id].children.get(character);
      }
      trie[id].terminal = true;
    }
    function advanceExcluded(id, symbol) {
      for (const character of symbol) {
        if (id < 0) break;
        id = trie[id].children.get(character) ?? -1;
      }
      return id;
    }
    // Start suffix matches only at symbol boundaries; retain all viable offsets.
    function advanceSuffix(progress, symbol) {
      const next = new Set([0]);
      for (const offset of progress) if (suffix.startsWith(symbol, offset)) next.add(offset + symbol.length);
      return [...next].sort((a, b) => a - b);
    }
    const roots = [];
    for (let count = min; count <= max; count++) {
      const memo = new Map();
      function build(index, pattern, offset, consumed, previous, relation, progress, first, excludedId) {
        const key = JSON.stringify([index, pattern, offset, consumed, previous, relation, progress, first,
          excludedId]);
        if (memo.has(key)) return memo.get(key);
        const edges = [];
        if (pattern === null) {
          const kind = count === 1 ? "single" : index === 0 ? "initial" : index === count - 1 ? "final" : "medial";
          for (const value of config.syllablePatterns[kind]) {
            if (!value.length) continue;
            const next = build(index, value, 0, consumed, previous, relation, progress, first, excludedId);
            if (next) edges.push({ next, weight: 1 });
          }
        } else for (const entry of inventory) {
          if (entry.type !== pattern[offset]) continue;
          const endSyllable = offset === pattern.length - 1;
          const endWord = endSyllable && index === count - 1;
          if (endSyllable && syllableBans.has(entry.symbol) || endWord && wordBans.has(entry.symbol)) continue;
          if (config.transitionRules.some(rule => rule.triggerSymbol === previous &&
            (rule.scope === "word" || rule.scope === relation) && rule.blockedNextSymbols.includes(entry.symbol))) continue;
          let nextConsumed = consumed;
          if (consumed < prefix.length) {
            if (!prefix.startsWith(entry.symbol, consumed) || consumed + entry.symbol.length > prefix.length) continue;
            nextConsumed += entry.symbol.length;
          }
          const nextProgress = advanceSuffix(progress, entry.symbol);
          const nextExcludedId = advanceExcluded(excludedId, entry.symbol);
          let next;
          if (endWord) {
            if (nextConsumed === prefix.length && nextProgress.includes(suffix.length) &&
                (nextExcludedId < 0 || !trie[nextExcludedId].terminal)) next = { terminal: true };
          } else next = build(endSyllable ? index + 1 : index, endSyllable ? null : pattern,
            endSyllable ? 0 : offset + 1, nextConsumed, entry.symbol,
            endSyllable ? "boundary" : "syllable", nextProgress, false, nextExcludedId);
          if (next) edges.push({ next, entry, endSyllable, weight: symbolWeight(weights, entry.symbol, first, endWord) });
        }
        const result = edges.length ? { edges } : null;
        memo.set(key, result);
        return result;
      }
      const node = build(0, null, 0, 0, "", "", [0], true, 0);
      if (node) roots.push({ next: node, weight: 1 });
    }
    if (!roots.length) {
      const exhausted = excluded.size && search(config, rawPrefix, min, max, false, new Set(), options).ready;
      return { ready: false, reason: exhausted ? "exhausted" : "impossible", message: exhausted
        ? "All valid words for these constraints are already in the generated list. Clear the list or change the constraints."
        : "No valid completion exists for these constraints and syllable range." };
    }
    function choose(edges) {
      if (!randomize) return edges[0];
      let target = random() * edges.reduce((sum, edge) => sum + edge.weight, 0);
      for (const edge of edges) { target -= edge.weight; if (target < 0) return edge; }
      return edges[edges.length - 1];
    }
    let node = choose(roots).next;
    const syllables = [], sounds = [];
    let symbols = [], ipa = [];
    while (!node.terminal) {
      const edge = choose(node.edges);
      if (edge.entry) {
        symbols.push(edge.entry.symbol); ipa.push(edge.entry.ipa);
        if (edge.endSyllable) { syllables.push(symbols); sounds.push(ipa.join("")); symbols = []; ipa = []; }
      }
      node = edge.next;
    }
    const ambiguous = prefixCount > 1 || suffixCount > 1;
    return { ready: true, ambiguous, candidate: { word: syllables.flat().join(""),
      ipa: sounds.join("."), syllables, symbols: syllables.flat() },
    message: ambiguous ? "Multiple symbol mappings are possible; valid completions will be used." : "" };
  }
  const api = { search, symbolWeight };
  scope.SECRET_PREFIX_GENERATOR = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
