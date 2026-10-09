const assert = require('node:assert/strict');
const workflow = require('../definition-workflow.js');
const legacy = { meaning: 'sun', meaningUpdatedTimestamp: 10, user: 'alice' };
assert.equal(workflow.classification(legacy), 'defined');
assert.equal(workflow.classification(null), 'undefined');
const candidate = { ...legacy, definitionReview: { status: 'candidate' } };
assert.equal(workflow.classification(candidate), 'candidate');
assert.deepEqual(workflow.reviewForSave(legacy), { status: 'candidate' });
assert.equal(workflow.reviewForSave({ ...legacy, hearted: true }, legacy), null);
const approved = { ...legacy, definitionReview: { status: 'defined', reviewedBy: 'bob' } };
assert.deepEqual(workflow.reviewForSave({ ...approved, hearted: false }, approved), approved.definitionReview);
assert.deepEqual(workflow.reviewForSave({ ...approved, meaning: 'day', meaningUpdatedTimestamp: 11 }, approved), { status: 'candidate' });
assert.equal(workflow.reviewForSave({ ...approved, meaning: null }, approved), null);
assert.deepEqual(workflow.reviewForSave(approved), approved.definitionReview);
assert.equal(workflow.sharedHearts([{ user: 'alice', hearted: true }, { user: 'alice', hearted: true }]), false);
assert.equal(workflow.sharedHearts([{ user: 'alice', hearted: true }, { user: 'bob', hearted: true }]), true);
assert.equal(workflow.sharedHearts([{ user: 'alice', hearted: true }, { user: 'bob', hearted: false }]), false);
const legacyHeart = { user: 'us-east-1:12345678-1234-1234-1234-123456789012', hearted: true };
assert.equal(workflow.sharedHearts([legacyHeart, { user: 'alice', hearted: true }]), false);
assert.equal(workflow.sharedHearts([legacyHeart, { ...legacyHeart, user: 'us-east-1:other-id' }]), false);
assert.equal(workflow.sharedHearts([legacyHeart, { user: 'alice', hearted: true }, { user: 'bob', hearted: true }]), true);
assert.equal(workflow.sharedHearts([{ user: ' Alice ', hearted: true }, { user: 'alice', hearted: true }]), false);
assert.equal(workflow.sharedHearts([{ user: '', hearted: true }, { user: null, hearted: true }, { user: 'alice', hearted: true }]), false);
assert.equal(workflow.canApprove(candidate, 'alice'), false);
assert.equal(workflow.canApprove(candidate, 'bob'), true);
assert.equal(workflow.canApprove(candidate, ''), false);
assert.equal(workflow.canApprove(approved, 'charlie'), false);
async function testPersistence() {
  let previous = { ...approved, rowId: 'alice::sun', timestamp: 1, updatedTimestamp: 12,
    conceptData: { id: 'concept-1', text: 'sun', author: 'bob', createdAt: 1 } };
  const writes = [];
  const client = {
    get: () => ({ promise: async () => ({ Item: previous }) }),
    put: params => ({ promise: async () => { writes.push(params); } })
  };
  const item = { ...previous, hearted: true, updatedTimestamp: 13 };
  // Even a page that never loaded approval metadata must preserve it.
  delete item.definitionReview;
  delete item.conceptData;
  await workflow.save(client, 'secretWords', item);
  assert.deepEqual(writes[0].Item.definitionReview, approved.definitionReview);
  assert.deepEqual(writes[0].Item.conceptData, previous.conceptData, 'Heart saves preserve concept linkage');
  assert.ok(writes[0].ConditionExpression.includes('#review'));
  await workflow.save(client, 'secretWords', { ...item, meaning: 'light', meaningUpdatedTimestamp: 14 });
  assert.equal(writes[1].Item.definitionReview.status, 'candidate');
  delete previous.conceptData;
  await workflow.save(client, 'secretWords', { ...item, conceptData: { id: 'deleted-request' } });
  assert.equal(writes[2].Item.conceptData, undefined, 'A stale heart save cannot resurrect a deleted request');
  previous = undefined;
  await workflow.save(client, 'secretWords', { rowId: 'bob::sky', timestamp: 2, meaning: 'sky' });
  assert.equal(writes[3].ConditionExpression, 'attribute_not_exists(rowId)');
  assert.equal(writes[3].Item.definitionReview.status, 'candidate');
  console.log('Definition workflow tests passed.');
}
testPersistence().catch(error => { console.error(error); process.exitCode = 1; });
