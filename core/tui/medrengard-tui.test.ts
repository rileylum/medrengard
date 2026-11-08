import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { factoryIn, run } from "../cli/fixture.ts";

const tui = join(import.meta.dirname, "medrengard-tui.ts");

/**
 * Opens the TUI on `factory` in a terminal of 30 rows and 90 columns, as the owner would, with
 * `env` added. `until` waits for a text the terminal shows after what earlier waits found, failing
 * once the terminal closes or `within` ms pass.
 */
function open(t: TestContext, factory: string, env: Record<string, string> = {}) {
  const terminal = spawn(
    "script",
    ["-q", "-e", "-c", `stty rows 30 cols 90; exec '${process.execPath}' '${tui}'`, "/dev/null"],
    { cwd: tmpdir(), env: { ...process.env, MEDRENGARD_FACTORY: factory, ...env } },
  );

  let shown = "";
  let read = 0;

  terminal.stdout.on("data", (chunk: Buffer) => {
    shown += chunk.toString();
  });

  let ended = false;

  const closed = once(terminal, "close").then(([status]) => {
    ended = true;

    return Number(status);
  });

  t.after(() => terminal.kill("SIGKILL"));

  return {
    async until(text: string | RegExp, { within = Infinity } = {}) {
      const deadline = Date.now() + within;

      for (;;) {
        const rest = shown.slice(read);
        const found = rest.search(text instanceof RegExp ? text : RegExp.escape(text));

        if (found >= 0) {
          read += found + 1;

          return;
        }

        // A wait that can no longer end fails with what the terminal showed, rather than
        // polling past its test's timeout.
        if (ended || t.signal.aborted || Date.now() > deadline) {
          assert.fail(`The terminal never showed ${text}; it showed ${JSON.stringify(rest)}`);
        }

        await sleep(20);
      }
    },
    type(keys: string) {
      terminal.stdin.write(keys);
    },
    shown: () => shown,
    closed,
  };
}

const enter = "\r";
const down = "\x1b[B";

// Each commission's state, as the CLI reads it from the log.
function stateOf(factory: string, commission: string) {
  return JSON.parse(run(["state", commission, "--json"], factory).stdout);
}

function commission(factory: string, workflow: string, name: string) {
  run(["commission", workflow, name, "--title", "Greet", "--body", "Say hello."], factory);
}

test("the TUI refuses to start without the owner's terminal", async (t) => {
  const { factory } = await factoryIn(t);

  const child = spawn(process.execPath, [tui], {
    env: { ...process.env, MEDRENGARD_FACTORY: factory },
  });

  let stderr = "";

  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const [status] = await once(child, "close");

  assert.equal(status, 1);
  assert.equal(stderr, "The TUI needs the owner's terminal as stdin and stdout.\n");
});

test(
  "home puts what needs the owner first, then what runs, then what waits for run",
  { timeout: 20_000 },
  async (t) => {
    const { directory, factory } = await factoryIn(t);

    commission(factory, "build", "gate");
    run(["advance", "gate"], factory);
    commission(factory, "failing", "broken");
    run(["advance", "broken"], factory);
    commission(factory, "attended", "talk");
    commission(factory, "slow", "queued");
    commission(factory, "build", "done");
    run(["advance", "done"], factory);
    run(
      [
        "decide",
        "done",
        "approve",
        "--subject",
        stateOf(factory, "done").subject,
        "--since",
        String(stateOf(factory, "done").since),
      ],
      factory,
    );

    // An engine of its own runs held, which runs until the test lets it go.
    commission(factory, "held", "busy");

    const engine = spawn(
      process.execPath,
      [join(import.meta.dirname, "../cli/medrengard.ts"), "advance", "busy"],
      { env: { ...process.env, MEDRENGARD_FACTORY: factory } },
    );

    t.after(() => engine.kill("SIGKILL"));

    while (stateOf(factory, "busy").status !== "attempting") {
      await sleep(20);
    }

    const screen = open(t, factory);

    await screen.until("Needs you");
    await screen.until(/gate +awaiting at review/);
    await screen.until(/broken +escalated at build/);
    await screen.until(/talk +ready at greet, to attend/);
    await screen.until("Running");
    await screen.until(/busy +attempting at build/);
    await screen.until("Waiting for run");
    await screen.until(/queued +ready at build/);
    await screen.until("1 finished (f to show)");

    screen.type("f");
    await screen.until(/done +finished by end/);

    screen.type("q");
    assert.equal(await screen.closed, 0);

    await writeFile(join(directory, "held.go"), "");
  },
);

test(
  "the owner decides at a gate from the TUI, bound to the wait they saw",
  { timeout: 20_000 },
  async (t) => {
    const { factory } = await factoryIn(t);

    commission(factory, "build", "gate");
    run(["advance", "gate"], factory);

    const waited = stateOf(factory, "gate");
    const screen = open(t, factory);

    await screen.until(/gate +awaiting/);
    screen.type("d");
    await screen.until("approve");
    await screen.until("abandon");
    screen.type(enter);
    await screen.until("No feedback");
    screen.type(down + enter);
    await screen.until("Feedback:");
    screen.type("Looks good." + enter);
    await screen.until(/Decide approve on gate at review, about \w{8}, with feedback\?/);
    screen.type("y");
    await screen.until("gate: finished by end");
    screen.type("q");
    assert.equal(await screen.closed, 0);

    const record = JSON.parse(run(["show", "gate", "--json"], factory).stdout);

    assert.deepEqual(record.entries.at(-1), {
      entry: "decision",
      step: "review",
      outcome: "approve",
      subject: waited.subject,
      feedback: "Looks good.",
      at: record.entries.at(-1).at,
    });
  },
);

test(
  "a decision the TUI was about to make is refused once the wait it saw has ended",
  { timeout: 20_000 },
  async (t) => {
    const { factory } = await factoryIn(t);

    commission(factory, "failing", "broken");
    run(["advance", "broken"], factory);

    const screen = open(t, factory);

    await screen.until(/broken +escalated/);
    screen.type("d");
    await screen.until("retry");
    screen.type(enter);
    await screen.until("No feedback");
    screen.type(enter);
    await screen.until(/Decide retry on broken at build, about \w{8}\?/);

    // Meanwhile the owner retries it elsewhere, and its step escalates again: a new wait.
    const { subject, since } = stateOf(factory, "broken");

    run(["decide", "broken", "retry", "--subject", subject, "--since", String(since)], factory);
    run(["advance", "broken"], factory);

    const again = stateOf(factory, "broken");

    screen.type("y");
    await screen.until(`has waited since event ${again.since}, not ${since}.`);
    screen.type("q");
    assert.equal(await screen.closed, 0);
    assert.deepEqual(stateOf(factory, "broken"), again);
  },
);

test("the TUI shows a commission as the log records it, live", { timeout: 20_000 }, async (t) => {
  const { factory } = await factoryIn(t);

  const screen = open(t, factory);

  await screen.until("Nothing has been commissioned.");

  // Woken by the log, well before the TUI's own redraw every five seconds.
  commission(factory, "noting", "notes");
  await screen.until(/notes +ready at build/, { within: 3000 });
  screen.type(enter);
  await screen.until(/notes: ready at build/);
  await screen.until(/request +\w{8} +Greet/);

  run(["advance", "notes"], factory);
  await screen.until("Reading the request.", { within: 3000 });
  await screen.until("Writing the reply.");
  await screen.until("notes: awaiting at review");

  screen.type("\x1b");
  await screen.until(/notes +awaiting at review/);
  screen.type("q");
  assert.equal(await screen.closed, 0);
});

test(
  "artifacts and transcripts open in the owner's pager, with a step's controls made visible",
  { timeout: 20_000 },
  async (t) => {
    const { factory } = await factoryIn(t);

    commission(factory, "hostile", "rogue");
    run(["advance", "rogue"], factory);

    const screen = open(t, factory, { PAGER: "cat; echo '[paged]'" });

    await screen.until(/rogue +awaiting/);
    screen.type(enter);
    await screen.until(/rogue: awaiting at review/);

    // The rows: request, the attempt's ending, then the document it claimed.
    screen.type(down + down + enter);
    await screen.until("Body\\u009b\\u202e");
    await screen.until("[paged]");
    await screen.until("Esc back");

    screen.type(down.replace("B", "A") + enter);
    await screen.until("\\u001b]52;c;eA==\\u0007Out");
    await screen.until("[paged]");
    await screen.until("Esc back");

    screen.type("e");
    await screen.until("\\u001b[1AErr");
    await screen.until("[paged]");
    await screen.until("Esc back");

    screen.type("q");
    assert.equal(await screen.closed, 0);

    // Nothing the step wrote reached the terminal as a control: no clipboard write, no C1 CSI.
    for (const control of ["\x1b]52", "\u009b", "\u202e"]) {
      assert.ok(!screen.shown().includes(control), control);
    }
  },
);

test(
  "the owner attends an attended step from the TUI and comes back to it",
  { timeout: 20_000 },
  async (t) => {
    const { factory } = await factoryIn(t);

    commission(factory, "attended", "talk");

    const screen = open(t, factory);

    await screen.until(/talk +ready at greet, to attend/);
    screen.type("a");
    await screen.until("Your name? ");
    screen.type("Riley" + enter);
    await screen.until("hello Riley");
    await screen.until(/talk +awaiting at review/);
    screen.type("q");
    assert.equal(await screen.closed, 0);
    assert.equal(stateOf(factory, "talk").status, "awaiting");
  },
);

test("the owner cancels a running attempt from the TUI", { timeout: 20_000 }, async (t) => {
  const { factory } = await factoryIn(t);

  commission(factory, "held", "busy");

  const engine = spawn(
    process.execPath,
    [join(import.meta.dirname, "../cli/medrengard.ts"), "advance", "busy"],
    { env: { ...process.env, MEDRENGARD_FACTORY: factory } },
  );

  t.after(() => engine.kill("SIGKILL"));

  while (stateOf(factory, "busy").status !== "attempting") {
    await sleep(20);
  }

  const screen = open(t, factory);

  await screen.until(/busy +attempting/);
  screen.type("x");
  await screen.until("Cancel busy's attempt at build?");
  screen.type("y");
  await screen.until(/busy +escalated at build/);
  screen.type("q");
  assert.equal(await screen.closed, 0);
  assert.match(stateOf(factory, "busy").reason, /cancel/i);
});

test("the owner commissions a request written in their editor", { timeout: 20_000 }, async (t) => {
  const { directory, factory } = await factoryIn(t);
  const editor = join(directory, "editor.sh");

  await writeFile(editor, `#!/bin/sh\nprintf 'Say hello to the owner.' > "$1"\n`);
  await chmod(editor, 0o755);

  const screen = open(t, factory, { VISUAL: editor });

  await screen.until("Nothing has been commissioned.");
  screen.type("n");
  await screen.until("Workflow");
  await screen.until("attended");

  // The factory's workflows in the order it lists them: build, then attended.
  screen.type(down + enter);
  await screen.until("Name:");
  screen.type("talk" + enter);
  await screen.until("Title:");
  screen.type("Greet" + enter);
  await screen.until(/talk +ready at greet, to attend/);
  screen.type("q");
  assert.equal(await screen.closed, 0);

  const record = JSON.parse(run(["show", "talk", "--json"], factory).stdout);

  assert.deepEqual(record.request.artifact, {
    kind: "document",
    fields: { title: "Greet" },
    body: "Say hello to the owner.",
  });
});
