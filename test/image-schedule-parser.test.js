import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScheduleTsv } from '../server/image-schedule-parser.js';

const header = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
const page = '1\t1\t0\t0\t0\t0\t0\t0\t1190\t2100\t-1\t';
const word = (line, left, top, width, text) => `5\t1\t1\t1\t${line}\t1\t${left}\t${top}\t${width}\t18\t90\t${text}`;

test('reconstructs an employee shift from positioned OCR words', () => {
  const tsv = [header,page,word(1,190,100,45,'Ramp'),word(1,240,100,90,'Supervisors'),word(2,40,130,38,'Jane'),word(2,82,130,32,'Doe'),word(2,215,130,34,'4:00'),word(2,270,130,42,'12:00')].join('\n');
  const employees = parseScheduleTsv(tsv, '2026-09-14');
  assert.equal(employees.length, 1);
  assert.equal(employees[0].name, 'Jane Doe');
  assert.equal(employees[0].role, 'supervisor');
  assert.equal(employees[0].shifts[0].start, '2026-09-14T04:00:00');
});

test('handles an overnight shift', () => {
  const tsv = [header,page,word(1,190,100,35,'Ramp'),word(1,230,100,55,'Lead'),word(2,40,130,38,'John'),word(2,82,130,42,'Smith'),word(2,215,130,38,'15:30'),word(2,270,130,34,'0:30')].join('\n');
  const [employee] = parseScheduleTsv(tsv, '2026-09-14');
  assert.equal(employee.shifts[0].end, '2026-09-15T00:30:00');
});
