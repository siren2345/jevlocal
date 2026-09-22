import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest, admission } from '../server.mjs';

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

test('routes compact choice to the fast path without configuration', () => {
  const route = admission({
    state: 'Where is my package?',
    questions: {
      route: {
        type: 'choice',
        instructions: 'Choose the team.',
        criteria: { billing: 'payment issue', support: 'technical issue' },
      },
    },
  });
  assert.equal(route.provider, 'laya');
});

test('keeps reasoning-shaped input on the quality provider', () => {
  const route = admission({
    state: 'A passage with two people.',
    questions: {
      q: {
        type: 'choice',
        instructions: 'Answer according to the passage.',
        criteria: { a: 'first', b: 'second', c: 'Cannot be determined' },
      },
    },
  });
  assert.equal(route.provider, 'semif');
});

test('keeps noul, score, and multi-question requests on quality', () => {
  const noul = admission({ state: 'x', questions: { q: { type: 'noul' } } });
  const score = admission({ state: 'x', questions: { q: { type: 'score', criteria: ['low', 'high'] } } });
  const multi = admission({
    state: 'x',
    questions: {
      a: { type: 'choice', criteria: { x: 'X' } },
      b: { type: 'choice', criteria: { y: 'Y' } },
    },
  });
  assert.equal(noul.provider, 'semif');
  assert.equal(score.provider, 'semif');
  assert.equal(multi.provider, 'semif');
});
