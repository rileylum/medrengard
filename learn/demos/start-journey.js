// An idea's way to a PR, one step at a time, across the three lanes: the owner, the controller
// and the agents. Pictures only; the simulator (sim.html) runs the real thing.
import { flow } from '../diagram.js';

const N = (id, x, lane, label, cls) => ({ id, x, y: [64, 180, 296][lane], w: 116, h: 50, label, cls });
const SPEC = {
  width: 1320, height: 350,
  nodes: [
    N('studio', 70, 0, 'Design Studio\n(not built)', 'owner dim'),
    N('ticket', 200, 0, 'ticket +\njob file', 'owner'), N('open', 330, 1, 'open cycle\nbase SHA', 'ctl'),
    N('dev', 460, 2, 'developer\ncommits', 'agent'), N('land', 590, 1, 'judge the\nclaim', 'ctl'),
    N('verify', 720, 1, 'run checks\nevidence', 'ctl'), N('std', 850, 2, 'standard\nreviewer', 'agent'),
    N('adv', 980, 2, 'adversarial\nreviewer', 'agent'), N('accept', 1110, 0, 'diff, accept\nthe SHA', 'owner'),
    N('merge', 1240, 0, 'merge', 'owner good'),
  ],
  edges: [
    { from: 'studio', to: 'ticket', dashed: true }, { from: 'ticket', to: 'open', label: 'main.ts' }, { from: 'open', to: 'dev', label: 'prompt' },
    { from: 'dev', to: 'land', label: 'claim' }, { from: 'land', to: 'verify', label: 'VERIFYING' },
    { from: 'verify', to: 'std', label: 'PASS' }, { from: 'std', to: 'adv', label: 'PASS' },
    { from: 'adv', to: 'accept', label: 'PASS' }, { from: 'accept', to: 'merge' },
    { from: 'std', to: 'dev', label: 'first FAIL: one fix run', bend: -50, dashed: true, cls: 'fix', dy: 16 },
  ],
};

const STEPS = [
  ['studio', null, '<b class="violet-t">Not built yet.</b> In the design, a <a href="/docs/architecture/source-v0.3.md">Design Studio</a> (source §03) comes first: you and agents frame the problem, explore, prototype if needed, approve a spec and split it into tickets. No plan step builds it. Today you write each ticket by hand, as <a href="workflow.html">the workflow</a> describes.'],
  ['ticket', 'studio', '<b class="violet-t">Owner.</b> You write a ticket: a goal, a "done when" list, constraints. A small job file names the repository, the checks to run and which runtime plays each role. Then <code>node src/main.ts job.json</code>.'],
  ['open', 'ticket', '<b class="amber-t">Controller.</b> It resolves the base commit to a full SHA, opens a <a class="w" href="words.html#cycle">cycle</a> in its event log, and makes a private clone on a new branch <code>sf/&lt;cycle&gt;</code>.'],
  ['dev', 'open', '<b class="cyan-t">Developer agent.</b> Claude Code or pi, inside a sandbox, with only the clone writable. It reads the ticket, changes the code, commits, and ends its reply with a <a class="w" href="words.html#claim">claim</a>: the commit SHA and the files it changed.'],
  ['land', 'dev', '<b class="amber-t">Controller.</b> A claim is not a fact. It fetches the branch and checks: is that SHA the branch tip, does it descend from the base, does it change anything? Only then is it the <a class="w" href="words.html#candidate">candidate</a>.'],
  ['verify', 'land', '<b class="amber-t">Controller.</b> It checks out the candidate fresh, with no <code>.git</code>, and runs the repository\'s declared checks itself, in a sandbox with no network. Output and exit code are stored against the SHA. Any FAIL or MISSING check stops the cycle.'],
  ['std', 'verify', '<b class="cyan-t">Standard reviewer.</b> A fresh agent with read-only access. It gets the ticket, the diff, the instructions and the evidence, never the developer\'s conversation. It returns PASS or FAIL with findings.'],
  ['dev', 'std', '<b class="cyan-t">Fix run.</b> On the first standard FAIL, the developer runs once more on the same branch, given the findings. New commit, new checks, new standard review. A second FAIL stops the cycle and asks you.'],
  ['adv', 'std', '<b class="cyan-t">Adversarial reviewer.</b> Told to break it: bad inputs, odd sequences, states the ticket did not think of. One FAIL here stops the cycle at once.'],
  ['accept', 'adv', '<b class="violet-t">Owner.</b> The cycle waits in AWAITING_ACCEPTANCE. You read the diff and accept the exact SHA the reviews were bound to.'],
  ['merge', 'accept', '<b class="violet-t">Owner.</b> You merge. The factory never merges or deploys by itself.'],
];

export default function mount(el) {
  el.innerHTML = `<div class="row small"><span class="violet-t">■ owner</span><span class="amber-t">■ controller</span><span class="cyan-t">■ agents</span></div>
    <div class="fig"></div><p class="caption lead" style="min-height:5.5em"></p>
    <div class="row"><button class="back">◀ back</button><button class="primary play">▶ play</button><button class="next">next ▶</button><span class="small dim count"></span></div>`;
  const d = flow(el.querySelector('.fig'), SPEC);
  let i = 0, timer;
  const show = () => {
    const [node, from, text] = STEPS[i];
    if (i === 0) d.reset();
    d.current(node);
    if (from) d.travel(from, node);
    el.querySelector('.caption').innerHTML = text;
    el.querySelector('.count').textContent = `step ${i + 1} of ${STEPS.length}`;
  };
  const stop = () => { clearInterval(timer); timer = undefined; el.querySelector('.play').textContent = '▶ play'; };
  el.querySelector('.next').addEventListener('click', () => { stop(); i = (i + 1) % STEPS.length; show(); });
  el.querySelector('.back').addEventListener('click', () => { stop(); i = (i + STEPS.length - 1) % STEPS.length; d.reset(); for (let k = 0; k <= i; k++) d.current(STEPS[k][0]); show(); });
  el.querySelector('.play').addEventListener('click', () => {
    if (timer) return stop();
    el.querySelector('.play').textContent = '❚❚ pause';
    timer = setInterval(() => { i = (i + 1) % STEPS.length; show(); }, 3200);
  });
  d.onClick((id) => { const k = STEPS.findIndex((s) => s[0] === id); if (k >= 0) { stop(); i = k; show(); } });
  show();
}
