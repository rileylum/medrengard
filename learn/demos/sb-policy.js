// The policy builder. A Policy and the owner's Sandbox go into the real wrap and checkSandbox from
// src/sandbox.ts; the argv that comes out is what the factory would spawn, here on the guide's
// made-up machine (merged /usr, the owner's CLIs under ~/.local). Presets are the policies
// src/verify.ts, src/runtime/cli-adapter.ts and src/developer.ts build.
import { checkSandbox, wrap } from '/src/sandbox.ts';
import { vfs } from '../shims/node/fs.js';
import { esc } from '../live.js';

const RUNS = '/var/tmp/software_factory/runs';
const CYCLE = '7f3c9a10';
const CLONE = `${RUNS}/${CYCLE}`, CHECKOUT = `${RUNS}/${CYCLE}-verify`, TMP = `${RUNS}/run-42-tmp`;
const EVIDENCE = `${RUNS}/evidence/5e1f0c2a9d7b3e4f6a8c1d2e3f4a5b6c7d8e9f01/VERIFYING`, OUTPUT = `${EVIDENCE}/output`;
const HOME = '/home/owner';
vfs.dir(CLONE).dir(CHECKOUT).dir(TMP).dir(OUTPUT).dir(`${HOME}/projects/todo-cli/.git`).file(`${HOME}/.ssh/id_ed25519`, 'secret', 0o600);

const PRESETS = {
  check: { label: 'A check (npm test)', why: 'src/verify.ts#verify: write the checkout and output/, read the stage\'s evidence (the request, the diff), no network unless the stage sets it.',
    p: { cwd: CHECKOUT, write: [CHECKOUT, OUTPUT], read: [EVIDENCE], overlay: [], network: false, env: { SF_REQUEST: `${EVIDENCE}/request.json` } }, cmd: ['npm', 'test'] },
  dev: { label: 'The developer (claude)', why: 'src/runtime/cli-adapter.ts: writes its own clone, reads its binary\'s directory and ~/.claude, has the network to reach the model, and its own /tmp beside the clone on disk.',
    p: { cwd: CLONE, write: [CLONE], read: [`${HOME}/.local/share/claude/versions`, `${HOME}/.claude`, `${HOME}/.claude.json`], overlay: [], network: true, home: HOME, tmp: TMP }, cmd: [`${HOME}/.local/share/claude/versions/2.1.0`, '-p', '--output-format', 'json', '--restricted', '…'] },
  pidev: { label: 'The developer (pi)', why: 'pi takes a lock file in its config directory, so ~/.pi is an overlay: writes succeed inside and are dropped after the run (08-c findings).',
    p: { cwd: CLONE, write: [CLONE], read: [`${HOME}/.local/share/pi/bin`], overlay: [`${HOME}/.pi`], network: true, home: HOME, tmp: TMP }, cmd: [`${HOME}/.local/share/pi/bin/pi`, '-p', '--mode', 'json', '--no-approve', '…'] },
  reviewer: { label: 'A reviewer (claude)', why: 'Same as the developer, except it writes nothing: the checkout is bound read-only, so what it reads stays the commit (08-d).',
    p: { cwd: CHECKOUT, write: [], read: [`${HOME}/.local/share/claude/versions`, CHECKOUT, `${HOME}/.claude`, `${HOME}/.claude.json`], overlay: [], network: true, home: HOME, tmp: TMP }, cmd: [`${HOME}/.local/share/claude/versions/2.1.0`, '-p', '--restricted', '--allowedTools', 'Read', 'Glob', 'Grep'] },
  upload: { label: 'git upload-pack on the clone', why: 'src/developer.ts#land: the one process that reads the clone\'s Git config runs boxed, with the clone read-only and no network, so the developer\'s hooks and config never run as the owner.',
    p: { cwd: CLONE, write: [], read: [CLONE], overlay: [], network: false }, cmd: ['git', 'upload-pack'] },
};

const NOTE = {
  '--die-with-parent': 'if the controller dies, the box dies', '--unshare-all': 'new namespaces for everything: PIDs, mounts, users, network…',
  '--share-net': 'except the network: the model is on the internet', '--new-session': 'cannot type into the owner\'s terminal (TIOCSTI)',
  '--clearenv': 'no inherited variables: the owner\'s tokens stay outside', '--setenv': 'only PATH, HOME, LANG and what the stage sets come back', '--unsetenv': 'every inherited name but the secrets is removed',
  '--proc': 'its own /proc', '--dev': 'a minimal /dev', '--tmpfs': 'an empty /tmp in memory', '--bind': 'read-write', '--ro-bind': 'read-only',
  '--symlink': 'merged /usr: recreated as a link', '--overlay-src': 'overlay lower layer', '--tmp-overlay': 'writes land in a throwaway layer',
  '--remount-ro': 'the root itself is read-only: nothing outside the binds takes writes', '--chdir': 'start here', '--': 'then the command',
};
const ARITY = { '--unsetenv': 1, '--setenv': 2, '--bind': 2, '--ro-bind': 2, '--symlink': 2, '--proc': 1, '--dev': 1, '--tmpfs': 1, '--overlay-src': 1, '--tmp-overlay': 1, '--remount-ro': 1, '--chdir': 1 };

const PROBES = [`${HOME}/.ssh/id_ed25519`, `${HOME}/.claude`, `${HOME}/projects/todo-cli/.git`, '/usr/bin/git', CLONE, CHECKOUT, `${RUNS}/events.sqlite`, '/tmp/scratch', '/run/user/1000/bus'];

export default function mount(el) {
  el.innerHTML = `
    <div class="row"><label>Who runs</label><select class="preset">${Object.entries(PRESETS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select>
      <label>backend</label><select class="backend"><option>bwrap</option><option>none</option></select>
      <label><input type="checkbox" class="net"> network</label></div>
    <p class="small muted why"></p>
    <div class="cols3">
      <div><label>cwd</label><input class="cwd" style="width:100%"><label>write (read-write roots)</label><textarea class="write" rows="3"></textarea></div>
      <div><label>read (read-only roots)</label><textarea class="read" rows="3"></textarea><label>overlay (writes dropped)</label><textarea class="overlay" rows="2"></textarea></div>
      <div><label>home / tmp <span class="dim">(blank: /tmp and a tmpfs)</span></label><input class="home" style="width:100%" placeholder="/tmp"><input class="tmp" style="width:100%;margin-top:4px" placeholder="tmpfs">
        <label>the owner's sandbox.read</label><textarea class="sread" rows="2" placeholder="/opt/toolchain"></textarea></div>
    </div>
    <div class="check-err"></div>
    <div class="cols wide-left">
      <div><h3>The argv <span class="tag real">real wrap()</span></h3><div class="argv"></div></div>
      <div><h3>What the command can see</h3><table class="small seen"></table></div>
    </div>`;
  const $ = (s) => el.querySelector(s);
  const lines = (s) => $(s).value.split('\n').map((x) => x.trim()).filter(Boolean);
  let cmd, env;
  function load(k) {
    const { p, why, cmd: c } = PRESETS[k];
    $('.why').textContent = why; cmd = c; env = p.env;
    $('.cwd').value = p.cwd; $('.write').value = p.write.join('\n'); $('.read').value = p.read.join('\n'); $('.overlay').value = p.overlay.join('\n');
    $('.home').value = p.home ?? ''; $('.tmp').value = p.tmp ?? ''; $('.net').checked = p.network;
    render();
  }
  function render() {
    const sandbox = { backend: $('.backend').value, read: lines('.sread') };
    const policy = { cwd: $('.cwd').value, write: lines('.write'), read: lines('.read'), overlay: lines('.overlay'), network: $('.net').checked, home: $('.home').value || undefined, tmp: $('.tmp').value || undefined, env };
    try { checkSandbox(sandbox); $('.check-err').innerHTML = ''; }
    catch (err) { $('.check-err').innerHTML = `<p class="err">checkSandbox refuses to start: ${esc(err.message)}</p>`; }
    let argv;
    try { argv = wrap(sandbox, policy, cmd[0], cmd.slice(1)); }
    catch (err) { $('.argv').innerHTML = `<p class="err">${esc(err.message)}</p>`; return; }
    const [bin, args] = argv;
    if (bin !== 'bwrap') {
      $('.argv').innerHTML = `<pre class="small wrap">${esc([bin, ...args].join(' '))}</pre><p class="small bad-t">Backend none: the command runs as the owner, unconfined, with everything the owner can reach. Scratch repositories only (A-029).</p>`;
    } else {
      const rows = [];
      for (let i = 0; i < args.length;) {
        const f = args[i];
        if (f === '--') { rows.push(['--', args.slice(i + 1).join(' '), NOTE['--']]); break; }
        const n = ARITY[f] ?? 0;
        rows.push([f, args.slice(i + 1, i + 1 + n).join(' '), NOTE[f] ?? '']);
        i += 1 + n;
      }
      $('.argv').innerHTML = `<pre class="small" style="max-height:440px">bwrap\n${rows.map(([f, a, note]) => `  <b class="${f === '--bind' || f === '--tmp-overlay' ? 'amber-t' : f === '--share-net' ? 'bad-t' : 'cyan-t'}">${esc(f)}</b> ${esc(a)}${note ? `  <span class="c">${esc('# ' + note)}</span>` : ''}`).join('\n')}</pre>`;
    }
    // Visibility from the binds: the deepest mount above a path decides it (later mounts hide earlier ones).
    const mounts = [];
    if (bin === 'bwrap') {
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--bind' || args[i] === '--ro-bind') mounts.push({ at: args[i + 2], mode: args[i] === '--bind' ? 'RW' : 'RO' });
        if (args[i] === '--tmp-overlay') mounts.push({ at: args[i + 1], mode: 'overlay' });
        if (args[i] === '--tmpfs') mounts.push({ at: args[i + 1], mode: 'empty' });
        if (args[i] === '--symlink') mounts.push({ at: args[i + 2], mode: 'RO' });
        if (args[i] === '--') break;
      }
    }
    const see = (p) => {
      if (bin !== 'bwrap') return ['RW', 'everything the owner can'];
      const m = mounts.filter((x) => p === x.at || p.startsWith(x.at.endsWith('/') ? x.at : x.at + '/')).sort((a, b) => b.at.length - a.at.length)[0];
      return m ? [m.mode, m.at] : ['hidden', 'not in the box'];
    };
    const style = { RW: 'FAIL', RO: 'PASS', overlay: 'MISSING', empty: '', hidden: 'good' };
    $('.seen').innerHTML = `<tr><th>path</th><th>inside</th></tr>` + PROBES.map((p) => { const [mode, via] = see(p); return `<tr><td class="mono">${esc(p.replace(HOME, '~'))}</td><td><span class="pill ${style[mode]}">${mode === 'RW' ? 'read-write' : mode === 'RO' ? 'read-only' : mode === 'empty' ? 'fresh, empty' : mode}</span> <span class="dim">${esc(via.replace(HOME, '~'))}</span></td></tr>`; }).join('');
  }
  $('.preset').addEventListener('change', (e) => load(e.target.value));
  el.addEventListener('input', (e) => { if (!e.target.matches('.preset')) render(); });
  load('check');
}
