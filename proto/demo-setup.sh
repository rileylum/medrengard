#!/bin/sh
# Prototype (A-046): makes a scratch repository and three job files for the board.
# The herdr adapter runs claude unconfined, so the jobs point at this scratch repository only.
# Re-running wipes the demo, its runs and their event store.
set -eu
DEMO=/var/tmp/software_factory/proto
HERE=$(cd "$(dirname "$0")" && pwd)
NODE_DIR=$(dirname "$(dirname "$(readlink -f "$(command -v node)")")")
rm -rf "$DEMO/repo" "$DEMO/jobs" "$DEMO/runs"
mkdir -p "$DEMO/repo" "$DEMO/jobs"

cd "$DEMO/repo"
git init -q -b main
cat > lib.js <<'JS'
export function add(a, b) {
  return a + b;
}
JS
cat > lib.test.js <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add } from './lib.js';

test('add', () => assert.equal(add(2, 3), 5));
JS
echo '{ "type": "module" }' > package.json
printf '# Demo\n\nSmall helpers in lib.js. Tests: `node --test`. Keep each function under ten lines.\n' > AGENTS.md
git add -A && git commit -qm 'demo: initial'

job() {
  # $1 work ID, $2 ticket text
  node -e '
    const [workId, ticket, demo, nodeDir] = process.argv.slice(1);
    console.log(JSON.stringify({
      workId, ticket, repo: demo + "/repo", runsDir: demo + "/runs",
      checks: [{ name: "test", command: ["node", "--test"] }],
      sandbox: { backend: "bwrap", read: [nodeDir] },
    }, null, 2));
  ' "$1" "$2" "$DEMO" "$NODE_DIR" > "$DEMO/jobs/$1.json"
}

job demo-slugify 'Add `slugify(text)` to lib.js: lower case, runs of non-alphanumerics become one hyphen, no leading or trailing hyphen. Add tests to lib.test.js.'
job demo-clamp 'Add `clamp(n, lo, hi)` to lib.js and tests for it in lib.test.js. Throw a RangeError when lo > hi.'
job demo-ask 'Add `formatDate(date)` to lib.js with tests. The output format is not decided: before writing code, ask the owner in this terminal which format they want, and use their answer.'

echo "demo ready: $DEMO/jobs"
echo "inside herdr: node $HERE/board.ts $DEMO/jobs"
