import assert from 'node:assert/strict';
import { planHistoryRetention } from '../../background/history-retention.js';

const history = Array.from({ length: 100 }, (_, index) => ({
  id: `recording-${index + 1}`,
  title: `Tutorial ${index + 1}`
}));

const inserted = planHistoryRetention(history, { id: 'recording-new', title: 'Newest tutorial' }, 100);
assert.equal(inserted.history.length, 100, 'visible history remains capped');
assert.equal(inserted.history[0].id, 'recording-new', 'new recording is first');
assert.deepEqual(inserted.evictedIds, ['recording-100'], 'oldest stored recording is scheduled for deletion');
console.log('ok - retention plans cleanup for the oldest invisible recording');

const updated = planHistoryRetention(history, { id: 'recording-50', title: 'Updated tutorial' }, 100);
assert.equal(updated.history.length, 100, 'updating an existing record does not reduce history');
assert.equal(updated.history[0].id, 'recording-50', 'updated record moves to the front');
assert.deepEqual(updated.evictedIds, [], 'updating an existing record does not delete another recording');
console.log('ok - updating existing history does not evict data');

const duplicateHistory = [{ id: 'same' }, { id: 'same' }, { id: 'other' }];
const deduplicated = planHistoryRetention(duplicateHistory, { id: 'new' }, 2);
assert.deepEqual(deduplicated.history.map((item) => item.id), ['new', 'same']);
assert.deepEqual(deduplicated.evictedIds, ['other']);
console.log('ok - retention deduplicates history and cleanup ids');
