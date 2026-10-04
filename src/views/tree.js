// Descendant tree with spouses inside each card, drawn as SVG, with drag and pinch zoom.
// Custom for the prototype; CLAUDE.md §2 still asks to evaluate libraries such as
// family-chart before Phase 1 settles on this.
import { h, s, icon } from '../ui/dom.js';
import { t } from '../i18n/index.js';
import { state, graph, person } from '../data/store.js';
import { years } from '../ui/people.js';

const CARD_W = 168;
const LINE_H = 18;
const GAP_X = 18;
const GAP_Y = 64;

/** Ancestors with no parents whose spouses also have none: possible starting points. */
function roots() {
  const g = graph();
  const seen = new Set();
  return state.persons.filter((p) => {
    if (g.parentsOf(p.id).length || !g.childrenOf(p.id).length) return false;
    const spouses = g.spousesOf(p.id).map((x) => x.id);
    if (spouses.some((sp) => g.parentsOf(sp).length || seen.has(sp))) return false;
    seen.add(p.id);
    return true;
  });
}

function layout(rootId) {
  const g = graph();
  const nodes = [];
  const links = [];
  const cardH = (id) => 44 + LINE_H * (1 + g.spousesOf(id).length) + (person(id).house_name ? LINE_H - 4 : 0);

  function measure(id, depth, seen) {
    seen.add(id);
    const kids = g.childrenOf(id).map((c) => person(c.id))
      .filter((c) => !seen.has(c.id))
      .sort((a, b) => (a.birth_year ?? 9999) - (b.birth_year ?? 9999))
      .map((c) => measure(c.id, depth + 1, seen));
    const kidsWidth = kids.reduce((sum, k) => sum + k.width, 0) + GAP_X * Math.max(0, kids.length - 1);
    return { id, depth, kids, width: Math.max(CARD_W, kidsWidth) };
  }

  const rowHeights = [];
  (function heights(n) { rowHeights[n.depth] = Math.max(rowHeights[n.depth] ?? 0, cardH(n.id)); n.kids.forEach(heights); })(measure(rootId, 0, new Set()));
  const rowY = rowHeights.reduce((acc, hgt, i) => [...acc, i === 0 ? 0 : acc[i - 1] + rowHeights[i - 1] + GAP_Y], []);

  (function place(n, left) {
    const x = left + n.width / 2 - CARD_W / 2;
    const y = rowY[n.depth];
    nodes.push({ id: n.id, x, y, h: cardH(n.id) });
    let cursor = left + (n.width - (n.kids.reduce((s2, k) => s2 + k.width, 0) + GAP_X * Math.max(0, n.kids.length - 1))) / 2;
    for (const k of n.kids) {
      const kx = cursor + k.width / 2;
      links.push({ x1: x + CARD_W / 2, y1: y + cardH(n.id), x2: kx, y2: rowY[k.depth], mid: rowY[k.depth] - GAP_Y / 2 });
      place(k, cursor);
      cursor += k.width + GAP_X;
    }
  })(measure(rootId, 0, new Set()), 0);

  const width = Math.max(...nodes.map((n) => n.x + CARD_W));
  const height = Math.max(...nodes.map((n) => n.y + n.h));
  return { nodes, links, width, height };
}

function card(n) {
  const g = graph();
  const p = person(n.id);
  const late = p.is_living === false;
  const isMe = p.id === state.meId;
  let y = 24;
  const lines = [];
  lines.push(s('text', { x: 12, y, class: `t-name${p.name_known ? '' : ' is-unknown'}` }, p.name_known ? p.full_name : t('common.nameUnknown')));
  if (p.house_name) { y += LINE_H - 2; lines.push(s('text', { x: 12, y, class: 't-house' }, p.house_name)); }
  y += LINE_H;
  lines.push(s('text', { x: 12, y, class: 't-years' }, [years(p), isMe ? t('common.you') : null].filter(Boolean).join(' · ')));
  for (const sp of g.spousesOf(p.id)) {
    const spouse = person(sp.id);
    y += LINE_H;
    lines.push(s('text', { x: 12, y, class: 't-spouse', 'data-id': spouse.id }, `+ ${spouse.full_name ?? t('common.nameUnknown')}`));
  }
  return s('g', { class: `node${late ? ' is-late' : ''}${isMe ? ' is-me' : ''}${p.name_known ? '' : ' is-unknown'}`,
    transform: `translate(${n.x} ${n.y})`, 'data-id': p.id, tabindex: '0', role: 'link', 'aria-label': p.full_name ?? t('common.nameUnknown') },
  s('rect', { width: CARD_W, height: n.h, rx: 10 }), ...lines);
}

export function treeView(params) {
  const options = roots();
  const rootId = params.get('root') ?? options[0]?.id;
  const { nodes, links, width, height } = layout(rootId);

  const svg = s('svg', { class: 'tree-svg', role: 'img', 'aria-label': t('tree.title') });
  const world = s('g', {});
  links.forEach((l) => world.append(s('path', { class: 'tree-link', d: `M${l.x1} ${l.y1} V${l.mid} H${l.x2} V${l.y2}` })));
  nodes.forEach((n) => world.append(card(n)));
  svg.append(world);

  // View transform: scale k, translate (tx, ty) in screen pixels.
  let k = 1;
  let tx = 0;
  let ty = 0;
  const apply = () => world.setAttribute('transform', `translate(${tx} ${ty}) scale(${k})`);
  const zoomAt = (factor, cx, cy) => {
    const nk = Math.min(2.5, Math.max(0.25, k * factor));
    tx = cx - ((cx - tx) * nk) / k;
    ty = cy - ((cy - ty) * nk) / k;
    k = nk;
    apply();
  };
  const centreOn = (id) => {
    const n = nodes.find((x) => x.id === id);
    const box = svg.getBoundingClientRect();
    if (!n || !box.width) return;
    k = 0.8;
    tx = box.width / 2 - (n.x + CARD_W / 2) * k;
    ty = box.height / 3 - n.y * k;
    apply();
  };

  const pointers = new Map();
  let moved = 0;
  let pinch = null;
  svg.addEventListener('pointerdown', (e) => {
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = 0;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
    }
  });
  svg.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, cur);
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const box = svg.getBoundingClientRect();
      zoomAt(d / pinch.d, (a.x + b.x) / 2 - box.left, (a.y + b.y) / 2 - box.top);
      pinch.d = d;
      moved += 10;
    } else if (pointers.size === 1) {
      tx += cur.x - prev.x;
      ty += cur.y - prev.y;
      moved += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
      apply();
    }
  });
  const release = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
  };
  svg.addEventListener('pointerup', (e) => {
    release(e);
    if (moved > 6) return;
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-id]');
    if (hit) location.hash = `#/person/${hit.dataset.id}`;
  });
  svg.addEventListener('pointercancel', release);
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const box = svg.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.1 : 0.9, e.clientX - box.left, e.clientY - box.top);
  }, { passive: false });
  svg.addEventListener('keydown', (e) => {
    const id = e.target.closest?.('[data-id]')?.dataset.id;
    if (id && (e.key === 'Enter' || e.key === ' ')) location.hash = `#/person/${id}`;
  });

  const centre = () => {
    const box = svg.getBoundingClientRect();
    return [box.width / 2, box.height / 2];
  };
  const view = h('main', { class: 'tree-page' },
    h('div', { class: 'tree-toolbar' },
      options.length > 1 ? h('select', { id: 'tree-root', 'aria-label': t('tree.startFrom'),
        onchange: (e) => { location.hash = `#/tree?root=${e.target.value}`; } },
      options.map((p) => h('option', { value: p.id, selected: p.id === rootId }, p.full_name))) : null,
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('tree.zoomOut'), onclick: () => zoomAt(0.8, ...centre()) }, icon('minus')),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('tree.zoomIn'), onclick: () => zoomAt(1.25, ...centre()) }, icon('plus')),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => centreOn(state.meId) }, icon('target', 18), t('tree.findMe'))),
    svg,
    h('p', { class: 'tree-hint small muted' }, t('tree.hint')));

  requestAnimationFrame(() => (nodes.some((n) => n.id === state.meId) ? centreOn(state.meId) : centreOn(rootId)));
  view.dataset.size = `${Math.round(width)}x${Math.round(height)}`;
  return view;
}
