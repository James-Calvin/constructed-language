const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('dictionary.js','utf8');
class Element {
  constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.className='';}
  set textContent(value){this.text=value;this.children=[];}
  get textContent(){return this.text||'';}
  append(...nodes){this.children.push(...nodes);}
  appendChild(node){this.append(node);}
  setAttribute(key,value){this[key]=value;}
  focus(){context.document.activeElement=this;}
  querySelector(selector){return this.children.flatMap(node=>[node,...node.descendants()]).find(node=>selector.startsWith('.')?node.className.split(' ').includes(selector.slice(1)):node.tagName===selector)||null;}
  descendants(){return this.children.flatMap(node=>[node,...node.descendants()]);}
}
let database, fail=false, group;
const container=new Element('div');container.className='row-meaning';
const row=new Element('li');row.append(container);
const card={dataset:{word:'etos'},querySelector:selector=>row.querySelector(selector)};
const client={
  get:()=>({promise:async()=>({Item:structuredClone(database)})}),
  scan:()=>({promise:async()=>({Items:[structuredClone(database)]})}),
  put:({Item})=>({promise:async()=>{if(fail)throw new Error('Offline');database=structuredClone(Item);}})
};
const context={console:{error(){}},structuredClone,Date,Map,Set,Number,
  document:{createElement:tag=>new Element(tag)},currentUserId:'alice',selectedWord:'etos',renderedGroupCount:1,dictionaryRevision:0,
  isDictionaryConfigured:true,awsConfig:{heartsTableName:'secretWords'},getHeartsTableClient:()=>client,
  ensureCurrentUserIdentity:async()=>{},ensureAwsCredentials:async()=>true,
  scanDictionaryEntries:async()=>[structuredClone(database)],
  SECRET_DEFINITIONS:require('../definition-workflow.js'),recordsById:new Map(),
  GROUP_CLASSIFICATIONS:{UNDEFINED:'undefined'},activeFilter:'defined',dictionaryList:{children:[card]},
  trimOrEmpty:value=>typeof value==='string'?value.trim():'',hasMeaningText:value=>Boolean(String(value||'').trim()),
  getGroupByWord:()=>group,getDefinitionPicker:()=>({close:()=>true}),setStatus(){},
  createActionButton:(className,text,label,action)=>{const node=new Element('button');node.className=className;node.textContent=text;node.dataset.action=action;return node;},
  refreshDictionaryView(){context.renderRecordMeaning(row,group,group.displayRecord,false);},
  rebuildGroupsFromEntries(){group.definitionHistory=group.records.filter(record=>record.meaning);group.classification=context.SECRET_DEFINITIONS.classification(group.definitionHistory[0]);},
};
vm.createContext(context);
for(const name of ['buildEntryId','hasDefinedMeaning','buildDictionaryTableItem','renderRecordMeaning','openMeaningEditor','closeMeaningEditor','putDictionaryRecord','handleSaveMeaning','handleUndefineWord']) {
  const start=source.search(new RegExp(`(?:async )?function ${name}\\(`));
  const end=source.indexOf('\n}',start)+2;
  vm.runInContext(source.slice(start,end),context);
}
async function run(){
  const record={rowId:'bob::etos',timestamp:1,word:'etos',pronunciation:'etos',user:'bob',hearted:true,
    meaning:'hot; to heat',meaningUpdatedTimestamp:10,updatedTimestamp:10,definitionReview:{status:'defined'},
    conceptData:{id:'heat',text:'hot; to heat',author:'bob',createdAt:1}};
  record.id=context.buildEntryId(record.rowId,record.timestamp);
  database=structuredClone(record);context.recordsById.set(record.id,record);
  group={word:'etos',classification:'defined',displayRecord:record,definitionHistory:[record],records:[record],
    currentUserRecord:null,draftMeaning:'',saveStatus:'idle',isEditing:false};
  context.refreshDictionaryView();
  assert.ok(container.children.some(node=>node.textContent==='Append definition'));
  assert.ok(container.children.some(node=>node.textContent==='Edit meaning'));
  assert.ok(container.children.some(node=>node.textContent==='Unlink meaning'));
  context.openMeaningEditor('etos');
  assert.equal(group.draftMeaning,'hot; to heat');
  assert.equal(context.document.activeElement,row.querySelector('.meaning-input'));
  context.closeMeaningEditor('etos');
  context.openMeaningEditor('etos','append');group.draftMeaning='fire';
  fail=true;await context.handleSaveMeaning('etos');fail=false;
  assert.equal(group.isEditing,true);assert.equal(group.draftMeaning,'fire');
  assert.match(group.definitionError,/Offline/);assert.equal(record.meaning,'hot; to heat');
  await context.handleSaveMeaning('etos');
  assert.equal(record.meaning,'hot; to heat; fire');assert.equal(record.definitionReview.status,'defined');
  assert.equal(record.conceptData.text,record.meaning);assert.equal(record.user,'bob');assert.equal(record.hearted,true);
  assert.equal(record.meaningEditedBy,'alice');assert.equal(group.isEditing,false);
  context.openMeaningEditor('etos');group.draftMeaning='fire, hot, to heat';await context.handleSaveMeaning('etos');
  assert.equal(group.classification,'defined');
  context.openMeaningEditor('etos');group.draftMeaning='fire';await context.handleSaveMeaning('etos');
  assert.equal(group.classification,'candidate');
  assert.equal(context.SECRET_DEFINITIONS.canApprove(record,'alice'),false);
  context.openMeaningEditor('etos','append');group.draftMeaning='flame';
  database.meaning='changed elsewhere';database.meaningUpdatedTimestamp++;
  await context.handleSaveMeaning('etos');assert.match(group.definitionError,/changed/);
  assert.equal(group.draftMeaning,'flame');assert.equal(group.isEditing,true);
  context.closeMeaningEditor('etos');
  Object.assign(record,database);
  context.openMeaningEditor('etos','unlink');
  assert.equal(row.querySelector('.meaning-input').hidden,true);
  context.closeMeaningEditor('etos');assert.equal(database.meaning,'changed elsewhere');
  context.openMeaningEditor('etos','unlink');await context.handleSaveMeaning('etos');
  assert.equal(database.meaning,null);assert.equal(database.hearted,true);
  assert.equal(database.conceptData.text,'fire');assert.equal(group.classification,'undefined');
  console.log('Dictionary definition editing UI tests passed.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
