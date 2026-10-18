// node:crypto for src/ modules running in the browser.
export const randomUUID = () => crypto.randomUUID();
export function randomBytes(n) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return { toString: (enc) => enc === 'hex' ? [...b].map((x) => x.toString(16).padStart(2, '0')).join('') : String(b) };
}
export default { randomUUID, randomBytes };
