// The flags each runtime gets in each role, read from the real specs in src/runtime/cli-adapter.ts.
import { claude, claudeDeveloper, claudeReviewer, pi, piDeveloper, piReviewer } from '/src/runtime/cli-adapter.ts';
import { esc } from '../live.js';

const WHY = {
  '--restricted': 'Loads no user, project or local settings file: a .claude/settings.json in the repository could add allow rules and hooks (05-b, 06-b).',
  '--strict-mcp-config': 'A .mcp.json in the checkout is the candidate\'s, not the owner\'s (06-c).',
  '--no-approve': 'Project-local .pi files (extensions, skills, settings) belong to the repository and must not load (06-c).',
  '--no-context-files': 'The candidate\'s AGENTS.md reaches the reviewer only quoted in the prompt, never as instructions (06-c, 08-d).',
  '--no-session-persistence': 'Each run is fresh; nothing carries over between runs.',
  '--no-session': 'Each run is fresh; nothing carries over between runs.',
  '--tools': 'Which tools exist at all. Reviewers get read tools only: no shell, so no candidate code runs again as the owner.',
  '--allowedTools': 'Which tool uses need no prompt. Under -p nothing can prompt, so anything else is denied.',
  '--output-format': 'One JSON object on stdout, the result inside.',
  '--mode': 'JSON Lines: one event per line.',
};

export default function mount(el) {
  const wt = '/var/tmp/software_factory/runs/<cycle>';
  const rows = [
    ['claude', 'developer', claudeDeveloper(wt)], ['pi', 'developer', piDeveloper],
    ['claude', 'reviewer', claudeReviewer], ['pi', 'reviewer', piReviewer],
    ['claude', 'base spec (no tools)', claude], ['pi', 'base spec (no tools)', pi],
  ];
  el.innerHTML = `<table class="small"><thead><tr><th>runtime</th><th>role</th><th>argv</th></tr></thead><tbody>${rows.map(([rt, role, spec]) => `
    <tr><td><b>${rt}</b></td><td>${role}</td><td class="argv">${[spec.command, ...spec.args].map((a) => `<code class="${WHY[a] ? 'why' : ''}" ${WHY[a] ? `data-why="${esc(WHY[a])}"` : ''}>${esc(a === '' ? "''" : a)}</code>`).join(' ')}</td></tr>`).join('')}</tbody></table>
    <p class="small explain muted">Click an underlined flag to see why it is there.</p>`;
  el.addEventListener('click', (e) => {
    const c = e.target.closest('code.why');
    if (c) el.querySelector('.explain').innerHTML = `<code>${esc(c.textContent)}</code>: ${esc(c.dataset.why)}`;
  });
}
