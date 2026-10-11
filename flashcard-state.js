(function (root) {
  "use strict";
  const PREFIX = "secret.flashcards.v1:";
  const selectionsValid = value => value && ["words", "candidates", "sentences"].every(key => typeof value[key] === "boolean");
  function valid(state) {
    return Boolean(state && selectionsValid(state.selections) && selectionsValid(state.roundSelections) &&
      Array.isArray(state.round) && state.round.every(card => card && typeof card.id === "string" &&
        ["word", "sentence"].includes(card.type) && typeof card.front === "string" && typeof card.back === "string" &&
        typeof card.startsOnBack === "boolean" && (card.type !== "word" || typeof card.pronunciation === "string")) &&
      new Set(state.round.map(card => card.id)).size === state.round.length &&
      Number.isInteger(state.position) && state.position >= 0 && state.position <= state.round.length &&
      typeof state.flipped === "boolean" && typeof state.dataSignature === "string" && typeof state.dataChanged === "boolean");
  }
  function create({ scope, storage }) {
    if (storage === undefined) { try { storage = root.localStorage; } catch { /* Memory-only fallback. */ } }
    const key = PREFIX + JSON.stringify(scope);
    let memory = null;
    function load() {
      try {
        const saved = JSON.parse(storage?.getItem(key) || "null");
        if (valid(saved)) memory = saved;
      } catch { /* Malformed or unavailable storage must not prevent study. */ }
      return memory ? JSON.parse(JSON.stringify(memory)) : null;
    }
    function save(state) {
      if (!valid(state)) return;
      memory = JSON.parse(JSON.stringify(state));
      try { storage?.setItem(key, JSON.stringify(memory)); }
      catch { try { storage?.removeItem?.(key); } catch { /* Keep the in-memory state. */ } }
    }
    return { load, save };
  }
  const api = { create, valid, PREFIX };
  root.SECRET_FLASHCARD_STATE = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
