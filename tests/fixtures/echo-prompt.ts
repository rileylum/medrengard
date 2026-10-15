// Fake runtime for the spawn test: reads the prompt from stdin, reports it with the cwd.
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  process.stdout.write(`prompt=${input} cwd=${process.cwd()}\n`);
  process.stderr.write('to stderr\n');
  process.exitCode = 3;
});
