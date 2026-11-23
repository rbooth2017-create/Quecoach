import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyLayout, normalize, groupOrder, move, moveBefore, setFlag } from '../js/layout.js';

test('default order follows the panel list', () => {
  assert.deepEqual(groupOrder(emptyLayout(), 'stage'), ['lane', 'mixplan', 'decks', 'library']);
});

test('move swaps neighbours and stops at the ends', () => {
  let l = move(emptyLayout(), 'library', -1);
  assert.deepEqual(groupOrder(l, 'stage'), ['lane', 'mixplan', 'library', 'decks']);
  l = move(l, 'lane', -1);
  assert.deepEqual(groupOrder(l, 'stage'), ['lane', 'mixplan', 'library', 'decks']);
});

test('moveBefore drops a section in front of another, or at the end', () => {
  let l = moveBefore(emptyLayout(), 'library', 'lane');
  assert.deepEqual(groupOrder(l, 'stage'), ['library', 'lane', 'mixplan', 'decks']);
  l = moveBefore(l, 'library', null);
  assert.deepEqual(groupOrder(l, 'stage'), ['lane', 'mixplan', 'decks', 'library']);
  assert.equal(moveBefore(l, 'library', 'setlist'), l, 'never across areas');
});

test('fixed sections never move', () => {
  const l = emptyLayout();
  assert.equal(move(l, 'coach', 1), l);
});

test('normalize drops unknown ids and fills in new sections', () => {
  const l = normalize({ folded: { lane: true, gone: true }, hidden: { mixplan: 1 }, order: { stage: ['library', 'gone', 'lane'] } });
  assert.deepEqual(l.folded, { lane: true });
  assert.deepEqual(l.hidden, { mixplan: true });
  assert.deepEqual(l.order.stage, ['library', 'lane', 'mixplan', 'decks']);
});

test('setFlag sets and clears', () => {
  const l = setFlag(setFlag(emptyLayout(), 'folded', 'lane', true), 'folded', 'lane', false);
  assert.deepEqual(l.folded, {});
});
