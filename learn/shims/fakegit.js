// A Git repository small enough to hold in a page: commits are a parent, a tree (path to text)
// and a message, refs are names to SHAs. `git` and `gitStatus` answer the handful of commands
// the controller's guards run (src/developer.ts#refuse, src/review.ts#gather), with the
// same output and exit codes as real Git, so those functions can run here unchanged.

// 40 hex characters from five FNV-1a passes with different seeds. Not SHA-1; just stable.
export function sha(text) {
  let out = '';
  for (let seed = 0; seed < 5; seed++) {
    let h = 0x811c9dc5 ^ (seed * 0x9e3779b1);
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    out += h.toString(16).padStart(8, '0');
  }
  return out;
}

export class Repo {
  constructor(path, files, message = 'Initial commit') {
    this.path = path;
    this.commits = new Map();
    this.refs = new Map();
    this.head = 'refs/heads/main';
    this.clock = 0;
    const root = this.write(undefined, files, message);
    this.refs.set('refs/heads/main', root);
  }

  /** A commit with `parent` and the parent's tree plus `changes` (null deletes a path). Returns its SHA. */
  write(parent, changes, message) {
    const tree = { ...(parent ? this.commits.get(parent).tree : {}) };
    for (const [p, c] of Object.entries(changes)) { if (c === null) delete tree[p]; else tree[p] = c; }
    const id = sha(JSON.stringify([parent ?? '', tree, message, ++this.clock]));
    this.commits.set(id, { sha: id, parent, tree, message });
    return id;
  }

  /** Commit on a branch and move it. */
  commit(branch, changes, message) {
    const ref = branch.startsWith('refs/') ? branch : `refs/heads/${branch}`;
    const id = this.write(this.refs.get(ref), changes, message);
    this.refs.set(ref, id);
    return id;
  }

  branch(name, at) { this.refs.set(`refs/heads/${name}`, at); }

  resolve(ref) {
    if (ref === 'HEAD') return this.refs.get(this.head);
    if (/^[0-9a-f]{40}$/.test(ref)) return this.commits.has(ref) ? ref : undefined;
    return this.refs.get(ref) ?? this.refs.get(`refs/heads/${ref}`) ?? [...this.commits.keys()].find((k) => ref.length >= 4 && k.startsWith(ref));
  }

  isAncestor(a, b) {
    for (let c = b; c; c = this.commits.get(c)?.parent) if (c === a) return true;
    return false;
  }

  log(ref) {
    const out = [];
    for (let c = this.resolve(ref); c; c = this.commits.get(c).parent) out.push(this.commits.get(c));
    return out;
  }

  /** `git diff --name-status a b` */
  nameStatus(a, b) {
    const ta = this.commits.get(a).tree, tb = this.commits.get(b).tree;
    return [...new Set([...Object.keys(ta), ...Object.keys(tb)])].sort()
      .filter((p) => ta[p] !== tb[p]).map((p) => `${!(p in ta) ? 'A' : !(p in tb) ? 'D' : 'M'}\t${p}`).join('\n');
  }

  /** `git diff a b`, unified with whole-file hunks: enough for a reviewer to read. */
  diff(a, b) {
    const ta = this.commits.get(a).tree, tb = this.commits.get(b).tree;
    const out = [];
    for (const line of this.nameStatus(a, b).split('\n').filter(Boolean)) {
      const p = line.slice(2);
      const before = p in ta ? ta[p].split('\n') : [], after = p in tb ? tb[p].split('\n') : [];
      out.push(`diff --git a/${p} b/${p}`, p in ta ? `--- a/${p}` : '--- /dev/null', p in tb ? `+++ b/${p}` : '+++ /dev/null');
      out.push(`@@ -1,${before.length} +1,${after.length} @@`, ...lineDiff(before, after));
    }
    return out.join('\n');
  }
}

// Longest-common-subsequence line diff; files here are a few dozen lines.
function lineDiff(a, b) {
  const m = a.length, n = b.length, L = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) { out.push(' ' + a[i]); i++; j++; }
    else if (j < n && (i >= m || L[i][j + 1] >= L[i + 1][j])) out.push('+' + b[j++]);
    else out.push('-' + a[i++]);
  }
  return out;
}

const treeKey = (t) => JSON.stringify(Object.entries(t).sort(([x], [y]) => (x < y ? -1 : 1)));

const fail = (args, msg, status = 128) => Object.assign(new Error(`git ${args.join(' ')} failed: ${msg}`), { status });

/**
 * src/git.ts#git over a Repo: output trimmed, a failure thrown. Answers rev-parse, cat-file -t,
 * ls-tree, show, diff, diff --name-status and log; anything else throws so a demo shows it plainly.
 */
export function gitFor(repos) {
  const repo = (cwd) => repos[cwd] ?? Object.values(repos)[0];
  const git = (cwd, ...args) => {
    const r = repo(cwd), [cmd, ...rest] = args;
    const pos = rest.filter((a) => !a.startsWith('-'));
    if (cmd === 'rev-parse') {
      const ref = pos.at(-1).replace(/\^\{commit\}$/, '');
      const s = r.resolve(ref);
      if (!s) { if (rest.includes('--quiet')) throw fail(args, '', 1); throw fail(args, `fatal: Needed a single revision`); }
      return s;
    }
    if (cmd === 'cat-file') { if (!r.commits.has(pos[0])) throw fail(args, `fatal: Not a valid object name ${pos[0]}`); return 'commit'; }
    if (cmd === 'ls-tree') { const [head, path] = [pos[0], pos.at(-1)]; const t = r.commits.get(head).tree; return path in t ? `100644 blob ${sha(t[path])}\t${path}` : ''; }
    if (cmd === 'show') { const [head, path] = pos[0].split(':'); const t = r.commits.get(r.resolve(head))?.tree; if (!t || !(path in t)) throw fail(args, `fatal: path '${path}' does not exist`); return t[path].trim(); }
    if (cmd === 'diff') {
      const [a, b] = pos.map((x) => r.resolve(x));
      if (!a || !b) throw fail(args, 'fatal: bad revision');
      return (rest.includes('--name-status') ? r.nameStatus(a, b) : r.diff(a, b)).trim();
    }
    if (cmd === 'log') {
      // `log --reverse --format=... base..head`, in src/review.ts's COMMIT_FORMAT: SHA, author, indented message.
      const [a, b] = pos[0].split('..').map((x) => r.resolve(x));
      if (!a || !b) throw fail(args, 'fatal: bad revision');
      const commits = r.log(b).filter((c) => !r.isAncestor(c.sha, a));
      if (rest.includes('--reverse')) commits.reverse();
      return commits.map((c) => `commit ${c.sha}\nAuthor: Developer <developer@example.com>\n\n    ${c.message}`).join('\n\n');
    }
    throw fail(args, 'not simulated in the guide');
  };
  /** Exit status for the commands whose answer is the exit code (merge-base --is-ancestor, diff --quiet). */
  const gitStatus = (cwd, ...args) => {
    const r = repo(cwd), [cmd, ...rest] = args, pos = rest.filter((a) => !a.startsWith('-'));
    const [a, b] = pos.map((x) => r.resolve(x));
    if (!a || !b) return 128;
    if (cmd === 'merge-base') return r.isAncestor(a, b) ? 0 : 1;
    if (cmd === 'diff') return treeKey(r.commits.get(a).tree) === treeKey(r.commits.get(b).tree) ? 0 : 1;
    return 128;
  };
  return { git, gitStatus, isCommit: (cwd, s) => /^[0-9a-f]{40}$/.test(s) && repo(cwd).commits.has(s) };
}
