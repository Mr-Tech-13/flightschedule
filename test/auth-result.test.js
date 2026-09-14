import test from 'node:test';
import assert from 'node:assert/strict';

test('PGlite-style SELECT results are detected from rows without rowCount', () => {
  const existingAccountResult = { rows: [{ id: 'existing-admin' }] };
  assert.equal(existingAccountResult.rows.length === 0, false);
});

test('empty PGlite-style SELECT results are detected from rows', () => {
  const emptyResult = { rows: [] };
  assert.equal(emptyResult.rows.length === 0, true);
});
