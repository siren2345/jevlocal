import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest } from '../server.mjs';

test('accepts JeV-shaped structured state and choice instructions', () => {
  const request = {
    state: { customer: 'example' },
    questions: {
      route: {
        type: 'choice',
        instructions: { task: 'route the request' },
        criteria: { billing: 'payment issue', support: 'technical issue' },
      },
    },
  };
  assert.equal(validateRequest(request), request);
});

test('rejects choice requests outside the 1 to 26 option contract', () => {
  assert.throws(
    () => validateRequest({ state: 'x', questions: { q: { type: 'choice', criteria: {} } } }),
    /1 to 26 options/,
  );
});

test('rejects score requests outside the 2 to 10 level contract', () => {
  assert.throws(
    () => validateRequest({ state: 'x', questions: { q: { type: 'score', criteria: ['only one'] } } }),
    /2 to 10 ordered levels/,
  );
});
