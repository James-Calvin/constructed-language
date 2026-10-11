(function (root) {
  "use strict";
  const grouping = typeof module !== "undefined" && module.exports
    ? require("./meaning-requests.js") : root.SECRET_MEANING_REQUESTS;
  function validCard(row) {
    const card = row?.flashcardData;
    return Boolean(card && card.kind === "sentence" && typeof card.id === "string" && card.id &&
      row.rowId === `__secret_flashcard__::${card.id}` && row.timestamp === 0 &&
      typeof card.sentence === "string" && card.sentence.trim() && card.sentence.length <= 4000 &&
      typeof card.translation === "string" && card.translation.trim() && card.translation.length <= 4000 &&
      typeof card.revision === "string" && card.revision && typeof card.author === "string" &&
      Number.isFinite(card.createdAt) && typeof card.editor === "string" && Number.isFinite(card.editedAt));
  }
  function cards(rows, { words = true, candidates = false, sentences = true, groupedWords } = {}) {
    return [
      ...(words || candidates ? (groupedWords || grouping.groupWords(rows)).filter(word => word.hasDefinition &&
        (word.definitionReview?.status === "candidate" ? candidates : words)).map(word => ({
        id: `word:${word.word}`, type: "word", front: word.word, back: word.meaning,
        pronunciation: word.pronunciation
      })) : []),
      ...(sentences ? rows.filter(validCard).map(({ flashcardData: card }) => ({
        id: `sentence:${card.id}`, type: "sentence", front: card.sentence, back: card.translation
      })).sort((a, b) => a.id.localeCompare(b.id)) : [])
    ];
  }
  function round(deck, random = Math.random) {
    const shuffled = deck.map(card => ({ ...card }));
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.map(card => ({ ...card, startsOnBack: card.type === "word" && random() < 0.5 }));
  }
  function face(card, flipped = false) {
    const back = card.type === "sentence" ? flipped : card.startsOnBack !== flipped;
    return {
      label: card.type === "word" ? (back ? "Definition" : "Word") : (back ? "Translation" : "Sentence"),
      text: back ? card.back : card.front,
      pronunciation: card.type === "word" && !back ? card.pronunciation : ""
    };
  }
  const api = { validCard, cards, round, face };
  root.SECRET_FLASHCARD_DECK = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
