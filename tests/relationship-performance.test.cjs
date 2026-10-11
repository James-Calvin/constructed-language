const assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
global.SECRET_MEANING_REQUESTS=require('../meaning-requests.js');global.SECRET_DEFINITIONS=require('../definition-workflow.js');
const api=require('../word-relationships.js'),original=SECRET_MEANING_REQUESTS.groupWords;
let calls=0;SECRET_MEANING_REQUESTS.groupWords=rows=>{calls++;return original(rows);};
const rows=[];
for(let i=0;i<100;i++){const word='w'+String(i).padStart(4,'0');rows.push({rowId:'row'+i,timestamp:i+1,word,pronunciation:'a',meaning:'meaning',user:'alice',hearted:true});rows.push({rowId:'node'+i,timestamp:0,lexemeData:{spelling:word,source:{rowId:'row'+i,timestamp:i+1}}});}
const service=api.create({client:()=>null,table:'test',user:()=> 'alice'});service.load(rows);const started=performance.now();
for(let card=0;card<30;card++){service.choices();service.resolve('node'+card);service.relationships('node'+card);service.counts();}
assert.equal(calls,1,'Thirty cards and repeated endpoint lookups group exactly once');
assert.equal(service.choices().length,100);assert.equal(service.resolve('node20').spelling,'w0020');
service.remember({...rows[0],word:'renamed'});assert.equal(service.resolve('node0').spelling,'renamed');assert.equal(calls,2,'A mutation invalidates derived indexes');
service.load(rows);service.choices();assert.equal(calls,3);
SECRET_MEANING_REQUESTS.groupWords=original;
console.log(`Relationship performance regression passed: 100 words, 30 lookups, one grouping (${(performance.now()-started).toFixed(1)} ms including mutation checks).`);
