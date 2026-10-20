// The simulator's world: one hobby repository in a fake Git, the guide's live copies of the
// factory's unexported functions, and the hooks the stage stand-ins (sim-*.js) call when they need
// the reader to decide something. demos/sim.js fills in `world.ui`.
import { Repo, gitFor } from './fakegit.js';
import { defaultWorkflow } from '/src/lifecycle.ts';
import { liveFunction } from '../live.js';

export const REPO = '/home/owner/projects/todo-cli';
export const RUNS = '/var/tmp/software_factory/runs';

const TODO = `// A tiny todo list kept in todos.json.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const FILE = 'todos.json';
export const load = () => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : []);
export const save = (todos) => writeFileSync(FILE, JSON.stringify(todos, null, 2));

export function add(todos, text) {
  return [...todos, { text, done: false }];
}

export function list(todos) {
  return todos.map((t, i) => \`\${i + 1}. [\${t.done ? 'x' : ' '}] \${t.text}\`).join('\\n');
}
`;
const BIN = `#!/usr/bin/env node
import { add, list, load, save } from '../src/todo.js';

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'add') save(add(load(), rest.join(' ')));
else console.log(list(load()));
`;
const TEST = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, list } from '../src/todo.js';

test('add appends an open item', () => {
  assert.deepEqual(add([], 'milk'), [{ text: 'milk', done: false }]);
});
`;

export const FILES = {
  'AGENTS.md': '# todo-cli\n\n- Write the test first. `npm test` must pass.\n- No dependencies.\n',
  'README.md': '# todo-cli\n\n`todo add <text>`, `todo list`.\n',
  'package.json': '{\n  "name": "todo-cli",\n  "type": "module",\n  "bin": { "todo": "bin/todo.js" },\n  "scripts": { "test": "node --test" }\n}\n',
  'bin/todo.js': BIN,
  'src/todo.js': TODO,
  'test/todo.test.js': TEST,
};

export const TICKET = `# 01 — Mark a todo as done

Goal: \`todo done <n>\` marks item n as done, numbered as \`todo list\` prints it (from 1).

Done when:
- \`todo done 2\` marks the second item done; \`todo list\` shows it with [x].
- A number outside the list exits 1 with a message and changes nothing.
- Tests cover both.

Non-goals: undo, deleting items.`;

const doneFn = (body) => TODO.replace('export function list', `${body}\n\nexport function list`);
const binWith = (line) => BIN.replace("import { add, list, load, save }", "import { add, done, list, load, save }")
  .replace("else console.log", `${line}\nelse console.log`);
const testWith = (extra) => TEST.replace('import { add, list }', 'import { add, done, list }') + extra;

/** What a developer might commit. Each is a set of file changes and a commit message. */
export const CHANGES = {
  good: {
    label: 'Correct: 1-based, both bounds checked, tested',
    message: 'Add todo done <n>',
    files: {
      'src/todo.js': doneFn(`export function done(todos, n) {
  if (!Number.isInteger(n) || n < 1 || n > todos.length) throw new RangeError(\`no item \${n}\`);
  return todos.map((t, i) => (i === n - 1 ? { ...t, done: true } : t));
}`),
      'bin/todo.js': binWith(`else if (cmd === 'done') {
  try { save(done(load(), Number(rest[0]))); } catch (err) { console.error(err.message); process.exit(1); }
}`),
      'test/todo.test.js': testWith(`
test('done marks item n, counted from 1', () => {
  assert.equal(done(add(add([], 'a'), 'b'), 2)[1].done, true);
});

test('done refuses a number outside the list', () => {
  for (const n of [0, -1, 3, 1.5]) assert.throws(() => done(add(add([], 'a'), 'b'), n), RangeError);
});
`),
    },
  },
  offByOne: {
    label: 'Buggy: counts from 0, no bounds check (tests still pass)',
    message: 'Add todo done',
    files: {
      'src/todo.js': doneFn(`export function done(todos, n) {
  return todos.map((t, i) => (i === n ? { ...t, done: true } : t));
}`),
      'bin/todo.js': binWith(`else if (cmd === 'done') save(done(load(), Number(rest[0])));`),
      'test/todo.test.js': testWith(`
test('done marks an item', () => {
  assert.equal(done(add(add([], 'a'), 'b'), 1)[1].done, true);
});
`),
    },
  },
  upperOnly: {
    label: 'Half right: 1-based, but only the upper bound is checked',
    message: 'Fix review: count from 1, refuse numbers past the end',
    files: {
      'src/todo.js': doneFn(`export function done(todos, n) {
  if (n > todos.length) throw new RangeError(\`no item \${n}\`);
  return todos.map((t, i) => (i === n - 1 ? { ...t, done: true } : t));
}`),
      'bin/todo.js': binWith(`else if (cmd === 'done') {
  try { save(done(load(), Number(rest[0]))); } catch (err) { console.error(err.message); process.exit(1); }
}`),
      'test/todo.test.js': testWith(`
test('done marks item n, counted from 1', () => {
  assert.equal(done(add(add([], 'a'), 'b'), 2)[1].done, true);
});

test('done refuses a number past the end', () => {
  assert.throws(() => done(add([], 'a'), 2), RangeError);
});
`),
    },
  },
  failingTest: {
    label: 'Broken: a test that does not pass',
    message: 'Add todo done (wip)',
    files: {
      'src/todo.js': doneFn(`export function done(todos, n) {
  return todos.map((t, i) => (i === n - 1 ? { ...t, done: true } : t));
}`),
      'test/todo.test.js': testWith(`
test('done refuses a number outside the list', () => {
  assert.throws(() => done([], 1), RangeError);
});
`),
    },
  },
  nothing: { label: 'Nothing: commit no change at all (an empty commit)', message: 'WIP', files: {} },
};

const D = defaultWorkflow.stages;

/**
 * The workflows the simulator offers. Each passes the real checkWorkflow; the simulator's store
 * refuses one that does not, as the factory's does.
 */
export const WORKFLOWS = {
  default: { label: 'default: the v1 lifecycle', workflow: defaultWorkflow },
  package: {
    label: 'with a stage of its own: npm pack after the reviews',
    workflow: {
      name: 'with-package',
      start: 'DEVELOPING',
      stages: {
        DEVELOPING: D.DEVELOPING,
        VERIFYING: D.VERIFYING,
        STANDARD_REVIEW: D.STANDARD_REVIEW,
        ADVERSARIAL_REVIEW: { ...D.ADVERSARIAL_REVIEW, transitions: { PASS: 'PACKAGE', FAIL: 'ESCALATED' } },
        PACKAGE: { kind: 'command', run: [{ name: 'pack', command: ['npm', 'pack', '--dry-run'] }], transitions: { PASS: 'AWAITING_ACCEPTANCE' } },
        AWAITING_ACCEPTANCE: D.AWAITING_ACCEPTANCE,
      },
    },
  },
  light: {
    label: 'light: one reviewer with three tries, then the owner signs off',
    workflow: {
      name: 'light',
      start: 'DEVELOPING',
      stages: {
        DEVELOPING: D.DEVELOPING,
        VERIFYING: { kind: 'command', transitions: { PASS: 'REVIEW' } },
        REVIEW: {
          kind: 'agent', role: 'reviewer', produces: 'verdict', budget: 3,
          roleText: 'You are the reviewer for the change below. Judge the diff against the ticket and the verification evidence. The current directory is a read-only checkout of the candidate commit.',
          transitions: { PASS: 'SIGN_OFF', FAIL: 'DEVELOPING' },
        },
        SIGN_OFF: { kind: 'human', transitions: { PASS: 'ACCEPTED', FAIL: 'ESCALATED' } },
      },
    },
  },
};

export const repo = new Repo(REPO, FILES, 'todo-cli: add and list');
export const { git, gitStatus, isCommit } = gitFor({ [REPO]: repo });

// The factory's own guard and the reviewer's gatherer, read from src/ when first needed and run
// here against the fake Git. Not exported by their modules, so not importable; see live.js.
const memo = (fn) => { let p; return () => (p ??= fn()); };
export const live = {
  refuse: memo(() => liveFunction('src/developer.ts', 'refuse', { git, gitStatus, isCommit })),
  cut: memo(() => liveFunction('src/review.ts', 'cut')),
  gather: memo(async () => {
    const names = ['DIFF_MAX', 'EVIDENCE_KEEP', 'COMMITS_KEEP', 'COMMIT_FORMAT', 'EVIDENCE_EXTS'];
    const consts = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await liveFunction('src/review.ts', n)])));
    const quoteGit = await liveFunction('src/review.ts', 'quoteGit', { git });
    const { readFileSync } = await import('./node/fs.js');
    const { join } = await import('./node/path.js');
    return liveFunction('src/review.ts', 'gather', { ...consts, cut: await live.cut(), quoteGit, git, readFileSync, join });
  }),
};

export const world = {
  repo, git, live,
  /**
   * Set by demos/sim.js. stage(name, detail) narrates what src/run.ts called; checks(...) asks
   * the reader how each check behaves and resolves to { results: [{ check, behaviour }], dirty }.
   */
  ui: {
    stage() {},
    checks: async (checks) => ({ results: checks.map((check) => ({ check, behaviour: 'pass' })), dirty: false }),
  },
};
