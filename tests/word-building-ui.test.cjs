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
  let rows=[{rowId:'root',timestamp:0,morphemeData:{kind:'root',spelling:'ka',pronunciation:'ka',meaning:'fire',author:'bob',createdAt:1,editedBy:'bob',editedAt:1}},
    {rowId:'ka',timestamp:1,word:'ka',pronunciation:'ka',meaning:'fire; heat, flame',hearted:true,user:'bob'},
    {rowId:'n',timestamp:2,word:'n',pronunciation:'n',meaning:'water',hearted:true,user:'bob'}];
  let sync,failRead=false,failLinks=false,invalid=false,soundMissing=false;
  const client={scan:()=>({promise:async()=>{if(failRead)throw new Error('Read offline');return{Items:structuredClone(rows)};}}),
    get:({Key})=>({promise:async()=>({Item:structuredClone(rows.find(row=>row.rowId===Key.rowId&&row.timestamp===Key.timestamp))})}),
    put:({Item})=>({promise:async()=>{if(failLinks&&Item.recipeData)throw new Error('Recipe offline');rows=rows.filter(row=>row.rowId!==Item.rowId||row.timestamp!==Item.timestamp).concat(structuredClone(Item));}}),
    delete:({Key})=>({promise:async()=>{rows=rows.filter(row=>row.rowId!==Key.rowId||row.timestamp!==Key.timestamp);}})};
  const listeners={},storage=new Map();
  const context={console,document,URLSearchParams,Map,Set,Date,Number,crypto:require('node:crypto').webcrypto,
    location:{search:''},scrollX:0,scrollY:0,scrollTo(){},SECRET_CURRENT_USER:{id:'alice'},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
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
  assert.equal(el.builtSpelling.value,'','Adding to toolbox does not assemble yet');
  assert.equal(el.buildingToolbox.children.length,1);
  await el.buildingToolbox.children[0].querySelectorAll('button')[0].fire('click');
  assert.equal(el.builtSpelling.value,'ka');assert.equal(el.builtIpa.value,'ka');assert.equal(sync.isBusy(),true);
  assert.equal(el.builtMeaning.value,'fire');assert.equal(el.saveBuiltWord.disabled,true);
  const senseSelect=el.buildingParts.children[0].querySelector('select');senseSelect.value='heat';await senseSelect.fire('change');assert.equal(el.builtMeaning.value,'heat');
  el.partChoice.value='1';await el.addSavedPart.fire('click');await el.buildingToolbox.children[0].querySelectorAll('button')[0].fire('click');
  assert.equal(el.builtSpelling.value,'kan');assert.equal(el.builtMeaning.value,'heat + water');
  const partButtons=el.buildingParts.children[1].querySelectorAll('button');await partButtons[0].fire('click');assert.equal(el.builtSpelling.value,'nka');
  await el.buildingParts.children[0].querySelectorAll('button')[1].fire('click');assert.equal(el.builtSpelling.value,'kan');
  el.builtMeaning.value='custom meaning';await el.builtMeaning.fire('input');
  await el.buildingParts.children[1].querySelectorAll('button')[0].fire('click');assert.equal(el.builtMeaning.value,'custom meaning');
  await el.buildingParts.children[0].querySelectorAll('button')[1].fire('click');
  await el.useLiteral.fire('click');assert.equal(el.builtMeaning.value,'heat + water');
  assert.ok(storage.has('secret-compound-workspace-v1:alice'));assert.equal(JSON.parse(storage.get('secret-compound-workspace-v1:alice')).parts.length,2);
  el.builtSpelling.value='custom';await el.builtSpelling.fire('input');assert.equal(el.buildingParts.children.length,2,'Manual spelling keeps selected parts');
  soundMissing=true;await el.builtSpelling.fire('input');assert.equal(el.builtIpa.value,'');
  el.builtIpa.value='manual';await el.builtIpa.fire('input');assert.match(el.buildingWarnings.textContent,/Missing mapping/);
  el.buildingOverride.checked=true;el.builtIpa.value='edited';await el.builtIpa.fire('input');assert.equal(el.buildingOverride.checked,false);
  soundMissing=false;el.builtSpelling.value='kan';await el.builtSpelling.fire('input');
  invalid=true;listeners['secret-rules-imported']();await el.buildingForm.fire('submit');assert.match(el.buildingSaveStatus.textContent,/confirm/);
  assert.equal(rows.some(row=>row.word==='kan'),false);
  el.buildingOverride.checked=true;el.builtMeaning.value='flame';failLinks=true;await el.buildingForm.fire('submit');
  assert.match(el.buildingSaveStatus.textContent,/Word saved; composition pending/);assert.equal(el.retryBuiltLinks.hidden,false);
  const word=rows.find(row=>row.word==='kan');assert.equal(word.meaning,'flame');assert.equal(word.hearted,true);assert.equal(word.definitionReview.status,'candidate');
  assert.equal(el.builtSpelling.disabled,true,'Saved word cannot be duplicated during link retry');
  failLinks=false;await el.retryBuiltLinks.fire('click');assert.equal(rows.filter(row=>row.word==='kan').length,1);
  assert.equal(rows.filter(row=>row.recipeData).length,1);assert.equal(el.retryBuiltLinks.hidden,true);
  const recipe=rows.find(row=>row.recipeData);assert.equal(recipe.recipeData.parts[0].sense,'heat');
  await el.resetBuilder.fire('click');invalid=false;
  el.builtSpelling.value='kan';await el.builtSpelling.fire('input');el.builtMeaning.value='do not overwrite';
  assert.equal(el.useExistingWord.hidden,false);assert.equal(el.saveBuiltWord.disabled,true);
  await el.useExistingWord.fire('click');assert.match(el.buildingSaveStatus.textContent,/two components/);
  await el.buildingToolbox.children[0].querySelectorAll('button')[0].fire('click');await el.buildingToolbox.children[0].querySelectorAll('button')[0].fire('click');
  await el.useExistingWord.fire('click');assert.match(el.buildingSaveStatus.textContent,/confirm replacement/);
  el.replaceRecipe.checked=true;await el.useExistingWord.fire('click');assert.equal(rows.find(row=>row.word==='kan').meaning,'flame');
  await el.resetBuilder.fire('click');
  await el.newInventory.fire('click');el.inventorySpelling.value='ne';el.inventoryIpa.value='ne';el.inventoryKind.value='prefix';el.inventoryMeaning.value='not';
  await el.inventoryForm.fire('submit');assert.equal(el.inventoryForm.hidden,true);
  assert.equal(rows.filter(row=>row.morphemeData).length,2);
  failRead=true;await el.buildingRefresh.fire('click');assert.match(el.buildingStatus.textContent,/last successful/);
  assert.ok(el.inventoryList.children.length>=2,'Read failure retains inventory');failRead=false;
  await el.buildingRefresh.fire('click');assert.match(el.buildingStatus.textContent,/up to date/);
  el.savedCompound.value=recipe.rowId;await el.openCompound.fire('click');assert.equal(el.buildingParts.children.length,2);assert.equal(el.builtMeaning.value,'flame');
  await el.resetBuilder.fire('click');
  el.temporaryPart.value='x';await el.addTemporaryPart.fire('click');assert.match(el.buildingToolbox.textContent,/temporary: not linked/);
  assert.doesNotMatch(fs.readFileSync('index.html','utf8'),/word-building.html/);
  assert.doesNotMatch(fs.readFileSync('dictionary.html','utf8'),/word-building.html/);
  assert.doesNotMatch(fs.readFileSync('relationship-panel.js','utf8'),/word-building.html/);
  el.partChoice.value=el.partChoice.children.find(option=>option.textContent.startsWith('ka /')).value;await el.partChoice.fire('change');
  const moved=el.buildingToolbox.children[el.buildingToolbox.children.length-1];assert.match(moved.textContent,/Prefix 1/);
  const beforeMove=el.buildingToolbox.children.length;
  await moved.fire('dragstart',{dataTransfer:{setData(){}}});await el.buildingParts.fire('drop');
  assert.equal(el.buildingToolbox.children.length,beforeMove-1);assert.equal(el.buildingParts.children.length,1);
  el.partChoice.value=el.partChoice.children.find(option=>option.textContent.startsWith('ka /')).value;await el.partChoice.fire('change');
  await el.buildingToolbox.children[el.buildingToolbox.children.length-1].querySelectorAll('button')[0].fire('click');
  assert.equal(el.builtSpelling.value,'kaka','Multiple copies form reduplicated compounds');
  el.builtMeaning.value='kept draft';await el.builtMeaning.fire('input');el.buildingAdvanced.open=true;await el.buildingAdvanced.fire('toggle');
  const restored=fixture(ids);restored.elements.inventoryForm.hidden=true;context.document=restored.document;
  vm.runInContext(fs.readFileSync('word-building.js','utf8'),context);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(restored.elements.builtSpelling.value,'kaka');assert.equal(restored.elements.builtMeaning.value,'kept draft');
  assert.equal(restored.elements.buildingParts.children.length,2);assert.equal(restored.elements.buildingAdvanced.open,true);
  const other=fixture(ids);other.elements.inventoryForm.hidden=true;context.document=other.document;context.SECRET_CURRENT_USER={id:'bob'};
  vm.runInContext(fs.readFileSync('word-building.js','utf8'),context);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(other.elements.buildingParts.children.length,0,'Another username does not inherit the workspace');
  const offline=fixture(ids);offline.elements.inventoryForm.hidden=true;context.document=offline.document;context.SECRET_CURRENT_USER={id:'alice'};failRead=true;
  vm.runInContext(fs.readFileSync('word-building.js','utf8'),context);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(offline.elements.builtMeaning.value,'kept draft','Offline initial load still restores the draft');
  assert.equal(offline.elements.buildingParts.children.length,2);assert.match(offline.elements.buildingStatus.textContent,/last successful/);failRead=false;
  const denied=fixture(ids);denied.elements.inventoryForm.hidden=true;context.document=denied.document;context.SECRET_CURRENT_USER={id:'charlie'};
  context.localStorage={getItem(){throw new Error('Denied');},setItem(){throw new Error('Denied');}};
  vm.runInContext(fs.readFileSync('word-building.js','utf8'),context);await new Promise(resolve=>setImmediate(resolve));
  denied.elements.partChoice.value='0';await denied.elements.addSavedPart.fire('click');assert.equal(denied.elements.buildingToolbox.children.length,1,'Storage denial does not prevent building');
  console.log('Word building UI, warnings and partial-save tests passed.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
