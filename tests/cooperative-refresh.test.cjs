const assert = require('node:assert/strict');
const { start, fingerprint } = require('../cooperative-refresh.js');
const settle = () => new Promise(resolve => setImmediate(resolve));
function events(target = {}) {
  const listeners = new Map();
  return Object.assign(target, {
    addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    fire(type) { for (const callback of listeners.get(type) || []) callback(); }
  });
}
async function run() {
  assert.equal(fingerprint([{ b: 2, a: 1 }, { a: 3 }]), fingerprint([{ a: 3 }, { a: 1, b: 2 }]), 'Scan order does not trigger needless rendering');
  const timeouts = new Map();
  const intervals = new Map();
  let focused = true;
  let nextId = 1;
  const doc = events({ visibilityState: 'visible', hasFocus: () => focused });
  const scope = events({ document: doc,
    setTimeout(callback) { const id = nextId++; timeouts.set(id, callback); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    setInterval(callback, delay) { assert.equal(delay, 30000); const id = nextId++; intervals.set(id, callback); return id; },
    clearInterval(id) { intervals.delete(id); }
  });
  async function retries() {
    const callbacks = [...timeouts.values()]; timeouts.clear();
    callbacks.forEach(callback => callback());
    await settle();
  }
  let busy = false;
  let version = 0;
  let reads = 0;
  let applies = 0;
  let errors = 0;
  let successes = 0;
  let data = [{ rowId: 'word', timestamp: 1, hearted: false }];
  let readHook;
  const refresh = start({ scope, isBusy: () => busy, version: () => version,
    read: async () => { reads++; return readHook ? readHook() : structuredClone(data); },
    apply: incoming => { applies++; assert.deepEqual(incoming, data); },
    onError: () => errors++, onSuccess: () => successes++ });
  refresh.seed(data);
  await refresh.request();
  assert.equal(applies, 0, 'Unchanged snapshots retain the exact DOM and cursor');
  data[0].hearted = true;
  [...intervals.values()][0](); await settle();
  assert.equal(applies, 1, '30-second tick applies remote changes');
  const baselineReads = reads;
  doc.visibilityState = 'hidden';
  await refresh.request();
  assert.equal(reads, baselineReads);
  doc.visibilityState = 'visible'; focused = false;
  await refresh.request();
  assert.equal(reads, baselineReads, 'Unfocused pages do not poll');
  focused = true; scope.fire('focus'); await settle();
  assert.equal(reads, baselineReads + 1, 'Returning focus refreshes immediately');
  doc.fire('visibilitychange'); await settle();
  assert.equal(reads, baselineReads + 2);
  busy = true;
  data.push({ rowId: 'note', noteData: { text: 'new' } });
  await refresh.request();
  assert.equal(reads, baselineReads + 2, 'Open editors, composition and saves defer reads');
  await retries();
  assert.equal(reads, baselineReads + 2);
  busy = false; doc.fire('focusout'); await retries();
  assert.equal(applies, 2, 'Deferred changes catch up when editing ends');
  let resolveRead;
  readHook = () => new Promise(resolve => { resolveRead = resolve; });
  const inFlight = refresh.request();
  const pendingReads = reads;
  await refresh.request();
  assert.equal(reads, pendingReads, 'No overlapping scans');
  version++;
  resolveRead(structuredClone(data)); await inFlight;
  assert.equal(applies, 2, 'A scan spanning a local mutation is discarded');
  readHook = null;
  await retries();
  assert.ok(reads > pendingReads, 'Discarded snapshots are refetched, never replayed');
  assert.equal(applies, 3, 'After local writes, reconcile even if the database returned to its previous snapshot');
  readHook = async () => { throw new Error('Offline'); };
  await refresh.request();
  assert.equal(errors, 1);
  assert.equal(applies, 3, 'Failures keep the current view');
  readHook = null;
  const previousSuccesses = successes;
  await refresh.request();
  assert.equal(successes, previousSuccesses + 1, 'Recovery clears errors even when data is unchanged');
  readHook = () => new Promise(resolve => { resolveRead = resolve; });
  const duringEdit = refresh.request();
  busy = true;
  resolveRead([{ rowId: 'stale' }]); await duringEdit;
  assert.equal(applies, 3, 'Starting to type during a scan prevents rendering');
  busy = false; readHook = null; await retries();
  readHook = () => new Promise(resolve => { resolveRead = resolve; });
  const stopping = refresh.request();
  refresh.stop();
  resolveRead([{ rowId: 'late' }]); await stopping;
  assert.equal(applies, 3, 'Stopped refresh cannot render an in-flight result');
  assert.equal(intervals.size, 0);
  assert.equal(timeouts.size, 0);
  const stoppedReads = reads;
  scope.fire('focus'); doc.fire('visibilitychange'); await settle();
  assert.equal(reads, stoppedReads);
  console.log('Cooperative refresh tests passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
