const assert = require('node:assert/strict');
const { groupWords, matchesForConcept } = require('../meaning-requests.js');
const rows = [
  { word: 'sol', pronunciation: 'sol', meaning: 'Sunlight through leaves', meaningUpdatedTimestamp: 10 },
  { word: 'sol', pronunciation: 'wrong', meaning: null, hearted: true, updatedTimestamp: 1000 },
  { word: 'sol', pronunciation: 'sol', meaning: 'sunlight through leaves', meaningUpdatedTimestamp: 9 },
  { word: 'sol', pronunciation: 's', meaning: 'Dappled warmth', meaningUpdatedTimestamp: 8, definitionReview: { status: 'candidate' } },
  { word: 'glow', pronunciation: 'g', meaning: 'warm sunlight', meaningUpdatedTimestamp: 20, definitionReview: { status: 'candidate' } },
  { word: 'blank', pronunciation: 'b', meaning: '  ', hearted: true },
  { word: 'accent', pronunciation: 'a', meaning: 'Un café chaud' },
  { word: 'substring', pronunciation: 's', meaning: 'Warmer sunlit glow' },
  { word: 'heart-only', pronunciation: 'h', hearted: true },
  { word: 'verb', pronunciation: 'v', meaning: 'to run', meaningUpdatedTimestamp: 30 },
  { conceptData: { text: 'sunlight' } }
];
const words = groupWords(rows);
const sol = words.find(word => word.word === 'sol');
assert.equal(sol.hasDefinition, true, 'New heart-only rows do not make a defined spelling undefined');
assert.equal(sol.pronunciation, 'sol', 'Pronunciation follows the latest definition, not a heart-only row');
assert.equal(sol.definitions.length, 2, 'Identical definitions are deduplicated ignoring case');
assert.equal(sol.definitions[0].category, 'Defined');
assert.equal(sol.definitions[1].category, 'Candidate');
assert.equal(words.find(word => word.word === 'glow').hasDefinition, true);
assert.deepEqual(words.filter(word => !word.hasDefinition).map(word => word.word), ['blank', 'heart-only']);
const matches = matchesForConcept('WARM sunlight sunlight', words);
assert.deepEqual(matches.map(word => word.word), ['glow', 'sol']);
assert.equal(matches[0].score, 2, 'Rank by distinct matching query words');
assert.deepEqual(matchesForConcept('dappled', words), [], 'Older definitions do not participate');
assert.equal(matchesForConcept('warm', words)[0].definitions[0].category, 'Candidate', 'Latest candidate definitions still participate');
assert.equal(matchesForConcept('sunlight dappled', words).find(word => word.word === 'sol').definitions.length, 1, 'Results show only the latest definition');
assert.equal(matchesForConcept('sunlight dappled', words).find(word => word.word === 'sol').score, 1, 'Older definitions do not contribute to ranking');
assert.deepEqual(matchesForConcept('TO', words), [], 'A query containing only to returns no results');
assert.deepEqual(matchesForConcept('To run', words).map(word => word.word), ['verb'], 'To is ignored case-insensitively, but other words still match');
assert.equal(matchesForConcept('to sunlight', words).some(word => word.word === 'verb'), false, 'To alone cannot produce a match');
assert.equal(matchesForConcept('cafe\u0301', words)[0].word, 'accent', 'Unicode normalization is applied');
assert.equal(matchesForConcept('warm', words).some(word => word.word === 'substring'), false, 'No stemming or substring matching');
assert.equal(matchesForConcept('through', words)[0].word, 'sol', 'Other query words are retained');
assert.deepEqual(matchesForConcept('!!!', words), []);
assert.deepEqual(matchesForConcept('unknown', words), []);
console.log('Concept matching tests passed.');
