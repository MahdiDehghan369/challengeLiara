const test = require('node:test');
const assert = require('node:assert');
const { findOrder, summarize } = require('../src/orders');

test('summarize: order with items', () => {
  assert.deepStrictEqual(summarize(findOrder('1')), { id: '1', customer: 'sara', count: 1, total: 240000 });
});

test('summarize: order without items does not throw (fails until the bug is fixed)', () => {
  assert.deepStrictEqual(summarize(findOrder('2')), { id: '2', customer: 'reza', count: 0, total: 0 });
});