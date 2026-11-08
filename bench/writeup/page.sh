#!/bin/sh
# The posts as one self-contained web page, charts embedded: page.sh <output.html>. Links between
# posts become links within the page; links into the repository point at its main branch on GitHub.
set -eu
here=$(dirname "$(realpath "$0")")
out=${1:?usage: page.sh <output.html>}
repo=https://github.com/rileylum/medrengard
work=$(mktemp -d "${TMPDIR:-/tmp}/writeup-page-XXXXXX")
trap 'rm -rf "$work"' EXIT

for post in "$here"/posts/0*.md; do
  sed -E \
    -e "1s/^# (.*)$/# \1 {#$(basename "$post" .md)}/" \
    -e 's#\]\((0[0-9]-[a-z-]+)\.md\)#](\#\1)#g' \
    -e "s#\]\(\.\./\.\./\.\./docs/core\.md\)#]($repo/blob/main/docs/core.md)#g" \
    -e "s#\]\(\.\./\.\./published/METHODS\.md\)#]($repo/blob/main/bench/published/METHODS.md)#g" \
    -e "s#\]\(\.\./\.\./published/\)#]($repo/tree/main/bench/published)#g" \
    -e "s#\]\(\.\.\)#]($repo/tree/main/bench/writeup)#g" \
    "$post"
  printf '\n\n'
done >"$work/all.md"

cat >"$work/style.html" <<'EOF'
<style>
  body { max-width: 52rem; margin: 2rem auto; padding: 0 1.25rem; font: 17px/1.6 system-ui, sans-serif; color: #1d1d1f; }
  h1 { font-size: 1.7rem; margin-top: 4rem; padding-top: 1.5rem; border-top: 1px solid #ddd; line-height: 1.25; }
  header h1.title { border: 0; margin-top: 0; font-size: 2rem; }
  h2 { font-size: 1.3rem; margin-top: 2.2rem; }
  h3 { font-size: 1.1rem; }
  img { max-width: 100%; height: auto; display: block; margin: 1.5rem auto; }
  table { border-collapse: collapse; margin: 1.2rem 0; font-size: 0.9rem; display: block; overflow-x: auto; }
  th, td { border: 1px solid #ddd; padding: 0.35rem 0.6rem; text-align: left; vertical-align: top; }
  th { background: #f5f5f7; }
  code { font-size: 0.88em; background: #f5f5f7; padding: 0.1em 0.3em; border-radius: 3px; }
  pre { background: #f5f5f7; padding: 0.8rem 1rem; overflow-x: auto; border-radius: 6px; line-height: 1.4; }
  pre code { background: none; padding: 0; }
  div.sourceCode, pre.sourceCode { background: #f5f5f7 !important; border-radius: 6px; }
  blockquote { margin: 1rem 0; padding: 0.2rem 1rem; border-left: 3px solid #0072B2; color: #444; }
  nav#TOC { background: #f5f5f7; padding: 0.6rem 1.2rem; border-radius: 6px; }
  nav#TOC ul { padding-left: 1.2rem; }
  a { color: #0060a0; }
</style>
EOF

pandoc "$work/all.md" \
  --from gfm+attributes --to html5 --standalone --embed-resources \
  --resource-path "$here/posts" \
  --toc --toc-depth 1 \
  --metadata title="Testing published agent skills on a long-horizon benchmark" \
  --include-in-header "$work/style.html" \
  --output "$out"
