// A broken extension runtime for the 10-a kit test: valid JSON, but no RunOutcome.
process.stdin.resume();
process.stdin.on('end', () => process.stdout.write(JSON.stringify({ status: 'weird' })));
