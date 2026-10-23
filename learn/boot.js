// Runs before any module on every page (a classic script in <head>). The demos import the
// factory's own modules from src/, which were written for Node: the import map sends their
// node:* imports, and the two modules that need SQLite or a real process, to browser stand-ins
// under shims/. A page with data-sim on this script also swaps the three stage modules for the
// simulator's (shims/sim-*.js), so src/run.ts drives stages the reader plays.
(() => {
  const s = '/learn/shims/';
  const imports = {
    'node:fs': s + 'node/fs.js', 'node:path': s + 'node/path.js', 'node:child_process': s + 'node/child_process.js',
    'node:os': s + 'node/os.js', 'node:crypto': s + 'node/crypto.js',
    '/src/store.ts': s + 'store.js', '/src/runtime/spawn.ts': s + 'spawn.js', '/src/lock.ts': s + 'lock.js',
  };
  if (document.currentScript.hasAttribute('data-sim')) {
    Object.assign(imports, { '/src/developer.ts': s + 'sim-developer.js', '/src/verify.ts': s + 'sim-verify.js', '/src/review.ts': s + 'sim-review.js' });
  }
  const map = document.createElement('script');
  map.type = 'importmap';
  map.textContent = JSON.stringify({ imports });
  document.currentScript.after(map);
  // What src/ reads of `process` at call time. HOME and PATH are a made-up owner's.
  window.process = { env: { PATH: '/usr/local/bin:/usr/bin:/home/owner/.local/bin', LANG: 'en_US.UTF-8', HOME: '/home/owner' }, pid: 4242, argv: ['node', 'src/main.ts'], platform: 'linux' };
  // src/sandbox.ts makes one Buffer at load; nothing in the guide calls the code that uses it.
  window.Buffer ??= { from: (s) => new TextEncoder().encode(s), concat: (bs) => new Uint8Array(bs.flatMap((b) => [...b])) };
  try { document.documentElement.dataset.level = localStorage.getItem('sf.level') ?? '2'; } catch { document.documentElement.dataset.level = '2'; }
})();
