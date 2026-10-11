const assert=require('node:assert/strict');
const {isDeepStrictEqual}=require('node:util');
globalThis.SECRET_DEFINITIONS=require('../definition-workflow.js');
globalThis.SECRET_MEANING_REQUESTS=require('../meaning-requests.js');
globalThis.SECRET_COOPERATIVE_REFRESH=require('../cooperative-refresh.js');
if(!globalThis.crypto)globalThis.crypto=require('node:crypto').webcrypto;
const api=require('../word-relationships.js');
const key=row=>`${row.rowId}|${row.timestamp}`;
async function run(){
  const db=new Map();let fail=false,loseResponse=false;
  const client={scan:()=>({promise:async()=>({Items:structuredClone([...db.values()])})}),
    get:({Key})=>({promise:async()=>({Item:structuredClone(db.get(key(Key)))})}),
    put:p=>({promise:async()=>{
      if(fail&&p.Item.recipeData)throw new Error('Offline');
      const old=db.get(key(p.Item)),field=p.ExpressionAttributeNames?.['#data'];
      if(p.ConditionExpression==='attribute_not_exists(rowId)'&&old||field&&!isDeepStrictEqual(old?.[field],p.ExpressionAttributeValues[':data']))throw Object.assign(new Error('Concurrent write'),{code:'ConditionalCheckFailedException'});
      db.set(key(p.Item),structuredClone(p.Item));
      if(loseResponse&&p.Item.recipeData){loseResponse=false;throw new Error('Lost response');}
    }}),delete:p=>({promise:async()=>{const field=p.ExpressionAttributeNames['#data'];assert.deepEqual(db.get(key(p.Key))[field],p.ExpressionAttributeValues[':data']);db.delete(key(p.Key));}})};
  const service=api.create({client:()=>client,table:'secretWords',user:()=> 'alice'});
  assert.deepEqual(api.senses(' fire; heat, flame ;; fire '),['fire','heat','flame']);
  assert.equal(api.literal([{sense:'fire'},{sense:'water'}]),'fire + water');assert.equal(api.literal([{sense:'fire'},{sense:''}]),'');
  const words={};
  for(const [word,meaning]of [['ka','fire'],['ni','water'],['kanika','warm river']])words[word]=await service.saveWord({word,pronunciation:word,meaning});
  const a=await service.ensureWord('ka'),b=await service.ensureWord('ni'),result=await service.ensureWord('kanika');
  const parts=[{id:a,meaning:'fire; heat',sense:'fire'},{id:b,meaning:'water',sense:'water'},{id:a,meaning:'fire',sense:'heat'}];
  await assert.rejects(service.saveRecipe({result,parts:[parts[0]],operationId:'bad'}),/two/);
  await assert.rejects(service.saveRecipe({result,parts:[{id:result},{id:b}],operationId:'self'}),/itself/);
  fail=true;await assert.rejects(service.saveRecipe({result,parts,operationId:'one'}),/Offline/);fail=false;
  assert.equal(service.counts().size,0,'Failed recipes do not count');
  loseResponse=true;await assert.rejects(service.saveRecipe({result,parts,operationId:'one'}),/Lost response/);
  const first=await service.saveRecipe({result,parts,operationId:'one'});
  assert.equal(service.recipes().length,1);assert.deepEqual(service.counts().get(a),{prefix:1,root:0,suffix:1});assert.deepEqual(service.counts().get(b),{prefix:0,root:1,suffix:0});
  assert.equal(service.relationships(result).length,3,'Repeated component occurrences remain visible');
  assert.equal(service.relationships(a).length,2,'Inverse positions remain visible');
  assert.equal((await service.saveRecipe({result,parts,operationId:'one'})).rowId,first.rowId);
  await assert.rejects(service.saveRecipe({result,parts,operationId:'two'}),/already exists/);
  const second=await service.saveRecipe({result,parts:[parts[1],parts[0]],base:first,operationId:'two'});
  assert.equal(second.recipeData.author,'alice');assert.deepEqual(service.counts().get(a),{prefix:0,root:0,suffix:1});
  await assert.rejects(service.saveRecipe({result,parts,base:first,operationId:'three'}),/changed/);
  await service.link(result,a,'compound');assert.equal(service.relationships(result).filter(edge=>edge.target.id===a).length,1,'Manual links suppress duplicate recipe display');
  db.set(key(words.ka),{...words.ka,word:'ko'});service.load(await service.read());await service.renameWord('ka','ko');
  assert.equal(service.resolve(a).spelling,'ko');assert.equal(service.relationships(result).find(edge=>edge.target.id===a).target.spelling,'ko');
  db.set(key(words.kanika),{...words.kanika,meaning:null});service.load(await service.read());assert.equal(service.recipes().length,1,'Undefining retains composition');
  await service.removeWord('ko');service.load(await service.read());
  assert.equal(service.counts().has(a),false,'Deleted components are not live counters');
  assert.ok(service.relationships(result).some(edge=>edge.target.id===a&&edge.target.kind==='unavailable'),'Historical components stay visible');
  await assert.rejects(service.saveRecipe({result,parts:[parts[1],parts[0]],base:second,operationId:'missing'}),/unavailable/);
  const metadata=[...db.values()].filter(row=>row.recipeData);assert.equal(SECRET_MEANING_REQUESTS.groupWords(metadata).length,0);
  assert.equal(require('../symbol-analytics.js').analyze(metadata,{vowels:[{symbol:'a'}],consonants:[{symbol:'k'}]}).selected,0);
  await service.removeWord('kanika');assert.equal(service.recipes().length,0);assert.equal(service.counts().size,0);assert.ok(service.resolve(b));
  console.log('Compound recipes, position counters, conflicts and lifecycle tests passed.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
