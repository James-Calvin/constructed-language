const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync('prefix-generator.js', 'utf8'), context);
const search = context.window.SECRET_PREFIX_GENERATOR.search;
const config = {
  vowels: [{ symbol: 'a', ipa: 'ɑ' }, { symbol: 'i', ipa: 'i' }, { symbol: 'ai', ipa: 'e' }],
  consonants: [{ symbol: 'b', ipa: 'b' }, { symbol: 'ch', ipa: 'tʃ' }],
  syllablePatterns: { single: ['CV', 'VV'], initial: ['CV'], medial: ['CV'], final: ['CV'] },
  transitionRules: [], syllableEndBans: [], wordEndBans: []
};
assert.equal(search(config, 'c', 1, 1).ready, false);
assert.equal(search(config, 'z', 1, 1).ready, false);
assert.equal(search(config, ' b ', 1, 1).candidate.word.startsWith('b'), true);
assert.equal(search(config, 'ch', 1, 1).candidate.ipa.startsWith('tʃ'), true);
assert.equal(search(config, 'baba', 1, 1).ready, false);
assert.equal(search(config, 'baba', 2, 2).candidate.ipa, 'bɑ.bɑ');
assert.equal(search(config, 'ai', 1, 1).ambiguous, true);
assert.equal(search({ ...config, syllableEndBans: ['a', 'i', 'ai'] }, 'b', 1, 1).ready, false);
assert.equal(search({ ...config, wordEndBans: ['a', 'i', 'ai'] }, 'b', 1, 1).ready, false);
const blocked = { ...config, transitionRules: [{ scope: 'syllable', triggerSymbol: 'b', blockedNextSymbols: ['a', 'i', 'ai'] }] };
assert.equal(search(blocked, 'b', 1, 1).ready, false);
const boundaryBlocked = { ...config, transitionRules: [{ scope: 'boundary', triggerSymbol: 'a', blockedNextSymbols: ['b', 'ch'] }] };
assert.equal(search(boundaryBlocked, 'ba', 2, 2).ready, false);
const seen = new Set();
let result;
while ((result = search(config, 'b', 1, 1, true, seen)).ready) {
  assert.equal(result.candidate.word.startsWith('b'), true);
  assert.equal(seen.has(result.candidate.word), false);
  seen.add(result.candidate.word);
}
assert.equal(seen.size, 3);
console.log('Prefix generation tests passed');
