// CSV round trip and validation for the admin "Family data" export/import.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCSV, toCSV, personsToCSV, parsePersonsCSV, relationshipsToCSV, parseRelationshipsCSV,
} from '../src/lib/csv.js';

test('parseCSV handles quoted commas, quotes and newlines', () => {
  const text = 'id,notes\r\np1,"Ran a shop, in Colachel"\r\np2,"Said ""hello"""\r\np3,"Two\nlines"\r\n';
  const rows = parseCSV(text);
  assert.deepEqual(rows, [
    { id: 'p1', notes: 'Ran a shop, in Colachel' },
    { id: 'p2', notes: 'Said "hello"' },
    { id: 'p3', notes: 'Two\nlines' },
  ]);
});

test('toCSV / parseCSV round-trips arbitrary values', () => {
  const rows = [{ a: 'plain', b: 'with,comma' }, { a: 'with "quote"', b: 'line\nbreak' }];
  const text = toCSV(rows, ['a', 'b']);
  assert.deepEqual(parseCSV(text), rows);
});

test('personsToCSV / parsePersonsCSV round-trips a person', () => {
  const p = {
    id: 'p1', full_name: 'Mohamed Yusuf', name_known: true, known_as: 'Yusuf', house_name: 'Kadalkarai',
    gender: 'male', birth_year: 1880, birth_date: null, is_living: false, death_year: 1941,
    native_place: 'Colachel', city: null, notes: 'Ran a shop, in Colachel',
  };
  const { persons, errors } = parsePersonsCSV(personsToCSV([p]));
  assert.deepEqual(errors, []);
  assert.deepEqual(persons, [p]);
});

test('a name-not-available placeholder round-trips with full_name null', () => {
  const p = { id: 'p5', full_name: null, name_known: false, known_as: null, house_name: null,
    gender: 'unknown', birth_year: null, birth_date: null, is_living: null, death_year: null,
    native_place: null, city: null, notes: 'Died in infancy' };
  const { persons, errors } = parsePersonsCSV(personsToCSV([p]));
  assert.deepEqual(errors, []);
  assert.deepEqual(persons, [p]);
});

test('rejects a known name left blank', () => {
  const { errors } = parsePersonsCSV('id,full_name,name_known\r\np1,,true\r\n');
  assert.match(errors[0], /full_name is required/);
});

test('rejects name_known=false with a name still filled in', () => {
  const { errors } = parsePersonsCSV('id,full_name,name_known\r\np1,Someone,false\r\n');
  assert.match(errors[0], /name_known is false but full_name is set/);
});

test('rejects a bad gender, a non-numeric year, and death before birth', () => {
  const bad = (csv) => parsePersonsCSV(`id,full_name,gender,birth_year,death_year\r\n${csv}\r\n`).errors[0];
  assert.match(bad('p1,X,Q,,'), /gender must be M, F or blank/);
  assert.match(bad('p1,X,,abcd,'), /whole number/);
  assert.match(bad('p1,X,,1950,1940'), /death_year is before birth_year/);
});

test('rejects a duplicate id', () => {
  const { errors } = parsePersonsCSV('id,full_name\r\np1,A\r\np1,B\r\n');
  assert.match(errors[0], /duplicate id/);
});

test('relationships round-trip and validate against the persons file', () => {
  const ids = new Set(['p1', 'p2']);
  const rels = [{ person_a: 'p1', person_b: 'p2', type: 'parent_of', subtype: 'biological', status: null }];
  const { relationships, errors } = parseRelationshipsCSV(relationshipsToCSV(rels), ids);
  assert.deepEqual(errors, []);
  assert.deepEqual(relationships, rels);
});

test('rejects a relationship pointing at someone not in persons.csv', () => {
  const { errors } = parseRelationshipsCSV('person_a,person_b,type\r\np1,ghost,parent_of\r\n', new Set(['p1']));
  assert.match(errors[0], /not in persons\.csv/);
});

test('rejects linking a person to themselves', () => {
  const { errors } = parseRelationshipsCSV('person_a,person_b,type\r\np1,p1,parent_of\r\n', new Set(['p1']));
  assert.match(errors[0], /cannot be linked to themselves/);
});

test('normalises a spouse pair to the lower id first, whichever order the sheet has them', () => {
  const ids = new Set(['p1', 'p2']);
  const { relationships, errors } = parseRelationshipsCSV('person_a,person_b,type,status\r\np2,p1,spouse_of,married\r\n', ids);
  assert.deepEqual(errors, []);
  assert.deepEqual(relationships, [{ person_a: 'p1', person_b: 'p2', type: 'spouse_of', subtype: null, status: 'married' }]);
});

test('rejects a duplicate link once the pair is normalised', () => {
  const ids = new Set(['p1', 'p2']);
  const text = 'person_a,person_b,type,status\r\np1,p2,spouse_of,married\r\np2,p1,spouse_of,married\r\n';
  const { errors } = parseRelationshipsCSV(text, ids);
  assert.match(errors[0], /duplicate link/);
});
