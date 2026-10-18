// The working agreement (docs/workflow.md) as a diagram: how a plan row becomes merged code,
// with the review budget's stop points. The same shape as a cycle, run by hand.
import { flow } from '../diagram.js';

const SPEC = {
  width: 1180, height: 300,
  nodes: [
    { id: 'plan', x: 70, y: 70, w: 110, label: 'plan row', cls: 'owner' },
    { id: 'ticket', x: 210, y: 70, w: 120, label: 'tickets\n(Fast | Design)' },
    { id: 'ready', x: 350, y: 70, w: 110, label: 'owner:\n"go" = READY', cls: 'owner' },
    { id: 'tests', x: 490, y: 70, w: 120, label: 'branch +\ntests first' },
    { id: 'owner-test', x: 630, y: 70, w: 120, label: 'owner runs\nnpm test', cls: 'owner' },
    { id: 'std', x: 770, y: 70, w: 120, label: 'standard\nreview ×≤2', cls: 'agent' },
    { id: 'adv', x: 910, y: 70, w: 120, label: 'adversarial\nreview ×1', cls: 'agent' },
    { id: 'merge', x: 1060, y: 70, w: 120, label: 'owner\nmerges PR', cls: 'owner good' },
    { id: 'stop', x: 840, y: 230, w: 220, label: 'owner decides: fix ticket,\npark, or accept the risk', cls: 'bad' },
    { id: 'status', x: 1060, y: 230, w: 130, label: 'STATUS.md +\nticket log' },
  ],
  edges: [
    { from: 'plan', to: 'ticket' }, { from: 'ticket', to: 'ready' }, { from: 'ready', to: 'tests' },
    { from: 'tests', to: 'owner-test', label: 'SHA' }, { from: 'owner-test', to: 'std' }, { from: 'std', to: 'adv', label: 'PASS' },
    { from: 'adv', to: 'merge', label: 'PASS' }, { from: 'merge', to: 'status' },
    { from: 'std', to: 'tests', label: '1st FAIL: one fix', bend: -40, dashed: true, cls: 'fix' },
    { from: 'std', to: 'stop', label: '2nd FAIL', cls: 'esc' }, { from: 'adv', to: 'stop', label: 'FAIL', cls: 'esc' },
  ],
};

export default function mount(el) {
  const d = flow(el, SPEC);
  d.svg.classList.add('labels');
}
