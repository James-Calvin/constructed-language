const assert = require('node:assert/strict');
const { create } = require('../flashcard-service.js');
const cacheApi = require('../dictionary-cache.js');
async function run() {
  let id = 0, time = 100, user = 'alice', fail = false, available = true, reads = 0;
  const database = new Map();
  const collision = () => Object.assign(new Error('conflict'), { code: 'ConditionalCheckFailedException' });
  const client = {
    scan: () => ({ promise: async () => { reads++; return { Items: structuredClone([...database.values()]) }; } }),
    put: params => ({ promise: async () => {
      if (fail) throw new Error('offline');
      const current = database.get(params.Item.rowId);
      if (params.ConditionExpression === 'attribute_not_exists(rowId)') { if (current) throw collision(); }
      else if (!current || current.flashcardData.revision !== params.ExpressionAttributeValues[':revision']) throw collision();
      database.set(params.Item.rowId, structuredClone(params.Item));
    } }),
    delete: params => ({ promise: async () => {
      if (fail) throw new Error('offline');
      const current = database.get(params.Key.rowId);
      if (!current || current.flashcardData.revision !== params.ExpressionAttributeValues[':revision']) throw collision();
      database.delete(params.Key.rowId);
    } })
  };
  const cache = cacheApi.create({ client: () => client, table: 'test', scopeKey: 'flashcard-tests', now: () => 1000 });
  cacheApi.trackClient(client, () => cache);
  await cache.refresh();
  const service = create({ client: () => client, table: 'test', user: () => user,
    ensure: async () => available, uuid: () => `id${++id}`, now: () => time });
  const first = await service.add('  etos\nka  ', '  hot sun  ');
  assert.equal(first.timestamp, 0);
  assert.equal(first.flashcardData.sentence, 'etos\nka');
  assert.equal(first.flashcardData.translation, 'hot sun');
  assert.equal(first.flashcardData.author, 'alice');
  assert.equal(first.word, undefined);
  assert.equal(service.list().length, 1);
  assert.equal(cache.peek().length, 1, 'Confirmed additions patch the shared snapshot');
  const verified = cache.lastVerifiedAt();
  user = 'bob'; time = 200;
  const edited = await service.edit(first, '<b>ka</b>', 'sun');
  assert.equal(edited.flashcardData.author, 'alice');
  assert.equal(edited.flashcardData.createdAt, 100);
  assert.equal(edited.flashcardData.editor, 'bob');
  assert.equal(edited.flashcardData.editedAt, 200);
  assert.notEqual(edited.flashcardData.revision, first.flashcardData.revision);
  assert.equal(cache.lastVerifiedAt(), verified, 'Patching does not extend freshness');
  await assert.rejects(service.edit(first, 'stale', 'stale'), /changed or was deleted/);
  await assert.rejects(service.remove(first), /changed or was deleted/);
  assert.equal(database.get(first.rowId).flashcardData.sentence, '<b>ka</b>');
  assert.equal(cache.fresh(), false, 'Conflicted writes invalidate freshness');
  await assert.rejects(service.add(' ', 'sun'), /1–4000/);
  await assert.rejects(service.add('ka', 'x'.repeat(4001)), /1–4000/);
  user = ''; await assert.rejects(service.edit(edited, 'ka', 'sun'), /named user/);
  await assert.rejects(service.remove(edited), /named user/);
  user = 'bob'; available = false;
  await assert.rejects(service.add('ka', 'sun'), /unavailable/);
  available = true; fail = true;
  await assert.rejects(service.edit(edited, 'keep draft', 'draft'), /draft has been kept/);
  await assert.rejects(service.remove(edited), /draft has been kept/);
  assert.equal(service.list()[0].flashcardData.sentence, '<b>ka</b>');
  fail = false;
  await service.remove(edited);
  assert.equal(database.size, 0); assert.equal(service.list().length, 0); assert.equal(cache.peek().length, 0);
  await assert.rejects(service.edit(edited, 'ka', 'sun'), /changed or was deleted/);
  assert.equal(reads, 1, 'CRUD adds no full-table scans');
  console.log('Shared flashcard CRUD, attribution, conditional writes and cache patch tests passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
