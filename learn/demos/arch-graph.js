// The module graph of src/, crawled live: every .ts file, every import between them, read from
// the files each time so it cannot go out of date.
import { flow } from '../diagram.js';
import { esc, highlight, list, source } from '../live.js';
import { extract } from '../refs.js';

const ROOM = {
  'lifecycle.ts': 'lifecycle.html', 'store.ts': 'store.html', 'stream.ts': 'store.html#stream', 'controller.ts': 'controller.html', 'adapter.ts': 'controller.html',
  'developer.ts': 'developer.html', 'prompt.ts': 'developer.html#versions', 'verify.ts': 'verify.html', 'review.ts': 'review.html', 'sandbox.ts': 'sandbox.html',
  'run.ts': 'sim.html#loop', 'main.ts': 'start.html#use', 'config.ts': 'config.html', 'git.ts': 'developer.html#landing',
  'runtime/cli-adapter.ts': 'runtimes.html', 'runtime/spawn.ts': 'runtimes.html#spawn', 'runtime/registry.ts': 'runtimes.html#registry',
  'kits/runtime.ts': 'runtimes.html#kits', 'kits/command.ts': 'verify.html#own', 'kits/request.ts': 'verify.html#own', 'kits/observe.ts': 'store.html#stream',
};

async function crawl() {
  const files = [];
  const walk = async (dir) => { for (const n of await list(dir)) n.endsWith('/') ? await walk(dir + '/' + n.slice(0, -1)) : n.endsWith('.ts') && files.push(`${dir}/${n}`); };
  await walk('src');
  const mods = await Promise.all(files.map(async (path) => {
    const text = await source(path);
    const id = path.slice(4);
    const imports = [...text.matchAll(/^import\s+(type\s+)?[^'"]*?from\s+'([^']+)'/gm)]
      .filter((m) => m[2].startsWith('.'))
      .map((m) => ({ to: new URL(m[2], `http://x/${id}`).pathname.slice(1), typeOnly: !!m[1] }));
    const exports = [...text.matchAll(/^export\s+(?:async\s+)?(function|const|class|interface|type)\s+(\w+)/gm)].map((m) => ({ kind: m[1], name: m[2] }));
    return { id, path, text, imports, exports, lines: text.split('\n').length, node: [...text.matchAll(/from 'node:([\w/]+)'/g)].map((m) => m[1]) };
  }));
  return mods;
}

export default async function mount(el) {
  el.innerHTML = '<p class="muted small">Crawling src/ …</p>';
  const mods = await crawl();
  const byId = new Map(mods.map((m) => [m.id, m]));
  // Hand-placed by layer (the owner's entry and the loop, stages, core, outside world on the
  // right, the kits at the bottom) so the picture reads like the layers slide; a module added
  // later lands in the spare row.
  const AT = {
    'main.ts': [110, 60], 'config.ts': [300, 60], 'run.ts': [500, 60], 'stream.ts': [700, 60],
    'developer.ts': [200, 190], 'verify.ts': [450, 190], 'review.ts': [700, 190],
    'adapter.ts': [90, 320], 'controller.ts': [330, 320], 'store.ts': [580, 320], 'prompt.ts': [800, 320],
    'lifecycle.ts': [450, 440], 'git.ts': [800, 440],
    'runtime/registry.ts': [1010, 60], 'runtime/cli-adapter.ts': [1010, 190], 'sandbox.ts': [1010, 320], 'runtime/spawn.ts': [1010, 440],
    'kits/runtime.ts': [200, 570], 'kits/command.ts': [450, 570], 'kits/observe.ts': [700, 570], 'kits/request.ts': [950, 570],
  };
  let spare = 0;
  const height = 620;
  const nodes = mods.map((m) => {
    const [x, y] = AT[m.id] ?? [110 + 160 * spare++, 690];
    return { id: m.id, x, y, w: 156, h: 44, label: `${m.id}\n${m.lines} lines`,
      cls: m.id === 'lifecycle.ts' ? 'ctl' : m.id.startsWith('runtime/') || m.id === 'adapter.ts' ? 'agent' : m.id === 'main.ts' || m.id === 'config.ts' ? 'owner' : m.id.startsWith('kits/') ? 'dim' : '' };
  });
  const edges = mods.flatMap((m) => m.imports.filter((i) => byId.has(i.to)).map((i) => ({ from: m.id, to: i.to, dashed: i.typeOnly })));
  el.innerHTML = `<p class="small muted">${mods.length} modules, ${mods.reduce((s, m) => s + m.lines, 0).toLocaleString()} lines. Solid arrow: imports code. Dashed: imports only types (erased at run time). Click a module.</p><div class="fig"></div><div class="mod card" style="margin-top:10px"><p class="muted small">Click a module to see why it exists and what it exports.</p></div>`;
  const g = flow(el.querySelector('.fig'), { width: 1120, height: spare ? 740 : height, nodes, edges });
  const show = (id) => {
    const m = byId.get(id);
    g.current(id);
    g.options(id);
    const head = extract(m.text, 'header');
    const users = mods.filter((x) => x.imports.some((i) => i.to === id)).map((x) => x.id);
    el.querySelector('.mod').innerHTML = `<div class="row"><b class="mono amber-t">src/${esc(id)}</b><span class="tag live">live</span>${ROOM[id] ? `<a class="portal" href="${ROOM[id]}">its room</a>` : ''}<a href="/src/${esc(id)}?raw" target="_blank" class="small">source</a></div>
      <pre class="wrap small">${head.error ? '(no header comment)' : highlight(head.text)}</pre>
      <div class="cols"><div><h3>Exports</h3><p class="small">${m.exports.map((e) => `<code>${esc(e.name)}</code> <span class="dim">${e.kind}</span>`).join('<br>') || '<span class="dim">none</span>'}</p></div>
      <div><h3>Imports</h3><p class="small">${m.imports.map((i) => `<code>${esc(i.to)}</code>${i.typeOnly ? ' <span class="dim">types</span>' : ''}`).join('<br>') || '<span class="dim">nothing from src/</span>'}${m.node.length ? `<br><span class="dim">node: ${m.node.map(esc).join(', ')}</span>` : ''}</p>
      <h3>Imported by</h3><p class="small">${users.map((u) => `<code>${esc(u)}</code>`).join(' ') || '<span class="dim">no one: an entry point</span>'}</p></div></div>`;
  };
  g.onClick(show);
  show('lifecycle.ts');
}
