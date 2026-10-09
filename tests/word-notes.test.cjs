const assert = require('node:assert/strict');
const { create, unread, validNote } = require('../word-notes.js');
if (!globalThis.crypto) globalThis.crypto = require('node:crypto').webcrypto;

// Minimal DOM fixture exercises UI behavior without dependencies or AWS access.
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.open = false; this.isConnected = true; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  async fire(type, event = {}) { await this.listeners[type]?.({ preventDefault() {}, ...event }); }
}
globalThis.document = { createElement: tag => new Element(tag) };

async function run() {
  const database = new Map();
  let failWrites = false;
  const client = {
    put: ({ Item }) => ({ promise: async () => {
      if (failWrites) throw new Error('Offline');
      database.set(Item.rowId, structuredClone(Item));
    } }),
    delete: ({ Key }) => ({ promise: async () => { database.delete(Key.rowId); } })
  };
  const service = name => create({ client: () => client, table: 'secretWords', user: () => name });
  const alice = service('alice');
  await Promise.all([alice.add('sol', ' A warm sun. '), alice.add('sol', 'Second note')]);
  assert.equal(database.size, 2, 'Concurrent additions have separate keys');
  assert.equal(alice.notes('sol').length, 2);
  assert.ok(alice.notes('sol').some(n => n.text === 'A warm sun.'));
  assert.equal(alice.unreadNotes('sol').length, 0, 'Own notes are already read');
  assert.ok([...database.values()].every(validNote));
  assert.ok([...database.values()].every(i => !i.word && !i.pronunciation), 'Note rows cannot become dictionary words');

  const bob = service('bob');
  bob.load([...database.values()]);
  assert.equal(bob.unreadNotes('sol').length, 2);
  let panel = bob.render('sol');
  assert.equal(panel.open, false, 'Notes start collapsed');
  assert.equal(panel.children[0].children[1].textContent, '♥');
  assert.equal(panel.children[0].children[1].hidden, false, 'Unread heart is visible');
  const textarea = panel.children[2].children[0];
  textarea.value = 'Draft retained across dictionary renders';
  await textarea.fire('input');
  panel = bob.render('sol');
  assert.equal(panel.children[2].children[0].value, textarea.value);
  failWrites = true;
  await assert.rejects(bob.markRead('sol'), /Offline/);
  assert.equal(bob.unreadNotes('sol').length, 2, 'Failed receipts remain unread');
  await assert.rejects(bob.add('sol', 'Cannot save yet'), /Offline/);
  assert.equal(bob.notes('sol').length, 2);
  failWrites = false;
  panel.open = true;
  await panel.fire('toggle');
  assert.equal(bob.unreadNotes('sol').length, 0);
  assert.equal(panel.children[0].children[1].hidden, true, 'Opening notes clears unread heart');
  assert.equal(bob.render('sol').open, true, 'Dictionary rerenders preserve the open state');
  panel.open = false;
  await panel.fire('toggle');
  assert.equal(bob.render('sol').open, false);
  const bobOtherDevice = service('bob');
  bobOtherDevice.load([...database.values()]);
  assert.equal(bobOtherDevice.unreadNotes('sol').length, 0, 'Receipts follow username across devices');
  const charlie = service('charlie');
  charlie.load([...database.values()]);
  assert.equal(charlie.unreadNotes('sol').length, 2, 'Receipts do not apply to other users');

  await alice.add('sol', 'New note after Bob read');
  bob.load([...database.values()]);
  assert.equal(bob.unreadNotes('sol').length, 1, 'Later notes still show as unread');
  await bob.rename('sol', 'solar');
  assert.equal(bob.notes('sol').length, 0);
  assert.equal(bob.notes('solar').length, 3);
  assert.equal(bob.unreadNotes('solar').length, 1, 'Renaming preserves receipts');
  const reloaded = service('bob');
  reloaded.load([...database.values()]);
  assert.equal(reloaded.unreadNotes('solar').length, 1);
  await reloaded.remove('solar');
  assert.equal(database.size, 0, 'Deleting removes notes and receipts');
  const ui = service('alice');
  const uiPanel = ui.render('moon');
  const form = uiPanel.children[2];
  const field = form.children[0];
  assert.equal(form.children[1].disabled, true, 'Empty note cannot be submitted');
  field.value = '<script>not executable</script>\nA second line';
  await field.fire('input');
  await form.fire('submit');
  assert.equal(ui.notes('moon').length, 1);
  assert.equal(ui.notes('moon')[0].author, 'alice');
  const renderedNote = uiPanel.children[1].children[0];
  assert.ok(renderedNote.children[0].textContent.startsWith('alice · '), 'Author and date appear');
  assert.equal(renderedNote.children[1].textContent, '<script>not executable</script>\nA second line', 'Notes render as plain text');
  assert.equal(field.value, '', 'Successful submission clears the draft');
  assert.equal(form.children[1].disabled, true);
  field.value = 'Keep this draft on failure';
  await field.fire('input');
  failWrites = true;
  const originalError = console.error;
  try {
    console.error = () => {};
    await form.fire('submit');
  } finally { console.error = originalError; failWrites = false; }
  assert.equal(field.value, 'Keep this draft on failure');
  assert.match(form.children[2].textContent, /Could not save/);
  await assert.rejects(alice.add('sol', '  '));
  await assert.rejects(alice.add('sol', 'x'.repeat(4001)));
  assert.equal(validNote({ noteData: { kind: 'note' } }), false);
  assert.equal(unread([{ id: 'a', author: 'alice' }], [{ id: 'a', reader: 'bob' }], 'charlie').length, 1);
  console.log('Word notes tests passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
