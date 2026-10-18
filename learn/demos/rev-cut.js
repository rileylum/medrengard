// How much of a diff reaches the reviewer: the real cut and DIFF_MAX from src/review.ts, run on
// a made-up diff of the chosen size.
import { liveFunction, esc } from '../live.js';

export default async function mount(el) {
  const [cut, DIFF_MAX] = await Promise.all([liveFunction('src/review.ts', 'cut'), liveFunction('src/review.ts', 'DIFF_MAX')]);
  el.innerHTML = `
    <div class="row"><label>Diff size</label><input class="size" type="range" min="10" max="21" step="0.1" value="16" style="width:320px"><b class="mono n"></b></div>
    <div class="bar-out" style="display:flex;height:22px;border-radius:4px;overflow:hidden;border:1px solid var(--line2);margin:0 0 10px"></div>
    <p class="small says"></p>
    <pre class="small wrap out" style="max-height:160px"></pre>`;
  const $ = (s) => el.querySelector(s);
  const line = '+  return todos.map((t, i) => (i === n - 1 ? { ...t, done: true } : t));\n';
  const kib = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MiB` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KiB`);
  function render() {
    const size = Math.round(2 ** Number($('.size').value));
    const text = `diff --git a/src/todo.js b/src/todo.js\n${line.repeat(Math.ceil(size / line.length))}`.slice(0, size);
    const out = cut(text, DIFF_MAX);
    $('.n').textContent = `${kib(size)} (${size.toLocaleString()} characters)`;
    const kept = Math.min(size, 2 * DIFF_MAX);
    $('.bar-out').innerHTML = size <= 2 * DIFF_MAX
      ? '<span style="flex:1;background:#1f5a42"></span>'
      : `<span style="flex:${DIFF_MAX};background:#1f5a42"></span><span style="flex:${size - kept};background:#3a1d1d"></span><span style="flex:${DIFF_MAX};background:#1f5a42"></span>`;
    $('.says').innerHTML = size <= 2 * DIFF_MAX
      ? `The whole diff is quoted. <code>cut</code> keeps up to ${kib(DIFF_MAX)} at each end, so anything up to ${kib(2 * DIFF_MAX)} goes through untouched.`
      : `The reviewer gets the first and last ${kib(DIFF_MAX)}; <b>${(size - kept).toLocaleString()} characters</b> in the middle are replaced by a marker. The path list is never cut, so the reviewer still knows every file that changed, and can Read the rest from the checkout.`;
    const at = out.indexOf('\n[...');
    $('.out').innerHTML = at < 0 ? esc(out.slice(-300)) : `<span class="dim">…${esc(out.slice(at - 120, at))}</span><b class="amber-t">${esc(out.slice(at, out.indexOf('\n', at + 1)))}</b><span class="dim">${esc(out.slice(out.indexOf('\n', at + 1), out.indexOf('\n', at + 1) + 120))}…</span>`;
  }
  $('.size').addEventListener('input', render);
  render();
}
