const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const cacheApi=require('../dictionary-cache.js'),source=fs.readFileSync('script.js','utf8');
const fingerprint=require('../cooperative-refresh.js').fingerprint;
function functionSource(name){const start=source.search(new RegExp(`(?:async )?function ${name}\\(`));assert.ok(start>=0,name);return source.slice(start,source.indexOf('\n}',start)+2);}
async function run(){
  let scans=0,writes=0,now=1000,syncOptions;
  const database=Array.from({length:20},(_,i)=>({rowId:'saved'+i,timestamp:i+1,word:'w'+i,pronunciation:'a',meaning:'meaning'+i,user:'alice',hearted:true}));
  const client={scan:()=>({promise:async()=>{scans++;return{Items:structuredClone(database)};}}),put:()=>{writes++;throw new Error('Unexpected write');}};
  const cache=cacheApi.create({client:()=>client,table:'test',scopeKey:'test',now:()=>now});
  let rendered=0;
  const context={console,Map,Set,Date,performance:{now:()=>0},rowStateById:new Map(),generatedWords:new Set(),
    trimOrEmpty:value=>String(value||'').trim(),hasMeaningText:value=>Boolean(String(value||'').trim()),
    loadPersistedRows:()=>Array.from({length:50},(_,i)=>({rowId:'suggestion'+i,word:'w'+i,ipa:'a',saveStatus:'idle',isEditing:false})),
    syncDisplayMeaning:(state,meaning)=>{state.meaning=meaning?.meaning;},createResultRow:()=>({}),resultsList:{append(){},contains:()=>false},
    renderRow:()=>rendered++,savePersistedRows(){},
    hydrateWordState:()=>{throw new Error('Restore must not hydrate rows individually');},
    applyCurrentUserMatchToState:(state,own)=>{state.own=own;},applyGeneratorDictionaryMatches:(state,matches)=>{state.matches=matches;},
    findNewestCurrentUserMatch:matches=>matches.find(row=>row.user==='alice'),findNewestNonEmptyMeaningMatch:matches=>matches.find(row=>row.meaning),
    sortMatchesByMeaningDesc:matches=>matches,getCurrentUserId:()=> 'alice',generatorRevision:0,
    generatorDefinitionPicker:null,document:{activeElement:null,getElementById:()=>null},flushPersistedRowsSave(){},
    generatorConstraints:{enabled:()=>false,accept(){},success(){},error(){}},getGeneratorSnapshotStore:()=>cache,setGeneratorSyncStatus(){},
    isHeartsConfigured:true,ensureAwsCredentials:async()=>true,getHeartsTableClient:()=>client,awsConfig:{heartsTableName:'test'},
    SECRET_COOPERATIVE_REFRESH:{fingerprint,start:options=>{syncOptions=options;return{
      request:async()=>{const items=await options.read();options.apply(items);options.onSuccess();},seed(){},stop(){}};}},
    SECRET_DICTIONARY_CACHE:{forRuntime:()=>cache,measure(){}},addEventListener(){},generatorSync:null
  };context.window=context;vm.createContext(context);
  vm.runInContext(functionSource('restorePersistedRows'),context);context.restorePersistedRows();assert.equal(context.rowStateById.size,50);assert.equal(scans,0);
  vm.runInContext(source.slice(source.indexOf('generatorSync = SECRET_COOPERATIVE_REFRESH.start')),context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(scans,1,'Restoring fifty suggestions performs one full scan');assert.equal(writes,0);
  assert.equal(context.rowStateById.get('suggestion3').meaning,'meaning3');assert.equal(context.rowStateById.get('suggestion49').matches.length,0);
  const afterFirst=rendered;await context.generatorSync.request();assert.equal(scans,1);assert.equal(rendered,afterFirst,'Unchanged rows keep their DOM');
  vm.runInContext(functionSource('lookupWordState'),context);
  const lookups=await Promise.all(Array.from({length:50},(_,i)=>context.lookupWordState('w'+i)));
  assert.equal(scans,1,'Fifty display lookups reuse the indexed snapshot');assert.equal(lookups[3].latestMeaningMatch.meaning,'meaning3');
  cache.upsert({...database[3],meaning:'changed'});const beforeChanged=rendered;await context.generatorSync.request();assert.equal(rendered,beforeChanged+1,'Only the changed suggestion rerenders');
  now+=30000;await context.generatorSync.request();assert.equal(scans,2,'Expired snapshot refreshes once');
  context.rowStateById.clear();await context.generatorSync.request();assert.equal(scans,2,'An empty ordinary generator does not scan');
  assert.ok(cache.peek().length,'Skipped empty-generator reads never replace the snapshot');assert.equal(writes,0);
  assert.doesNotMatch(fs.readFileSync('dictionary.html','utf8'),/data-protected-src="relationship-panel.js"/);
  assert.doesNotMatch(fs.readFileSync('dictionary.js','utf8'),/getRelationshipPanel|SECRET_RELATIONSHIP_PANEL/);
  console.log('Generator shared-snapshot hydration, incremental rendering and read-count tests passed.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
