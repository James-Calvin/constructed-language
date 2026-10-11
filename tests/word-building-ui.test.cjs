const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {fixture}=require('./building-dom.cjs');
const ids=[...fs.readFileSync('word-building.html','utf8').matchAll(/id="([^"]+)"/g)].map(match=>match[1]);
async function run(){
  for(const page of ['index.html','dictionary.html','word-building.html']){
    const html=fs.readFileSync(page,'utf8');
    for(const match of html.matchAll(/data-protected-src="([^"]+)"/g))if(!match[1].startsWith('https:'))assert.ok(fs.existsSync(match[1]),`${page}: missing ${match[1]}`);
    assert.match(html,/<script src="auth.js"><\/script>/,'All pages stay behind the existing password gate');
  }
  const {elements:el,document}=fixture(ids);
  for(const id of ['inventoryForm','useExistingWord','retryBuiltLinks','buildingOverrideLabel'])el[id].hidden=true;
  for(const id of ['partSearch','temporaryPart','builtSpelling','builtIpa','inventorySearch','inventorySpelling','inventoryIpa'])el[id].tagName='input';
  for(const id of ['builtMeaning','inventoryMeaning','inventoryNotes'])el[id].tagName='textarea';
  for(const id of ['partChoice','builtRequest','temporaryKind','inventoryKind'])el[id].tagName='select';
  el.temporaryKind.value=el.inventoryKind.value='root';
  for(const id of ['builtSpelling','builtIpa','builtMeaning','builtRequest','buildingOverride','saveBuiltWord','useExistingWord','retryBuiltLinks','resetBuilder'])el.buildingForm.append(el[id]);
  for(const id of ['inventoryKind','inventorySpelling','inventoryIpa','inventoryMeaning','inventoryNotes','cancelInventory'])el.inventoryForm.append(el[id]);
  let rows=[{rowId:'root',timestamp:0,morphemeData:{kind:'root',spelling:'ka',pronunciation:'ka',meaning:'fire',author:'bob',createdAt:1,editedBy:'bob',editedAt:1}}];
  let sync,failRead=false,failLinks=false,invalid=false,soundMissing=false;
  const client={scan:()=>({promise:async()=>{if(failRead)throw new Error('Read offline');return{Items:structuredClone(rows)};}}),
    get:({Key})=>({promise:async()=>({Item:structuredClone(rows.find(row=>row.rowId===Key.rowId&&row.timestamp===Key.timestamp))})}),
    put:({Item})=>({promise:async()=>{if(failLinks&&Item.relationshipData)throw new Error('Link offline');rows=rows.filter(row=>row.rowId!==Item.rowId||row.timestamp!==Item.timestamp).concat(structuredClone(Item));}}),
    delete:({Key})=>({promise:async()=>{rows=rows.filter(row=>row.rowId!==Key.rowId||row.timestamp!==Key.timestamp);}})};
  const listeners={};
  const context={console,document,URLSearchParams,Map,Set,Date,Number,crypto:require('node:crypto').webcrypto,
    location:{search:''},scrollX:0,scrollY:0,scrollTo(){},SECRET_CURRENT_USER:{id:'alice'},
    addEventListener:(type,callback)=>{listeners[type]=callback;},
    LOVE_LANGUAGE_SHARED:{createAwsRuntime:()=>({getHeartsTableClient:()=>client,awsConfig:{heartsTableName:'secretWords'},isHeartsConfigured:true,ensureAwsCredentials:async()=>true}),
      ui:{deferEditorRender:()=>false,captureEditor:()=>null,restoreEditor(){}}},
    LOVE_LANGUAGE_RULES:{loadActiveRuleConfig:()=>({}),derivePronunciationFromSpelling:({spelling})=>({pronunciation:soundMissing?'':spelling,warnings:soundMissing?['Missing mapping']:[]}),
      analyzeEntryAgainstRuleConfig:()=>({available:true,warnings:invalid?['Rule mismatch']:[]})},
    SECRET_COOPERATIVE_REFRESH:{fingerprint:require('../cooperative-refresh.js').fingerprint,start:options=>{
      sync=options;return{request:async()=>{if(options.isBusy())return;try{options.apply(await options.read());options.onSuccess();}catch(error){options.onError(error);}},stop(){}};}}
  };
  context.window=context;vm.createContext(context);
  for(const file of ['definition-workflow.js','meaning-requests.js','word-relationships.js','relationship-panel.js','word-building.js'])vm.runInContext(fs.readFileSync(file,'utf8'),context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(el.buildingStatus.textContent,/up to date/);assert.equal(el.addSavedPart.disabled,false);
  el.partChoice.value='0';await el.addSavedPart.fire('click');
  assert.equal(el.builtSpelling.value,'ka');assert.equal(el.builtIpa.value,'ka');assert.equal(sync.isBusy(),true);
  el.temporaryPart.value='n';await el.addTemporaryPart.fire('click');
  assert.equal(el.builtSpelling.value,'kan');assert.match(el.buildingParts.textContent,/temporary: not linked/);
  const partButtons=el.buildingParts.children[1].querySelectorAll('button');await partButtons[0].fire('click');assert.equal(el.builtSpelling.value,'nka');
  await el.buildingParts.children[0].querySelectorAll('button')[1].fire('click');assert.equal(el.builtSpelling.value,'kan');
  el.builtSpelling.value='custom';await el.builtSpelling.fire('input');assert.equal(el.buildingParts.children.length,2,'Manual spelling keeps selected parts');
  soundMissing=true;await el.builtSpelling.fire('input');assert.equal(el.builtIpa.value,'');
  el.builtIpa.value='manual';await el.builtIpa.fire('input');assert.match(el.buildingWarnings.textContent,/Missing mapping/);
  el.buildingOverride.checked=true;el.builtIpa.value='edited';await el.builtIpa.fire('input');assert.equal(el.buildingOverride.checked,false);
  soundMissing=false;el.builtSpelling.value='kan';await el.builtSpelling.fire('input');
  invalid=true;listeners['secret-rules-imported']();await el.buildingForm.fire('submit');assert.match(el.buildingSaveStatus.textContent,/confirm/);
  assert.equal(rows.some(row=>row.word==='kan'),false);
  el.buildingOverride.checked=true;el.builtMeaning.value='flame';failLinks=true;await el.buildingForm.fire('submit');
  assert.match(el.buildingSaveStatus.textContent,/Word saved; relationships pending/);assert.equal(el.retryBuiltLinks.hidden,false);
  const word=rows.find(row=>row.word==='kan');assert.equal(word.meaning,'flame');assert.equal(word.hearted,true);assert.equal(word.definitionReview.status,'candidate');
  assert.equal(el.builtSpelling.disabled,true,'Saved word cannot be duplicated during link retry');
  failLinks=false;await el.retryBuiltLinks.fire('click');assert.equal(rows.filter(row=>row.word==='kan').length,1);
  assert.equal(rows.filter(row=>row.relationshipData).length,1);assert.equal(el.retryBuiltLinks.hidden,true);
  await el.resetBuilder.fire('click');invalid=false;
  el.builtSpelling.value='kan';await el.builtSpelling.fire('input');el.builtMeaning.value='do not overwrite';
  assert.equal(el.useExistingWord.hidden,false);assert.equal(el.saveBuiltWord.disabled,true);
  await el.useExistingWord.fire('click');assert.equal(rows.find(row=>row.word==='kan').meaning,'flame');
  await el.resetBuilder.fire('click');
  await el.newInventory.fire('click');el.inventorySpelling.value='ne';el.inventoryIpa.value='ne';el.inventoryKind.value='prefix';el.inventoryMeaning.value='not';
  await el.inventoryForm.fire('submit');assert.equal(el.inventoryForm.hidden,true);
  assert.equal(rows.filter(row=>row.morphemeData).length,2);
  failRead=true;await el.buildingRefresh.fire('click');assert.match(el.buildingStatus.textContent,/last successful/);
  assert.ok(el.inventoryList.children.length>=2,'Read failure retains inventory');failRead=false;
  await el.buildingRefresh.fire('click');assert.match(el.buildingStatus.textContent,/up to date/);
  console.log('Word building UI, warnings and partial-save tests passed.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
