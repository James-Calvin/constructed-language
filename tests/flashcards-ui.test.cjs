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
    this.classList = { toggle: (name, enabled) => {
      const names = new Set(this.className.split(' ').filter(Boolean));
      if (enabled) names.add(name); else names.delete(name);
      this.className = [...names].join(' ');
    } };
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
  removeAttribute(name) { delete this[name]; }
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
  closest(selector) {
    if (this.matches(selector)) return this;
    return this.parentElement?.closest(selector) || null;
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  reset() { this.querySelectorAll('textarea').forEach(field => { field.value = ''; }); }
  fire(type, values = {}) { if (!this.disabled) return this.listeners[type]?.({ preventDefault() {}, stopPropagation() {}, ...values }); }
}
async function harness(warm, options = {}) {
  let scans = 0, syncOptions, fail = false, failAudio = false, stops = 0;
  const played = [];
  const sentence = { rowId: '__secret_flashcard__::one', timestamp: 0, flashcardData: {
    kind: 'sentence', id: 'one', sentence: '<b>ka mi</b>', translation: 'my sun', revision: 'v1',
    author: 'alice', editor: 'alice', createdAt: 1, editedAt: 1
  } };
  const word = { rowId: 'word', timestamp: 1, word: 'ka', pronunciation: 'ka', meaning: 'sun' };
  const database = options.database || new Map([word, sentence].map(row => [row.rowId, row]));
  const saved = options.saved || new Map();
  const storage = options.storage || { getItem: key => saved.get(key) || null,
    setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
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
  const docListeners = new Map();
  const doc = { activeElement: null, addEventListener: (name, handler) => docListeners.set(name, handler),
    removeEventListener: name => docListeners.delete(name) };
  function key(key, values = {}) {
    const event = { key, target: doc.activeElement, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, ...values };
    docListeners.get('keydown')?.(event); return event;
  }
  doc.body = new Element('body', doc); doc.activeElement = doc.body;
  const html = fs.readFileSync('flashcards.html', 'utf8');
  const nodes = {};
  for (const match of html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const element = new Element(match[1], doc); element.id = match[2]; nodes[match[2]] = element;
  }
  nodes.flashcardWords.checked = true;
  nodes.flashcardSentences.checked = Boolean(options.sentences);
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
    SECRET_CURRENT_USER: { id: options.username || 'alice' }, SECRET_MEANING_REQUESTS: grouping,
    SECRET_FLASHCARD_STATE: { create: args => require('../flashcard-state.js').create({ ...args, storage }) },
    SECRET_FLASHCARD_MOTION: require('../flashcard-motion.js'),
    SECRET_FLASHCARD_GESTURES: require('../flashcard-gestures.js'),
    SECRET_FLASHCARD_DECK: { ...deck, round: cards => deck.round(cards, () => 0.75) }, SECRET_FLASHCARD_SERVICE: serviceApi,
    SECRET_DICTIONARY_CACHE: { forRuntime: () => store }, scrollX: 0, scrollY: 123,
    scrollTo(x, y) { this.scrollX = x; this.scrollY = y; }, addEventListener() {},
    SECRET_FLASHCARD_AUDIO: { create: () => ({
      async play(word, ipa) { if (failAudio) throw new Error('audio unavailable'); played.push([word, ipa]); },
      stop() { stops++; }, dispose() {}
    }) },
    LOVE_LANGUAGE_SHARED: { createAwsRuntime: () => ({ isPlaybackConfigured: true, awsConfig: { heartsTableName: 'test' }, getHeartsTableClient: () => client, ensureAwsCredentials: async () => true }) },
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
    scans: () => scans - initialScans, fail: value => { fail = value; }, played, stops: () => stops,
    failAudio: value => { failAudio = value; }, saved, key };
}
function findButton(root, text) { const found = root.querySelectorAll('button').find(button => button.textContent === text); assert.ok(found, text); return found; }
async function run() {
  const ui = await harness(true, { sentences: true }), n = ui.nodes;
  assert.equal(ui.scans(), 0, 'Fresh-cache study does not scan');
  assert.equal(n.flashcardText.textContent, 'ka');
  assert.equal(n.flashcardIpa.textContent, 'ka');
  assert.equal(n.flashcardProgress.textContent, 'Card 1 of 2');
  assert.equal(n.flashcardBack.disabled, true);
  n.flashcardBack.fire('click'); assert.equal(n.flashcardProgress.textContent, 'Card 1 of 2');
  assert.equal(n.flashcardStatus.hidden, true, 'Routine cache status is not displayed');
  assert.equal(n.flashcardPlay.hidden, false);
  assert.equal(n.flashcardSoundBuffer.hidden, false);
  n.flashcardSoundBuffer.fire('click'); assert.equal(n.flashcardText.textContent, 'ka', 'The audio buffer is a no-op');
  await n.flashcardPlay.fire('click');
  assert.deepEqual(ui.played, [['ka', 'ka']]);
  assert.equal(n.flashcardText.textContent, 'ka', 'Playing pronunciation does not flip the card');
  assert.equal(n.flashcardPlay.disabled, false);
  ui.failAudio(true); await n.flashcardPlay.fire('click');
  assert.equal(n.flashcardAudioStatus.hidden, false);
  assert.match(n.flashcardAudioStatus.textContent, /Could not play/);
  ui.failAudio(false);
  n.flashcardFace.fire('click'); assert.equal(n.flashcardText.textContent, 'sun');
  assert.equal(n.flashcardPlay.hidden, true, 'Definition side does not reveal pronunciation');
  assert.equal(n.flashcardSoundBuffer.hidden, true, 'The buffer is only present alongside the sound control');
  assert.equal(n.flashcardAudioStatus.hidden, true);
  assert.ok(ui.stops() > 0, 'Flipping stops pronunciation');
  n.flashcardFace.fire('click'); assert.equal(n.flashcardText.textContent, 'ka');
  n.flashcardFace.fire('click'); assert.equal(n.flashcardText.textContent, 'sun');
  assert.equal(n.flashcardIpa.hidden, true);
  const changed = { ...ui.word, meaning: 'bright sun' };
  ui.store.upsert(changed); ui.options.apply(ui.store.peek());
  assert.equal(n.flashcardText.textContent, 'sun', 'Background refresh freezes the current round');
  assert.equal(n.flashcardUpdates.textContent, 'Words or definitions have changed. Shuffle to update.');
  assert.equal(n.flashcardShuffle.textContent, '⚠️ Shuffle');
  assert.match(n.flashcardShuffle.className, /flashcard-shuffle-pending/);
  n.flashcardNext.fire('click'); assert.equal(n.flashcardText.textContent, '<b>ka mi</b>');
  assert.equal(n.flashcardBack.disabled, false);
  n.flashcardBack.fire('click');
  assert.equal(n.flashcardProgress.textContent, 'Card 1 of 2');
  assert.equal(n.flashcardText.textContent, 'ka', 'Back revisits the previous card on its initial side');
  n.flashcardFace.fire('click');
  assert.equal(n.flashcardText.textContent, 'sun', 'Back retains the frozen round, not newer database content');
  n.flashcardNext.fire('click');
  assert.equal(n.flashcardPlay.hidden, true, 'Sentence cards do not show word pronunciation controls');
  const scansBeforeShuffle = ui.scans();
  n.flashcardShuffle.fire('click');
  assert.equal(n.flashcardProgress.textContent, 'Card 1 of 2');
  assert.equal(n.flashcardText.textContent, 'ka', 'Shuffle restarts on the initial side');
  assert.equal(ui.scans(), scansBeforeShuffle, 'Shuffle does not force a database read');
  n.flashcardNext.fire('click');
  assert.equal(n.flashcardText.children.length, 0, 'Sentence markup is displayed as text');
  n.flashcardFace.fire('click'); assert.equal(n.flashcardText.textContent, 'my sun');
  n.flashcardNext.fire('click'); assert.equal(n.flashcardAgain.hidden, false);
  assert.equal(n.flashcardFace.disabled, true);
  assert.equal(ui.doc.activeElement, n.flashcardAgain);
  n.flashcardBack.fire('click');
  assert.equal(n.flashcardProgress.textContent, 'Card 2 of 2', 'Back works from the completed round');
  assert.equal(n.flashcardText.textContent, '<b>ka mi</b>');
  n.flashcardNext.fire('click');
  n.flashcardAgain.fire('click'); n.flashcardFace.fire('click');
  assert.equal(n.flashcardText.textContent, 'bright sun');
  n.flashcardWords.checked = false; n.flashcardSentences.checked = false; n.flashcardWords.fire('change');
  assert.equal(n.flashcardText.textContent, 'bright sun', 'Selection changes do not reset the current card or side');
  assert.equal(n.flashcardUpdates.textContent, 'Your selection has changed. Shuffle the deck for it to take effect.');
  n.flashcardShuffle.fire('click');
  assert.match(n.flashcardText.textContent, /Select Defined words, Candidates, or Sentences/);
  assert.equal(n.flashcardCandidates.checked, false, 'Candidates start unchecked');
  const candidate = { rowId: 'candidate', timestamp: 1, word: 'etos', pronunciation: 'etos', meaning: 'hot', definitionReview: { status: 'candidate' } };
  ui.store.upsert(candidate); ui.options.apply(ui.store.peek());
  n.flashcardCandidates.checked = true; n.flashcardCandidates.fire('change');
  assert.equal(n.flashcardUpdates.textContent, 'Words or definitions have changed. Shuffle to update.', 'Data changes take precedence over selection changes');
  n.flashcardShuffle.fire('click');
  assert.equal(n.flashcardProgress.textContent, 'Card 1 of 1', 'Candidates can be studied independently');
  assert.equal(n.flashcardText.textContent, 'etos');
  n.flashcardFace.fire('click'); assert.equal(n.flashcardText.textContent, 'hot');
  n.flashcardCandidates.checked = false; n.flashcardCandidates.fire('change');
  n.flashcardSentences.checked = true; n.flashcardSentences.fire('change');
  n.flashcardShuffle.fire('click');
  assert.equal(n.flashcardProgress.textContent, 'Card 1 of 1');
  n.flashcardManage.open = true;
  n.flashcardSentence.value = 'draft'; n.flashcardSentence.selectionStart = 2; n.flashcardSentence.focus();
  assert.ok(ui.options.isBusy());
  n.flashcardShuffle.fire('click');
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
  assert.equal(n.flashcardText.textContent, '<b>ka mi</b>', 'Local saves do not replace the current round');
  assert.equal(n.flashcardUpdates.textContent, 'Words or definitions have changed. Shuffle to update.');
  n.flashcardShuffle.fire('click'); assert.equal(n.flashcardText.textContent, 'new sentence');
  assert.equal(n.flashcardManage.open, true);
  findButton(n.flashcardList, 'Delete').fire('click'); assert.ok(ui.options.isBusy());
  findButton(n.flashcardList, 'Cancel').fire('click'); assert.ok(ui.database.has(ui.sentence.rowId));
  findButton(n.flashcardList, 'Delete').fire('click');
  findButton(n.flashcardList, 'Confirm delete').fire('click'); await flush();
  assert.equal(ui.database.has(ui.sentence.rowId), false);
  assert.equal(n.flashcardText.textContent, 'new sentence', 'Deleted cards remain in the frozen round until Shuffle');
  n.flashcardShuffle.fire('click');
  assert.match(n.flashcardText.textContent, /No cards/);
  n.flashcardSentence.value = 'ka'; n.flashcardTranslation.value = 'sun'; addSubmit(n).fire('submit'); await flush();
  assert.equal(n.flashcardSentence.value, ''); assert.equal(n.flashcardTranslation.value, '');
  assert.equal(ui.database.size, 2);
  n.flashcardShuffle.fire('click');
  ui.options.onError(); assert.match(n.flashcardStatus.textContent, /last successful data/);
  assert.equal(n.flashcardStatus.hidden, false, 'Read failures are still visible');
  ui.options.onSuccess(); assert.equal(n.flashcardStatus.hidden, true);
  assert.equal(n.flashcardText.textContent, 'ka');
  assert.notEqual(ui.doc.activeElement?.disabled, true);
  const cold = await harness(false);
  assert.equal(cold.scans(), 1, 'Cold study uses one shared scan');
  assert.equal(cold.nodes.flashcardText.textContent, 'ka');
  assert.equal(cold.nodes.flashcardSentences.checked, false, 'Sentences start unchecked');
  assert.equal(cold.nodes.flashcardProgress.textContent, 'Card 1 of 1');
  const keyboard = await harness(true, { sentences: true });
  assert.equal(keyboard.key(' ').defaultPrevented, true);
  assert.equal(keyboard.nodes.flashcardText.textContent, 'sun', 'Space flips from the page background');
  keyboard.key('ArrowRight'); assert.equal(keyboard.nodes.flashcardProgress.textContent, 'Card 2 of 2');
  keyboard.key('ArrowLeft'); assert.equal(keyboard.nodes.flashcardProgress.textContent, 'Card 1 of 2');
  // Returning to the first card focuses its native button: Space must not double-activate it.
  assert.equal(keyboard.key(' ').defaultPrevented, false);
  keyboard.doc.activeElement = keyboard.doc.body;
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'repeat', 'isComposing']) {
    keyboard.key('ArrowRight', { [modifier]: true });
    assert.equal(keyboard.nodes.flashcardProgress.textContent, 'Card 1 of 2');
  }
  keyboard.nodes.flashcardSentence.focus();
  assert.equal(keyboard.key(' ').defaultPrevented, false);
  keyboard.key('ArrowRight'); assert.equal(keyboard.nodes.flashcardProgress.textContent, 'Card 1 of 2');
  keyboard.nodes.flashcardCandidates.focus();
  assert.equal(keyboard.key(' ').defaultPrevented, false);
  keyboard.key('ArrowRight'); assert.equal(keyboard.nodes.flashcardProgress.textContent, 'Card 1 of 2', 'Checkbox keyboard behavior is unchanged');
  keyboard.nodes.flashcardPlay.focus();
  assert.equal(keyboard.key(' ').defaultPrevented, false, 'Space on Play remains native audio activation');
  keyboard.doc.activeElement = keyboard.doc.body;
  keyboard.key('ArrowRight'); keyboard.key('ArrowRight');
  assert.equal(keyboard.nodes.flashcardAgain.hidden, false, 'Keyboard navigation reaches the completed round');
  keyboard.key('ArrowLeft'); assert.equal(keyboard.nodes.flashcardProgress.textContent, 'Card 2 of 2');
  const swipe = await harness(true, { sentences: true });
  const swipeCard = swipe.nodes.flashcardCard;
  const pointer = { pointerId: 1, pointerType: 'touch', isPrimary: true, target: swipe.nodes.flashcardFace, clientX: 200, clientY: 100 };
  swipeCard.fire('pointerdown', pointer); swipeCard.fire('pointerup', { ...pointer, clientX: 100 });
  assert.equal(swipe.nodes.flashcardProgress.textContent, 'Card 2 of 2');
  assert.equal(swipe.nodes.flashcardText.textContent, '<b>ka mi</b>');
  swipeCard.fire('pointerdown', pointer); swipeCard.fire('pointerup', { ...pointer, clientX: 300 });
  assert.equal(swipe.nodes.flashcardProgress.textContent, 'Card 1 of 2');
  swipeCard.fire('pointerdown', pointer); swipeCard.fire('pointerup', { ...pointer, clientX: 300 });
  assert.equal(swipe.nodes.flashcardProgress.textContent, 'Card 1 of 2', 'Swipe respects the first-card boundary');
  const resume = await harness(true, { sentences: true });
  resume.nodes.flashcardNext.fire('click'); resume.nodes.flashcardFace.fire('click');
  resume.nodes.flashcardCandidates.checked = true; resume.nodes.flashcardCandidates.fire('change');
  const returned = await harness(true, { saved: resume.saved, database: resume.database });
  assert.equal(returned.nodes.flashcardProgress.textContent, 'Card 2 of 2');
  assert.equal(returned.nodes.flashcardText.textContent, 'my sun', 'Returning restores the displayed side');
  assert.equal(returned.nodes.flashcardCandidates.checked, true, 'Pending selections restore separately from the frozen deck');
  assert.equal(returned.nodes.flashcardSentences.checked, true, 'Saved sentence selections override the new default');
  assert.equal(returned.nodes.flashcardUpdates.textContent, 'Your selection has changed. Shuffle the deck for it to take effect.');
  returned.nodes.flashcardCandidates.checked = false; returned.nodes.flashcardCandidates.fire('change');
  assert.equal(returned.nodes.flashcardShuffle.textContent, 'Shuffle', 'Reverting selections clears their warning');
  returned.nodes.flashcardCandidates.checked = true; returned.nodes.flashcardCandidates.fire('change');
  returned.nodes.flashcardBack.fire('click'); assert.equal(returned.nodes.flashcardText.textContent, 'ka', 'Saved order is retained');
  returned.nodes.flashcardNext.fire('click'); returned.nodes.flashcardNext.fire('click');
  const completed = await harness(true, { saved: resume.saved, database: resume.database });
  assert.match(completed.nodes.flashcardText.textContent, /Round complete/);
  assert.equal(completed.nodes.flashcardAgain.hidden, false);
  resume.database.set(resume.word.rowId, { ...resume.word, meaning: 'changed while away' });
  const updated = await harness(true, { saved: resume.saved, database: resume.database });
  assert.equal(updated.nodes.flashcardUpdates.textContent, 'Words or definitions have changed. Shuffle to update.');
  updated.nodes.flashcardAgain.fire('click'); updated.nodes.flashcardFace.fire('click');
  assert.equal(updated.nodes.flashcardText.textContent, 'changed while away', 'Go again uses the latest card data just like Shuffle');
  assert.equal(updated.nodes.flashcardProgress.textContent, 'Card 1 of 2');
  assert.equal(updated.nodes.flashcardUpdates.textContent, '', 'Go again applies pending changes and clears the warning');
  updated.nodes.flashcardShuffle.fire('click'); updated.nodes.flashcardFace.fire('click');
  assert.equal(updated.nodes.flashcardText.textContent, 'changed while away');
  assert.equal(updated.nodes.flashcardShuffle.textContent, 'Shuffle');
  assert.doesNotMatch(updated.nodes.flashcardShuffle.className, /flashcard-shuffle-pending/);
  updated.nodes.flashcardWords.checked = false; updated.nodes.flashcardCandidates.checked = false;
  updated.nodes.flashcardSentences.checked = false; updated.nodes.flashcardWords.fire('change');
  updated.nodes.flashcardShuffle.fire('click');
  const empty = await harness(true, { saved: resume.saved, database: resume.database });
  assert.match(empty.nodes.flashcardText.textContent, /Select Defined words/);
  assert.equal(empty.nodes.flashcardProgress.textContent, '');
  const otherUser = await harness(true, { saved: resume.saved, username: 'bob' });
  assert.equal(otherUser.nodes.flashcardWords.checked, true, 'Other usernames do not inherit the saved selections');
  const deniedStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {} };
  const denied = await harness(true, { storage: deniedStorage, sentences: true });
  denied.nodes.flashcardNext.fire('click'); assert.equal(denied.nodes.flashcardProgress.textContent, 'Card 2 of 2');
  const html = fs.readFileSync('flashcards.html', 'utf8');
  assert.match(html, /src="auth.js"/);
  assert.match(html, /<button id="flashcardFace" type="button"/);
  assert.match(html, /id="flashcardShuffle"/);
  assert.match(html, /id="flashcardAgain"[^>]*>Go again<\/button>/);
  assert.match(html, /id="flashcardBack"/);
  assert.match(html, /id="flashcardWords"[^>]*checked> Defined words/);
  assert.match(html, /id="flashcardCandidates" type="checkbox"> Candidates/);
  assert.match(html, /id="flashcardSentences" type="checkbox"> Sentences/);
  assert.doesNotMatch(html, /flashcardFlip/);
  assert.match(html, /<\/button>\s*<div id="flashcardSoundBuffer"[^>]*><\/div>\s*<button id="flashcardPlay"/, 'Sound controls remain siblings, not nested buttons');
  assert.doesNotMatch(html, /flashcardRetry|Refresh \/ Retry/);
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
