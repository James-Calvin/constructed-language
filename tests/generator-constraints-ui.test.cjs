const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
assert.match(html,/<details class="prefix-options">\s*<summary>Constraints<\/summary>/);
assert.match(html,/id="wordSuffix"/);
assert.ok(html.indexOf('data-protected-src="meaning-requests.js"') < html.indexOf('data-protected-src="symbol-analytics.js"'));
assert.ok(html.indexOf('data-protected-src="generator-constraints.js"') < html.indexOf('data-protected-src="script.js"'));
class Element {
  constructor(tag='div') { this.tag=tag; this.children=[]; this.listeners={}; this.value=''; this.hidden=false; }
  appendChild(node) { this.children.push(node); return node; }
  addEventListener(name,callback) { this.listeners[name]=callback; }
  fire() { this.listeners.change(); }
}
const nodes=Object.fromEntries(['normalizationRows','normalizationStatus','normalizationRetry','wordSuffix'].map(id=>[id,new Element()]));
const document={getElementById:id=>nodes[id],createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text})};
const root={SECRET_GENERATOR_NORMALIZATION:require('../generator-normalization.js')};
vm.runInNewContext(fs.readFileSync('generator-constraints.js','utf8'),{window:root});
let config={vowels:[{symbol:'a'},{symbol:'i'}],consonants:[]};
let changes=0,requests=0;
const controller=root.SECRET_GENERATOR_CONSTRAINTS.create({document,config:()=>config,onChange:()=>changes++,requestRefresh:()=>requests++});
const groups=nodes.normalizationRows.children;
const inputs=group=>group.children.filter(node=>node.tag==='label').map(label=>label.children[0]);
assert.equal(groups.length,3);
for(const group of groups) assert.deepEqual(inputs(group).map(input=>input.checked),[false,true,true,true]);
assert.equal(controller.enabled(),false); assert.equal(controller.ready(),true);
assert.equal(requests,0);
const start=inputs(groups[0]),all=inputs(groups[1]);
start[0].checked=true; start[0].fire();
assert.equal(requests,1); assert.equal(controller.ready(),false);
assert.match(nodes.normalizationStatus.textContent,/Loading/);
controller.error(); assert.equal(nodes.normalizationRetry.hidden,false); assert.match(nodes.normalizationStatus.textContent,/Could not load/);
nodes.normalizationRetry.listeners.click(); assert.equal(requests,2);
const data=[{rowId:'r',timestamp:1,word:'a',pronunciation:'a',meaning:'old'}];
controller.accept(data); assert.equal(controller.ready(),true);
assert.equal(controller.options().weights.start.i,2);
assert.equal(nodes.normalizationRetry.hidden,true);
nodes.wordSuffix.value='i';
controller.error(); assert.equal(controller.options().weights.start.i,2); assert.match(nodes.normalizationStatus.textContent,/last successful/);
assert.equal(controller.options().suffix,'i');
all[0].checked=true; all[0].fire();
assert.equal(controller.options().weights.all.i,2);
start.slice(1).forEach(input=>input.checked=false); start[1].fire();
assert.match(nodes.normalizationStatus.textContent,/uniform weights/);
assert.equal(controller.options().weights.start.i,1);
controller.remember({rowId:'r',timestamp:1,word:'i',pronunciation:'i',meaning:'new'});
assert.equal(controller.options().weights.all.a,2);
assert.equal(controller.options().weights.all.i,1);
config={vowels:[{symbol:'a'},{symbol:'i'},{symbol:'u'}],consonants:[]};
assert.equal(controller.options().weights.all.u,2,'Rule changes use the active inventory');
const original=nodes.normalizationRows.children[0];
controller.accept(data); assert.equal(nodes.normalizationRows.children[0],original,'Refresh does not rebuild controls');
assert.equal(start[1].checked,false); assert.equal(nodes.wordSuffix.value,'i');
controller.success(); assert.equal(nodes.normalizationRetry.hidden,true);
assert.ok(changes>0);

// Exercise the generator refresh integration independently of playback/rendering.
let syncOptions, revision=0, normalization=false, snapshots=0, successes=0, failures=0;
const rows=new Map();
const context={
  generatorSync:null,SECRET_COOPERATIVE_REFRESH:{start:options=>{syncOptions=options;return{stop(){}};}},
  generatorConstraints:{enabled:()=>normalization,accept:items=>{snapshots++;assert.equal(items.length,1);},success:()=>successes++,error:()=>failures++},
  rowStateById:rows,document:{activeElement:null},generatorRevision:revision,
  generatorDefinitionPicker:null,
  isHeartsConfigured:true,ensureAwsCredentials:async()=>true,
  getHeartsTableClient:()=>({scan:()=>({promise:async()=>({Items:data})})}),awsConfig:{heartsTableName:'secretWords'},
  window:{addEventListener(){}},flushPersistedRowsSave(){},console:{warn(){}}
};
const script=fs.readFileSync('script.js','utf8');
vm.runInNewContext(script.slice(script.indexOf('generatorSync = SECRET_COOPERATIVE_REFRESH.start')),context);
(async()=>{
  assert.equal((await syncOptions.read()).length,0);
  syncOptions.apply([]); assert.equal(snapshots,0,'A skipped read is not a loaded dictionary');
  const before=syncOptions.version(); normalization=true;
  assert.notEqual(syncOptions.version(),before,'Enabling normalization invalidates skipped-read fingerprints');
  const result=await syncOptions.read(); assert.equal(result.length,1,'Load even with no generated rows');
  syncOptions.apply(result); assert.equal(snapshots,1);
  syncOptions.onSuccess();syncOptions.onError(new Error('Offline'));
  assert.equal(successes,1);assert.equal(failures,1);
  console.log('Generator constraint UI and refresh tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
