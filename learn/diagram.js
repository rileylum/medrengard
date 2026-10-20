// SVG flow diagrams: boxes and curved arrows, with a stage that can be lit, edges that can glow
// as a cycle moves along them, and clicks. `layout` lays out any workflow, for every page that
// draws one.
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
 * { from, to, label, bend (pixels sideways, + is left of the direction of travel), dashed, cls, ax
 * and fx (the x to aim at on the target box, or to leave from on the source), dx (a label offset sideways, set beside the line) }. A spec
 * with `labels` shows every label; otherwise an escalation's label shows on hover or click.
 * Returns controls for the demos.
 */
export function flow(host, spec) {
  const { width, height } = spec;
  const id = uid++;
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, class: `flow ${spec.labels ? 'labels' : ''}`, role: 'img' });
  const defs = el('defs', {}, svg);
  for (const [name, cls] of [['arrow', 'ah'], ['arrow-hot', 'ah hot'], ['arrow-trail', 'ah trail']]) {
    const m = el('marker', { id: `${name}-${id}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
    el('path', { d: 'M0,0 L10,5 L0,10 z', class: cls }, m);
  }
  const nodes = new Map(spec.nodes.map((n) => [n.id, { w: 120, h: 46, ...n }]));
  const edgeLayer = el('g', {}, svg), nodeLayer = el('g', {}, svg);
  const edges = spec.edges.map((e) => {
    const from = nodes.get(e.from), to = nodes.get(e.to);
    // `fx` and `ax`: leave from, or aim at, this x on the box, not its centre, so arrows into or out
    // of a wide box drop straight.
    const a = e.fx === undefined ? from : { ...from, x: e.fx, w: 4 };
    const b = e.ax === undefined ? to : { ...to, x: e.ax, w: 4 };
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const cx = mx + ((b.y - a.y) / len) * (e.bend ?? 0), cy = my - ((b.x - a.x) / len) * (e.bend ?? 0);
    const [x1, y1] = edgePoint(a, cx, cy), [x2, y2] = edgePoint(b, cx, cy);
    const g = el('g', { class: `edge ${e.cls ?? ''} ${e.dashed ? 'dashed' : ''}` }, edgeLayer);
    const path = el('path', { d: `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`, 'marker-end': `url(#arrow-${id})` }, g);
    if (e.label) {
      const lx = 0.25 * x1 + 0.5 * cx + 0.25 * x2 + (e.dx ?? 0), ly = 0.25 * y1 + 0.5 * cy + 0.25 * y2 + (e.dy ?? -6);
      const lines = e.label.split('\n');
      const t = el('text', { x: lx, y: ly - (lines.length - 1) * 6, class: 'elabel', style: e.dx ? 'text-anchor: start' : undefined }, g);
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

/**
 * Any workflow laid out as a flow: QUEUED, then the stages in the order PASS visits them, then
 * ACCEPTED along the top; ESCALATED as a bar underneath, so each stage's arrow into it drops
 * straight down and no two labels meet; CANCELLED at the bottom right. Stages PASS never reaches
 * come after the rest. A FAIL that goes back to an earlier stage arcs over the top.
 */
export function layout(w) {
  const order = [];
  for (let s = w.start; w.stages[s] && !order.includes(s); s = w.stages[s].transitions.PASS) order.push(s);
  for (const s of Object.keys(w.stages)) if (!order.includes(s)) order.push(s);
  const step = 168, W = 136;
  const X = (i) => 80 + i * step;
  const label = (s) => s.replace(/_/, '\n');
  const nodes = [
    { id: 'QUEUED', x: X(0), y: 120, w: W, label: 'QUEUED' },
    ...order.map((s, i) => ({ id: s, x: X(i + 1), y: 120, w: W, label: label(s), cls: `kind-${w.stages[s].kind}`, title: `${w.stages[s].kind} stage` })),
    { id: 'ACCEPTED', x: X(order.length + 1), y: 120, w: W - 20, label: 'ACCEPTED', cls: 'good' },
  ];
  const left = X(1) - W / 2, right = X(order.length) + W / 2;
  nodes.push({ id: 'ESCALATED', x: (left + right) / 2, y: 290, w: right - left, h: 40, label: 'ESCALATED', cls: 'bad' });
  nodes.push({ id: 'CANCELLED', x: X(order.length + 1), y: 290, w: W - 20, h: 40, label: 'CANCELLED', cls: 'grey' });
  const at = (s) => nodes.find((n) => n.id === s).x;
  const passLabel = { agent: (d) => (d.produces === 'commit' ? 'result' : 'PASS'), command: () => 'checks\nPASS', human: () => 'accept\nSHA' };
  const edges = [{ from: 'QUEUED', to: w.start, label: 'claim' }];
  for (const s of order) {
    const d = w.stages[s];
    edges.push({ from: s, to: d.transitions.PASS, label: passLabel[d.kind](d) });
    const fail = d.transitions.FAIL;
    const back = fail !== undefined && fail !== 'ESCALATED' && w.stages[fail];
    if (back) {
      const span = Math.abs(order.indexOf(s) - order.indexOf(fail));
      edges.push({ from: s, to: fail, label: `FAIL${d.budget ? ` (budget ${d.budget})` : ''}`, bend: -40 - 22 * span, cls: 'fix', dy: -4 });
    } else if (fail === 'CANCELLED' || fail === 'ACCEPTED') {
      edges.push({ from: s, to: fail, label: 'FAIL', cls: 'esc' });
    }
    // Every stage escalates on what it cannot classify; the label names the usual reason.
    const why = d.kind === 'human' ? 'request\nchanges' : d.kind === 'command' ? 'FAIL or\nMISSING'
      : d.produces === 'commit' ? 'no usable\nclaim' : back ? 'FAIL at\nlimit' : 'FAIL';
    edges.push({ from: s, to: 'ESCALATED', ax: at(s), label: why, cls: 'esc', dy: 4, dx: 6 });
  }
  edges.push({ from: 'ESCALATED', to: 'CANCELLED', label: 'owner cancels\n(from any open stage too)', cls: 'grey', dy: 36 });
  edges.push({ from: 'ESCALATED', to: 'QUEUED', fx: left + 8, label: 'owner opens\na child cycle', bend: 30, dashed: true, cls: 'child', dy: 10 });
  // Every label shows: the arrows into ESCALATED drop straight, so their labels cannot meet.
  return { width: X(order.length + 1) + 80, height: 350, nodes, edges, order, labels: true };
}
