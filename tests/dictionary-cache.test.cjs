const assert=require('node:assert/strict');
const api=require('../dictionary-cache.js');
const row=(word='ka',meaning='fire')=>({rowId:word,timestamp:1,word,pronunciation:word,meaning,hearted:true,user:'alice'});
function storage(){const data=new Map();return{getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key),key:index=>[...data.keys()][index],get length(){return data.size;}};}
async function run(){
  let now=1000,scans=0,ensures=0,failPage=false,release;
  const session=storage(),client={scan:params=>({promise:async()=>{
    scans++;if(release)await release;
    if(!params.ExclusiveStartKey)return{Items:[row()],LastEvaluatedKey:{rowId:'next',timestamp:1}};
    if(failPage)throw new Error('Page offline');return{Items:[row('ni','water')]};
  }})};
  const options={client:()=>client,table:'test',scopeKey:'alice',storage:session,ensure:async()=>{ensures++;return true;},now:()=>now};
  const cache=api.create(options);
  assert.equal(cache.peek(),null);assert.equal(cache.fresh(),false);
  const results=await Promise.all([cache.refresh(),cache.refresh(),cache.refresh({force:true})]);
  assert.equal(scans,2,'One paginated scan for concurrent consumers');assert.equal(ensures,1);assert.equal(results[0],results[1]);
  assert.equal(cache.matches('ka')[0].meaning,'fire');assert.equal(cache.matches('missing').length,0);assert.equal(cache.row({rowId:'ni',timestamp:1}).meaning,'water');
  const verified=cache.lastVerifiedAt();now+=10000;
  const navigated=api.create(options);assert.equal(navigated.remaining(),20000);await navigated.refresh();assert.equal(scans,2,'Warm page navigation performs no scan');
  global.SECRET_MEANING_REQUESTS=require('../meaning-requests.js');let groups=0;const original=SECRET_MEANING_REQUESTS.groupWords;
  SECRET_MEANING_REQUESTS.groupWords=raw=>{groups++;return original(raw);};cache.words();cache.words();assert.equal(groups,1);SECRET_MEANING_REQUESTS.groupWords=original;
  cache.upsert(row('ka','flame'));assert.equal(cache.lastVerifiedAt(),verified);assert.equal(cache.matches('ka')[0].meaning,'flame');
  cache.remove({rowId:'ni',timestamp:1});assert.equal(cache.matches('ni').length,0);
  now=31000;assert.equal(cache.fresh(),false);failPage=true;
  const before=cache.peek();await assert.rejects(cache.refresh(),/Page offline/);assert.equal(cache.peek(),before,'Partial pagination never publishes');
  assert.equal(api.create(options).matches('ka')[0].meaning,'flame','Partial results never reach session storage');failPage=false;
  await cache.refresh();assert.equal(cache.matches('ni').length,1);
  let resume;release=new Promise(resolve=>{resume=resolve;});const pending=cache.refresh({force:true});await new Promise(resolve=>setImmediate(resolve));
  cache.upsert(row('ka','saved during read'));resume();await assert.rejects(pending,/changed during refresh/);release=null;
  assert.equal(cache.matches('ka')[0].meaning,'saved during read');
  let failWrite=false;
  const tracked=api.trackClient({put:()=>({promise:async()=>{if(failWrite)throw new Error('Conditional conflict');return{};}}),
    delete:()=>({promise:async()=>({})}),update:()=>({promise:async()=>({Attributes:row('ka','updated')})})},()=>cache);
  const priorTime=cache.lastVerifiedAt();await tracked.put({Item:row('ka','confirmed')}).promise();assert.equal(cache.matches('ka')[0].meaning,'confirmed');assert.equal(cache.lastVerifiedAt(),priorTime);
  failWrite=true;await assert.rejects(tracked.put({Item:row('ka','rejected')}).promise(),/conflict/);assert.equal(cache.matches('ka')[0].meaning,'confirmed');assert.equal(cache.fresh(),false);failWrite=false;
  await cache.refresh();await tracked.update({ReturnValues:'ALL_NEW'}).promise();assert.equal(cache.matches('ka')[0].meaning,'updated');
  await tracked.delete({Key:{rowId:'ka',timestamp:1}}).promise();assert.equal(cache.matches('ka').length,0);
  await tracked.update({}).promise();assert.equal(cache.fresh(),false,'Unknown update images invalidate instead of guessing');
  const malformed=storage();malformed.setItem(api.PREFIX+'bad','{broken');assert.equal(api.create({...options,storage:malformed,scopeKey:'bad'}).peek(),null);
  malformed.setItem(api.PREFIX+'bad',JSON.stringify({rows:[{}],verifiedAt:1000}));assert.equal(api.create({...options,storage:malformed,scopeKey:'bad'}).peek(),null);
  const denied=api.create({...options,storage:{getItem(){throw new Error('Denied');},setItem(){throw new Error('Denied');}}});await denied.refresh();assert.equal(denied.matches('ka').length,1);
  global.sessionStorage=session;global.SECRET_CURRENT_USER={id:'alice'};
  const runtime={awsConfig:{region:'r',identityPoolId:'p',heartsTableName:'t'},getHeartsTableClient:()=>client,ensureAwsCredentials:async()=>true};
  const alice=api.forRuntime(runtime);assert.equal(api.forRuntime({...runtime}),alice);
  global.SECRET_CURRENT_USER={id:'bob'};assert.notEqual(api.forRuntime(runtime),alice);
  global.SECRET_CURRENT_USER={id:'alice'};assert.notEqual(api.forRuntime({...runtime,awsConfig:{...runtime.awsConfig,heartsTableName:'other'}}),alice);
  session.setItem('unrelated','keep');api.clearAll();assert.equal(session.length,1);assert.equal(session.getItem('unrelated'),'keep');assert.equal(alice.peek(),null);
  delete global.sessionStorage;delete global.SECRET_CURRENT_USER;
  console.log('Session snapshot cache, pagination, concurrency, mutations and isolation tests passed.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
