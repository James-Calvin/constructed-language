(function (root) {
  "use strict";
  const analytics = typeof module !== "undefined" && module.exports
    ? require("./symbol-analytics.js") : root.SECRET_SYMBOL_ANALYTICS;
  function calculate(raw, config, settings, groupedWords) {
    const weights = {};
    const reports = {};
    const words=groupedWords||(typeof module!=="undefined"&&module.exports?require("./meaning-requests.js"):root.SECRET_MEANING_REQUESTS).groupWords(raw);
    for (const position of ["start", "all", "end"]) {
      if (!settings[position]?.enabled) continue;
      const report = analytics.analyze(raw, config, { position, categories: settings[position].categories,groupedWords:words });
      reports[position] = report;
      const scores = Object.create(null);
      for (const type of ["vowels", "consonants"]) {
        const symbols = report.symbols.filter(entry => entry.type === type);
        const highest = Math.max(0, ...symbols.map(entry => entry.total));
        for (const entry of symbols) scores[entry.symbol] = highest + 1 - entry.total;
      }
      weights[position] = scores;
    }
    return { weights, reports };
  }
  const api = { calculate };
  root.SECRET_GENERATOR_NORMALIZATION = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
