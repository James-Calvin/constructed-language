const assert = require('node:assert/strict');
const { create, valid } = require('../flashcard-state.js');
const saved = new Map();
const storage = { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
const scope = ['region', 'pool', 'table', 'alice'];
const state = {
  round: [{ id: 'word:ka', type: 'word', front: 'ka', back: 'sun', pronunciation: 'ka', startsOnBack: true }],
  selections: { words: false, candidates: true, sentences: true },
  roundSelections: { words: true, candidates: false, sentences: true },
  position: 0, flipped: true, dataSignature: 'baseline', dataChanged: true
};
assert.equal(valid(state), true);
const first = create({ scope, storage }); first.save(state);
const restored = create({ scope, storage }).load(); assert.deepEqual(restored, state);
restored.round[0].back = 'mutated'; assert.equal(first.load().round[0].back, 'sun');
assert.equal(create({ scope: ['region', 'pool', 'table', 'bob'], storage }).load(), null);
assert.equal(create({ scope: ['region', 'pool', 'other-table', 'alice'], storage }).load(), null);
assert.equal(create({ scope: ['other-region', 'pool', 'table', 'alice'], storage }).load(), null);
assert.equal(create({ scope: ['region', 'other-pool', 'table', 'alice'], storage }).load(), null);
for (const invalid of [
  { ...state, position: -1 }, { ...state, position: 2 }, { ...state, position: 0.5 },
  { ...state, selections: { words: 'yes' } }, { ...state, roundSelections: null },
  { ...state, round: [null] }, { ...state, round: [state.round[0], state.round[0]] },
  { ...state, flipped: 'true' }, { ...state, dataSignature: null }, { ...state, dataChanged: null },
  { ...state, round: [{ ...state.round[0], startsOnBack: null }] }
]) assert.equal(valid(invalid), false);
assert.equal(valid({ ...state, position: 1 }), true, 'Completed rounds restore');
assert.equal(valid({ ...state, round: [], position: 0 }), true, 'Intentionally empty rounds restore');
const malformed = { ...storage, getItem: () => '{broken' };
assert.equal(create({ scope, storage: malformed }).load(), null);
const invalidSaved = { ...storage, getItem: () => JSON.stringify({ ...state, position: 200 }) };
assert.equal(create({ scope, storage: invalidSaved }).load(), null);
const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('denied'); } };
const fallback = create({ scope, storage: denied });
assert.equal(fallback.load(), null); fallback.save(state); assert.deepEqual(fallback.load(), state);
const quota = create({ scope, storage: { ...storage, setItem() { throw new Error('full'); } } });
quota.save({ ...state, flipped: false });
assert.equal(create({ scope, storage }).load(), null, 'Failed persistence removes an older misleading saved image');
console.log('Flashcard browser state validation, isolation, restoration and storage fallback tests passed.');
