// Finds a definition in a source file by name, for live code on the slides (deck.js), live
// functions in the demos (live.js) and the guide's tests (learn/learn.test.ts).
//
// A reference is `path#name`, `path#a,b`, `path#header` (the comment a file starts with),
// `path#L10-L24` (a line range) or a bare `path` (the whole file). A name is a top-level
// function, class, const, interface or type, or a method inside a class.

export function parseRef(ref) {
  const [path, names] = ref.split('#');
  return { path, names: names ? names.split(',') : [] };
}

const DECL = (name) => new RegExp(
  `^(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function\\*?|class|const|let|interface|type)\\s+${name}\\b` +
  `|^\\s+(?:async\\s+|static\\s+|private\\s+|public\\s+)*${name}\\s*\\(`);

/** { text, line } for the named definition with the comment above it, or { error }. Lines are 1-based. */
export function extract(source, name) {
  const lines = source.split('\n');
  if (name === 'header') {
    let end = 0;
    while (end < lines.length && /^\s*(\/\/|\/\*|\*)/.test(lines[end])) end++;
    return end ? { text: lines.slice(0, end).join('\n'), line: 1 } : { error: 'file has no header comment' };
  }
  const range = name.match(/^L(\d+)(?:-L?(\d+))?$/);
  if (range) {
    const from = Number(range[1]), to = Number(range[2] ?? range[1]);
    if (from < 1 || to > lines.length || to < from) return { error: `lines ${name} out of range` };
    return { text: lines.slice(from - 1, to).join('\n'), line: from };
  }
  const re = DECL(name.replace(/[$]/g, '\\$'));
  const at = lines.findIndex((l) => re.test(l));
  if (at < 0) return { error: `no definition of ${name}` };
  const end = endOf(lines, at, /^(?:export\s+)?type\s/.test(lines[at]));
  let start = at;
  // The comment directly above belongs to the definition: it says why.
  while (start > 0 && /^\s*(\/\/|\/\*\*?|\*)/.test(lines[start - 1])) start--;
  return { text: lines.slice(start, end + 1).join('\n'), line: start + 1, body: lines.slice(at, end + 1).join('\n'), bodyLine: at + 1 };
}

// Last line of the definition starting at `at`: brackets balanced once a `{` opened, or a `;`
// at depth 0 (always the `;` for a type alias, whose members are braces). Skips strings, template literals and comments; regex literals in this codebase hold
// no unbalanced brackets outside character classes, so they are not tracked.
function endOf(lines, at, typeAlias) {
  let depth = 0, opened = false, mode = '';
  for (let i = at; i < lines.length; i++) {
    const l = lines[i];
    let last = '';
    for (let j = 0; j < l.length; j++) {
      const ch = l[j], next = l[j + 1];
      if (mode === '/*') { if (ch === '*' && next === '/') { mode = ''; j++; } continue; }
      if (mode) { if (ch === '\\') j++; else if (ch === mode) mode = ''; continue; }
      if (ch === '/' && next === '/') break;
      if (ch === '/' && next === '*') { mode = '/*'; j++; continue; }
      if (ch === "'" || ch === '"' || ch === '`') { mode = ch; continue; }
      if (ch === '{' || ch === '(' || ch === '[') { depth++; if (ch === '{') opened = true; }
      else if (ch === '}' || ch === ')' || ch === ']') depth--;
      if (ch.trim()) last = ch;
    }
    if (mode === "'" || mode === '"') mode = '';
    if (depth <= 0 && !mode && ((opened && !typeAlias) || last === ';')) return i;
  }
  return lines.length - 1;
}
