// SVG flow diagrams: boxes and curved arrows, with a stage that can be lit, edges that can glow
// as a cycle moves along them, and clicks. LIFECYCLE is the spec's state machine laid out once,
// for every page that draws it.
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
};

// Where the line from the box centre towards (tx, ty) leaves the box.
function edgePoint(n, tx, ty) {
  const dx = tx - n.x, dy = ty - n.y, hw = n.w / 2 + 3, hh = n.h / 2 + 3;
  const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return [n.x + dx * t, n.y + dy * t];
}

/**
 * Draw `spec` into `host`. Nodes: { id, x, y, w, h, label ("\n" breaks), cls, title }. Edges:
 * { from, to, label, bend (pixels sideways, + is left of the direction of travel), dashed, cls }.
 * Returns controls for the demos.
 */
export function flow(host, spec) {
  const { width, height } = spec;
  const id = uid++;
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, class: 'flow', role: 'img' });
  const defs = el('defs', {}, svg);
  for (const [name, cls] of [['arrow', 'ah'], ['arrow-hot', 'ah hot'], ['arrow-trail', 'ah trail']]) {
    const m = el('marker', { id: `${name}-${id}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
    el('path', { d: 'M0,0 L10,5 L0,10 z', class: cls }, m);
  }
  const nodes = new Map(spec.nodes.map((n) => [n.id, { w: 120, h: 46, ...n }]));
  const edgeLayer = el('g', {}, svg), nodeLayer = el('g', {}, svg);
  const edges = spec.edges.map((e) => {
    const a = nodes.get(e.from), b = nodes.get(e.to);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const cx = mx + ((b.y - a.y) / len) * (e.bend ?? 0), cy = my - ((b.x - a.x) / len) * (e.bend ?? 0);
    const [x1, y1] = edgePoint(a, cx, cy), [x2, y2] = edgePoint(b, cx, cy);
    const g = el('g', { class: `edge ${e.cls ?? ''} ${e.dashed ? 'dashed' : ''}` }, edgeLayer);
    const path = el('path', { d: `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`, 'marker-end': `url(#arrow-${id})` }, g);
    if (e.label) {
      const lx = 0.25 * x1 + 0.5 * cx + 0.25 * x2, ly = 0.25 * y1 + 0.5 * cy + 0.25 * y2 + (e.dy ?? -6);
      const lines = e.label.split('\n');
      const t = el('text', { x: lx, y: ly - (lines.length - 1) * 6, class: 'elabel' }, g);
      lines.forEach((line, i) => { const s = el('tspan', { x: lx, dy: i ? 12 : 0 }, t); s.textContent = line; });
    }
    return { ...e, g, path };
  });
  for (const n of nodes.values()) {
    const g = el('g', { class: `node ${n.cls ?? ''}`, 'data-id': n.id, tabindex: 0 }, nodeLayer);
    el('rect', { x: n.x - n.w / 2, y: n.y - n.h / 2, width: n.w, height: n.h, rx: 7 }, g);
    const lines = n.label.split('\n');
    const t = el('text', { x: n.x, y: n.y - (lines.length - 1) * 7.5 + 4.5 }, g);
    lines.forEach((line, i) => { const s = el('tspan', { x: n.x, dy: i ? 15 : 0 }, t); s.textContent = line; });
    if (n.title) el('title', {}, g).textContent = n.title;
    n.g = g;
  }
  host.appendChild(svg);

  const find = (from, to) => edges.filter((e) => e.from === from && e.to === to);
  const api = {
    svg, nodes, edges,
    /** Light one node as the current one; earlier ones stay marked as visited. */
    current(id) {
      for (const n of nodes.values()) n.g.classList.toggle('on', n.id === id);
      nodes.get(id)?.g.classList.add('seen');
    },
    /** Glow the edge from → to, then leave it as part of the trail. */
    travel(from, to) {
      for (const e of find(from, to)) {
        e.g.classList.add('hot', 'trail');
        e.path.setAttribute('marker-end', `url(#arrow-hot-${id})`);
        setTimeout(() => { e.g.classList.remove('hot'); e.path.setAttribute('marker-end', `url(#arrow-trail-${id})`); }, 1100);
      }
    },
    /** Light every edge that starts at `id`: what can happen next. */
    options(id) { for (const e of edges) e.g.classList.toggle('opt', e.from === id); },
    badge(id, text) {
      const n = nodes.get(id); n.badge?.remove();
      if (!text) return;
      const b = el('g', { class: 'badge' }, n.g);
      el('rect', { x: n.x + n.w / 2 - 22, y: n.y - n.h / 2 - 10, width: 30, height: 16, rx: 8 }, b);
      el('text', { x: n.x + n.w / 2 - 7, y: n.y - n.h / 2 + 2 }, b).textContent = text;
      n.badge = b;
    },
    reset() {
      for (const n of nodes.values()) n.g.classList.remove('on', 'seen');
      for (const e of edges) { e.g.classList.remove('hot', 'trail', 'opt'); e.path.setAttribute('marker-end', `url(#arrow-${id})`); }
    },
    onClick(fn) { for (const n of nodes.values()) { n.g.addEventListener('click', () => fn(n.id)); n.g.addEventListener('keydown', (ev) => ev.key === 'Enter' && fn(n.id)); } },
  };
  return api;
}
let uid = 0;

const X = (i) => 80 + i * 168;
const W = 136;
/** The spec's states and transitions (docs/specs/core-lifecycle-v1.md). */
export const LIFECYCLE = {
  width: 1180, height: 330,
  nodes: [
    { id: 'QUEUED', x: X(0), y: 120, w: W, label: 'QUEUED' },
    { id: 'DEVELOPING', x: X(1), y: 120, w: W, label: 'DEVELOPING' },
    { id: 'VERIFYING', x: X(2), y: 120, w: W, label: 'VERIFYING' },
    { id: 'STANDARD_REVIEW', x: X(3), y: 120, w: W, label: 'STANDARD\nREVIEW' },
    { id: 'ADVERSARIAL_REVIEW', x: X(4), y: 120, w: W, label: 'ADVERSARIAL\nREVIEW' },
    { id: 'AWAITING_ACCEPTANCE', x: X(5), y: 120, w: W, label: 'AWAITING\nACCEPTANCE' },
    { id: 'ACCEPTED', x: X(6), y: 120, w: W - 20, label: 'ACCEPTED', cls: 'good' },
    { id: 'ESCALATED', x: X(3), y: 280, w: W + 20, label: 'ESCALATED', cls: 'bad' },
    { id: 'CANCELLED', x: X(6), y: 280, w: W - 20, label: 'CANCELLED', cls: 'grey' },
  ],
  edges: [
    { from: 'QUEUED', to: 'DEVELOPING', label: 'claim' },
    { from: 'DEVELOPING', to: 'VERIFYING', label: 'result' },
    { from: 'VERIFYING', to: 'STANDARD_REVIEW', label: 'checks\nPASS' },
    { from: 'STANDARD_REVIEW', to: 'ADVERSARIAL_REVIEW', label: 'PASS' },
    { from: 'ADVERSARIAL_REVIEW', to: 'AWAITING_ACCEPTANCE', label: 'PASS' },
    { from: 'AWAITING_ACCEPTANCE', to: 'ACCEPTED', label: 'accept\nSHA' },
    { from: 'STANDARD_REVIEW', to: 'DEVELOPING', label: '1st FAIL: fix run on the findings', bend: -62, cls: 'fix', dy: -4 },
    { from: 'DEVELOPING', to: 'ESCALATED', label: 'bad result,\ncrash, timeout', bend: 18, cls: 'esc' },
    { from: 'VERIFYING', to: 'ESCALATED', label: 'check FAIL\nor MISSING', bend: 6, cls: 'esc' },
    { from: 'STANDARD_REVIEW', to: 'ESCALATED', label: '2nd FAIL', cls: 'esc' },
    { from: 'ADVERSARIAL_REVIEW', to: 'ESCALATED', label: 'FAIL', bend: -6, cls: 'esc' },
    { from: 'AWAITING_ACCEPTANCE', to: 'ESCALATED', label: 'request\nchanges', bend: -18, cls: 'esc' },
    { from: 'ESCALATED', to: 'CANCELLED', label: 'owner cancels\n(from any open stage too)', cls: 'grey', dy: 18 },
    { from: 'ESCALATED', to: 'QUEUED', label: 'owner opens a child cycle (0,0)', bend: -40, dashed: true, cls: 'child', dy: 22 },
  ],
};
