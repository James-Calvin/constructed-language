const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { create } = require('../meaning-requests.js');
if (!globalThis.crypto) globalThis.crypto = require('node:crypto').webcrypto;

class Element {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.listeners = {}; this.dataset = {};
    this.value = ''; this.open = false; this.hidden = false; this.parentElement = null;
  }
  append(...nodes) {
    for (const node of nodes) { node.remove(); this.children.push(node); node.parentElement = this; }
  }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this);
    this.parentElement = null;
  }
  replaceChildren(...nodes) { for (const node of [...this.children]) node.remove(); this.append(...nodes); }
  replaceWith(node) {
    const parent = this.parentElement;
    if (!parent) return;
    const index = parent.children.indexOf(this);
    node.remove(); parent.children[index] = node; node.parentElement = parent; this.parentElement = null;
  }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  async fire(type, event = {}) { return this.listeners[type]?.({ preventDefault() {}, ...event }); }
  querySelectorAll(selector) {
    const tags = selector.split(',').map(tag => tag.trim());
    return this.children.flatMap(node => [...(tags.includes(node.tagName) ? [node] : []), ...node.querySelectorAll(selector)]);
  }
  checkValidity() { return this.type !== 'number' || Number(this.value) >= Number(this.min) && Number(this.value) <= Number(this.max); }
}
async function run() {
  const database = new Map();
  const key = item => `${item.rowId}|${item.timestamp}`;
  const client = {
    get: ({ Key }) => ({ promise: async () => ({ Item: structuredClone(database.get(key(Key))) }) }),
    put: ({ Item }) => ({ promise: async () => { database.set(key(Item), structuredClone(Item)); } }),
    scan: () => ({ promise: async () => ({ Items: [...database.values()].map(item => structuredClone(item)) }) })
  };
  const service = create({ client: () => client, table: 'secretWords', user: () => 'alice' });
  const wanted = await service.add('sunlight');
  await service.add('moonlight');
  database.set('existing|1', { rowId: 'existing', timestamp: 1, word: 'sol', pronunciation: 'sol', meaning: 'sun', user: 'bob' });
  const ids = ['conceptPending', 'conceptFulfilled', 'conceptStatus', 'conceptSearch', 'conceptAddForm', 'conceptText',
    'conceptAddButton', 'conceptRefresh', 'conceptPendingHeading', 'conceptFulfilledHeading'];
  const nodes = Object.fromEntries(ids.map(id => [id, new Element('div')]));
  let generationCalls = 0;
  const context = {
    console, Set, Map, URLSearchParams,
    window: { SECRET_CURRENT_USER: { id: 'alice' }, addEventListener() {} },
    SECRET_COOPERATIVE_REFRESH: { start: () => ({ seed() {}, stop() {} }) },
    document: { createElement: tag => new Element(tag), getElementById: id => nodes[id] },
    SECRET_MEANING_REQUESTS: require('../meaning-requests.js'),
    LOVE_LANGUAGE_SHARED: { createAwsRuntime: () => ({ getHeartsTableClient: () => client,
      awsConfig: { heartsTableName: 'secretWords' }, isHeartsConfigured: true, ensureAwsCredentials: async () => true }) },
    LOVE_LANGUAGE_RULES: {
      loadActiveRuleConfig: () => ({}),
      derivePronunciationFromSpelling: ({ spelling }) => spelling === 'unknown'
        ? { pronunciation: '', warnings: ['Missing symbol mapping'] } : { pronunciation: 'auto.ipa', warnings: [] },
      evaluateRuleConfigCompatibility: () => ({ isReady: true })
    },
    SECRET_PREFIX_GENERATOR: { search: (config, prefix, min, max, randomize, excluded) => {
      generationCalls++;
      assert.ok(excluded.has('sol'));
      return { candidate: { word: 'luna', ipa: 'lu.na' } };
    } }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../meanings.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nodes.conceptPending.children.length, 2);
  assert.equal(nodes.conceptFulfilled.children.length, 0);
  const card = nodes.conceptPending.children.find(node => node.dataset.conceptId === wanted.conceptData.id);
  const details = card.children[2];
  assert.equal(details.open, false, 'Assignment controls start collapsed');
  const form = details.children[1];
  const existing = form.children[0].children[1];
  existing.value = 'sol';
  await existing.fire('change');
  const spelling = form.children[2].children[1];
  const ipa = form.children[3].children[1];
  assert.equal(spelling.value, 'sol');
  assert.equal(ipa.value, 'sol', 'Existing word retains saved IPA');
  spelling.value = 'manual';
  await spelling.fire('input');
  assert.equal(ipa.value, 'auto.ipa');
  spelling.value = 'unknown';
  await spelling.fire('input');
  assert.equal(ipa.value, '', 'Unknown mappings clear IPA for manual entry');
  assert.match(form.children[4].textContent, /Missing symbol/);
  ipa.value = 'do not interrupt';
  await spelling.fire('input', { isComposing: true });
  assert.equal(ipa.value, 'do not interrupt', 'Composition does not trigger derivation');
  const generate = form.children[1].children[2];
  await generate.fire('click');
  assert.equal(generationCalls, 1);
  assert.equal(spelling.value, 'luna');
  assert.equal(ipa.value, 'lu.na');
  nodes.conceptSearch.value = 'moon';
  await nodes.conceptSearch.fire('input');
  assert.equal(card.hidden, true);
  assert.equal(spelling.value, 'luna', 'Searching preserves assignment draft');
  nodes.conceptSearch.value = '';
  await nodes.conceptSearch.fire('input');
  await form.fire('submit');
  assert.equal(nodes.conceptPending.children.length, 1);
  assert.equal(nodes.conceptFulfilled.children.length, 1);
  assert.equal(database.get(key(wanted)).word, 'luna');
  assert.equal(database.get(key(wanted)).definitionReview.status, 'candidate');
  assert.equal(database.get('existing|1').meaning, 'sun', 'Existing definition is untouched');
  nodes.conceptText.value = 'a new concept';
  await nodes.conceptAddForm.fire('submit');
  assert.equal(nodes.conceptPending.children.length, 2);
  assert.equal(nodes.conceptText.value, '');
  console.log('Meanings UI tests passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
