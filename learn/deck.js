// The engine every page loads: the bar, detail levels, the table of contents, live code from
// the repository, live Markdown from docs/, demos (loaded when they scroll into view), glossary
// tips and the map. Pages are plain HTML; see learn/README.md for the markup.
import { ROOMS } from './rooms.js';
import { extract, parseRef } from './refs.js';
import { esc, markdown, numbered, source } from './live.js';

const LEVELS = { 1: 'Idea', 2: 'How it works', 3: 'Real code' };
const page = location.pathname.split('/').pop() || 'index.html';
const at = ROOMS.findIndex((r) => r.file === page);
const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

function setLevel(lv) {
  document.documentElement.dataset.level = lv;
  store.set('sf.level', lv);
  for (const b of document.querySelectorAll('.levels button')) b.classList.toggle('on', b.dataset.lv === String(lv));
}

function bar() {
  const b = document.createElement('nav');
  b.className = 'bar';
  const prev = ROOMS[at - 1], next = ROOMS[at + 1];
  b.innerHTML = `<a class="home" href="index.html">◆ SOFTWARE FACTORY</a>` +
    (at >= 0 ? `<span class="room">${at + 1}/${ROOMS.length} · ${esc(ROOMS[at].title)}</span>` : page === 'words.html' ? '<span class="room">Word book</span>' : '') +
    `<span class="spacer"></span>` +
    (document.querySelector('.slide') ? `<span class="levels" title="How deep to go">${Object.entries(LEVELS).map(([lv, name]) => `<button data-lv="${lv}">${lv} ${name}</button>`).join('')}</span>` : '') +
    `<span class="doors">${prev ? `<a href="${prev.file}" title="${esc(prev.title)}">← prev</a>` : ''}${next ? `<a href="${next.file}" title="${esc(next.title)}">next →</a>` : ''}<a href="words.html">words</a></span>`;
  document.body.prepend(b);
  for (const btn of b.querySelectorAll('.levels button')) btn.addEventListener('click', () => setLevel(btn.dataset.lv));
  setLevel(document.documentElement.dataset.level ?? '2');
}

function rooms() {
  const deck = document.querySelector('main.deck');
  if (!deck) return;
  const layout = document.createElement('div');
  layout.className = 'layout';
  const toc = document.createElement('aside');
  toc.className = 'toc';
  deck.before(layout);
  layout.append(toc, deck);
  const slides = [...deck.querySelectorAll('.slide')];
  for (const s of slides) s.dataset.lvname = `${s.dataset.lv} · ${LEVELS[s.dataset.lv]}`;
  toc.innerHTML = `<p class="title">${at >= 0 ? esc(ROOMS[at].title) : 'On this page'}</p>` +
    slides.map((s) => `<a href="#${s.id}" data-lv="${s.dataset.lv}"><span class="dot l${s.dataset.lv}"></span>${esc(s.querySelector('h2')?.textContent ?? s.id)}</a>`).join('');
  const links = new Map([...toc.querySelectorAll('a')].map((a) => [a.getAttribute('href').slice(1), a]));
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { for (const a of links.values()) a.classList.remove('here'); links.get(e.target.id)?.classList.add('here'); }
  }, { rootMargin: '-30% 0px -60% 0px' });
  slides.forEach((s) => seen.observe(s));
  // A link to a slide deeper than the chosen level opens that level.
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest('a[href^="#"]');
    const s = a && document.getElementById(a.getAttribute('href').slice(1));
    if (s?.dataset.lv && s.dataset.lv > document.documentElement.dataset.level) setLevel(s.dataset.lv);
  });
  const next = ROOMS[at + 1];
  if (at >= 0) {
    const end = document.createElement('section');
    end.className = 'slide end-card';
    end.dataset.lv = '1';
    end.dataset.lvname = '';
    end.innerHTML = `<div class="end"><a href="index.html" class="btn">◆ Back to the map</a>${next ? `<span class="muted small">Next room</span><a class="portal" href="${next.file}">${at + 2}. ${esc(next.title)}</a>` : '<span class="muted">That was the last room.</span>'}</div>`;
    deck.append(end);
    const visited = new Set(JSON.parse(store.get('sf.visited', '[]')));
    visited.add(page);
    store.set('sf.visited', JSON.stringify([...visited]));
  }
}

/** <pre data-code="src/lifecycle.ts#apply"> shows the definition as it is in the file now. */
async function liveCode(pre) {
  const { path, names } = parseRef(pre.dataset.code);
  try {
    const text = await source(path);
    const parts = names.length ? names.map((n) => ({ n, ...extract(text, n) })) : [{ n: '', text, line: 1 }];
    const bad = parts.find((p) => p.error);
    if (bad) throw new Error(bad.error);
    const label = document.createElement('div');
    label.className = 'file';
    label.innerHTML = `<a href="/${path}${path.endsWith('.ts') ? '?raw' : ''}" target="_blank">${esc(path)}</a>${parts.map((p) => p.n ? `<span>${esc(p.n)} · line ${p.line}</span>` : '').join('')}<span class="tag live" title="Read from the repository when the page opened">live</span>`;
    pre.before(label);
    pre.innerHTML = `<code>${parts.map((p) => numbered(p.text, p.line)).join('\n\n')}</code>`;
  } catch (err) {
    pre.innerHTML = `<code class="err">${esc(pre.dataset.code)}: ${esc(err.message)}</code>`;
  }
}

/** <div data-md="docs/plan.md"> renders the doc as it is now. data-md-section picks one heading. */
async function liveMarkdown(div) {
  try {
    let text = await source(div.dataset.md);
    if (div.dataset.mdSection) {
      const re = new RegExp(`^(#+) ${div.dataset.mdSection.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm');
      const m = text.match(re);
      if (m) { const rest = text.slice(m.index + m[0].length); const stop = rest.search(new RegExp(`^#{1,${m[1].length}} `, 'm')); text = stop < 0 ? rest : rest.slice(0, stop); }
    }
    div.innerHTML = `<div class="file"><a href="/${esc(div.dataset.md)}" target="_blank">${esc(div.dataset.md)}</a><span class="tag live">live</span></div>` + markdown(text);
  } catch (err) {
    div.innerHTML = `<p class="err">${esc(err.message)}</p>`;
  }
}

function demos() {
  const start = (el) => {
    if (el.dataset.started) return;
    el.dataset.started = '1';
    import(`./demos/${el.dataset.demo}.js`).then((m) => m.default(el)).catch((err) => {
      el.insertAdjacentHTML('beforeend', `<p class="err">Demo ${esc(el.dataset.demo)} failed: ${esc(err.message)}</p>`);
      console.error(err);
    });
  };
  const io = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && start(e.target)), { rootMargin: '300px' });
  document.querySelectorAll('[data-demo]').forEach((el) => io.observe(el));
}

let words;
function tips() {
  let tip;
  document.addEventListener('mouseover', async (ev) => {
    const a = ev.target.closest('a.w');
    if (!a) return;
    const id = a.getAttribute('href').split('#')[1];
    words ??= fetch('words.html').then((r) => r.text()).then((t) => new DOMParser().parseFromString(t, 'text/html'));
    const entry = (await words).getElementById(id);
    if (!entry || !a.matches(':hover')) return;
    tip?.remove();
    tip = document.createElement('div');
    tip.className = 'tip';
    tip.innerHTML = `<b>${entry.querySelector('dt')?.innerHTML ?? id}</b><div>${entry.querySelector('dd')?.innerHTML ?? ''}</div>`;
    document.body.append(tip);
    const r = a.getBoundingClientRect();
    tip.style.left = `${Math.min(window.scrollX + r.left, window.scrollX + innerWidth - 380)}px`;
    tip.style.top = `${window.scrollY + r.bottom + 6}px`;
    a.addEventListener('mouseleave', () => tip?.remove(), { once: true });
  });
}

function map() {
  const m = document.getElementById('map');
  if (!m) return;
  const visited = new Set(JSON.parse(store.get('sf.visited', '[]')));
  m.innerHTML = ROOMS.map((r, i) => `<a class="station ${r.big ? 'big' : ''} ${visited.has(r.file) ? 'visited' : ''}" href="${r.file}"><span class="n">STATION ${String(i + 1).padStart(2, '0')}</span><h3>${esc(r.title)}</h3><p>${esc(r.blurb)}</p></a>`).join('');
}

bar();
rooms();
map();
document.querySelectorAll('pre[data-code]').forEach(liveCode);
document.querySelectorAll('[data-md]').forEach(liveMarkdown);
demos();
tips();
if (location.hash) requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView());
