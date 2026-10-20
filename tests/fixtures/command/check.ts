// A command-stage check, as a user would write one: one file, run as a file argument, reading the
// request itself. FAILs when the change adds bad.txt; writes a report to outputDir.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const r = JSON.parse(readFileSync(process.env.SF_REQUEST!, 'utf8'));
const diff = readFileSync(r.diffFile, 'utf8');
writeFileSync(join(r.outputDir, 'report.txt'), `${r.stage} ${r.head}\n`);
// <kit run>/runs/evidence/<head>/<stage>/output: five up is the kit's run folder, which holds outside/.
if (process.argv[2] === 'forge-stage') writeFileSync(join(r.outputDir, '..', 'forged'), 'forged\n');
if (process.argv[2] === 'forge') writeFileSync(join(r.outputDir, '..', '..', '..', '..', '..', 'outside', 'escaped'), 'forged\n');
process.exitCode = diff.includes('+++ b/bad.txt') ? 1 : 0;
