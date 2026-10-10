const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
  constructor(tag='div') { this.tag = tag; this.children=[]; this.listeners={}; this.style={}; this.dataset={}; }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children=children; }
  setAttribute(key,value) { this[key]=value; }
  addEventListener(event,fn) { this.listeners[event]=fn; }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
}
async function run() {
  const ids = ['analyticsPosition','analyticsSummary','analyticsGuidance','analyticsCharts','analyticsDiagnostics',
    'analyticsDiagnosticsTitle','analyticsExcluded','analyticsStatus','analyticsRefresh'];
  const nodes = Object.fromEntries(ids.map(id => [id,new Element()]));
  nodes.analyticsPosition.value='all';
  const checks=['defined','candidate','undefined'].map(value => Object.assign(new Element('input'),{value,checked:true}));
  let config={vowels:[{symbol:'a'}],consonants:[{symbol:'b'}]};
  let options, scanCalls=0;
  const events={};
  const root={
    scrollX:0,scrollY:120,scrollTo(x,y) { assert.equal(y,120); },
    addEventListener(name,fn) { events[name]=fn; },
    SECRET_SYMBOL_ANALYTICS:require('../symbol-analytics.js'),
    LOVE_LANGUAGE_RULES:{loadActiveRuleConfig:()=>config,storageKeys:{active:'active'}},
    LOVE_LANGUAGE_SHARED:{createAwsRuntime:()=>({isHeartsConfigured:true,ensureAwsCredentials:async()=>true,
      awsConfig:{heartsTableName:'secretWords'},getHeartsTableClient:()=>({scan(params) {
        assert.equal(params.ConsistentRead,true); scanCalls++;
        return {promise:async()=>scanCalls%2 ? {Items:[{word:'ab',pronunciation:'ab',meaning:'old'}],LastEvaluatedKey:{rowId:'next'}}
          : {Items:[{word:'a',pronunciation:'a',hearted:true}]}};
      }})})},
    SECRET_COOPERATIVE_REFRESH:{start(value) { options=value; return {request:async()=>{},stop(){}}; }}
  };
  const document={getElementById:id=>nodes[id],querySelectorAll:()=>checks,createElement:tag=>new Element(tag),activeElement:checks[0]};
  vm.runInNewContext(fs.readFileSync('analytics.js','utf8'),{window:root,document});
  const rows=await options.read();
  assert.equal(rows.length,2); assert.equal(scanCalls,2);
  options.apply(rows); options.onSuccess();
  assert.match(nodes.analyticsSummary.textContent,/2 selected words · 2 analyzed/);
  assert.equal(nodes.analyticsCharts.children.length,2);
  assert.equal(document.activeElement,checks[0]);
  checks[2].checked=false; checks[2].listeners.change();
  assert.match(nodes.analyticsSummary.textContent,/1 selected words/);
  nodes.analyticsPosition.value='end'; nodes.analyticsPosition.listeners.change();
  assert.match(nodes.analyticsSummary.textContent,/1 symbol occurrences/);
  options.onError(); assert.match(nodes.analyticsStatus.textContent,/last successful/);
  assert.equal(nodes.analyticsCharts.children.length,2);
  options.apply(rows); assert.equal(checks[2].checked,false); assert.equal(nodes.analyticsPosition.value,'end');
  config={vowels:[{symbol:'a'}],consonants:[]}; events['secret-rules-imported']();
  assert.match(nodes.analyticsSummary.textContent,/1 excluded/);
  assert.equal(nodes.analyticsDiagnostics.hidden,false);
  config={}; events.storage({key:'active'}); assert.equal(nodes.analyticsGuidance.hidden,false);
  checks.forEach(check=>check.checked=false); checks[0].listeners.change();
  assert.match(nodes.analyticsSummary.textContent,/Select at least one category/);
  assert.equal(nodes.analyticsCharts.children.length,0);
  console.log('Analytics UI tests passed.');
}
run().catch(error=>{ console.error(error); process.exitCode=1; });
