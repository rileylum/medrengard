# The guide

An interactive tour of how the factory works, from the big ideas down to the real code. It is modelled on the
[Cube Crawler learning guide](https://mitsuhiko.github.io/dungeon-crawler/learn/) (source: the `learn/` directory of
https://github.com/mitsuhiko/dungeon-crawler). Status: a prototype, not a planned ticket.

## Run it

```sh
npm run learn               # node learn/serve.ts; then open http://127.0.0.1:8077/learn/
node learn/serve.ts 9000    # another port
```

Node 24, no dependencies. The guide needs its server; `file://` cannot fetch the repository. The server binds to
127.0.0.1, serves the repository read-only, and hides `.git` and every dot file.

## How it works

Three ideas carry the whole guide. Keep them if you rebuild it.

1. **The page reads the repository when it opens.** Code, docs and ticket lists on the slides are fetched from the
   server, so they are never copies. `<pre data-code="src/lifecycle.ts#apply">` shows one definition (`refs.js` finds
   it); `<div data-md="docs/plan.md" data-md-section="Next action">` renders a doc or one section.
2. **Demos run the factory's own code in the browser.** The server strips TypeScript types on the fly
   (`node:module` `stripTypeScriptTypes`, strip mode), so a demo imports `/src/run.ts` unchanged. Strip mode keeps
   every line where it was, which is what lets `?raw` (the file as written, for display) and the served file share
   line numbers.
3. **Only I/O is replaced.** `boot.js`, a classic script in `<head>`, writes an import map before any module loads.
   The map sends what cannot run in a browser to stand-ins under `shims/`:

| Module | Stand-in | What it does |
| --- | --- | --- |
| `node:fs`, `node:path`, `node:os`, `node:crypto`, `node:child_process` | `shims/node/*.js` | A made-up machine in memory; no process ever starts |
| `src/store.ts` | `shims/store.js` | The store's rules over an array instead of SQLite; replays through the real `apply` |
| `src/runtime/spawn.ts` | `shims/spawn.js` | Throws if anything tries to spawn |
| `src/developer.ts`, `verify.ts`, `review.ts` (only on pages whose `boot.js` tag has `data-sim`) | `shims/sim-*.js` | The same steps; the clone, checkout and agents are the reader's |

Functions a module does not export (`refuse`, `prompt`, `buildPrompt`, `cut`) are not copied either: `liveFunction`
in `live.js` cuts the definition out of the served file and evaluates it with stand-ins for what it calls.
`shims/fakegit.js` answers the few Git commands those guards run, with Git's outputs and exit codes.
`shims/world.js` holds the simulator's hobby repository, its ticket and the changes a developer can commit.

## Change the guide

### A slide

A room is `<main class="deck">` of `<section class="slide" id="…" data-lv="1|2|3">`. Level 1 is the idea, 2 how it
works, 3 the real code; the reader's level setting hides deeper slides. Within a room go from 1 to 3 and end on a
level 1 takeaway.

- Show code with `data-code`, not a copy. A reference is `path#name`, `path#a,b`, `path#header` (the file's opening
  comment), `path#L10-L24`, or a bare path.
- Link a glossary word with `<a class="w" href="words.html#id">`; add the entry to `words.html` if it is new.
- Plain language: short sentences, a named actor, one idea per paragraph.
- Check every claim against `src/` before writing it. The walkthrough on 2026-10-18 found claims that read well
  and were wrong: a scenario count, and a stage table missing a transition `apply` allows.

### A room

1. Copy an existing room's HTML: `boot.js` in `<head>`, `deck.js` as a module at the end of `<body>`.
2. Add it to `ROOMS` in `rooms.js`, in reading order. The map, the bar and the next-room card read that list.
3. `npm run test:learn` is green: it fails on a room missing from `ROOMS` or a slide without an id and level.

### A demo

1. Write `demos/<name>.js` exporting `default function mount(el)`. Put `<div class="demo" data-demo="<name>">` on
   the slide; add `real` to the class when the demo runs `src/` code.
2. Import the factory from `/src/…` and run it. If it needs something that cannot run in a browser, extend a
   stand-in; add an import-map entry in `boot.js` only for a new module. If it needs an unexported function, use
   `liveFunction('src/file.ts', 'name', deps)`.
3. `deck.js` loads a demo only when it comes within 300 px of the viewport. A demo must not assume another demo
   on the page has started.
4. Check it in a browser (below). `npm run test:learn` checks that the demo file exists and that every stand-in exports
   what the browser code imports from it; it does not run the demo.

### The simulator

`demos/sim.js` is the largest demo: the real `src/run.ts` drives the cycle while the reader, or a script, plays
each agent through `shims/sim-*.js`. Scenarios are `PRESETS` at the top of `sim.js`: per actor, a list of what it
does on its n-th turn. Three modes: *Autopilot* (a script at a chosen speed), *Step through* (the same script,
one *Next* press per action) and *I play the agents*. A card the script plays hides the reader's controls; switching
to *I play the agents* mid-run hands the open card back.

## When you change src/

`npm run test:learn` runs `learn/learn.test.ts`. It fails when a live code reference, a `liveFunction` target, a link,
a demo or a glossary word no longer resolves, or when a stand-in no longer exports a name that browser code imports
from it. These tests are kept out of `npm test` (A-050), so a change to `src/` can break the guide without failing the
factory's tests. Run them after changing `src/` or `learn/`, and fix the page or the stand-in.

Two kinds of drift the tests cannot see:

- **Words around live code.** If you change what a function does, read the slides that show it:
  `grep -rn 'src/<file>' learn/*.html learn/demos/*.js`.
- **Stand-ins that copy rules.** `shims/store.js` and `shims/sim-*.js` repeat their `src/` module's steps by hand.
  Change both together, and prefer `liveFunction` over copying when the logic is a pure function.

## Check it in a browser

- Edited modules can stay cached across navigations: run `location.reload()` after editing a demo.
- Demos start only when scrolled into view, so an offscreen sweep of the page starts none of them.
- The detail level is saved in `localStorage` (`sf.level`); at level 1 or 2 some slides are hidden.
- Smooth scrolling takes about a second; a check that measures position straight after a click reads the old one.
- Look at the result, not only the DOM: column alignment and overlapping diagram labels show only in a screenshot.

## Known gaps

- The workflow room's review badges (`demos/wf-tickets.js`) read outcomes from free-text ticket logs with a regex,
  so they are approximate.
- The sandbox room's "who may touch what" table was written from reading the code and has not been tested.
- In the lifecycle room's diagram, the labels on the arrows into ESCALATED overlap.

## How it was built

One session built the server, the tests, the deck engine, the map and the simulator; three helper agents wrote
eight rooms in parallel and checked their own demos in Chrome. Nobody reviewed the helpers' prose against `src/`
until the owner's walkthrough, which found the errors noted under "A slide". If you rebuild it, build in this
order: the server and its tests, then `refs.js` and `live.js`, then the deck engine, then one room end to end, then
the simulator. Have each room's claims checked against `src/` by someone who did not write it.

## Files

| File | What |
| --- | --- |
| `index.html`, `rooms.js` | The map; the rooms in order |
| `<room>.html` | One room |
| `words.html` | The glossary; `<a class="w">` links show an entry on hover |
| `deck.js` | Bar, levels, contents, live code and docs, demos, tips |
| `boot.js` | Classic script in `<head>`: the import map, `process`, the saved level |
| `diagram.js` | SVG flow diagrams, and the lifecycle laid out once |
| `live.js`, `refs.js` | Reading the repository: source, served code, one definition, Markdown |
| `serve.ts` | The server |
| `demos/*.js` | One module per demo |
| `shims/` | The stand-ins above |
