const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {Element,fixture}=require('./building-dom.cjs');
async function run(){
  const {body,document}=fixture([]),details=new Element('details');details.className='prefix-options';body.append(details);
  let database=[{rowId:'root',timestamp:0,morphemeData:{kind:'root',spelling:'ka',pronunciation:'ka',meaning:'fire',author:'bob'}}],fail=false;
  const client={scan:()=>({promise:async()=>({Items:structuredClone(database)})}),get:({Key})=>({promise:async()=>({Item:structuredClone(database.find(row=>row.rowId===Key.rowId&&row.timestamp===Key.timestamp))})}),
    put:({Item})=>({promise:async()=>{if(fail&&Item.relationshipData)throw new Error('Offline');database=database.filter(row=>row.rowId!==Item.rowId||row.timestamp!==Item.timestamp).concat(structuredClone(Item));}})};
  const context={document,console,URLSearchParams,Map,Set,Date,crypto:require('node:crypto').webcrypto,
    location:{search:'?rootId=root&rootPosition=end'},SECRET_COOPERATIVE_REFRESH:require('../cooperative-refresh.js')};
  context.window=context;vm.createContext(context);
  for(const file of ['definition-workflow.js','meaning-requests.js','word-relationships.js','root-generation.js'])vm.runInContext(fs.readFileSync(file,'utf8'),context);
  const inputs={start:{value:'old prefix'},end:{value:'old suffix'}};let validations=0,refreshes=0;
  const controller=context.SECRET_ROOT_GENERATION.create({client:()=>client,table:'secretWords',user:()=> 'alice',inputs,
    revalidate:()=>validations++,rerender(){},refresh:()=>refreshes++});
  assert.equal(controller.ready(),false);controller.accept(database);
  assert.equal(inputs.start.value,'');assert.equal(inputs.end.value,'ka');assert.equal(details.open,true);
  assert.equal(controller.ready(),true);assert.equal(database.filter(row=>row.relationshipData).length,0,'Opening root context is read-only');
  const row=new Element('li'),meaning=new Element('div');meaning.className='row-meaning';row.append(meaning);
  const state={word:'nka',hearted:false,saveStatus:'idle'};
  controller.render(row,state,false);assert.equal(meaning.children.length,0,'Unselected suggestions hide controls');
  controller.render(row,state,true);assert.equal(meaning.querySelector('input').checked,true);
  const item={rowId:'word',timestamp:1,word:'nka',pronunciation:'nka',hearted:true,user:'alice'};
  database.push(item);await controller.saved(state,item);assert.equal(database.some(row=>row.relationshipData),false,'Unhearted suggestions never create links');
  state.hearted=true;state.linkRoot=false;await controller.saved(state,item);assert.equal(database.some(row=>row.relationshipData),false,'Unchecked link option is respected');
  state.linkRoot=true;fail=true;await controller.saved(state,item);assert.match(state.relationshipError,/Word saved; relationships pending/);
  assert.equal(state.pendingRootLink,item);assert.equal(database.filter(row=>row.word==='nka').length,1);
  meaning.replaceChildren();controller.render(row,state,true);fail=false;await meaning.querySelector('button').fire('click');
  assert.equal(state.relationshipError,'');assert.equal(database.filter(row=>row.relationshipData).length,1);
  await controller.saved(state,item);assert.equal(database.filter(row=>row.relationshipData).length,1,'Retry does not duplicate links');
  assert.ok(validations>0);
  inputs.start.value='user prefix';const banner=body.querySelector('.root-context-banner');await banner.querySelectorAll('button')[1].fire('click');
  assert.equal(inputs.end.value,'');assert.equal(inputs.start.value,'user prefix');assert.equal(controller.isActive(),false);
  context.location.search='';assert.equal(context.SECRET_ROOT_GENERATION.create({}),null,'Ordinary generation has no root context');
  context.location.search='?rootWord=nka&rootPosition=start';
  const wordContext=context.SECRET_ROOT_GENERATION.create({client:()=>client,table:'secretWords',user:()=> 'alice',inputs,revalidate(){},rerender(){},refresh(){}});
  wordContext.accept(database);assert.equal(inputs.start.value,'nka');
  database=database.map(row=>row.rowId==='word'?{...row,word:'renamed'}:row);wordContext.accept(database);
  assert.equal(wordContext.ready(),true,'Dictionary root context follows stable source identities');
  assert.equal(inputs.start.value,'renamed','An untouched root constraint follows a renamed root');
  wordContext.accept([]);assert.equal(wordContext.ready(),false,'Missing root requires retry or clearing context');
  console.log('Root-generation controls and link retry tests passed.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
