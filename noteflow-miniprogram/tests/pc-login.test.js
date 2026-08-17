const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeScene, canSubmitPcLogin } = require('../pages/pc-login/pc-login');

test('normalizeScene decodes a QR scene value', () => {
  assert.equal(normalizeScene('state%2Bvalue'), 'state+value');
});

test('normalizeScene keeps malformed values usable', () => {
  assert.equal(normalizeScene('%E0%A4%A'), '%E0%A4%A');
});

test('canSubmitPcLogin only accepts a non-empty state', () => {
  assert.equal(canSubmitPcLogin(''), false);
  assert.equal(canSubmitPcLogin('   '), false);
  assert.equal(canSubmitPcLogin('state-123'), true);
});
