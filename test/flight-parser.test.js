import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFlightText } from '../server/flight-parser.js';

test('parses a paired turn and gate', () => {
  const flights = parseFlightText('MX1414 ORF 0816\nMX1414 EYW 0856\nGATE 9', '2026-09-14');
  assert.equal(flights.length, 1);
  assert.equal(flights[0].arrivalNumber, 'MX1414');
  assert.equal(flights[0].destination, 'EYW');
  assert.equal(flights[0].gate, '9');
  assert.equal(flights[0].confidence, 'paired');
});

test('marks a single flight for confirmation', () => {
  const [flight] = parseFlightText('MX2323 PWM 0600\nGATE 6', '2026-09-14');
  assert.equal(flight.departureNumber, null);
  assert.equal(flight.confidence, 'needs-confirmation');
});

test('recognizes a ferry marker on the flight line', () => {
  const [flight] = parseFlightText('MX9045 BHM 0815(FERRY)\nGATE4', '2026-09-14');
  assert.equal(flight.ferry, true);
});
