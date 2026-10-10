const assert = require('node:assert/strict');
const { analyze, tokenize } = require('../symbol-analytics.js');
const config = { vowels: [{symbol:'a'}, {symbol:'é'}, {symbol:'A'}], consonants: [{symbol:'sh'}, {symbol:'b'}, {symbol:'z'}] };
const row = (word, extra = {}) => ({ word, pronunciation: 'irrelevant', ...extra });
const rows = [row('aba', {meaning:'old', timestamp:1}), row('aba', {hearted:true, timestamp:100}),
  row('aba', {meaning:'new', meaningUpdatedTimestamp:2, definitionReview:{status:'candidate'}}),
  row('shé', {meaning:'legacy accepted'}), row('A', {hearted:true}), row('b', {hearted:false}),
  row('?', {meaning:'unknown'}), {conceptData:{text:'a'}}, {notesData:{}}, {settings:{}},
  row('z'), {word:'a', meaning:'no IPA'}];
let result = analyze(rows, config);
assert.equal(result.selected, 4);
assert.equal(result.analyzed, 3);
assert.equal(result.excluded.length, 1);
assert.equal(result.occurrences, 6);
assert.equal(result.symbols.find(s => s.symbol === 'a').candidate, 2);
assert.equal(result.symbols.find(s => s.symbol === 'a').defined, 0);
assert.equal(result.symbols.find(s => s.symbol === 'sh').defined, 1);
assert.equal(result.symbols.find(s => s.symbol === 'A').undefined, 1);
assert.equal(result.symbols.find(s => s.symbol === 'z').total, 0);
assert.equal(result.symbols[0].symbol, 'a');
assert.ok(Math.abs(result.symbols.reduce((sum,s) => sum+s.percentage,0)-100) < 1e-9);
assert.ok(Math.abs(result.symbols.find(s => s.symbol === 'a').percentage - 100/3) < 1e-9);
result = analyze(rows, config, {position:'start'});
assert.equal(result.occurrences, 3);
assert.equal(result.symbols.find(s => s.symbol === 'sh').total, 1);
assert.equal(result.symbols.find(s => s.symbol === 'b').total, 0);
result = analyze(rows, config, {position:'end'});
assert.equal(result.occurrences, 3);
assert.equal(result.symbols.find(s => s.symbol === 'é').total, 1);
result = analyze(rows, config, {categories:['defined']});
assert.equal(result.analyzed, 1);
assert.equal(result.symbols.find(s => s.symbol === 'sh').percentage, 50);
assert.equal(analyze(rows, config, {categories:[]}).selected, 0);
assert.equal(analyze([], config).symbols.length, 6);
assert.equal(analyze(rows, {}).symbols.length, 0);
assert.deepEqual(tokenize('shshé', ['sh','é']).tokens, ['sh','sh','é']);
assert.deepEqual(tokenize('😀a', ['😀','a']).tokens, ['😀','a']);
assert.equal(tokenize('a', ['A']).tokens, null);
assert.equal(tokenize('s', ['sh']).tokens, null);
assert.equal(tokenize('a.b', ['a','b']).tokens, null);
assert.match(tokenize('aa', ['a','aa']).reason, /Ambiguous/);
assert.match(tokenize('a'.repeat(1000), ['a','aa']).reason, /Ambiguous/);
assert.deepEqual(tokenize('aa', ['a','a']).tokens, ['a','a']);
result = analyze([row('aa', {hearted:true})], {vowels:[{symbol:'a'},{symbol:'aa'}]});
assert.equal(result.analyzed, 0);
assert.equal(result.occurrences, 0);
assert.match(result.excluded[0].reason, /Ambiguous/);
console.log('Symbol analytics tests passed.');
