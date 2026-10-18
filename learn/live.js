// Reading the repository from the page: source as written (for display), source as served
// (types stripped, for running), one function cut out of a file and run with stand-ins for what
// it calls, and a little Markdown for the docs. Needs learn/serve.ts; file:// cannot fetch.
import { extract } from './refs.js';

const cache = new Map();
const get = (url) => {
  if (!cache.has(url)) cache.set(url, fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${url}: ${r.status}`)))));
  return cache.get(url);
};

/** The file as written. */
export const source = (path) => get(`/${path}${path.endsWith('.ts') ? '?raw' : ''}`);
/** A .ts file as the server strips it: the same lines, runnable. */
export const stripped = (path) => get(`/${path}`);
/** Names in a repository directory, directories with a trailing slash. */
export const list = (dir) => get(`/_ls/${dir}`).then(JSON.parse);

/**
 * The function (or const) `name` from `path`, as it is in the file today, evaluated with `deps`
 * in scope for every name it uses that is not a global. Lets a demo run a guard that the module
 * does not export, against a fake Git, without copying it into the guide.
 */
export async function liveFunction(path, name, deps = {}) {
  const js = await stripped(path);
  const found = extract(js, name);
  if (found.error) throw new Error(`${path}#${name}: ${found.error}`);
  const body = found.body.replace(/^export\s+/, '');
  return new Function(...Object.keys(deps), `${body}\nreturn ${name};`)(...Object.values(deps));
}

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const KEYWORDS = new Set(('async await break case catch class const continue default do else export extends finally for from function if import ' +
  'in instanceof interface let new of return static switch throw try type typeof undefined while yield null true false private readonly as').split(' '));

/** HTML for TypeScript, JSON or shell text: comments, strings, keywords, numbers. */
export function highlight(code) {
  let out = '';
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)|\b(\d[\d_]*(?:\.\d+)?)\b|([A-Za-z_$][\w$]*)|([\s\S])/g;
  for (const [, com, str, num, word, other] of code.matchAll(re)) {
    if (com) out += `<span class="c">${esc(com)}</span>`;
    else if (str) out += `<span class="s">${esc(str)}</span>`;
    else if (num) out += `<span class="n">${num}</span>`;
    else if (word) out += KEYWORDS.has(word) ? `<span class="k">${word}</span>` : /^[A-Z][A-Z_]+$/.test(word) ? `<span class="n">${word}</span>` : word;
    else out += esc(other);
  }
  return out;
}

/** Code with line numbers starting at `first`, highlighted. */
export function numbered(code, first = 1) {
  return highlight(code).split('\n').map((l, i) => `<span class="ln">${first + i}</span>${l}`).join('\n');
}

const inline = (s) => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, href) => `<a href="${href.startsWith('http') ? href : '#'}" data-md-link="${esc(href)}">${t}</a>`);

/** The Markdown the docs use: headings, paragraphs, lists, tables, fenced code, quotes. */
export function markdown(text) {
  const lines = text.split('\n'), out = [];
  for (let i = 0; i < lines.length;) {
    const l = lines[i];
    if (/^```/.test(l)) {
      const body = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) body.push(lines[i]);
      i++;
      out.push(`<pre><code>${highlight(body.join('\n'))}</code></pre>`);
    } else if (/^#{1,6} /.test(l)) {
      const n = l.match(/^#+/)[0].length;
      out.push(`<h${Math.min(n + 1, 6)}>${inline(l.slice(n + 1))}</h${Math.min(n + 1, 6)}>`); i++;
    } else if (/^\|/.test(l)) {
      const rows = [];
      for (; i < lines.length && /^\|/.test(lines[i]); i++) rows.push(lines[i]);
      const cells = (r) => r.replace(/^\||\|\s*$/g, '').split(/(?<!\\)\|/).map((c) => c.trim());
      const [head, , ...body] = rows;
      out.push(`<table><thead><tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>` +
        body.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('') + '</tbody></table>');
    } else if (/^\s*([-*]|\d+\.) /.test(l)) {
      const ordered = /^\s*\d+\./.test(l), items = [];
      for (; i < lines.length && /^\s*([-*]|\d+\.) |^\s{2,}\S/.test(lines[i]); i++) {
        if (/^\s*([-*]|\d+\.) /.test(lines[i])) items.push(lines[i].replace(/^\s*([-*]|\d+\.) /, ''));
        else items[items.length - 1] += ' ' + lines[i].trim();
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
    } else if (/^> /.test(l)) {
      const q = [];
      for (; i < lines.length && /^> ?/.test(lines[i]); i++) q.push(lines[i].replace(/^> ?/, ''));
      out.push(`<blockquote>${inline(q.join(' '))}</blockquote>`);
    } else if (l.trim()) {
      const p = [l];
      for (i++; i < lines.length && lines[i].trim() && !/^(#|```|\||\s*[-*] |\s*\d+\. |> )/.test(lines[i]); i++) p.push(lines[i]);
      out.push(`<p>${inline(p.join(' '))}</p>`);
    } else i++;
  }
  return out.join('\n');
}
