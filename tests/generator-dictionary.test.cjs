const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('script.js', 'utf8');
class Element {
  constructor(tag) { this.tagName=tag; this.children=[]; this.dataset={}; this.listeners={}; this.className=''; this.value='';
    this.classList={toggle:(name,on)=>{const classes=new Set(this.className.split(' ').filter(Boolean));on?classes.add(name):classes.delete(name);this.className=[...classes].join(' ');},remove:name=>this.classList.toggle(name,false)}; }
  set textContent(value) { this.text=value; this.children=[]; }
  get textContent() { return this.text || ''; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); }
  replaceChildren(...children) { this.children=children; }
  setAttribute(key,value) { this[key]=value; }
  addEventListener(event,fn) { this.listeners[event]=fn; }
  fire(event) { return this.listeners[event]?.({preventDefault(){},stopPropagation(){}}); }
  querySelector(selector) {
    if(selector.includes(' ')) { const [first,...rest]=selector.split(' '); return this.querySelector(first)?.querySelector(rest.join(' ')); }
    return this.children.flatMap(child=>[child,...child.descendants()]).find(child=>selector.startsWith('.')
      ?child.className.split(' ').includes(selector.slice(1)):child.tagName===selector) || null;
  }
  descendants() { return this.children.flatMap(child=>[child,...child.descendants()]); }
  focus() { context.document.activeElement=this; }
}
const elements=new Map();
let database=[], refreshes=0, failedRead=false, failedWrite=false, heldWrite=null, generationMessage='';
const context={ console, Map, Set, Number, Date,
  document:{createElement:tag=>new Element(tag),activeElement:null},
  toEpochMs:value=>Number(value)||0, trimOrEmpty:value=>typeof value==='string'?value.trim():'',
  hasMeaningText:value=>typeof value==='string'&&Boolean(value.trim()),
  DISPLAY_MEANING_SOURCES:{NONE:'',OWN:'own',IMPORTED:'imported'},
  SECRET_DEFINITIONS:require('../definition-workflow.js'),SECRET_MEANING_REQUESTS:require('../meaning-requests.js'),
  rowStateById:new Map(),selectedRowId:null,playingRowId:null,generatorRevision:0,
  generatorDefinitionPicker:null,generatorPickerRowId:null,
  getCurrentUserId:()=> 'alice',isHeartsConfigured:true,
  resultsList:{querySelector:selector=>elements.get(selector.match(/data-row-id="([^"]+)"/)?.[1])},
  sharedUi:{deferEditorRender:()=>false,captureEditor:()=>null,restoreEditor(){}},
  createActionButton:(className,text,label,action)=>{const button=new Element('button');button.className=className;button.textContent=text;button.dataset.action=action;return button;},
  awsConfig:{heartsTableName:'secretWords'},flushPersistedRowsSave(){},
  setTimeout, clearTimeout,
  setGenerationStatus:message=>{generationMessage=message;},
  generatorConstraints:{accept(){},remember(){}},generatorSync:{request:async()=>{refreshes++;}},
  readGeneratorDefinitionRequests:async()=>{if(failedRead)throw new Error('Offline');return structuredClone(database);},
  getHeartsTableClient:()=>({get:({Key})=>({promise:async()=>({Item:structuredClone(database.find(item=>item.rowId===Key.rowId&&item.timestamp===Key.timestamp))})}),
    put:({Item})=>({promise:async()=>{if(heldWrite&&Item.rowId==='heart-debug-concept')await heldWrite;if(failedWrite)throw new Error('Offline');database=database.filter(item=>item.rowId!==Item.rowId||item.timestamp!==Item.timestamp).concat(structuredClone(Item));}})})
};
context.window=context;
vm.createContext(context);
function load(name) {
  const start=source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start>=0,name);
  const end=source.indexOf('\n}',start)+2;
  vm.runInContext(source.slice(start,end),context);
}
for(const name of ['getActivityTimestamp','getMeaningTimestamp','hasOwnMeaning','getDraftMeaningTimestamp','getLocalUserStateTimestamp',
  'getPreferredOwnMeaning','getDisplayedMeaning','isImportedDisplayMeaning','clearImportedDisplay','syncDisplayMeaning',
  'sortMatchesByActivityDesc','sortMatchesByMeaningDesc','findNewestNonEmptyMeaningMatch','findNewestCurrentUserMatch',
  'createRowState','applyCurrentUserMatchToState','applyGeneratorDictionaryMatches','rememberGeneratorRecord',
  'getGeneratorDefinitionPicker','openGeneratorDefinitionPicker','renderMeaning','renderRow',
  'generatorHeartBlockReason','renderGeneratorHeartButton','handleToggleHeart','persistHeartedState',
  'buildCanonicalRecordRowId','buildHeartTableItem','putCurrentUserRecord','persistOwnMeaning',
  'openMeaningEditor','closeMeaningEditor','handleSaveMeaning']) load(name);
vm.runInContext(fs.readFileSync('definition-picker.js','utf8'),context);
function result(id) {
  const state=context.createRowState({rowId:id,timestamp:10000,word:'sol',ipa:'sol'});
  context.rowStateById.set(id,state);
  const row=new Element('li');
  for(const name of ['word','heart-btn','row-meaning']) {const child=new Element('span');child.className=name;row.append(child);}
  elements.set(id,row);return {state,row};
}
async function run() {
  const {state,row}=result('r');
  context.renderRow('r');
  assert.doesNotMatch(row.querySelector('.word').className,/is-undefined/,'Unsaved suggestions retain the default white color');
  assert.equal(row.querySelector('.word').title,'Not in dictionary');
  context.applyGeneratorDictionaryMatches(state,[{word:'sol',pronunciation:'sol',hearted:false}]);
  context.renderRow('r');
  assert.doesNotMatch(row.querySelector('.word').className,/is-undefined/,'Unhearted undefined records are not dictionary entries');
  context.applyGeneratorDictionaryMatches(state,[{word:'sol',pronunciation:'sol',user:'legacy:identity',hearted:true}]);
  context.renderRow('r');
  assert.match(row.querySelector('.word').className,/is-undefined/,'A heart from any user makes an undefined spelling visible in the dictionary');
  const own={rowId:'saved',timestamp:10,updatedTimestamp:20,word:'sol',pronunciation:'sol',user:'alice',hearted:true};
  context.applyCurrentUserMatchToState(state,own);
  assert.equal(state.hearted,true,'New suggestion timestamps must not hide an older persisted heart');
  context.applyGeneratorDictionaryMatches(state,[own]); context.renderRow('r');
  assert.equal(row.querySelector('.heart-btn').textContent,'❤');
  assert.match(row.querySelector('.heart-btn').className,/is-hearted/);
  assert.match(row.querySelector('.word').className,/is-undefined/);
  assert.deepEqual(row.querySelector('.row-meaning').children.map(node=>node.textContent),['Write a definition','Select a definition']);
  const accepted={...own,rowId:'bob',user:'bob',meaning:'sun',meaningUpdatedTimestamp:25};
  context.applyGeneratorDictionaryMatches(state,[accepted,{...own,updatedTimestamp:99}]);context.renderRow('r');
  assert.match(row.querySelector('.word').className,/is-defined/,'Heart-only activity does not override latest definition');
  const candidate={...accepted,meaningUpdatedTimestamp:30,definitionReview:{status:'candidate'}};
  context.applyGeneratorDictionaryMatches(state,[accepted,candidate]);context.renderRow('r');
  assert.match(row.querySelector('.word').className,/is-candidate/);
  state.updatedTimestamp=100;state.hearted=false;
  context.applyCurrentUserMatchToState(state,own);
  assert.equal(state.hearted,false,'Newer local unheart remains intact');
  const {state:busy}=result('busy');busy.saveStatus='saving-heart';
  context.applyCurrentUserMatchToState(busy,own);assert.equal(busy.hasPersistedRecord,false,'A pending save is not hydrated over');
  context.rowStateById.delete('busy');
  state.hearted=true;state.updatedTimestamp=20;
  context.applyGeneratorDictionaryMatches(state,[own]);
  database=[own,{rowId:'concept',timestamp:1,conceptData:{id:'c',text:'sunlight',author:'bob',createdAt:1}}];
  await context.openGeneratorDefinitionPicker('r');
  assert.equal(context.generatorDefinitionPicker.isOpen(),true);
  let form=row.querySelector('.definition-picker'),select=form.querySelector('select');
  assert.equal(context.document.activeElement,select,'Opening focuses the concept picker');
  select.value='c';await select.fire('change');await form.fire('submit');
  assert.equal(state.hearted,true,'Assignment retains the personal heart');
  assert.equal(state.dictionaryClassification,'candidate');
  assert.match(row.querySelector('.word').className,/is-candidate/);
  assert.equal(state.ownMeaning,'sunlight');
  assert.ok(database.find(item=>item.rowId==='concept').word==='sol');
  assert.equal(context.generatorDefinitionPicker.isOpen(),false);
  assert.ok(refreshes>0);
  context.applyGeneratorDictionaryMatches(state,[own]);state.ownMeaning=null;failedRead=true;
  await context.openGeneratorDefinitionPicker('r');
  assert.match(state.definitionError,/Offline/);assert.equal(state.saveStatus,'idle');
  assert.match(row.querySelector('.row-meaning').children.map(node=>node.textContent).join(' '),/Select a definition/);
  failedRead=false;database=[own,{...accepted,meaning:'now defined'}];
  await context.openGeneratorDefinitionPicker('r');
  assert.equal(context.generatorDefinitionPicker.isOpen(),true,'Hearted words may select a new requested definition even when already defined');
  assert.equal(state.dictionaryClassification,'defined');
  assert.equal(state.definitionError,'');
  const cancel=row.querySelector('.definition-picker').children[3];await cancel.fire('click');
  assert.equal(context.generatorDefinitionPicker.isOpen(),false);
  assert.equal(state.dictionaryClassification,'defined','Cancel leaves the existing definition intact');
  const {state:written,row:writtenRow}=result('written');written.word='nova';
  context.selectedRowId='written';context.renderRow('written');
  assert.deepEqual(writtenRow.querySelector('.row-meaning').children.map(node=>node.textContent),['Write a definition','Select a definition'],
    'Selected unhearted words offer both definition actions');
  context.openMeaningEditor('written');
  assert.equal(written.isEditing,true);assert.equal(written.hearted,false,'Opening the editor does not heart the word');
  written.draftMeaning='  ';await context.handleSaveMeaning('written');
  assert.equal(written.hearted,false,'Empty submissions do not heart the word');
  context.openMeaningEditor('written');written.draftMeaning='a new light';written.hasDraftCache=true;
  failedWrite=true;const originalError=console.error;console.error=()=>{};
  try { await context.handleSaveMeaning('written'); } finally { console.error=originalError;failedWrite=false; }
  assert.equal(written.hearted,false,'Failed writes do not heart the word');
  assert.equal(written.isEditing,true);assert.equal(written.draftMeaning,'a new light');
  assert.match(written.definitionError,/Offline/);
  await context.handleSaveMeaning('written');
  assert.equal(written.hearted,true);assert.equal(written.dictionaryClassification,'candidate');
  assert.equal(database.find(item=>item.word==='nova').hearted,true,'Definition and heart are persisted together');
  assert.equal(writtenRow.querySelector('.heart-btn').textContent,'❤');
  const {state:picked}=result('picked');picked.word='luma';
  database.push({rowId:'unhearted-concept',timestamp:1,conceptData:{id:'uc',text:'soft light',author:'bob',createdAt:1}});
  await context.openGeneratorDefinitionPicker('picked');
  assert.equal(picked.hearted,false,'Opening a picker does not heart the word');
  let unheartedForm=elements.get('picked').querySelector('.definition-picker');
  await unheartedForm.children[3].fire('click');
  assert.equal(picked.hearted,false,'Cancelling selection does not heart the word');
  await context.openGeneratorDefinitionPicker('picked');
  unheartedForm=elements.get('picked').querySelector('.definition-picker');
  const unheartedSelect=unheartedForm.querySelector('select');unheartedSelect.value='uc';await unheartedSelect.fire('change');
  failedWrite=true;await unheartedForm.fire('submit');failedWrite=false;
  assert.equal(picked.hearted,false,'Failed assignment does not heart the word');
  await unheartedForm.children[2].fire('click');
  unheartedSelect.value='uc';await unheartedSelect.fire('change');await unheartedForm.fire('submit');
  assert.equal(picked.hearted,true,'Successful selected definitions automatically heart the word');
  assert.equal(database.find(item=>item.rowId==='unhearted-concept').hearted,true);
  assert.equal(picked.dictionaryClassification,'candidate');
  const {state:pickerWord,row:pickerRow}=result('heart-picker');pickerWord.word='pickerword';
  const {state:otherWord,row:otherRow}=result('heart-other');otherWord.word='otherword';
  database.push({rowId:'heart-debug-concept',timestamp:1,conceptData:{id:'hdc',text:'a heart debug meaning',author:'bob',createdAt:1}});
  await context.openGeneratorDefinitionPicker('heart-picker');
  let heartForm=pickerRow.querySelector('.definition-picker');
  const heartSelect=heartForm.querySelector('select');heartSelect.value='hdc';await heartSelect.fire('change');
  const messages=[];
  context.console={info:(...args)=>messages.push(args),warn:(...args)=>messages.push(args),error:(...args)=>messages.push(args)};
  await context.handleToggleHeart('heart-other');
  assert.equal(otherWord.hearted,true,'Other words can be hearted while a picker is open');
  assert.equal(context.generatorDefinitionPicker.isOpen(),true);
  assert.equal(heartSelect.value,'hdc','Other heart clicks preserve the picker selection');
  let releaseWrite;heldWrite=new Promise(resolve=>{releaseWrite=resolve;});
  const pendingAssignment=heartForm.fire('submit');
  assert.equal(context.generatorDefinitionPicker.isBusy(),true);
  assert.equal(pickerRow.querySelector('.heart-btn').disabled,true,'Busy picker visibly disables only its own heart');
  assert.match(pickerRow.querySelector('.heart-btn').title,/definition picker/);
  context.renderRow('heart-other');assert.equal(otherRow.querySelector('.heart-btn').disabled,false);
  await context.handleToggleHeart('heart-picker');
  assert.equal(pickerWord.hearted,false,'Same-word busy picker prevents a racing heart write');
  assert.match(generationMessage,/definition picker/);
  assert.ok(messages.some(message=>/Click ignored/.test(message[0])),'Ignored clicks are diagnosed');
  await context.handleToggleHeart('heart-other');
  assert.equal(otherWord.hearted,false,'Other hearts still work while assignment is saving');
  releaseWrite();await pendingAssignment;heldWrite=null;
  assert.equal(context.generatorDefinitionPicker.isBusy(),false);
  assert.equal(pickerRow.querySelector('.heart-btn').disabled,false,'Completion reenables the heart');
  database.push({rowId:'idle-debug-concept',timestamp:1,conceptData:{id:'idc',text:'another debug meaning',author:'bob',createdAt:1}});
  await context.openGeneratorDefinitionPicker('heart-picker');
  assert.equal(pickerRow.querySelector('.heart-btn').disabled,false,'Idle pickers do not block their own heart');
  await context.handleToggleHeart('heart-picker');
  assert.equal(context.generatorDefinitionPicker.isOpen(),false,'Clicking the same word closes an idle picker and toggles the heart');
  assert.equal(pickerWord.hearted,false);
  assert.ok(messages.some(message=>/Saved/.test(message[0])));
  otherWord.saveStatus='loading-definitions';
  await context.handleToggleHeart('heart-other');
  assert.ok(messages.some(message=>/Click ignored/.test(message[0])&&/loading-definitions/.test(message[1].reason)));
  otherWord.saveStatus='idle';
  failedWrite=true;await context.handleToggleHeart('heart-other');failedWrite=false;
  assert.equal(otherWord.hearted,false,'Failed heart writes roll back');
  assert.ok(messages.some(message=>/Save failed/.test(message[0])));
  assert.match(generationMessage,/Could not save heart/);
  let slowCallback, finishSlow, clearedSlow=false;
  const originalPersist=context.persistHeartedState;
  context.setTimeout=callback=>{slowCallback=callback;return 99;};
  context.clearTimeout=id=>{assert.equal(id,99);clearedSlow=true;};
  context.persistHeartedState=()=>new Promise(resolve=>{finishSlow=resolve;});
  const slowSave=context.handleToggleHeart('heart-other');slowCallback();
  assert.ok(messages.some(message=>/still pending after 10 seconds/.test(message[0])));
  assert.match(generationMessage,/taking longer/);
  finishSlow();await slowSave;
  assert.equal(clearedSlow,true);assert.equal(generationMessage,'Heart saved.');
  assert.equal(otherWord.saveStatus,'idle');
  context.persistHeartedState=originalPersist;context.setTimeout=setTimeout;context.clearTimeout=clearTimeout;
  context.console=console;
  console.log('Generator dictionary state and definition tests passed.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
