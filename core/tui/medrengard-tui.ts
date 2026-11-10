/**
 * The owner's terminal UI: what needs them, what runs and what waits, each commission's record as
 * the log grows, and the owner's own calls (decide, cancel, attend, commission) through the
 * engine's methods, as the CLI makes them. It never runs a commission's steps but the one the
 * owner attends: `medrengard run` does, so closing the TUI stops nothing.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitKeypressEvents } from "node:readline";
import { parseArgs } from "node:util";
import type { Entry } from "../src/engine.ts";
import type { CommissionState } from "../src/replay.ts";
import { openFactory } from "../cli/factory.ts";
import { full, line, linesOf, visible, where } from "../cli/readable.ts";

const usage = `Usage: medrengard-tui [--factory <path>]

The factory is --factory <path>, or else MEDRENGARD_FACTORY, as for medrengard.`;

let parsed;

try {
  parsed = parseArgs({ options: { factory: { type: "string" } } });
} catch {
  refuseUsage();
}

const factory = parsed.values.factory ?? process.env.MEDRENGARD_FACTORY;

if (factory === undefined) {
  refuseUsage();
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  process.stderr.write("The TUI needs the owner's terminal as stdin and stdout.\n");
  process.exit(1);
}

let opened;

try {
  opened = await openFactory(factory);
} catch (error) {
  process.stderr.write(`${visible(error instanceof Error ? error.message : String(error))}\n`);
  process.exit(1);
}

const { engine, workflows } = opened;

// A row on a screen: its text, and what Enter (and e, for an attempt's errors) opens from it.
type Row = { text: string; commission?: string; open?: () => string; errors?: () => string };

type Screen = { screen: "home"; finished: boolean } | { screen: "commission"; commission: string };

// What the owner is asked, over the screen: a choice, a line of text, or yes or no.
type Prompt =
  | { prompt: "pick"; title: string; choices: string[]; selected: number; chosen: Then<string> }
  | { prompt: "line"; title: string; text: string; chosen: Then<string> }
  | { prompt: "confirm"; title: string; chosen: () => void }
  | { prompt: "help" };

type Then<T> = (value: T) => void;

const screens: Screen[] = [{ screen: "home", finished: false }];

// The selected row on each screen, by its place among the rows Enter can open.
const selected = new Map<Screen, number>();

let prompt: Prompt | undefined;

// What the last call said, shown until the owner's next key.
let message = "";

// While a pager, an editor or an attended step has the terminal, nothing is drawn.
let suspended = false;

// The time each commission's latest event was written, read on from the log as it grows.
const latest = new Map<string, number>();

// lazy: the whole log is read once at start, and every commission replayed on each draw. Read
// from the log's end and replay only the commissions an event names once a log makes drawing slow.
let position = 0;

function readOn(): void {
  for (const { position: at, commission, event } of engine.events(position)) {
    position = at;

    if (event.at !== undefined) {
      latest.set(commission, event.at);
    }
  }
}

readOn();

// How long ago the commission last changed, or nothing for a log with no times.
function ago(commission: string): string {
  const written = latest.get(commission);

  if (written === undefined) {
    return "";
  }

  const seconds = Math.max(0, Math.floor((Date.now() - written) / 1000));

  const amount =
    seconds < 60
      ? `${seconds} s`
      : seconds < 3600
        ? `${Math.floor(seconds / 60)} min`
        : seconds < 86_400
          ? `${Math.floor(seconds / 3600)} h`
          : `${Math.floor(seconds / 86_400)} d`;

  return `  (${amount})`;
}

function attendable(state: CommissionState): boolean {
  return state.status === "ready" && state.step.kind === "agent" && state.step.attended === true;
}

// Whether a run is advancing work, as the engines registered on the log say: an idle one writes
// no events, so the commissions alone cannot tell. A dead one is no run.
function runRows(): Row[] {
  const running = engine.engines().filter(({ status }) => status !== "dead");

  const rows = running.map(({ host, pid, since, status }) => ({
    text:
      status === "alive"
        ? `run: alive on ${host}, pid ${pid}, since ${new Date(since).toLocaleString()}`
        : `run: on ${host}, pid ${pid}, since ${new Date(since).toLocaleString()}, unknown from this machine`,
  }));

  return [
    ...(rows.length === 0 ? [{ text: "run: not running, so nothing ready advances" }] : rows),
    { text: "" },
  ];
}

function homeRows(finished: boolean): Row[] {
  const listed = engine.commissions();

  if (listed.length === 0) {
    return [...runRows(), { text: "Nothing has been commissioned. n to commission a request." }];
  }

  const needs: Row[] = [];
  const running: Row[] = [];
  const queued: Row[] = [];
  const ended: Row[] = [];
  const unreadable: Row[] = [];

  for (const entry of listed) {
    const { commission } = entry;
    const name = commission.padEnd(16);

    if ("error" in entry) {
      unreadable.push({ text: `${name}unreadable: ${entry.error}`, commission });
      continue;
    }

    const { state } = entry;
    const row = { text: `${name}${at(state)}${ago(commission)}`, commission };

    if (state.status === "finished") {
      ended.push(row);
    } else if (state.status === "attempting") {
      running.push(row);
    } else if (state.status === "ready" && !attendable(state)) {
      queued.push({ ...row, text: `${name}${where(state)}, waits for run${ago(commission)}` });
    } else {
      needs.push(row);

      if (state.status === "escalated") {
        needs.push({ text: `${"".padEnd(16)}${state.reason.split("\n")[0]}` });
      }
    }
  }

  const group = (title: string, rows: Row[]) =>
    rows.length === 0 ? [] : [{ text: title }, ...rows, { text: "" }];

  return [
    ...runRows(),
    ...group("Needs you", needs),
    ...group("Running", running),
    ...group("Waiting for run", queued),
    ...group("Unreadable", unreadable),
    ...(finished
      ? group("Finished", ended)
      : ended.length === 0
        ? []
        : [{ text: `${ended.length} finished (f to show)` }]),
  ];
}

function commissionRows(commission: string): Row[] {
  const { state, request, entries } = engine.record(commission);
  const reason = state.status === "escalated" ? state.reason.split("\n") : [];

  return [
    { text: `${commission}: ${at(state)}` },
    ...reason.map((text, index) => ({ text: index === 0 ? `reason: ${text}` : `        ${text}` })),
    { text: "" },
    {
      text: line("request", request.hash, request.artifact),
      open: () => full(request.hash, request.artifact, null),
    },
    ...entries.flatMap((entry, index) => entryRows(commission, index, entry)),
  ];
}

// An entry's rows: an ended attempt opens its transcript and its errors, each artifact it claimed
// opens in full.
function entryRows(commission: string, index: number, entry: Entry): Row[] {
  return linesOf(index, entry, () => "e").flatMap(([key, text]): Row[] => {
    if (!key.endsWith(":end") || entry.entry !== "attempt" || "running" in entry) {
      return [{ text }];
    }

    const [ending, ...claimed] = text.split("\n");
    const decoded = (bytes: Buffer) => new TextDecoder().decode(bytes);

    return [
      {
        text: ending,
        open: () => decoded(engine.transcript(commission, entry.attempt)),
        errors: () => decoded(engine.errors(commission, entry.attempt)),
      },
      ...claimed.map((text, n) => {
        const { hash, artifact, verifier } = "artifacts" in entry ? entry.artifacts[n] : never();

        return { text, open: () => full(hash, artifact, verifier) };
      }),
    ];
  });
}

function never(): never {
  throw new Error("An attempt that escalated claimed no artifacts.");
}

function rowsOf(screen: Screen): Row[] {
  return screen.screen === "home" ? homeRows(screen.finished) : commissionRows(screen.commission);
}

// The rows Enter acts on: a commission at home, what opens on a commission's screen.
function selectable(screen: Screen, rows: Row[]): Row[] {
  return rows.filter((row) =>
    screen.screen === "home" ? row.commission !== undefined : row.open !== undefined,
  );
}

function current() {
  const screen = screens.at(-1)!;
  const rows = rowsOf(screen);
  const choices = selectable(screen, rows);
  const at = Math.min(selected.get(screen) ?? 0, Math.max(0, choices.length - 1));

  return { screen, rows, row: choices.at(at), at };
}

// Where the commission is, and that the owner is to attend it; the wait a decision names is the
// TUI's to fill in, not the owner's to read.
function at(state: CommissionState): string {
  return `${where(state)}${attendable(state) ? ", to attend" : ""}`;
}

// The keys the screen or the prompt over it takes.
function hints(screen: Screen): string {
  switch (prompt?.prompt) {
    case "pick":
      return "up, down choose  Enter pick  Esc cancel";
    case "line":
      return "Enter done  Esc cancel";
    case "confirm":
      return "y yes  n no  Esc cancel";
    case "help":
      return "any key closes";
    case undefined:
  }

  return screen.screen === "home"
    ? "Enter open  d decide  x cancel  a attend  n new  f finished  ? help  q quit"
    : "Enter open  e errors  d decide  x cancel  a attend  Esc back  ? help  q quit";
}

const help = [
  "Keys",
  "",
  "  up, down, j, k   move",
  "  Enter            open a commission, an artifact or an attempt's transcript",
  "  e                an attempt's errors",
  "  d                decide on what awaits you or has escalated",
  "  x                cancel a running attempt",
  "  a                attend a step that waits for you",
  "  n                commission a request",
  "  f                show or fold the finished commissions",
  "  Esc              back",
  "  q, Ctrl-C        quit",
  "",
  "Any key closes this.",
];

function draw(): void {
  if (suspended) {
    return;
  }

  const width = process.stdout.columns;
  const height = process.stdout.rows;
  const { screen, rows, row } = current();

  const below = promptLines();
  const status = [message, hints(screen)];
  const room = Math.max(1, height - 2 - below.length - status.length);

  // Scrolled so the selected row is in view.
  const index = row === undefined ? 0 : rows.indexOf(row);
  const top = Math.max(0, Math.min(index - Math.floor(room / 2), rows.length - room));

  const shown =
    prompt?.prompt === "help" ? help : rows.slice(top, top + room).map(({ text }) => text);

  const fit = (text: string) => {
    const seen = visible(text);

    return seen.length > width ? `${seen.slice(0, width - 1)}…` : seen;
  };

  const body = shown.map((text, n) => {
    const fitted = fit(text);

    return prompt === undefined && rows[top + n] === row && row !== undefined
      ? `\x1b[7m${fitted}\x1b[0m`
      : fitted;
  });

  const title = screen.screen === "home" ? "Medrengard" : `Medrengard  ${screen.commission}`;

  const lines = [
    `\x1b[1m${fit(title)}\x1b[0m`,
    "",
    ...body,
    ...Array.from({ length: Math.max(0, room - body.length) }, () => ""),
    ...below.map(fit),
    ...status.map(fit),
  ];

  process.stdout.write(`\x1b[H\x1b[2J${lines.join("\r\n")}`);
}

function promptLines(): string[] {
  switch (prompt?.prompt) {
    case undefined:
    case "help":
      return [];
    case "pick": {
      const { title, choices, selected: chosen } = prompt;

      return [title, ...choices.map((choice, n) => `${n === chosen ? "  > " : "    "}${choice}`)];
    }

    case "line":
      return [`${prompt.title}: ${prompt.text}_`];
    case "confirm":
      return [`${prompt.title} (y/n)`];
  }
}

function pick(title: string, choices: string[], then: Then<string>): void {
  prompt = { prompt: "pick", title, choices, selected: 0, chosen: then };
}

function ask(title: string, then: Then<string>): void {
  prompt = { prompt: "line", title, text: "", chosen: then };
}

function confirm(title: string, then: () => void): void {
  prompt = { prompt: "confirm", title, chosen: then };
}

// Runs `call`, saying what it returned, or the engine's refusal, on the status line.
function say(call: () => string): void {
  try {
    message = call();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
}

// The commission the owner is at: the selected one at home, or the one whose screen this is.
function target(): string | undefined {
  const { screen, row } = current();

  return screen.screen === "commission" ? screen.commission : row?.commission;
}

function decide(commission: string): void {
  const state = engine.state(commission);

  if (state.status !== "awaiting" && state.status !== "escalated") {
    message = `${commission} is ${state.status}: there is nothing to decide.`;

    return;
  }

  // The decision names the subject and the wait the owner saw, so the engine refuses it if
  // either has moved on by the time they confirm.
  const { subject, since } = state;
  const step = state.step.name;

  const outcomes =
    state.status === "awaiting"
      ? [...Object.keys(engine.definition(commission).workflow.steps[step].on), "abandon"]
      : ["retry", "abandon"];

  const made = (outcome: string, feedback: string | undefined) => {
    const about = `${commission} at ${step}, about ${subject.slice(0, 8)}`;

    confirm(
      `Decide ${outcome} on ${about}${feedback === undefined ? "" : ", with feedback"}?`,
      () =>
        say(() => {
          const after = engine.decide(commission, { subject, since, outcome, feedback });

          return `${commission}: ${where(after)}`;
        }),
    );
  };

  pick(`Decide on ${commission} at ${step}`, outcomes, (outcome) =>
    pick("Feedback", ["No feedback", "Write a line", "Write it in the editor"], (way) => {
      if (way === "No feedback") {
        made(outcome, undefined);
      } else if (way === "Write a line") {
        ask("Feedback", (text) => made(outcome, text === "" ? undefined : text));
      } else {
        const text = edit();

        made(outcome, text === "" ? undefined : text);
      }
    }),
  );
}

function cancel(commission: string): void {
  const state = engine.state(commission);

  if (state.status !== "attempting") {
    message = `${commission} is ${state.status}: there is no attempt to cancel.`;

    return;
  }

  confirm(`Cancel ${commission}'s attempt at ${state.step.name}?`, () =>
    say(() => {
      engine.cancel(commission);

      return `Asked to cancel ${commission}'s attempt.`;
    }),
  );
}

async function attend(commission: string): Promise<void> {
  if (!attendable(engine.state(commission))) {
    message = `${commission} is not ready at a step for you to attend.`;

    return;
  }

  suspend();

  try {
    message = `${commission}: ${where(await engine.attend(commission))}`;
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  } finally {
    resume();
  }
}

function create(): void {
  pick("Workflow", workflows, (workflow) =>
    ask("Name", (name) =>
      ask("Title", (title) => {
        const body = edit();

        say(() => {
          engine.commission(workflow, { title, body }, { name: name });

          return `${name}: ${where(engine.state(name))}`;
        });
      }),
    ),
  );
}

// The owner's text from their editor, $VISUAL or $EDITOR, on an empty file.
function edit(): string {
  const directory = mkdtempSync(join(tmpdir(), "medrengard-tui-"));
  const file = join(directory, "text.md");

  writeFileSync(file, "");
  suspend();

  try {
    const editor = process.env.VISUAL || process.env.EDITOR || "vi";
    const { status } = spawnSync("sh", ["-c", `${editor} "$1"`, "sh", file], { stdio: "inherit" });

    if (status !== 0) {
      throw new Error(`The editor exited ${status}.`);
    }

    return readFileSync(file, "utf8");
  } finally {
    resume();
    rmSync(directory, { recursive: true, force: true });
  }
}

// Shows `text` in the owner's pager, $PAGER or less, with a step's controls made visible.
function page(text: string): void {
  suspend();

  try {
    spawnSync("sh", ["-c", process.env.PAGER || "less"], {
      input: visible(text),
      stdio: ["pipe", "inherit", "inherit"],
    });
  } finally {
    resume();
  }
}

// Gives the terminal back as the owner's shell left it, for a pager, an editor or a step.
function suspend(): void {
  suspended = true;
  process.stdin.setRawMode(false);
  process.stdin.pause();
  writeSync(1, "\x1b[?25h\x1b[?1049l");
}

function resume(): void {
  writeSync(1, "\x1b[?1049h\x1b[?25l");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  suspended = false;
  draw();
}

function quit(): never {
  stopping.abort();
  process.exit(0);
}

process.on("exit", () => {
  process.stdin.setRawMode(false);
  writeSync(1, "\x1b[?25h\x1b[?1049l");
});

type Key = { name?: string; ctrl?: boolean; sequence?: string };

function answer(text: string | undefined, key: Key): void {
  const asked = prompt!;

  if (key.name === "escape") {
    prompt = undefined;

    return;
  }

  switch (asked.prompt) {
    case "help":
      prompt = undefined;

      return;
    case "confirm":
      if (text === "y" || text === "n") {
        prompt = undefined;

        if (text === "y") {
          asked.chosen();
        }
      }

      return;
    case "pick":
      if (key.name === "up" || key.name === "k") {
        asked.selected = Math.max(0, asked.selected - 1);
      } else if (key.name === "down" || key.name === "j") {
        asked.selected = Math.min(asked.choices.length - 1, asked.selected + 1);
      } else if (key.name === "return") {
        prompt = undefined;
        asked.chosen(asked.choices[asked.selected]);
      }

      return;
    case "line":
      if (key.name === "return") {
        prompt = undefined;
        asked.chosen(asked.text);
      } else if (key.name === "backspace") {
        asked.text = asked.text.slice(0, -1);
      } else if (text !== undefined && !key.ctrl && /^[^\p{Cc}]+$/u.test(text)) {
        asked.text += text;
      }
  }
}

async function press(text: string | undefined, key: Key): Promise<void> {
  if (key.ctrl && key.name === "c") {
    quit();
  }

  if (prompt !== undefined) {
    say(() => {
      answer(text, key);

      return message;
    });

    return;
  }

  message = "";

  const { screen, row, at } = current();
  const choices = selectable(screen, rowsOf(screen)).length;
  const commission = target();

  switch (key.name) {
    case "q":
      quit();
    case "up":
    case "k":
      selected.set(screen, Math.max(0, at - 1));
      break;
    case "down":
    case "j":
      selected.set(screen, Math.min(Math.max(0, choices - 1), at + 1));
      break;
    case "return":
      if (screen.screen === "home" && row?.commission !== undefined) {
        screens.push({ screen: "commission", commission: row.commission });
      } else if (row?.open !== undefined) {
        const open = row.open;

        say(() => {
          page(open());

          return "";
        });
      }

      break;
    case "e":
      if (row?.errors !== undefined) {
        const errors = row.errors;

        say(() => {
          page(errors());

          return "";
        });
      }

      break;
    case "escape":
      if (screens.length > 1) {
        screens.pop();
      }

      break;
    case "f":
      if (screen.screen === "home") {
        screen.finished = !screen.finished;
      }

      break;
    case "n":
      create();
      break;
    default:
      if (text === "?") {
        prompt = { prompt: "help" };
      } else if (commission !== undefined && key.name === "d") {
        decide(commission);
      } else if (commission !== undefined && key.name === "x") {
        cancel(commission);
      } else if (commission !== undefined && key.name === "a") {
        await attend(commission);
      }
  }
}

const stopping = new AbortController();

// The owner's keys one by one, on a screen of the TUI's own that leaves theirs as it was.
emitKeypressEvents(process.stdin);

process.stdin.setRawMode(true);

writeSync(1, "\x1b[?1049h\x1b[?25l");

// One key at a time: an action that hands the terminal over ends before the next key is read.
let pressing = Promise.resolve();

process.stdin.on("keypress", (text: string | undefined, key: Key | undefined) => {
  // A key typed while a pager or editor handed the terminal back arrives as the terminal's
  // cooked mode left it: Enter as a newline.
  const pressed = key?.name === "enter" ? { ...key, name: "return" } : key;

  pressing = pressing.then(async () => {
    await press(text, pressed ?? { sequence: text });
    draw();
  });
});

process.stdout.on("resize", draw);

// Ages move on with no event, so the screen is drawn again now and then.
setInterval(draw, 5000).unref();

draw();

while (!stopping.signal.aborted) {
  await engine.next(position, { signal: stopping.signal });
  readOn();
  draw();
}

function refuseUsage(): never {
  process.stderr.write(`${usage}\n`);
  process.exit(2);
}
