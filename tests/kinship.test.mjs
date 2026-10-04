// Relationship calculator and family-graph rules, checked against the demo family.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, isMinor, isKnownMinor } from '../src/lib/graph.js';
import { relationship, findPath } from '../src/lib/kinship.js';
import { persons, relationships, me } from '../src/data/demo-family.js';
import { kinshipTerms } from '../src/data/kinship-seed.js';

const graph = buildGraph(persons, relationships);
const rel = (id) => relationship(graph, kinshipTerms, me, id);

test('parents, grandparents, spouse and children use their terms', () => {
  assert.equal(rel('p16').path, 'F');
  assert.equal(rel('p17').path, 'M');
  assert.equal(rel('p08').path, 'F.F');
  assert.equal(rel('p09').en, 'Paternal grandmother');
  assert.equal(rel('p28').path, 'W');
  assert.equal(rel('p30').path, 'D');
  assert.equal(rel('p31').path, 'S');
});

test('siblings are elder or younger by birth year', () => {
  assert.equal(rel('p26').path, 'eB');
  assert.equal(rel('p29').path, 'yZ');
});

test('uncles and aunts compare with the parent, not with me', () => {
  assert.equal(rel('p20').path, 'F.yB');
  assert.equal(rel('p20').side, 'paternal');
  assert.equal(rel('p21').path, 'F.yB.W');
  const aunt = rel('p18');                 // father's younger sister; table has F.Z
  assert.equal(aunt.path, 'F.yZ');
  assert.equal(aunt.en, "Father's sister");
});

test('parallel cousins take sibling terms; cross cousins take machaan terms', () => {
  assert.equal(rel('p33').path, 'yB');     // father's brother's son, younger than me
  assert.equal(rel('p32').en, 'Cross cousin (male)');
});

test('unverified local terms are not shown as the Tamil label', () => {
  const father = rel('p16');
  assert.equal(father.ta, 'அப்பா');
  assert.match(father.taLocalDraft, /வாப்பா/);
  const verified = kinshipTerms.map((t) => (t.path === 'F' ? { ...t, is_verified: true } : t));
  assert.equal(relationship(graph, verified, me, 'p16').ta, 'வாப்பா');
});

test('paths with no term are described in both languages', () => {
  const r = rel('p10');                   // grandfather's younger sister
  assert.equal(r.kind, 'described');
  assert.equal(r.path, 'F.F.yZ');
  assert.equal(r.en, "Father's father's younger sister");
  assert.equal(r.ta, 'அப்பாவின் அப்பாவின் தங்கை');
  assert.equal(r.recordable, true);
});

test('unknown gender gives a neutral description that is not sent to the missing-terms list', () => {
  const r = rel('p05');
  assert.equal(r.kind, 'described');
  assert.equal(r.recordable, false);
  assert.match(r.en, /sibling$/);
});

test('self and unconnected people', () => {
  assert.equal(rel(me).kind, 'self');
  const lone = buildGraph([...persons, { id: 'x', full_name: 'X', gender: 'male' }], relationships);
  assert.equal(relationship(lone, kinshipTerms, me, 'x').kind, 'none');
  assert.equal(findPath(lone, me, 'x'), null);
});

test('immediate family matches the database rule', () => {
  assert.ok(graph.isImmediateFamily('p27', 'p26'));   // sibling
  assert.ok(graph.isImmediateFamily('p27', 'p16'));   // parent
  assert.ok(graph.isImmediateFamily('p27', 'p28'));   // current spouse
  assert.ok(!graph.isImmediateFamily('p27', 'p33'));  // cousin
  assert.ok(!graph.isImmediateFamily('p11', 'p12'));  // widowed marriage
  assert.ok(graph.isImmediateFamily('p22', 'p23'));   // half-siblings share a father
});

test('minors: known age, unknown age, deceased', () => {
  const today = new Date('2026-10-04');
  assert.ok(isMinor(graph.byId.get('p30'), today));
  assert.ok(!isMinor(graph.byId.get('p27'), today));
  assert.ok(isMinor({ birth_year: null, is_living: null }, today));
  assert.ok(!isKnownMinor({ birth_year: null, is_living: null }, today));
  assert.ok(!isMinor(graph.byId.get('p05'), today));
});
