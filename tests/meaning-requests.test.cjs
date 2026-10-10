const assert = require('node:assert/strict');
const { create, fulfilled, validRequest, groupWords, fulfillmentTarget } = require('../meaning-requests.js');
const { isDeepStrictEqual } = require('node:util');
if (!globalThis.crypto) globalThis.crypto = require('node:crypto').webcrypto;
async function run() {
  const database = new Map();
  let failWrites = false;
  const clone = value => value === undefined ? value : structuredClone(value);
  const key = item => `${item.rowId}|${item.timestamp}`;
  function check(params, previous) {
    if (params.ConditionExpression === 'attribute_not_exists(rowId)') return !previous;
    if (!previous || !isDeepStrictEqual(previous.conceptData, params.ExpressionAttributeValues[':concept'])) return false;
    return params.ConditionExpression.includes('attribute_not_exists(#updated)')
      ? previous.updatedTimestamp == null : previous.updatedTimestamp === params.ExpressionAttributeValues[':updated'];
  }
  const client = {
    scan: params => ({ promise: async () => {
      assert.equal(params.ConsistentRead, true);
      return { Items: [...database.values()].filter(item => item.word === params.ExpressionAttributeValues[':word']).map(clone) };
    } }),
    get: params => ({ promise: async () => ({ Item: clone(database.get(key(params.Key))) }) }),
    put: params => ({ promise: async () => {
      if (failWrites) throw new Error('Offline');
      const previous = database.get(key(params.Item));
      const valid = check(params, previous);
      if (!valid) throw Object.assign(new Error('Concurrent change'), { code: 'ConditionalCheckFailedException' });
      database.set(key(params.Item), clone(params.Item));
    } }),
    delete: params => ({ promise: async () => {
      if (failWrites) throw new Error('Offline');
      if (!check(params, database.get(key(params.Key)))) throw Object.assign(new Error('Concurrent change'), { code: 'ConditionalCheckFailedException' });
      database.delete(key(params.Key));
    } })
  };
  const service = name => create({ client: () => client, table: 'secretWords', user: () => name });
  const alice = service('alice');
  const [sun, moon] = await Promise.all([alice.add(' sunlight through leaves '), alice.add('moon')]);
  assert.equal(database.size, 2);
  assert.equal(sun.conceptData.text, 'sunlight through leaves');
  assert.equal(sun.conceptData.author, 'alice');
  assert.equal(validRequest(sun), true);
  assert.equal(fulfilled(sun), false);
  assert.equal(sun.word, undefined, 'Unassigned concept is not an undefined dictionary word');
  failWrites = true;
  await assert.rejects(alice.assign(sun, 'sol', 'sol'), /Offline/);
  assert.equal(fulfilled(database.get(key(sun))), false, 'Failed assignment cannot fulfill a concept');
  failWrites = false;
  const assigned = await alice.assign(sun, 'so-l.', 'so.l');
  assert.equal(assigned.word, 'sol');
  assert.equal(assigned.pronunciation, 'so.l');
  assert.equal(assigned.meaning, sun.conceptData.text);
  assert.equal(assigned.user, 'alice');
  assert.equal(assigned.definitionReview.status, 'candidate');
  assert.equal(fulfilled(assigned), true);
  assert.equal(database.size, 2, 'Definition and fulfillment use one atomic row write');
  const bob = service('bob');
  bob.load([...database.values(), { rowId: 'ordinary', timestamp: 123, word: 'old', meaning: 'legacy' }]);
  assert.equal(bob.list().length, 2, 'Existing words and unrelated records are not concepts');
  assert.equal(bob.list().filter(fulfilled).length, 1, 'Fulfillment persists across users and reloads');
  await assert.rejects(bob.assign(sun, 'other', 'o'), /already assigned/);
  const racers = await Promise.allSettled([alice.assign(moon, 'lun', 'lun'), bob.assign(moon, 'sel', 'sel')]);
  assert.equal(racers.filter(result => result.status === 'fulfilled').length, 1, 'Only one concurrent assignment wins');
  assert.equal(fulfilled(database.get(key(moon))), true);
  const editable = await alice.add('a subtle meaning');
  await assert.rejects(bob.edit(editable, 'not mine'), /Only the requester/);
  await assert.rejects(bob.remove(editable), /Only the requester/);
  failWrites = true;
  await assert.rejects(alice.edit(editable, 'failed edit'), /Offline/);
  assert.equal(database.get(key(editable)).conceptData.text, 'a subtle meaning');
  await assert.rejects(alice.remove(editable), /Offline/);
  assert.ok(database.has(key(editable)));
  failWrites = false;
  const edited = await alice.edit(editable, ' a nuanced feeling ');
  assert.equal(edited.conceptData.text, 'a nuanced feeling');
  assert.equal(edited.conceptData.author, editable.conceptData.author);
  assert.equal(edited.conceptData.createdAt, editable.conceptData.createdAt);
  assert.ok(edited.conceptData.updatedAt);
  await assert.rejects(alice.edit(editable, 'stale'), /changed/);
  await assert.rejects(alice.remove(editable), /changed/);
  await assert.rejects(bob.assign(editable, 'stale', 's'), /changed/);
  await assert.rejects(alice.edit(assigned, 'fulfilled edit'), /already assigned/);
  await assert.rejects(alice.remove(assigned), /already assigned/);
  await alice.remove(edited);
  assert.equal(database.has(key(edited)), false);
  assert.equal(alice.list().some(item => item.rowId === edited.rowId), false);

  const linked = await alice.add('linked request');
  const linkedWord = { ...linked, word: 'kept', pronunciation: 'kept', meaning: null, user: 'bob', hearted: true, updatedTimestamp: 99 };
  database.set(key(linked), clone(linkedWord));
  await alice.remove(linked);
  const kept = database.get(key(linked));
  assert.equal(kept.word, 'kept');
  assert.equal(kept.hearted, true);
  assert.equal(kept.user, 'bob');
  assert.equal(kept.conceptData, undefined, 'Only request metadata is removed from a shared row');
  const concurrent = await alice.add('racing edit');
  const edits = await Promise.allSettled([alice.edit(concurrent, 'first'), alice.edit(concurrent, 'second')]);
  assert.equal(edits.filter(result => result.status === 'fulfilled').length, 1, 'Concurrent edits cannot overwrite each other');
  await assert.rejects(alice.add('  '));
  await assert.rejects(alice.add('x'.repeat(2001)));
  await assert.rejects(alice.assign(moon, 'word', ''));
  await assert.rejects(service('').add('nameless'));
  assert.equal(validRequest({ conceptData: { text: 'bad' } }), false);
  const existing = { rowId: 'match', timestamp: 1, word: 'rays', pronunciation: 'rays', meaning: 'warm sunlight',
    user: 'bob', hearted: true, meaningUpdatedTimestamp: 10 };
  database.set(key(existing), clone(existing));
  const matching = groupWords([existing])[0];
  const reference = await alice.add('sunlight');
  failWrites = true;
  await assert.rejects(bob.fulfillWithExisting(reference, matching), /Offline/);
  assert.equal(fulfilled(database.get(key(reference))), false);
  failWrites = false;
  const resolved = await bob.fulfillWithExisting(reference, matching);
  assert.equal(fulfilled(resolved), true);
  assert.equal(resolved.word, undefined, 'Reference fulfillment does not create a duplicate dictionary row');
  assert.equal(resolved.meaning, undefined, 'The request text does not become a new definition');
  assert.equal(resolved.conceptData.author, 'alice');
  assert.equal(fulfillmentTarget(resolved).word, 'rays');
  assert.equal(resolved.conceptData.fulfillment.fulfilledBy, 'bob');
  assert.deepEqual(database.get(key(existing)), existing, 'Existing definition, approval, and hearts are unchanged');
  assert.equal(groupWords([existing, resolved]).length, 1);
  await assert.rejects(alice.assign(resolved, 'other', 'o'), /already assigned/);
  await assert.rejects(alice.edit(resolved, 'other'), /already assigned/);
  await assert.rejects(alice.remove(resolved), /already assigned/);
  const raced = await alice.add('warm');
  const race = await Promise.allSettled([alice.fulfillWithExisting(raced, matching), bob.assign(raced, 'new', 'n')]);
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1, 'Only one fulfillment or assignment can win');
  const changed = await alice.add('sunlight');
  database.set(key(existing), {...existing, meaning:'cold moonlight', meaningUpdatedTimestamp:11});
  await assert.rejects(alice.fulfillWithExisting(changed, matching), /matching definition changed/);
  database.set(key(existing), existing);
  await alice.edit(changed, 'different request');
  await assert.rejects(alice.fulfillWithExisting(changed, matching), /concept changed/);
  const newer = { ...existing, rowId:'newer', timestamp:2, meaning:'new sunlight', meaningUpdatedTimestamp:12, definitionReview:{status:'candidate'} };
  database.set(key(newer), newer);
  const latestRequest = await alice.add('sunlight');
  await assert.rejects(alice.fulfillWithExisting(latestRequest, matching), /matching definition changed/);
  const latest = groupWords([existing,newer])[0];
  const candidateRef = await alice.fulfillWithExisting(latestRequest, latest);
  assert.equal(fulfillmentTarget(candidateRef).category, 'Candidate');
  assert.deepEqual(database.get(key(newer)), newer, 'Existing candidate is not approved or rewritten');
  const sharedRequest = await alice.add('sunlight');
  const sharedRow = { ...sharedRequest, word:'unrelated', pronunciation:'u', hearted:true, user:'bob', meaning:null };
  database.set(key(sharedRow), sharedRow);
  const sharedReference = await alice.fulfillWithExisting(sharedRequest, latest);
  assert.equal(sharedReference.word, 'unrelated', 'Fulfillment metadata preserves a shared undefined spelling');
  assert.equal(sharedReference.hearted, true);
  assert.equal(fulfillmentTarget(sharedReference).word, 'rays', 'The fulfillment target is separate from the shared dictionary row');
  await assert.rejects(service('').fulfillWithExisting(latestRequest, latest), /named user/);
  console.log('Meaning request tests passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
