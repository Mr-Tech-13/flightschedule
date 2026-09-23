import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWeekStart, parseEmployeeRows, unwrapWorkbookRows } from '../server/employee-schedule-parser.js';

test('unwraps the multi-sheet result returned by read-excel-file v9', () => {
  const rows = [['Ramp Lead'], ['Jane Doe', '5:00', '13:00']];
  assert.deepEqual(unwrapWorkbookRows([{ sheet: 'Ramp Schedule', data: rows }]), rows);
});

test('imports section roles and overnight shifts from a weekly workbook', () => {
  const workbook = [{ sheet: 'Ramp Schedule', data: [
    ['Ramp Supervisor', 'MONDAY'], ['Sam Smith', '4:00', '12:00'],
    ['Ramp Lead', 'MONDAY'], ['Jane Doe s.', '15:30', '0:30'],
    ['Ramp Agents (AM)', 'MONDAY'], ['OPEN LINE', '5:00', '13:00'],
    ['Alex Jones', 'VAC', 'VAC', '5:00', '13:00']
  ] }];
  const people = parseEmployeeRows(workbook, '2026-09-14');
  assert.equal(people.length, 3);
  assert.equal(people[0].role, 'supervisor');
  assert.equal(people[1].role, 'lead');
  assert.equal(people[1].name, 'Jane Doe');
  assert.equal(people[1].customsSeal, true);
  assert.equal(people[1].shifts[0].end, '2026-09-15T00:30:00');
  assert.equal(people[2].role, 'agent');
  assert.equal(people[2].shifts[0].date, '2026-09-15');
});

test('anchors an imported weekly schedule to Monday', () => {
  assert.equal(normalizeWeekStart('2026-09-17'), '2026-09-14');
  const people = parseEmployeeRows([['Ramp Agents (AM)', 'MONDAY'], ['Alex Jones', '5:00', '13:00']], '2026-09-17');
  assert.equal(people[0].shifts[0].date, '2026-09-14');
});

test('keeps employees who are off for the entire imported week', () => {
  const people = parseEmployeeRows([['Ramp Lead', 'MONDAY'], ['Jane Doe', 'VAC', 'VAC']], '2026-09-14');
  assert.equal(people.length, 1);
  assert.deepEqual(people[0].shifts, []);
});
