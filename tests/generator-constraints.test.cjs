const assert=require('node:assert/strict');
const {search}=require('../prefix-generator.js');
const config={vowels:[{symbol:'a',ipa:'ɑ'},{symbol:'i',ipa:'ɪ'},{symbol:'ai',ipa:'e'}],
  consonants:[{symbol:'b',ipa:'b'},{symbol:'sh',ipa:'ʃ'}],
  syllablePatterns:{single:['CV','VV'],initial:['CV'],medial:['CV'],final:['CV']},
  transitionRules:[],syllableEndBans:[],wordEndBans:[]};
const run=(prefix,suffix,min=1,max=1,extras={})=>search(config,prefix,min,max,false,new Set(),{suffix,...extras});
assert.equal(run('','s').reason,'invalid');
assert.equal(run('','A').reason,'invalid');
assert.equal(run('','z').reason,'invalid');
assert.equal(run('',' i ').candidate.word,'bi');
assert.equal(run('','sh').reason,'impossible');
assert.equal(run('b','i').candidate.word,'bi');
assert.equal(run('ba','ba').candidate.word,'ba','Prefix/suffix may completely overlap');
assert.equal(run('bai','ai').candidate.word,'bai');
assert.equal(run('bai','ai').ambiguous,true);
assert.equal(run('ba','aba',2,2).candidate.word,'baba','Suffix spans syllables');
assert.equal(run('ba','ba',1,2).candidate.ipa,'bɑ');
const across={...config,vowels:[{symbol:'ai',ipa:'e'},{symbol:'i',ipa:'ɪ'}],syllablePatterns:{single:['V'],initial:['V'],medial:['V'],final:['V']}};
assert.equal(search(across,'',1,1,false,new Set(),{suffix:'i'}).candidate.word,'i','Do not accept suffix inside ai');
assert.equal(search(across,'ai',1,1,false,new Set(),{suffix:'i'}).reason,'impossible');
assert.equal(search({...config,wordEndBans:['i']},'',1,1,false,new Set(),{suffix:'i'}).reason,'impossible');
assert.equal(search({...config,syllableEndBans:['i']},'',1,1,false,new Set(),{suffix:'i'}).reason,'impossible');
const boundary={...config,transitionRules:[{scope:'boundary',triggerSymbol:'a',blockedNextSymbols:['b','sh']}]};
assert.equal(search(boundary,'ba',2,2,false,new Set(),{suffix:'ba'}).reason,'impossible');
const seen=new Set();
let result;
while((result=search(config,'',1,1,true,seen,{suffix:'i'})).ready) {
  assert.ok(result.candidate.word.endsWith('i'));
  assert.ok(!seen.has(result.candidate.word)); seen.add(result.candidate.word);
}
assert.equal(result.reason,'exhausted');
assert.ok(seen.size>0);
const unicode={...config,vowels:[{symbol:'é',ipa:'e'},{symbol:'😀',ipa:'o'}]};
assert.equal(search(unicode,'sh',1,1,false,new Set(),{suffix:'😀'}).candidate.word,'sh😀');
// Large spaces are memoized, including duplicate exclusions, not enumerated.
const large={...config,vowels:['a','i','u','e','o'].map(symbol=>({symbol,ipa:symbol})),
  consonants:['b','c','d','f','g'].map(symbol=>({symbol,ipa:symbol}))};
assert.equal(search(large,'',12,12,true,new Set(['ba'.repeat(12)]),{suffix:'i',random:()=>.2}).candidate.symbols.length,24);
console.log('Generator constraint tests passed.');
