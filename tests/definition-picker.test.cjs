const assert = require('node:assert/strict');
const requestsApi = require('../meaning-requests.js');
const { create } = require('../definition-picker.js');
if (!globalThis.crypto) globalThis.crypto = require('node:crypto').webcrypto;
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.listeners = {}; this.value = ''; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this[key] = value; }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  fire(type) { return this.listeners[type]?.({ preventDefault() {}, stopPropagation() {} }); }
}
globalThis.document = { createElement: tag => new Element(tag) };
async function run() {
  const database = new Map();
  const key = item => `${item.rowId}|${item.timestamp}`;
  const client = {
    get: ({ Key }) => ({ promise: async () => ({ Item: structuredClone(database.get(key(Key))) }) }),
    put: ({ Item }) => ({ promise: async () => { database.set(key(Item), structuredClone(Item)); } })
  };
  const service = requestsApi.create({ client: () => client, table: 'secretWords', user: () => 'alice' });
  const wanted = await service.add('a subtle feeling');
  const originalWord = { rowId: 'alice::sol', timestamp: 1, word: 'sol', pronunciation: 'sol', user: 'alice', hearted: true };
  database.set(key(originalWord), originalWord);
  let changes = 0;
  let mutations = 0;
  const assigned = [];
  const picker = create({ client: () => client, table: 'secretWords', user: () => 'alice',
    read: async () => [...database.values()], onChange: () => changes++,
    onMutation: () => mutations++, onAssigned: item => assigned.push(item) });
  picker.load([...database.values()]);
  picker.open('sol', 'sol');
  assert.equal(picker.isOpen(), true);
  let form = picker.render('sol');
  assert.equal(picker.render('different'), null);
  let select = form.children[0].children[0];
  assert.equal(form.children[1].disabled, true);
  select.value = wanted.conceptData.id; await select.fire('change');
  assert.equal(form.children[1].disabled, false);
  await form.children[3].fire('click');
  assert.equal(picker.isOpen(), false, 'Cancel closes without assigning');
  assert.equal(assigned.length, 0);
  assert.equal(changes, 2);
  picker.open('sol', 'sol'); form = picker.render('sol'); select = form.children[0].children[0];
  select.value = wanted.conceptData.id; await select.fire('change');
  await service.edit(wanted, 'a more nuanced feeling');
  await form.fire('submit');
  assert.equal(picker.isOpen(), true, 'Changed concepts keep the picker open');
  assert.equal(assigned.length, 0);
  assert.equal(form.children[1].disabled, true, 'Stale selection requires refresh');
  assert.match(form.children[4].textContent, /changed/);
  form = picker.render('sol'); select = form.children[0].children[0];
  assert.equal(select.value, wanted.conceptData.id, 'A dictionary rerender retains the selection');
  assert.equal(form.children[1].disabled, true);
  await form.children[2].fire('click');
  assert.equal(select.value, '', 'Refresh requires explicit reselection');
  assert.match(select.children[1].textContent, /more nuanced/);
  await form.fire('submit');
  assert.equal(assigned.length, 0);
  select.value = wanted.conceptData.id; await select.fire('change');
  await form.fire('submit');
  assert.equal(assigned.length, 1);
  assert.equal(assigned[0].word, 'sol');
  assert.equal(assigned[0].meaning, 'a more nuanced feeling');
  assert.equal(assigned[0].definitionReview.status, 'candidate');
  assert.equal(picker.isOpen(), false);
  assert.equal(database.get(key(originalWord)).hearted, true, 'Existing word hearts are not rewritten by assignment');
  assert.equal(mutations, 2);
  picker.load([...database.values()]); picker.open('other', 'o');
  form = picker.render('other');
  assert.match(form.children[0].children[0].children[0].textContent, /No unassigned concepts/);
  assert.equal(form.children[1].disabled, true);
  picker.close();
  const generatorRequest = await service.add('a generator-selected meaning');
  picker.load([...database.values()]);
  picker.open('generated', 'g', { hearted: true });
  form = picker.render('generated'); select = form.children[0].children[0];
  select.value = generatorRequest.conceptData.id; await select.fire('change');
  await form.fire('submit');
  assert.equal(assigned.at(-1).hearted, true, 'Generator assignment preserves the current user heart');
  assert.equal(assigned.at(-1).definitionReview.status, 'candidate');
  console.log('Definition picker tests passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
