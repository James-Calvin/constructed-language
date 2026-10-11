const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const api=require('../dictionary-cache.js'),source=fs.readFileSync('dictionary.js','utf8');
const functionSource=name=>{const start=source.search(new RegExp(`(?:async )?function ${name}\\(`));assert.ok(start>=0);return source.slice(start,source.indexOf('\n}',start)+2);};
async function run(){
  let now=1000,scans=0,rendered=0,refreshed=0,identities=0;
  const data=new Map(),storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};
  const rows=[{rowId:'one',timestamp:1,word:'ka',pronunciation:'ka',meaning:'fire',hearted:true,user:'alice'}];
  const options={scopeKey:'same-tab',storage,now:()=>now,table:'test',client:()=>({scan:()=>({promise:async()=>{scans++;return{Items:rows};}})})};
  const generatorStore=api.create(options);await generatorStore.refresh();
  const dictionaryStore=api.create(options);
  const status={textContent:''},context={console,Map,Date,dictionaryList:{children:[]},dictionaryStatus:status,isDictionaryConfigured:true,currentUserId:'',
    trimOrEmpty:value=>String(value||'').trim(),getDictionarySnapshotStore:()=>dictionaryStore,
    SECRET_CURRENT_USER:{id:'alice'},setStatus(){},updateFilterControls(){},updateSentinelVisibility(){},
    ensureAwsCredentials:async()=>{throw new Error('Warm navigation must not wait for credentials');},ensureCurrentUserIdentity:async()=>{identities++;},
    scanDictionaryEntries:async()=>{throw new Error('Warm navigation must not scan');},
    applyDictionarySnapshot:()=>rendered++,dictionarySync:{seed(){},request:async()=>{refreshed++;}},
    document:{getElementById:()=>status},dictionaryLoaded:false
  };context.window=context;vm.createContext(context);vm.runInContext(functionSource('loadDictionary'),context);
  await context.loadDictionary();assert.equal(scans,1);assert.equal(rendered,1);assert.equal(refreshed,0);assert.equal(identities,0);assert.equal(context.dictionaryLoaded,true);
  now+=30000;await context.loadDictionary();assert.equal(rendered,2,'Stale cache is painted immediately');assert.equal(refreshed,1);assert.match(status.textContent,/refreshing/);
  const view={...context,wordRelationships:null,dictionarySnapshot:[],dictionaryViewSignature:undefined,renderedGroupCount:0,recordsById:new Map(),selectedWord:'',scrollX:0,scrollY:0,
    getWordNotes:()=>({load(){}}),getDefinitionPicker:()=>({load(){}}),normalizeDictionaryEntry:row=>row.word?{...row,id:row.rowId}:null,
    rebuildGroupsFromEntries(){},getFilteredGroups:()=>[],refreshDictionaryView:()=>rendered++,scrollTo(){},
    SECRET_COOPERATIVE_REFRESH:require('../cooperative-refresh.js')};view.window=view;vm.createContext(view);vm.runInContext(functionSource('applyDictionarySnapshot'),view);
  view.applyDictionarySnapshot(rows,false);const first=rendered;
  view.applyDictionarySnapshot(rows.concat({rowId:'settings',timestamp:0,activeRules:{}}),true);
  assert.equal(rendered,first,'Unrelated metadata does not reconstruct dictionary cards');
  view.applyDictionarySnapshot([{...rows[0],meaning:'flame'}],true);assert.equal(rendered,first+1);
  assert.equal(view.wordRelationships,null,'Ordinary dictionary display does not initialize relationships');
  console.log('Dictionary warm/stale navigation and metadata-only refresh tests passed.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
