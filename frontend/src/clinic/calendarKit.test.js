import test from 'node:test';
import assert from 'node:assert/strict';
import { findConflict, lifecycle, matchesCalendarFilters } from './calendarKit.js';

const empty = { status: [], confirm: [], services: [] };

test('calendar reflects real visit progress and keeps terminal booking states', () => {
  assert.equal(lifecycle({ status: 'confirmed', visit_id: 8, visit_status: 'in_consult' })[0], 'in_progress');
  assert.equal(lifecycle({ status: 'confirmed', visit_id: 8, visit_status: 'completed' })[0], 'completed');
  assert.equal(lifecycle({ status: 'cancelled', visit_id: 8, visit_status: 'completed' })[0], 'cancelled');
  assert.equal(lifecycle({ status: 'no_show', visit_id: 8 })[0], 'no_show');
});

test('lifecycle filtering does not also treat an arrived booking as confirmed', () => {
  const booking = { status: 'confirmed', visit_id: 8, visit_status: 'waiting' };
  assert.equal(matchesCalendarFilters(booking, { ...empty, status: ['confirmed'] }), false);
  assert.equal(matchesCalendarFilters(booking, { ...empty, status: ['checked_in'] }), true);
});

test('status, contact and service filters combine; service selection uses OR', () => {
  const booking = { status: 'pending', confirm_state: 'waiting_reply', items: [{ service: 10 }, { service: 11 }] };
  const filters = { status: ['pending'], confirm: ['waiting_reply'], services: [9, 11] };
  assert.equal(matchesCalendarFilters(booking, filters), true);
  assert.equal(matchesCalendarFilters(booking, { ...filters, confirm: ['replied_no'] }), false);
  assert.equal(matchesCalendarFilters(booking, { ...filters, services: [12] }), false);
  assert.equal(matchesCalendarFilters({ ...booking, items: [{ service: { id: 11 } }] }, filters), true);
});

test('cancelled appointments remain hidden unless explicitly selected', () => {
  assert.equal(matchesCalendarFilters({ status: 'cancelled' }, empty), false);
  assert.equal(matchesCalendarFilters({ status: 'cancelled' }, { ...empty, status: ['cancelled'] }), true);
  assert.equal(matchesCalendarFilters({ status: 'confirmed' }, empty), true);
});

test('hidden appointments still block scheduling when passed in the complete availability pool', () => {
  const booking = { id: 8, staff: 1, status: 'pending', customer_name: 'Khách đang chờ',
    appointment: '2030-01-07T10:00:00', duration_minutes: 60 };
  assert.equal(matchesCalendarFilters(booking, { ...empty, status: ['confirmed'] }), false);
  const error = findConflict({ staffId: 1, start: new Date('2030-01-07T10:30:00'), minutes: 30,
    bookings: [booking], blocks: [], hours: {}, now: new Date('2030-01-01T00:00:00') });
  assert.match(error, /Trùng lịch/);
});
