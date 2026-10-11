const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {fixture}=require('./building-dom.cjs');
async function run(){
  const {document}=fixture([]);let failWrite=false,failDelete=false,rows=[{rowId:'word',timestamp:1,word:'kan',pronunciation:'kan',meaning:'flame',user:'alice',hearted:true},
    {rowId:'root',timestamp:0,morphemeData:{kind:'root',spelling:'ka',pronunciation:'ka',meaning:'fire',author:'bob'}}];
  const client={scan:()=>({promise:async()=>({Items:structuredClone(rows)})}),get:({Key})=>({promise:async()=>({Item:structuredClone(rows.find(row=>row.rowId===Key.rowId&&row.timestamp===Key.timestamp))})}),
    put:({Item})=>({promise:async()=>{if(failWrite)throw new Error('Offline');rows=rows.filter(row=>row.rowId!==Item.rowId||row.timestamp!==Item.timestamp).concat(structuredClone(Item));}}),
    delete:({Key})=>({promise:async()=>{if(failDelete)throw new Error('Delete offline');rows=rows.filter(row=>row.rowId!==Key.rowId);}})};
  const context={console,document,Map,Set,Date,crypto:require('node:crypto').webcrypto,SECRET_COOPERATIVE_REFRESH:require('../cooperative-refresh.js')};context.window=context;vm.createContext(context);
  for(const file of ['definition-workflow.js','meaning-requests.js','word-relationships.js','relationship-panel.js'])vm.runInContext(fs.readFileSync(file,'utf8'),context);
  const service=context.SECRET_RELATIONSHIPS.create({client:()=>client,table:'secretWords',user:()=> 'alice'});service.load(rows);
  let view;
  const panel=context.SECRET_RELATIONSHIP_PANEL.create({service,onChange:()=>{view=panel.render('kan');}});view=panel.render('kan');
  assert.equal(view.open,false);view.open=true;await view.fire('toggle');
  await view.querySelectorAll('button').find(button=>button.textContent==='Add relationship').fire('click');
  assert.equal(panel.isBusy(),true);assert.equal(view.open,true);
  const select=view.querySelector('select');select.value='0';await select.fire('change');
  const explanation=view.querySelector('textarea');explanation.value='a hot thing';await explanation.fire('input');
  await view.querySelector('form').fire('submit');
  assert.equal(panel.isBusy(),false);assert.match(view.textContent,/Derived from/);assert.match(view.textContent,/a hot thing/);
  const rootPanel=panel.render('ka','root');assert.match(rootPanel.textContent,/Derived words/,'Inventory gets inverse links');
  await view.querySelectorAll('button').find(button=>button.textContent==='Edit relationship').fire('click');
  view.querySelector('textarea').value='expanded note';await view.querySelector('textarea').fire('input');
  failWrite=true;await view.querySelector('form').fire('submit');failWrite=false;
  assert.equal(view.querySelector('textarea').value,'expanded note','Failed writes keep relationship drafts');
  assert.match(view.textContent,/Offline/);assert.equal(panel.isBusy(),true);
  await view.querySelector('form').fire('submit');assert.match(view.textContent,/expanded note/);
  await view.querySelectorAll('button').find(button=>button.textContent==='Remove link').fire('click');
  assert.equal(panel.isBusy(),true);assert.match(view.textContent,/Neither word/);
  await view.querySelectorAll('button').find(button=>button.textContent==='Cancel').fire('click');assert.match(view.textContent,/Derived from/);
  await view.querySelectorAll('button').find(button=>button.textContent==='Remove link').fire('click');
  failDelete=true;await view.querySelectorAll('button').find(button=>button.textContent==='Confirm remove').fire('click');failDelete=false;
  assert.match(view.textContent,/Delete offline/);assert.equal(panel.isBusy(),true,'Failed removal keeps confirmation available for retry');
  await view.querySelectorAll('button').find(button=>button.textContent==='Confirm remove').fire('click');
  assert.equal(rows.some(row=>row.relationshipData),false);assert.ok(rows.find(row=>row.rowId==='word').hearted);
  console.log('Relationship panel editing and confirmation tests passed.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
