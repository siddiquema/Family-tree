// Press-and-hold mutations, checked against the demo family.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/lib/graph.js';
import { addParent, addChild, addSpouse, removePerson, canAddParent, linkCount } from '../src/lib/family-edit.js';
import { persons as demoPersons, relationships as demoRelationships } from '../src/data/demo-family.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const fresh = () => ({ persons: clone(demoPersons), relationships: clone(demoRelationships) });

test('add child creates a placeholder linked to the parent', () => {
  const { persons, relationships } = fresh();
  const id = addChild(persons, relationships, 'p27');  // Arif
  const g = buildGraph(persons, relationships);
  assert.ok(g.byId.get(id));
  assert.equal(g.byId.get(id).name_known, false);
  assert.ok(g.parentsOf(id).some((p) => p.id === 'p27'));
});

test('add child also links the one married spouse', () => {
  const { persons, relationships } = fresh();
  const id = addChild(persons, relationships, 'p27');  // married to p28 (Hasina)
  const g = buildGraph(persons, relationships);
  const parentIds = g.parentsOf(id).map((p) => p.id).sort();
  assert.deepEqual(parentIds, ['p27', 'p28']);
});

test('add child skips the second parent when there is no current spouse', () => {
  const { persons, relationships } = fresh();
  const id = addChild(persons, relationships, 'p16');  // Nizar, one spouse (Shameema) -> links her too
  assert.equal(buildGraph(persons, relationships).parentsOf(id).length, 2);
  const id2 = addChild(persons, relationships, 'p10');  // Rahima, no spouse recorded
  assert.equal(buildGraph(persons, relationships).parentsOf(id2).length, 1);
  const id3 = addChild(persons, relationships, 'p12');  // Zubaida, only a widowed marriage
  assert.equal(buildGraph(persons, relationships).parentsOf(id3).length, 1);
});

test('add parent is blocked once two biological parents are on record', () => {
  const { persons, relationships } = fresh();
  assert.equal(canAddParent(relationships, 'p27'), false);  // already has p16 and p17
  assert.equal(addParent(persons, relationships, 'p27'), null);
  assert.equal(persons.length, demoPersons.length);  // nothing was added
});

test('add parent works until two are on record, then blocks', () => {
  const { persons, relationships } = fresh();
  assert.equal(buildGraph(persons, relationships).parentsOf('p09').length, 0);  // Khadija: no parents in the sample
  const first = addParent(persons, relationships, 'p09');
  assert.ok(first);
  assert.ok(buildGraph(persons, relationships).parentsOf('p09').some((p) => p.id === first));
  assert.equal(canAddParent(relationships, 'p09'), true);
  const second = addParent(persons, relationships, 'p09');
  assert.ok(second);
  assert.equal(canAddParent(relationships, 'p09'), false);
  assert.equal(addParent(persons, relationships, 'p09'), null);
});

test('add spouse stores the pair with the lower id first', () => {
  const { persons, relationships } = fresh();
  const id = addSpouse(persons, relationships, 'p09');
  const row = relationships.find((r) => r.type === 'spouse_of' && [r.person_a, r.person_b].includes(id));
  assert.ok(row);
  assert.ok(row.person_a < row.person_b);
  assert.equal(row.status, 'married');
});

test('remove person clears them and every relationship that names them', () => {
  const { persons, relationships } = fresh();
  assert.ok(linkCount(relationships, 'p16') > 0);
  const ok = removePerson(persons, relationships, 'p16');
  assert.ok(ok);
  assert.ok(!persons.some((p) => p.id === 'p16'));
  assert.equal(linkCount(relationships, 'p16'), 0);
  // the people who were linked to p16 keep their own record, just lose that one link
  assert.ok(persons.some((p) => p.id === 'p26'));
  assert.ok(!buildGraph(persons, relationships).parentsOf('p26').some((p) => p.id === 'p16'));
});

test('remove person on an unknown id is a no-op', () => {
  const { persons, relationships } = fresh();
  assert.equal(removePerson(persons, relationships, 'nope'), false);
  assert.equal(persons.length, demoPersons.length);
});
