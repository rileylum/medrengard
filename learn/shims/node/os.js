// node:os for src/ modules running in the browser: a made-up owner.
export const homedir = () => '/home/owner';
export const tmpdir = () => '/tmp';
export const platform = () => 'linux';
export default { homedir, tmpdir, platform };
