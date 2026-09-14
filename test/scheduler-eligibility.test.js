import test from 'node:test';
import assert from 'node:assert/strict';
import { eligible } from '../server/scheduler-eligibility.js';

const employee = (overrides = {}) => ({
  primary_role: 'lead', eligible_roles: ['lead'], customs_seal: false,
  qualifications: [], ...overrides
});

test('leadership requires an explicit authorization for the flight airline', () => {
  assert.equal(eligible(employee(), 'lead', 'MX', false), false);
  assert.equal(eligible(employee({ qualifications: [{ airline: 'MX', can_lead: false }] }), 'lead', 'MX', false), false);
  assert.equal(eligible(employee({ qualifications: [{ airline: 'MX', can_lead: true }] }), 'lead', 'MX', false), true);
});

test('supervisors can run only explicitly authorized airlines', () => {
  const supervisor = employee({ primary_role: 'supervisor', eligible_roles: ['supervisor'], qualifications: [{ airline: 'SY', can_lead: true }] });
  assert.equal(eligible(supervisor, 'lead', 'SY', false), true);
  assert.equal(eligible(supervisor, 'lead', 'MX', false), false);
});

test('agents cannot run flights even if an authorization record is present', () => {
  const agent = employee({ primary_role: 'agent', eligible_roles: ['agent'], qualifications: [{ airline: 'MX', can_lead: true }] });
  assert.equal(eligible(agent, 'lead', 'MX', false), false);
});
