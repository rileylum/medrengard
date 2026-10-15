// Fake runtime for the cancel test: installs a SIGTERM handler that does nothing, then idles.
process.on('SIGTERM', () => {});
console.log('ready');
setInterval(() => {}, 1000);
