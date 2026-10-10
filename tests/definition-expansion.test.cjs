const assert = require('node:assert/strict');
const workflow = require('../definition-workflow.js');
const concepts = require('../meaning-requests.js');

async function run() {
  for (const after of ['hot; to heat; fire', 'fire, HOT, to heat', ' hot ; hot, to heat ', 'to heat;hot']) {
    assert.equal(workflow.isAdditive('hot; to heat', after), true, after);
    assert.equal(workflow.reviewForSave({meaning: after}, {meaning:'hot; to heat'}), null);
  }
  assert.equal(workflow.isAdditive('café, inner', 'INNER; cafe\u0301; inside'), true);
  assert.equal(workflow.isAdditive('hot; to heat', 'hot; fire'), false);
  assert.equal(workflow.isAdditive('hot', 'hotter'), false);
  assert.equal(workflow.isAdditive('', 'hot'), false);
  assert.deepEqual(workflow.reviewForSave({meaning:'hot; fire'}, {meaning:'hot',definitionReview:{status:'candidate'}}), {status:'candidate'});

  let rows = [{rowId:'linked',timestamp:1,word:'etos',pronunciation:'etos',user:'alice',hearted:true,
    meaning:'hot; to heat',meaningUpdatedTimestamp:10,updatedTimestamp:10,
    conceptData:{id:'heat',text:'hot; to heat',author:'alice',createdAt:1},
    definitionReview:{status:'defined',reviewedBy:'bob'}}];
  let fail = false, race = false;
  const client = {
    get: ({Key}) => ({promise:async()=>({Item:structuredClone(rows.find(row=>row.rowId===Key.rowId&&row.timestamp===Key.timestamp))})}),
    scan: ({ExpressionAttributeValues}) => ({promise:async()=>({Items:structuredClone(rows.filter(row=>row.word===ExpressionAttributeValues[':word']))})}),
    put: params => ({promise:async()=>{
      if (fail) throw new Error('Offline');
      if (race) throw Object.assign(new Error('Concurrent edit'), {code:'ConditionalCheckFailedException'});
      rows=rows.filter(row=>row.rowId!==params.Item.rowId||row.timestamp!==params.Item.timestamp).concat(structuredClone(params.Item));
    }}),
    delete: ({Key}) => ({promise:async()=>{rows=rows.filter(row=>row.rowId!==Key.rowId||row.timestamp!==Key.timestamp);}})
  };
  const base = structuredClone(rows[0]);
  // A heart change after opening the editor must not be overwritten.
  rows[0].hearted=false;rows[0].unheartedTimestamp=11;rows[0].updatedTimestamp=11;
  const item={...base,meaning:'hot; to heat; fire',meaningUpdatedTimestamp:12,updatedTimestamp:12};
  await workflow.save(client,'secretWords',item,{base,editor:'bob'});
  assert.equal(item.definitionReview.status,'defined');
  assert.equal(item.user,'alice');assert.equal(item.hearted,false);assert.equal(item.unheartedTimestamp,11);
  assert.equal(item.meaningEditedBy,'bob');assert.equal(item.meaningEditedAt,12);
  assert.equal(item.conceptData.text,item.meaning);
  assert.equal(item.conceptData.author,'alice');assert.equal(item.conceptData.createdAt,1);
  assert.equal(concepts.fulfilled(item,rows),true);
  const staleHeart={...base,hearted:true,updatedTimestamp:13};
  await workflow.save(client,'secretWords',staleHeart,{heartAction:true});
  assert.equal(staleHeart.meaning,'hot; to heat; fire','Stale heart saves cannot revert another user’s definition edit');
  assert.equal(staleHeart.meaningEditedBy,'bob');
  assert.equal(staleHeart.heartUpdatedTimestamp,13);
  const oldUnheart={...item,rowId:'other-heart',hearted:false,unheartedTimestamp:14,updatedTimestamp:14,heartUpdatedTimestamp:14};
  const laterEdit={...staleHeart,meaning:'hot; to heat; fire; warm',meaningUpdatedTimestamp:15,updatedTimestamp:15};
  await workflow.save(client,'secretWords',laterEdit,{base:structuredClone(staleHeart),editor:'bob'});
  assert.equal(concepts.hasUserHeart([oldUnheart,laterEdit],'alice'),false,'Definition editing cannot override a newer heart action on another row');
  rows=[item];
  await assert.rejects(workflow.save(client,'secretWords',{...base,meaning:'hot; fire'},{base,editor:'bob'}),/changed/);
  const changed={...item,meaning:'burn',meaningUpdatedTimestamp:13,updatedTimestamp:13};
  await workflow.save(client,'secretWords',changed,{base:structuredClone(item),editor:'bob'});
  assert.equal(changed.definitionReview.status,'candidate');
  assert.equal(workflow.canApprove(changed,'bob'),false,'Latest editor cannot approve their own changes');
  assert.equal(workflow.canApprove(changed,'alice'),true,'Original owner can review the other editor’s changes');
  assert.equal(changed.conceptData.text,'burn');
  const fresh=structuredClone(changed);
  fail=true;
  await assert.rejects(workflow.save(client,'secretWords',{...fresh,meaning:'burn; fire'},{base:fresh,editor:'alice'}),/Offline/);
  assert.equal(rows[0].meaning,'burn');fail=false;
  race=true;
  await assert.rejects(workflow.save(client,'secretWords',{...fresh,meaning:'burn; fire'},{base:fresh,editor:'alice'}),/Concurrent/);
  race=false;
  rows.push({...fresh,rowId:'newer',meaning:'newer definition',meaningUpdatedTimestamp:20});
  await assert.rejects(workflow.save(client,'secretWords',{...fresh,meaning:'burn; fire'},{base:fresh,editor:'alice'}),/newer definition/);
  rows=rows.filter(row=>row.rowId!=='newer');

  const reference={rowId:'ref',timestamp:2,conceptData:{id:'ref',text:'hot',author:'alice',createdAt:2,
    fulfillment:{word:'etos',pronunciation:'etos',rowId:'linked',timestamp:1}}};
  rows.push(reference);
  assert.equal(concepts.fulfillmentTarget(reference,rows).word,'etos');
  rows[0].word='eta';
  assert.equal(concepts.fulfillmentTarget(reference,rows).word,'eta','References follow renamed source rows');
  assert.equal(reference.conceptData.text,'hot','Reference requests remain independent of definition text');
  const undefinedRow={...rows[0],meaning:null,meaningUpdatedTimestamp:null,updatedTimestamp:30};
  await workflow.save(client,'secretWords',undefinedRow,{base:structuredClone(rows[0])});
  assert.equal(concepts.fulfilled(reference,rows),false,'Undefining reopens reference requests');
  assert.equal(concepts.fulfilled(undefinedRow,rows),false,'Undefining reopens directly linked requests');
  assert.equal(undefinedRow.conceptData.text,'burn','Expanded linked meaning is retained on undefine');
  const service=concepts.create({client:()=>client,table:'secretWords',user:()=> 'alice'});
  service.load(rows);
  assert.equal(service.fulfilled(reference),false);
  const edited=await service.edit(reference,'hot inside');
  assert.equal(edited.conceptData.text,'hot inside');
  const reassigned=await service.assign(edited,'new','n',{hearted:true});
  assert.equal(reassigned.conceptData.fulfillment,undefined,'Reassignment clears obsolete reference metadata');
  assert.equal(concepts.fulfilled(reassigned,rows),true);
  assert.equal(reassigned.hearted,true);
  await service.remove(undefinedRow);
  assert.equal(rows.find(row=>row.rowId==='linked').word,'eta','Removing reopened request keeps undefined word');
  assert.equal(rows.find(row=>row.rowId==='linked').hearted,false);
  assert.equal(concepts.fulfilled(reference,[]),false,'Deleting target reopens reference');
  // Older defined rows without a meaning timestamp remain editable.
  const legacy={rowId:'legacy',timestamp:40,word:'old',pronunciation:'o',meaning:'old',user:'alice',hearted:true};
  rows.push(legacy);
  const saved={...legacy,meaning:'old; ancient',updatedTimestamp:41,meaningUpdatedTimestamp:41};
  await workflow.save(client,'secretWords',saved,{base:{...legacy,meaningUpdatedTimestamp:40,updatedTimestamp:40},editor:'bob'});
  assert.equal(saved.definitionReview,null);
  console.log('Definition expansion and live fulfillment tests passed.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
