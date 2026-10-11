const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function scenario({warm,localEdit=false,malformed=false}){
  const data=new Map(),events=[],intervals=[];let reads=0,resolveRead,focused=true;
  const pending=new Promise(resolve=>{resolveRead=resolve;});
  const document={visibilityState:'visible',hasFocus:()=>focused,addEventListener(){}};
  const context={console,document,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},
    localStorage:{getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)},addEventListener(){},dispatchEvent:event=>events.push(event),
    setInterval:callback=>intervals.push(callback),LOVE_LANGUAGE_SHARED:{createAwsRuntime:()=>({awsConfig:{heartsTableName:'test'},isHeartsConfigured:true,
      ensureAwsCredentials:async()=>true,getHeartsTableClient:()=>({get:()=>({promise:async()=>{reads++;return pending;}})})})}};
  context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync('rules-config.js','utf8'),context);
  const rules=context.LOVE_LANGUAGE_RULES,base={...rules.getDefaultRuleConfig(),vowels:[{symbol:'i',ipa:'i'}],consonants:[{symbol:'k',ipa:'k'}],syllablePatterns:{single:['CV'],initial:['CV'],medial:['CV'],final:['CV']}};
  const remote={...base,vowels:[{symbol:'a',ipa:'a'}],consonants:[{symbol:'b',ipa:'b'}],syllablePatterns:{single:['CV'],initial:['CV'],medial:['CV'],final:['CV']}};
  if(warm){rules.saveActiveRuleConfig(base);rules.saveDraftRuleConfig(base);
    data.set('secret.database-rules.sync.v1',JSON.stringify({updatedTimestamp:1,fingerprint:JSON.stringify({draft:rules.normalizeRuleConfig(base),active:rules.normalizeRuleConfig(base)})}));}
  if(localEdit)rules.saveActiveRuleConfig({...remote,vowels:[{symbol:'i',ipa:'i'}]});
  if(malformed)data.set(rules.storageKeys.active,'{broken');
  vm.runInContext(fs.readFileSync('database-settings.js','utf8'),context);
  let ready=false;context.SECRET_RULES_READY.then(()=>{ready=true;});await settle();
  assert.equal(ready,warm&&!malformed,'Only validated local rules bypass the initial database wait');
  resolveRead({Item:{rowId:'__secret_language_settings__',timestamp:0,draftRules:remote,activeRules:remote,updatedTimestamp:2}});
  await context.SECRET_RULES_READY;await settle();
  assert.equal(rules.loadActiveRuleConfig().vowels[0].symbol,localEdit?'i':'a');
  assert.equal(events.some(event=>event.type==='secret-rules-imported'),warm&&!localEdit&&!malformed,'Warm-start remote changes notify running consumers');
  const before=reads;focused=false;intervals[0]();await settle();assert.equal(reads,before);
  focused=true;intervals[0]();await settle();assert.equal(reads,before+1);
}
async function run(){await scenario({warm:true});await scenario({warm:false});await scenario({warm:true,localEdit:true});await scenario({warm:true,malformed:true});console.log('Warm/cold settings startup, local edit protection and focused polling tests passed.');}
run().catch(error=>{console.error(error);process.exitCode=1;});
