// 08-c: stands in for a runtime inside the sandbox. Each argv entry is `label=path`; the fixture
// tries to write the path and reports, per label, `ok` or the error code. The report is the claim,
// in claude's result shape, so the real claude parser reads it. HOME is reported as seen inside.
// A label starting with `read:` reads the path instead and reports its content. One starting with
// `fchmod:` first makes fd 0 writable (the run owns what it was given), then writes the path (11-e).
import { fchmodSync, readFileSync, writeFileSync } from 'node:fs';

const report: Record<string, string> = { HOME: process.env.HOME ?? '' };
for (const arg of process.argv.slice(2)) {
  const [label = '', path = ''] = arg.split('=');
  if (label.startsWith('read:')) { try { report[label] = readFileSync(path, 'utf8'); } catch (err) { report[label] = (err as NodeJS.ErrnoException).code ?? 'error'; } continue; }
  try { if (label.startsWith('fchmod:')) fchmodSync(0, 0o600); writeFileSync(path, 'x\n'); report[label] = 'ok'; } catch (err) { report[label] = (err as NodeJS.ErrnoException).code ?? 'error'; }
}
process.stdin.resume();
process.stdin.on('end', () => {
  const result = `\`\`\`json\n${JSON.stringify(report)}\n\`\`\``;
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 's', result }) + '\n');
});
