// An idea's way to a PR under the default workflow, in one picture with three lanes: the owner,
// the controller and the agents. Point at a box for who acts there. Pictures only; the simulator
// (sim.html) runs the real thing, so nothing here steps.
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
    { from: 'dev', to: 'land', label: 'claim' }, { from: 'land', to: 'verify', label: 'candidate' },
    { from: 'verify', to: 'std', label: 'PASS' }, { from: 'std', to: 'adv', label: 'PASS' },
    { from: 'adv', to: 'accept', label: 'PASS' }, { from: 'accept', to: 'merge' },
    { from: 'std', to: 'dev', label: 'FAIL: a fix run', bend: -50, dashed: true, cls: 'fix', dy: 16 },
  ],
};

const TIPS = {
  studio: '<b class="violet-t">Not built.</b> The design puts a <a href="/docs/architecture/source-v0.3.md">Design Studio</a> first (source §03), where ideas become approved tickets. No plan row builds it; today you write each ticket by hand.',
  ticket: '<b class="violet-t">You</b> write a ticket and a small job file, then run <code>node src/main.ts job.json</code>. The job may name another workflow; this picture is the default one.',
  open: '<b class="amber-t">The controller</b> resolves the base to a full SHA, opens a <a class="w" href="words.html#cycle">cycle</a> in its event log, and makes a private clone on the branch <code>sf/&lt;cycle&gt;</code>.',
  dev: '<b class="cyan-t">A developer agent</b>, in a sandbox where only its clone is writable, changes the code, commits, and ends its reply with a <a class="w" href="words.html#claim">claim</a>. It never runs the official checks.',
  land: '<b class="amber-t">The controller</b> fetches the branch and judges the claim itself. Only a new commit at the branch tip becomes the <a class="w" href="words.html#candidate">candidate</a>.',
  verify: '<b class="amber-t">The controller</b> runs the checks on a fresh checkout of the candidate and stores the output against its SHA. It never takes the developer\'s word for a test run.',
  std: '<b class="cyan-t">A standard reviewer</b> reads the ticket, the diff and the evidence, never the developer\'s conversation, and returns PASS or FAIL. Its first FAIL sends the findings back for a fix run; a second stops the cycle.',
  adv: '<b class="cyan-t">An adversarial reviewer</b> is told to break the change. Its FAIL stops the cycle and asks you.',
  accept: '<b class="violet-t">You</b> read the diff and accept the exact SHA the reviews were bound to. The default workflow ends at this human stage.',
  merge: '<b class="violet-t">You</b> merge. The factory prints the merge line; it does not run it.',
};

export default function mount(el) {
  el.innerHTML = `<div class="row small"><span class="violet-t">■ owner</span><span class="amber-t">■ controller</span><span class="cyan-t">■ agents</span></div>
    <div class="fig"></div><p class="caption lead" style="min-height:4.2em"><span class="dim">Point at a box.</span></p>`;
  const d = flow(el.querySelector('.fig'), SPEC);
  const show = (id) => { d.current(id); el.querySelector('.caption').innerHTML = TIPS[id]; };
  for (const n of d.nodes.values()) {
    n.g.addEventListener('mouseenter', () => show(n.id));
    n.g.addEventListener('focus', () => show(n.id));
  }
  d.onClick(show);
}
