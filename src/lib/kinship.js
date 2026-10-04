// Relationship calculator (CLAUDE.md §6a). Pure functions: graph in, label out.
import { compareAge } from './graph.js';

// Step codes. F/M/S/D/B/Z/H/W match the kinship_terms path notation; P/C/Sp/Sib are used
// when gender is unknown, so such paths never match a term and fall back to a description.
const WORDS = {
  F: ['father', 'அப்பா', 'அப்பாவின்'],
  M: ['mother', 'அம்மா', 'அம்மாவின்'],
  P: ['parent', 'பெற்றோர்', 'பெற்றோரின்'],
  S: ['son', 'மகன்', 'மகனின்'],
  D: ['daughter', 'மகள்', 'மகளின்'],
  C: ['child', 'பிள்ளை', 'பிள்ளையின்'],
  H: ['husband', 'கணவர்', 'கணவரின்'],
  W: ['wife', 'மனைவி', 'மனைவியின்'],
  Sp: ['spouse', 'துணைவர்', 'துணைவரின்'],
  eB: ['elder brother', 'அண்ணன்', 'அண்ணனின்'],
  yB: ['younger brother', 'தம்பி', 'தம்பியின்'],
  B: ['brother', 'சகோதரன்', 'சகோதரனின்'],
  eZ: ['elder sister', 'அக்கா', 'அக்காவின்'],
  yZ: ['younger sister', 'தங்கை', 'தங்கையின்'],
  Z: ['sister', 'சகோதரி', 'சகோதரியின்'],
  Sib: ['sibling', 'உடன்பிறப்பு', 'உடன்பிறப்பின்'],
};

/** Shortest path of person ids from `from` to `to` over parent, child and spouse links. */
export function findPath(graph, from, to) {
  if (from === to) return [from];
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const id = queue.shift();
    const next = [
      ...graph.parentsOf(id).map((p) => p.id),
      ...graph.childrenOf(id).map((c) => c.id),
      ...graph.spousesOf(id).map((s) => s.id),
    ];
    for (const n of next) {
      if (prev.has(n)) continue;
      prev.set(n, id);
      if (n === to) {
        const path = [to];
        for (let cur = id; cur !== null; cur = prev.get(cur)) path.unshift(cur);
        return path;
      }
      queue.push(n);
    }
  }
  return null;
}

const gendered = (p, male, female, unknown) => (p.gender === 'male' ? male : p.gender === 'female' ? female : unknown);
const isParentStep = (s) => ['F', 'M', 'P'].includes(s.code);
const isChildStep = (s) => ['S', 'D', 'C'].includes(s.code);
const bare = (code) => code.replace(/^[ey]/, '');

function siblingStep(person, comparedTo) {
  const base = gendered(person, 'B', 'Z', 'Sib');
  const order = base === 'Sib' ? null : compareAge(person, comparedTo);
  return { code: order === -1 ? `e${base}` : order === 1 ? `y${base}` : base, id: person.id };
}

/** Turns a path of ids into canonical steps, e.g. father → his parent → that parent's son = F.eB. */
export function toSteps(graph, path) {
  const g = (id) => graph.byId.get(id);
  let steps = [];
  for (let i = 1; i < path.length; i++) {
    const [x, y] = [path[i - 1], path[i]];
    const person = g(y);
    if (graph.parentsOf(x).some((p) => p.id === y)) steps.push({ code: gendered(person, 'F', 'M', 'P'), id: y });
    else if (graph.childrenOf(x).some((c) => c.id === y)) steps.push({ code: gendered(person, 'S', 'D', 'C'), id: y });
    else steps.push({ code: gendered(person, 'H', 'W', 'Sp'), id: y });
  }

  // A parent step followed by one of that parent's other children is a sibling step.
  // The age prefix compares the sibling with the person just before the parent step.
  const origin = path[0];
  for (let i = 0; i < steps.length - 1; i++) {
    if (isParentStep(steps[i]) && isChildStep(steps[i + 1])) {
      const before = i === 0 ? origin : steps[i - 1].id;
      steps.splice(i, 2, siblingStep(g(steps[i + 1].id), g(before)));
    }
  }

  // Parallel cousins (father's brother's / mother's sister's children) take sibling terms, compared with me.
  const codes = steps.map((s) => bare(s.code));
  if (steps.length === 3 && isChildStep(steps[2])
      && ((codes[0] === 'F' && codes[1] === 'B') || (codes[0] === 'M' && codes[1] === 'Z'))) {
    steps = [siblingStep(g(steps[2].id), g(origin))];
  }
  return steps;
}

/**
 * How `other` is related to `me`.
 * @param {ReturnType<import('./graph.js').buildGraph>} graph
 * @param {{ path: string, label_en: string, label_ta_formal: string|null, label_ta_local: string|null,
 *   label_ta_local_roman?: string|null, is_verified: boolean }[]} terms
 */
export function relationship(graph, terms, me, other) {
  if (me === other) return { kind: 'self' };
  const ids = findPath(graph, me, other);
  if (!ids) return { kind: 'none' };
  const steps = toSteps(graph, ids);
  const path = steps.map((s) => s.code).join('.');
  const side = steps[0].code === 'F' ? 'paternal' : steps[0].code === 'M' ? 'maternal' : 'none';
  const byPath = new Map(terms.map((t) => [t.path, t]));
  const term = byPath.get(path) ?? byPath.get(steps.map((s) => bare(s.code)).join('.'));
  const recordable = /^[ey]?[FMSDBZHW](\.[ey]?[FMSDBZHW])*$/.test(path);

  if (term) {
    return {
      kind: 'term', path, side, steps: steps.length,
      en: term.label_en,
      ta: term.is_verified && term.label_ta_local ? term.label_ta_local : (term.label_ta_formal ?? term.label_en),
      taLocalDraft: !term.is_verified && term.label_ta_local
        ? `${term.label_ta_local}${term.label_ta_local_roman ? ` (${term.label_ta_local_roman})` : ''}` : null,
      verified: term.is_verified,
    };
  }
  return { kind: 'described', path, side, steps: steps.length, recordable, ...describe(steps) };
}

/** "father's elder brother's son" / "அப்பாவின் அண்ணனின் மகன்" */
export function describe(steps) {
  const w = steps.map((s) => WORDS[s.code]);
  const en = w.map((x, i) => (i < w.length - 1 ? `${x[0]}'s` : x[0])).join(' ');
  const ta = w.map((x, i) => (i < w.length - 1 ? x[2] : x[1])).join(' ');
  return { en: en.charAt(0).toUpperCase() + en.slice(1), ta };
}
