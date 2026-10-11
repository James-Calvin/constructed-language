const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const grouping = require('../meaning-requests.js');
const deck = require('../flashcard-deck.js');
const serviceApi = require('../flashcard-service.js');
const cacheApi = require('../dictionary-cache.js');
const { fingerprint } = require('../cooperative-refresh.js');
globalThis.SECRET_MEANING_REQUESTS = grouping;
const flush = () => new Promise(resolve => setImmediate(resolve));

class Element {
  constructor(tag, doc) {
    this.tagName = tag; this.doc = doc; this.children = []; this.listeners = {}; this.dataset = {};
    this.value = ''; this.checked = false; this.hidden = false; this.disabled = false; this.className = '';
    this.selectionStart = 0; this.selectionEnd = 0; this.scrollTop = 0;
  }
  set textContent(value) { this._text = value; this.replaceChildren(); }
  get textContent() { return this._text || ''; }
  append(...nodes) { this.children.push(...nodes); nodes.forEach(node => { node.parentElement = this; }); }
  replaceChildren(...nodes) {
    if (this.children.some(child => child.contains(this.doc.activeElement))) this.doc.activeElement = this.doc.body;
    this.children.forEach(child => { child.parentElement = null; }); this.children = []; this.append(...nodes);
  }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  focus() { this.doc.activeElement = this; }
  setSelectionRange(start, end, direction) { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; }
  matches(selector) {
    return selector.split(',').some(part => {
      part = part.trim();
      if (part === '.flashcard-manage textarea') return this.tagName === 'textarea';
      if (part.startsWith('.')) return this.className.split(' ').includes(part.slice(1));
      if (part === 'button[data-card-id]') return this.tagName === 'button' && Boolean(this.dataset.cardId);
      return this.tagName === part;
    });
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  reset() { this.querySelectorAll('textarea').forEach(field => { field.value = ''; }); }
  fire(type) { if (!this.disabled) this.listeners[type]?.({ preventDefault() {} }); }
}
async function harness(warm) {
  let scans = 0, syncOptions, fail = false;
  const sentence = { rowId: '__secret_flashcard__::one', timestamp: 0, flashcardData: {
    kind: 'sentence', id: 'one', sentence: '<b>ka mi</b>', translation: 'my sun', revision: 'v1',
    author: 'alice', editor: 'alice', createdAt: 1, editedAt: 1
  } };
  const word = { rowId: 'word', timestamp: 1, word: 'ka', pronunciation: 'ka', meaning: 'sun' };
  const database = new Map([word, sentence].map(row => [row.rowId, row]));
  const client = {
    scan: () => ({ promise: async () => { scans++; return { Items: structuredClone([...database.values()]) }; } }),
    put: params => ({ promise: async () => {
      if (fail) throw new Error('offline');
      const old = database.get(params.Item.rowId);
      if (params.ExpressionAttributeValues && old?.flashcardData?.revision !== params.ExpressionAttributeValues[':revision']) {
        throw Object.assign(new Error('conflict'), { code: 'ConditionalCheckFailedException' });
      }
      database.set(params.Item.rowId, structuredClone(params.Item));
    } }),
    delete: params => ({ promise: async () => {
      if (fail) throw new Error('offline');
      if (database.get(params.Key.rowId)?.flashcardData.revision !== params.ExpressionAttributeValues[':revision']) {
        throw Object.assign(new Error('conflict'), { code: 'ConditionalCheckFailedException' });
      }
      database.delete(params.Key.rowId);
    } })
  };
  const store = cacheApi.create({ client: () => client, table: 'test', scopeKey: 'ui', now: () => 1000 });
  cacheApi.trackClient(client, () => store);
  if (warm) await store.refresh();
  const initialScans = scans;
  const doc = { activeElement: null };
  doc.body = new Element('body', doc); doc.activeElement = doc.body;
  const html = fs.readFileSync('flashcards.html', 'utf8');
  const nodes = {};
  for (const match of html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const element = new Element(match[1], doc); element.id = match[2]; nodes[match[2]] = element;
  }
  nodes.flashcardWords.checked = nodes.flashcardSentences.checked = true;
  const add = nodes.flashcardAdd;
  add.append(nodes.flashcardSentence, nodes.flashcardTranslation, nodes.flashcardClear, new Element('button', doc));
  const addError = new Element('p', doc); addError.className = 'flashcard-error'; add.append(addError);
  const summary = new Element('summary', doc);
  nodes.flashcardManage.append(summary, add, nodes.flashcardList);
  doc.body.append(nodes.flashcardManage);
  doc.createElement = tag => new Element(tag, doc);
  doc.getElementById = id => nodes[id];
  const context = {
    console, document: doc, crypto: require('node:crypto').webcrypto, Math: Object.assign(Object.create(Math), { random: () => 0.75 }),
    SECRET_CURRENT_USER: { id: 'alice' }, SECRET_MEANING_REQUESTS: grouping,
    SECRET_FLASHCARD_DECK: { ...deck, round: cards => deck.round(cards, () => 0.75) }, SECRET_FLASHCARD_SERVICE: serviceApi,
    SECRET_DICTIONARY_CACHE: { forRuntime: () => store }, scrollX: 0, scrollY: 123,
    scrollTo(x, y) { this.scrollX = x; this.scrollY = y; }, addEventListener() {},
    LOVE_LANGUAGE_SHARED: { createAwsRuntime: () => ({ awsConfig: { heartsTableName: 'test' }, getHeartsTableClient: () => client, ensureAwsCredentials: async () => true }) },
    SECRET_COOPERATIVE_REFRESH: { fingerprint, start(options) {
      syncOptions = options;
      return { seed() {}, stop() {}, async request() {
        if (options.isBusy()) return;
        try { const data = await options.read(); options.apply(data); options.onSuccess(); }
        catch (error) { options.onError(error); }
      } };
    } }
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync('flashcards.js', 'utf8'), context);
  await flush();
  return { nodes, doc, store, database, word, sentence, options: syncOptions,
    scans: () => scans - initialScans, fail: value => { fail = value; } };
}
function findButton(root, text) { const found = root.querySelectorAll('button').find(button => button.textContent === text); assert.ok(found, text); return found; }
async function run() {
  const ui = await harness(true), n = ui.nodes;
  assert.equal(ui.scans(), 0, 'Fresh-cache study does not scan');
  assert.equal(n.flashcardText.textContent, 'ka');
  assert.equal(n.flashcardIpa.textContent, 'ka');
  assert.equal(n.flashcardProgress.textContent, 'Card 1 of 2');
  n.flashcardFlip.fire('click'); assert.equal(n.flashcardText.textContent, 'sun');
  assert.equal(n.flashcardIpa.hidden, true);
  const changed = { ...ui.word, meaning: 'bright sun' };
  ui.store.upsert(changed); ui.options.apply(ui.store.peek());
  assert.equal(n.flashcardText.textContent, 'sun', 'Background refresh freezes the current round');
  assert.match(n.flashcardUpdates.textContent, /next round/);
  n.flashcardNext.fire('click'); assert.equal(n.flashcardText.textContent, '<b>ka mi</b>');
  assert.equal(n.flashcardText.children.length, 0, 'Sentence markup is displayed as text');
  n.flashcardFlip.fire('click'); assert.equal(n.flashcardText.textContent, 'my sun');
  n.flashcardNext.fire('click'); assert.equal(n.flashcardAgain.hidden, false);
  assert.equal(ui.doc.activeElement, n.flashcardAgain);
  n.flashcardAgain.fire('click'); n.flashcardFlip.fire('click');
  assert.equal(n.flashcardText.textContent, 'bright sun');
  n.flashcardWords.checked = false; n.flashcardSentences.checked = false; n.flashcardWords.fire('change');
  assert.match(n.flashcardText.textContent, /Select Words or Sentences/);
  n.flashcardSentences.checked = true; n.flashcardSentences.fire('change');
  assert.equal(n.flashcardProgress.textContent, 'Card 1 of 1');
  n.flashcardManage.open = true;
  n.flashcardSentence.value = 'draft'; n.flashcardSentence.selectionStart = 2; n.flashcardSentence.focus();
  assert.ok(ui.options.isBusy());
  n.flashcardRetry.fire('click'); assert.match(n.flashcardStatus.textContent, /clear your draft/);
  assert.equal(n.flashcardSentence.value, 'draft'); assert.equal(n.flashcardSentence.selectionStart, 2);
  n.flashcardClear.fire('click'); ui.doc.activeElement = ui.doc.body;
  assert.equal(ui.options.isBusy(), false);
  findButton(n.flashcardList, 'Edit').fire('click');
  const edit = n.flashcardList.querySelector('form');
  const fields = edit.querySelectorAll('textarea');
  fields[0].value = 'edited sentence'; fields[0].selectionStart = fields[0].selectionEnd = 3;
  assert.ok(ui.options.isBusy());
  ui.fail(true); edit.fire('submit'); await flush();
  assert.match(edit.querySelector('.flashcard-error').textContent, /draft has been kept/);
  assert.equal(fields[0].value, 'edited sentence'); assert.equal(fields[0].selectionStart, 3);
  assert.equal(n.flashcardList.querySelector('form'), edit, 'A failed save does not rebuild the editor');
  ui.fail(false);
  ui.database.set(ui.sentence.rowId, { ...ui.sentence, flashcardData: { ...ui.sentence.flashcardData, revision: 'someone-else' } });
  edit.fire('submit'); await flush();
  assert.match(edit.querySelector('.flashcard-error').textContent, /changed or was deleted/);
  findButton(edit, 'Cancel').fire('click'); assert.equal(ui.options.isBusy(), false);
  // Refresh, then reopen the new revision rather than silently overwriting it.
  const fresh = await ui.store.refresh(); ui.options.apply(fresh);
  findButton(n.flashcardList, 'Edit').fire('click');
  const reopened = n.flashcardList.querySelector('form'); reopened.querySelectorAll('textarea')[0].value = 'new sentence';
  reopened.fire('submit'); await flush();
  assert.equal(ui.database.get(ui.sentence.rowId).flashcardData.sentence, 'new sentence');
  assert.equal(n.flashcardText.textContent, 'new sentence', 'Local saves start a new round');
  assert.equal(n.flashcardManage.open, true);
  findButton(n.flashcardList, 'Delete').fire('click'); assert.ok(ui.options.isBusy());
  findButton(n.flashcardList, 'Cancel').fire('click'); assert.ok(ui.database.has(ui.sentence.rowId));
  findButton(n.flashcardList, 'Delete').fire('click');
  findButton(n.flashcardList, 'Confirm delete').fire('click'); await flush();
  assert.equal(ui.database.has(ui.sentence.rowId), false);
  assert.match(n.flashcardText.textContent, /No cards/);
  n.flashcardSentence.value = 'ka'; n.flashcardTranslation.value = 'sun'; addSubmit(n).fire('submit'); await flush();
  assert.equal(n.flashcardSentence.value, ''); assert.equal(n.flashcardTranslation.value, '');
  assert.equal(ui.database.size, 2);
  ui.options.onError(); assert.match(n.flashcardStatus.textContent, /last successful data/);
  assert.equal(n.flashcardText.textContent, 'ka');
  assert.notEqual(ui.doc.activeElement?.disabled, true);
  const cold = await harness(false);
  assert.equal(cold.scans(), 1, 'Cold study uses one shared scan');
  assert.equal(cold.nodes.flashcardText.textContent, 'ka');
  const html = fs.readFileSync('flashcards.html', 'utf8');
  assert.match(html, /src="auth.js"/);
  assert.match(html, /type="application\/x-protected-script" data-protected-src="flashcards.js"/);
  assert.doesNotMatch(html, /<details[^>]*\bopen\b/);
  for (const match of html.matchAll(/(?:src|href|data-protected-src)="([^"]+)"/g)) {
    if (!match[1].includes(':')) assert.ok(fs.existsSync(match[1]), `Missing local asset/link: ${match[1]}`);
  }
  for (const page of ['index.html', 'dictionary.html']) assert.match(fs.readFileSync(page, 'utf8'), /href="flashcards.html"/);
  console.log('Flashcards UI, cached loading, frozen rounds, drafts, conflicts and shared management tests passed.');
}
function addSubmit(nodes) { return nodes.flashcardAdd; }
run().catch(error => { console.error(error); process.exitCode = 1; });
