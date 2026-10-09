const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { create } = require('../meaning-requests.js');
if (!globalThis.crypto) globalThis.crypto = require('node:crypto').webcrypto;

class Element {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.listeners = {}; this.dataset = {};
    this.value = ''; this.open = false; this.hidden = false; this.parentElement = null;
    this.classList = { add: value => { this.className = `${this.className || ''} ${value}`.trim(); } };
  }
  append(...nodes) {
    for (const node of nodes) { node.remove(); this.children.push(node); node.parentElement = this; }
  }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this);
    this.parentElement = null;
  }
  insertBefore(node, reference) {
    node.remove();
    const index = this.children.indexOf(reference);
    this.children.splice(index < 0 ? this.children.length : index, 0, node); node.parentElement = this;
  }
  focus() { this.focused = true; }
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
  let failWrites = false;
  const key = item => `${item.rowId}|${item.timestamp}`;
  const client = {
    get: ({ Key }) => ({ promise: async () => ({ Item: structuredClone(database.get(key(Key))) }) }),
    put: ({ Item }) => ({ promise: async () => { if (failWrites) throw new Error('Offline'); database.set(key(Item), structuredClone(Item)); } }),
    delete: ({ Key }) => ({ promise: async () => { if (failWrites) throw new Error('Offline'); database.delete(key(Key)); } }),
    scan: () => ({ promise: async () => ({ Items: [...database.values()].map(item => structuredClone(item)) }) })
  };
  const service = create({ client: () => client, table: 'secretWords', user: () => 'alice' });
  const wanted = await service.add('sunlight');
  await service.add('moonlight');
  database.set('existing|1', { rowId: 'existing', timestamp: 1, word: 'sol', pronunciation: 'sol', meaning: 'sun', user: 'bob' });
  database.set('match|2', { rowId: 'match', timestamp: 2, word: 'glow', pronunciation: 'glo', meaning: 'gentle sunlight', definitionReview: { status: 'candidate' }, user: 'bob' });
  let syncOptions;
  const ids = ['conceptPending', 'conceptFulfilled', 'conceptStatus', 'conceptSearch', 'conceptAddForm', 'conceptText',
    'conceptAddButton', 'conceptRefresh', 'conceptPendingHeading', 'conceptFulfilledHeading'];
  const nodes = Object.fromEntries(ids.map(id => [id, new Element('div')]));
  let generationCalls = 0;
  const context = {
    console, Set, Map, URLSearchParams,
    window: { SECRET_CURRENT_USER: { id: 'alice' }, addEventListener() {} },
    SECRET_COOPERATIVE_REFRESH: { start: options => { syncOptions = options; return { seed() {}, stop() {} }; } },
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
  const suggestions = card.children.find(node => node.className === 'concept-matches');
  assert.equal(card.children[1], suggestions, 'Matches appear directly below the title');
  assert.equal(card.children[2].className, 'concept-help', 'Requester line follows matches');
  assert.equal(suggestions.hidden, false);
  assert.equal(suggestions.children[1].children[0].children[0].textContent, 'glow');
  const details = card.children.find(node => node.className === 'concept-assignment');
  assert.equal(details.open, false, 'Assignment controls start collapsed');
  const form = details.children[1];
  const existing = form.children[0].children[0].children[1];
  const undefinedFilter = form.children[0].children[1].children[1];
  assert.equal(undefinedFilter.checked, true);
  assert.equal(existing.children.some(option => option.value === 'sol'), false, 'Defined words excluded by default');
  undefinedFilter.checked = false;
  await undefinedFilter.fire('change');
  assert.match(existing.children.find(option => option.value === 'sol').textContent, /sun/);
  existing.value = 'sol';
  await existing.fire('change');
  const spelling = form.children[2].children[1];
  const ipa = form.children[3].children[1];
  assert.equal(spelling.value, 'sol');
  assert.equal(ipa.value, 'sol', 'Existing word retains saved IPA');
  undefinedFilter.checked = true;
  await undefinedFilter.fire('change');
  assert.equal(spelling.value, 'sol', 'Filtering does not clear chosen spelling');
  assert.equal(ipa.value, 'sol', 'Filtering does not clear IPA');
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
  const editable = nodes.conceptPending.children.find(node => node.children[0].textContent === 'a new concept');
  const management = editable.children.find(node => node.className === 'concept-management');
  const edit = management.children[0];
  const remove = management.children[1];
  const editForm = management.children[2];
  const editor = editForm.children[0].children[1];
  await edit.fire('click');
  assert.equal(editForm.hidden, false);
  assert.equal(editor.focused, true);
  assert.equal(syncOptions.isBusy(), true, 'Editing pauses cooperative refresh');
  editor.value = 'sunlight with nuance';
  failWrites = true;
  const originalError = console.error;
  try {
    console.error = () => {};
    await editForm.fire('submit');
  } finally { failWrites = false; console.error = originalError; }
  assert.equal(editor.value, 'sunlight with nuance', 'Failed edit retains text');
  assert.equal(editForm.hidden, false);
  await nodes.conceptRefresh.fire('click');
  assert.match(nodes.conceptStatus.textContent, /Save or cancel/);
  assert.equal(editor.value, 'sunlight with nuance');
  await editForm.fire('submit');
  const editedCard = nodes.conceptPending.children.find(node => node.children[0].textContent === 'sunlight with nuance');
  assert.ok(editedCard);
  assert.equal(editedCard.children.find(node => node.className === 'concept-matches').hidden, false, 'Matches recomputed after editing');
  assert.equal(syncOptions.isBusy(), false);
  const editedManagement = editedCard.children.find(node => node.className === 'concept-management');
  await editedManagement.children[1].fire('click');
  const confirmation = editedManagement.children[3];
  assert.equal(confirmation.hidden, false);
  assert.equal(syncOptions.isBusy(), true, 'Delete confirmation pauses refresh');
  await confirmation.children[2].fire('click');
  assert.equal(confirmation.hidden, true, 'Delete can be cancelled');
  assert.ok(editedCard.parentElement);
  await editedManagement.children[1].fire('click');
  await confirmation.children[1].fire('click');
  assert.equal(editedCard.parentElement, null, 'Confirmed deletion removes the card');
  assert.equal(syncOptions.isBusy(), false);
  assert.equal(nodes.conceptFulfilled.children[0].children.some(node => node.className === 'concept-management'), false, 'Fulfilled concepts have no management actions');
  const bob = create({ client: () => client, table: 'secretWords', user: () => 'bob' });
  const other = await bob.add('someone else requested this');
  await nodes.conceptRefresh.fire('click');
  const otherCard = nodes.conceptPending.children.find(node => node.dataset.conceptId === other.conceptData.id);
  assert.equal(otherCard.children.some(node => node.className === 'concept-management'), false, 'Only owner sees edit/delete controls');
  console.log('Meanings UI tests passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
