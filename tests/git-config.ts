// Git config for every git this process starts while `fn` runs, as if the owner had set it
// globally: git reads GIT_CONFIG_COUNT/KEY_n/VALUE_n on top of every other config file, and the
// owner's real ~/.gitconfig is never touched. Tests in one file run one at a time, so the
// process environment is safe to borrow.
export async function withGitConfig<T>(config: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const entries = Object.entries(config);
  const env: Record<string, string> = { GIT_CONFIG_COUNT: String(entries.length) };
  entries.forEach(([k, v], i) => { env[`GIT_CONFIG_KEY_${i}`] = k; env[`GIT_CONFIG_VALUE_${i}`] = v; });
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(env)) delete process.env[k];
  }
}
