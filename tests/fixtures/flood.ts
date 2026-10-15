// Fake runtime for the size-bound test: writes 64 KB of stdout every 10 ms, ignores SIGTERM.
process.on('SIGTERM', () => {});
const chunk = 'x'.repeat(65536);
setInterval(() => process.stdout.write(chunk), 10);
