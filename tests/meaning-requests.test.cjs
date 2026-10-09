const assert = require('node:assert/strict');
const { create, fulfilled, validRequest } = require('../meaning-requests.js');
if (!globalThis.crypto) globalThis.crypto = require('node:crypto').webcrypto;
async function run() {
  const database = new Map();
  let failWrites = false;
  const clone = value => value === undefined ? value : structuredClone(value);
  const key = item => `${item.rowId}|${item.timestamp}`;
  const client = {
    get: params => ({ promise: async () => ({ Item: clone(database.get(key(params.Key))) }) }),
    put: params => ({ promise: async () => {
      if (failWrites) throw new Error('Offline');
      const previous = database.get(key(params.Item));
      let valid = true;
      if (params.ConditionExpression === 'attribute_not_exists(rowId)') valid = !previous;
      else if (params.ConditionExpression.includes('attribute_not_exists(#updated)')) valid = previous && previous.updatedTimestamp == null;
      else valid = previous && previous.updatedTimestamp === params.ExpressionAttributeValues[':updated'];
      if (!valid) throw Object.assign(new Error('Concurrent change'), { code: 'ConditionalCheckFailedException' });
      database.set(key(params.Item), clone(params.Item));
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
  await assert.rejects(alice.add('  '));
  await assert.rejects(alice.add('x'.repeat(2001)));
  await assert.rejects(alice.assign(moon, 'word', ''));
  await assert.rejects(service('').add('nameless'));
  assert.equal(validRequest({ conceptData: { text: 'bad' } }), false);
  console.log('Meaning request tests passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
