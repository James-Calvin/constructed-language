const assert = require('node:assert/strict');
const { calculate } = require('../generator-normalization.js');
const { search, symbolWeight } = require('../prefix-generator.js');
const config = { vowels: [{symbol:'a',ipa:'ɑ'},{symbol:'i',ipa:'ɪ'},{symbol:'u',ipa:'ʊ'}],
  consonants: [{symbol:'b',ipa:'b'},{symbol:'sh',ipa:'ʃ'}],
  syllablePatterns: {single:['CV'],initial:['CV'],medial:['CV'],final:['CV']},
  transitionRules:[],syllableEndBans:[],wordEndBans:[] };
const row = (word, extras={}) => ({word,pronunciation:word,...extras});
const rows = [row('baba',{meaning:'accepted',meaningUpdatedTimestamp:1}),
  row('baba',{hearted:true,updatedTimestamp:99}),
  row('bi',{meaning:'candidate',definitionReview:{status:'candidate'}}),
  row('shu',{hearted:true}),row('sh',{hearted:false}),row('?',{meaning:'unknown'}),{conceptData:{text:'a'}}];
const settings = {all:{enabled:true,categories:['defined','candidate','undefined']},
  start:{enabled:true,categories:['undefined']},end:{enabled:false,categories:['defined']}};
let result = calculate(rows,config,settings);
assert.deepEqual({...result.weights.all},{a:1,i:2,u:2,b:1,sh:3});
assert.deepEqual({...result.weights.start},{a:1,i:1,u:1,b:2,sh:1});
assert.equal(result.weights.end,undefined);
assert.equal(result.reports.all.selected,4);
assert.equal(result.reports.all.excluded.length,1);
assert.equal(result.reports.all.analyzed,3);
assert.deepEqual(calculate(rows,config,{}).weights,{});
assert.ok(Object.values(calculate(rows,config,{all:{enabled:true,categories:[]}}).weights.all).every(w=>w===1));
const w={all:{a:100,b:100},start:{a:2,b:3},end:{a:5,b:7}};
assert.equal(symbolWeight(w,'a',false,false),100);
assert.equal(symbolWeight(w,'a',true,false),2);
assert.equal(symbolWeight(w,'a',false,true),5);
assert.equal(symbolWeight(w,'a',true,true),10);
assert.equal(symbolWeight({end:{a:5},all:{a:100}},'a',true,true),5);
assert.equal(symbolWeight({},'a',true,true),1);
// Deterministic sampling: symbol probabilities use weights among viable symbols.
const single = {...config,syllablePatterns:{...config.syllablePatterns,single:['V']}};
const pick = random => search(single,'',1,1,true,new Set(),{weights:{all:{a:1,i:3,u:6}},random:()=>random}).candidate.word;
assert.equal(pick(.05),'a'); assert.equal(pick(.2),'i'); assert.equal(pick(.5),'u');
const banned={...single,wordEndBans:['u']};
assert.equal(search(banned,'',1,1,true,new Set(),{weights:{all:{a:1,i:3,u:10000}},random:()=>.9}).candidate.word,'i');
const blocked={...config,transitionRules:[{scope:'syllable',triggerSymbol:'b',blockedNextSymbols:['a','i','u']}]};
assert.equal(search(blocked,'',1,1,true,new Set(),{weights:{start:{b:10000,sh:1}},random:()=>0}).candidate.word,'sha');
const one=search(single,'',1,1,true,new Set(),{weights:{all:{a:9999},start:{a:2,i:1,u:1},end:{a:2,i:1,u:1}},random:()=>.5});
assert.equal(one.candidate.word,'a','Both edge weights multiply; all-position weights do not apply');
console.log('Generator normalization tests passed.');
