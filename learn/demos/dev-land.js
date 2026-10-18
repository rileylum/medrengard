// How a developer's branch comes back: a small flow of src/developer.ts#land.
import { flow } from '../diagram.js';

export default function mount(el) {
  const d = flow(el, {
    width: 1000, height: 250,
    nodes: [
      { id: 'clone', x: 90, y: 70, w: 150, h: 54, label: 'developer\'s clone\nsf/<cycle>', cls: 'agent' },
      { id: 'upload', x: 290, y: 70, w: 150, h: 54, label: 'git upload-pack\nin bwrap, read-only', cls: 'ctl' },
      { id: 'incoming', x: 500, y: 70, w: 170, h: 54, label: 'repository\nrefs/sf/incoming/<cycle>', cls: 'ctl' },
      { id: 'refuse', x: 700, y: 70, w: 130, h: 54, label: 'refuse()\nthe guard', cls: 'ctl' },
      { id: 'branch', x: 900, y: 70, w: 150, h: 54, label: 'refs/heads/\nsf/<cycle> moves', cls: 'good' },
      { id: 'failed', x: 700, y: 200, w: 160, h: 46, label: 'run_failed: reason', cls: 'bad' },
    ],
    edges: [
      { from: 'clone', to: 'upload', label: 'fetch' },
      { from: 'upload', to: 'incoming', label: 'fsckObjects' },
      { from: 'incoming', to: 'refuse', label: 'judge' },
      { from: 'refuse', to: 'branch', label: 'accepted' },
      { from: 'refuse', to: 'failed', label: 'refused' },
    ],
  });
  const steps = [['clone', 'upload'], ['upload', 'incoming'], ['incoming', 'refuse'], ['refuse', 'branch']];
  let i = 0;
  const t = setInterval(() => {
    if (!el.isConnected) return clearInterval(t);
    if (i === 0) d.reset();
    const [a, b] = steps[i];
    d.current(a); d.travel(a, b);
    setTimeout(() => d.current(b), 500);
    i = (i + 1) % steps.length;
  }, 1300);
}
