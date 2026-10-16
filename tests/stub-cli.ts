// A stub claude or pi for tests that run main.ts offline (08-e). Shared by run.test.ts and main.test.ts.
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A stub claude or pi in its own bin directory. As the developer it commits and claims; as a
 * reviewer it PASSes, except in the role named by `target`, where it names itself, tries to write
 * `outside` and fails the run. Everything is baked in: bwrap clears the environment.
 */
export function reviewerStub(bin: string, cli: 'claude' | 'pi', target: string, outside: string) {
  const reply = cli === 'claude'
    ? `printf '{"type":"result","is_error":false,"result":"%s"}\n' "$esc"`
    : `printf '{"type":"session","id":"s"}\n{"type":"turn_end","message":{"role":"assistant","content":[{"type":"text","text":"%s"}]}}\n{"type":"agent_end"}\n' "$esc"`;
  writeFileSync(join(bin, cli), [
    '#!/bin/sh',
    'p=$(cat)',
    // The claim as a whole JSON object, quotes escaped for the JSON string around it.
    `reply() { esc=$(printf %s "$1" | sed 's/"/\\\\"/g'); ${reply}; }`,
    `case "$p" in *"You are the ${target}"*) echo "stub ${cli} as the ${target}: $(touch ${outside} 2>&1)" >&2; exit 1;; esac`,
    'case "$p" in *"reviewer for the change below"*) h=$(printf %s "$p" | sed -n "s/^Candidate SHA: //p"); reply "{\\"head\\":\\"$h\\",\\"verdict\\":\\"PASS\\",\\"findings\\":[]}"; exit 0;; esac',
    'echo done > done.txt && git add done.txt && git -c user.name=s -c user.email=s@example.invalid commit -qm done',
    'reply "{\\"head\\":\\"$(git rev-parse HEAD)\\",\\"artifacts\\":[\\"done.txt\\"]}"',
    '',
  ].join('\n'));
  chmodSync(join(bin, cli), 0o755);
}
