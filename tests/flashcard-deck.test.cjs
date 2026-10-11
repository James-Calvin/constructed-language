const assert = require('node:assert/strict');
const deck = require('../flashcard-deck.js');
const grouping = require('../meaning-requests.js');
const analytics = require('../symbol-analytics.js');
const sentence = { rowId: '__secret_flashcard__::one', timestamp: 0, flashcardData: {
  kind: 'sentence', id: 'one', sentence: 'etos ka', translation: 'hot sun', revision: 'v1',
  author: 'alice', editor: 'bob', createdAt: 1, editedAt: 2
} };
const raw = [
  { rowId: 'old', timestamp: 1, word: 'etos', pronunciation: 'etos', meaning: 'hot' },
  { rowId: 'new', timestamp: 2, word: 'etos', pronunciation: 'ɛtos', meaning: 'hot; fire', definitionReview: { status: 'defined' } },
  { rowId: 'heart', timestamp: 3, word: 'etos', pronunciation: 'etos', hearted: true },
  { rowId: 'ka', timestamp: 1, word: 'ka', pronunciation: 'ka', meaning: 'sun', definitionReview: { status: 'candidate' } },
  { rowId: 'empty', timestamp: 1, word: 'la', pronunciation: 'la', hearted: true },
  { rowId: 'legacy', timestamp: 1, word: 'mi', pronunciation: 'mi', meaning: 'me' },
  { rowId: 'settings', timestamp: 0, activeRules: {} }, sentence,
  { rowId: 'invalid', timestamp: 0, flashcardData: { sentence: 'no translation' } }
];
const cards = deck.cards(raw);
assert.deepEqual(cards.map(card => card.id), ['word:etos', 'word:mi', 'sentence:one']);
assert.equal(cards[0].back, 'hot; fire');
assert.equal(cards[0].pronunciation, 'ɛtos');
assert.equal(deck.cards(raw, { words: false }).length, 1);
assert.equal(deck.cards(raw, { sentences: false }).length, 2);
assert.equal(deck.cards(raw, { words: false, sentences: false }).length, 0);
assert.deepEqual(deck.cards(raw, { words: false, candidates: true, sentences: false }).map(card => card.id), ['word:ka']);
assert.deepEqual(deck.cards(raw, { candidates: true, sentences: false }).map(card => card.id), ['word:etos', 'word:ka', 'word:mi']);
const latestCandidate = raw.concat({ rowId: 'candidate-update', timestamp: 4, word: 'etos', pronunciation: 'etos',
  meaning: 'heat', definitionReview: { status: 'candidate' } });
assert.equal(deck.cards(latestCandidate).some(card => card.id === 'word:etos'), false);
assert.equal(deck.cards(latestCandidate, { words: false, candidates: true, sentences: false }).find(card => card.id === 'word:etos').back, 'heat');
assert.equal(deck.validCard(sentence), true);
assert.equal(deck.validCard({ ...sentence, rowId: 'bad' }), false);
assert.equal(grouping.groupWords(raw).length, 4, 'Sentence metadata is not a dictionary word');
assert.equal(analytics.analyze([sentence], { vowels: [{ symbol: 'a' }], consonants: [] }).selected, 0);
const round = deck.round(cards, () => 0);
assert.deepEqual(round.map(card => card.id), ['word:mi', 'sentence:one', 'word:etos']);
assert.ok(round.every(card => card.startsOnBack));
assert.equal(new Set(round.map(card => card.id)).size, cards.length);
assert.notEqual(round[0], cards[1]);
const word = { ...cards[0], startsOnBack: false };
assert.deepEqual(deck.face(word), { label: 'Word', text: 'etos', pronunciation: 'ɛtos' });
assert.deepEqual(deck.face(word, true), { label: 'Definition', text: 'hot; fire', pronunciation: '' });
assert.equal(deck.face({ ...word, startsOnBack: true }).label, 'Definition');
assert.equal(deck.face({ ...word, startsOnBack: true }, true).pronunciation, 'ɛtos');
assert.equal(deck.face({ ...cards[2], startsOnBack: true }).label, 'Translation');
assert.equal(deck.face({ ...cards[2], startsOnBack: false }).label, 'Sentence');
assert.ok(deck.round(cards, () => 0.99).every(card => !card.startsOnBack));
assert.deepEqual(deck.round([]), []);
raw[1].meaning = 'changed';
assert.equal(round.find(card => card.id === 'word:etos').back, 'hot; fire', 'Rounds freeze content');
console.log('Flashcard deck selection, shuffle, frozen content and face tests passed.');
