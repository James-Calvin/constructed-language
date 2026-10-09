(function (scope) {
  "use strict";
  function search(config, rawPrefix, min, max, randomize = false, excluded = new Set()) {
    const prefix = rawPrefix.trim();
    const inventory = [
      ...config.vowels.map((entry) => ({ ...entry, type: "V" })),
      ...config.consonants.map((entry) => ({ ...entry, type: "C" }))
    ];
    const counts = Array(prefix.length + 1).fill(0); counts[0] = 1;
    for (let i = 0; i < prefix.length; i++) {
      for (const entry of inventory) {
        if (entry.symbol && prefix.startsWith(entry.symbol, i)) {
          const end = i + entry.symbol.length;
          if (end <= prefix.length) counts[end] = Math.min(2, counts[end] + counts[i]);
        }
      }
    }
    if (!counts[prefix.length]) return { ready: false, message: "Enter complete configured symbols; the prefix contains an unknown or partial symbol." };
    const order = (values) => {
      const result = [...values];
      if (randomize) for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]];
      }
      return result;
    };
    const syllableBans = new Set(config.syllableEndBans);
    const wordBans = new Set(config.wordEndBans);
    for (const count of order(Array.from({ length: max - min + 1 }, (_, i) => min + i))) {
      const failed = new Set();
      function syllable(index, consumed, previous, previousRelation, symbols, sounds) {
        const key = count === 1 ? "single" : index === 0 ? "initial" : index === count - 1 ? "final" : "medial";
        for (const pattern of order(config.syllablePatterns[key])) {
          const result = slot(pattern, 0, index, consumed, previous, previousRelation, symbols, sounds, [], []);
          if (result) return result;
        }
        return null;
      }
      function slot(pattern, offset, index, consumed, previous, relation, symbols, sounds, currentSymbols, currentSounds) {
        const memoKey = JSON.stringify([pattern, offset, index, consumed, previous, relation,
          excluded.size ? symbols.concat(currentSymbols).flat().join("") : ""]);
        if (failed.has(memoKey)) return null;
        for (const entry of order(inventory.filter((entry) => entry.type === pattern[offset]))) {
          const endSyllable = offset === pattern.length - 1;
          const endWord = endSyllable && index === count - 1;
          if (endSyllable && syllableBans.has(entry.symbol)) continue;
          if (endWord && wordBans.has(entry.symbol)) continue;
          if (config.transitionRules.some((rule) => rule.triggerSymbol === previous &&
              (rule.scope === "word" || rule.scope === relation) && rule.blockedNextSymbols.includes(entry.symbol))) continue;
          let nextConsumed = consumed;
          if (consumed < prefix.length) {
            if (!prefix.startsWith(entry.symbol, consumed) || consumed + entry.symbol.length > prefix.length) continue;
            nextConsumed += entry.symbol.length;
          }
          const nextSymbols = currentSymbols.concat(entry.symbol);
          const nextSounds = currentSounds.concat(entry.ipa);
          let result;
          if (endWord) {
            const syllables = symbols.concat([nextSymbols]);
            const word = syllables.flat().join("");
            if (nextConsumed === prefix.length && !excluded.has(word)) {
              return { word, ipa: sounds.concat([nextSounds]).map((part) => part.join("")).join("."),
                syllables, symbols: syllables.flat() };
            }
          } else if (endSyllable) {
            result = syllable(index + 1, nextConsumed, entry.symbol, "boundary",
              symbols.concat([nextSymbols]), sounds.concat([nextSounds]));
          } else {
            result = slot(pattern, offset + 1, index, nextConsumed, entry.symbol, "syllable",
              symbols, sounds, nextSymbols, nextSounds);
          }
          if (result) return result;
        }
        failed.add(memoKey);
        return null;
      }
      const candidate = syllable(0, 0, "", "", [], []);
      if (candidate) return { ready: true, candidate, ambiguous: counts[prefix.length] > 1,
        message: counts[prefix.length] > 1 ? "Multiple symbol mappings are possible; valid completions will be used." : "" };
    }
    return { ready: false, message: "No valid completion exists for this prefix and syllable range." };
  }
  scope.SECRET_PREFIX_GENERATOR = { search };
})(window);
