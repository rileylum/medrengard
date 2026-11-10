# The CLI and the TUI

Every command, what it prints, and the owner's terminal UI.

## The CLI

```text
medrengard <command> [--json] [--factory <path>]

  commission <workflow> [<commission>] [--trigger <name>] --title <title> (--body <text> | --body-file <path>)
  check      [<workflow>]
  advance    <commission>
  attend     <commission>
  state      <commission>
  show       <commission>
  watch      <commission>
  events     [--after <position>] [--follow]
  commissions
  engines
  run        [--parallel <n>]
  decide     <commission> <outcome> --subject <hash> --since <event>
             [--feedback <text> | --feedback-file <path>]
  cancel     <commission>
  renew      <trigger>
  accept
  transcript <commission> <attempt>
  errors     <commission> <attempt>
  artifact   <hash or a prefix of at least 8 characters>
  definition <commission>
```

- The factory is `--factory <path>`, or else `MEDRENGARD_FACTORY`. The CLI never guesses one,
  because loading a factory runs its code.
- With `--json`, stdout holds exactly one JSON value: the method's return, `{ "commission": name }` for
  `commission`, or `null` for `cancel` and `renew`. An error goes to stderr as `{"error": "…"}`. Without `--json`, the
  output is for people, not for parsing.
- A call the CLI cannot make says what is wrong with it first, `state takes 1 argument, not 0.`,
  then the usage.
- Exit codes: 0 when the call succeeded, an escalation included; 1 when the engine refused or
  failed; 2 for a usage error.
- `show` prints the commission's record: one line per attempt with what it claimed and how long
  it took, each escalation and each decision with its feedback, then the current subject and every judgement
  about it in full. Each artifact says whether a verifier accepted it, `(verified)`, or its kind has
  none, `(no verifier)`; in full, it names the verifier's command. It is what the owner reads at a
  gate. With `--json` it prints
  `engine.record`, whose times are milliseconds since the epoch. A log written before events
  carried times shows no durations.
- `watch` follows a commission as the log records it: each attempt as it starts, its notes as
  they arrive, its ending, and each escalation and decision. It stops once the commission awaits
  the owner, escalates or finishes; on one that already has, it prints the whole story. `show`
  leaves the notes out. It is woken by each new event, rather than looking every so often.
- `accept` accepts this engine for every commission that escalated because it last ran on
  another: the owner's `retry` on each, printed one per line, `first: ready at build`. Others are
  left as they are.
- `attend` starts the attended step a commission is ready at in the terminal it is run in. See
  [Attended steps](agents.md#attended-steps).
- `events` prints every commission's events after `--after`, 0 if left out, one line each with its
  position; `--follow` then prints each new one as it is written, until stopped. With `--json`,
  each line is one JSON value, `{ position, commission, event }`, for a UI or another observer to
  read.
- `transcript` prints everything an attempt wrote; `errors` prints its stderr alone. Both write the
  bytes unchanged to a file or program, and to a terminal as text with control characters made
  visible, as below.
- Every control character a terminal would act on rather than show (C0 but newline and tab, DEL,
  C1 and the bidi controls) is printed as `\uXXXX`, on stdout and stderr, readable or `--json`. A
  step's text can hold them, and could otherwise move the cursor, rewrite what the owner reads at a
  gate, set the clipboard or reorder a line. In JSON the escape is the same value; the engine's
  record keeps the text as claimed, so a program showing it to people must do the same.
- `artifact` takes a hash, or a unique prefix of at least 8 characters, as `show` prints them, and
  refuses one the log does not name as an artifact. `decide` takes the full hash.
- `definition` prints the definition a commission was commissioned with and runs on: its
  workflow, with each step's access, agent and harness command, and its limits made whole from the
  factory's defaults it recorded; its kinds; and its skills by file hash. It is what a step was
  allowed, whatever the factory says now. With `--json` it prints `engine.definition`.
- `check` checks each of the factory's workflows, or the one named, as `commission` would, skills
  included, and records nothing: `build: ok`, or `build:` and the refusal `commission` would give.
  It exits 1 if any fails, so a hook or CI can run it on every change to a factory. With `--json`
  it prints `{ workflow, error? }[]`; with a workflow named, the definition it would be
  commissioned with, in the shape `definition` prints a commission's, so comparing a factory with
  what a commission runs on is
  `diff <(medrengard definition first --json) <(medrengard check build --json)`.
- `engines` lists the engines registered on the log, oldest first, one line each:
  `alive    <host>  pid <pid>  since <time>`. `run` registers while it runs. On the log's own
  machine an engine is `alive` or `dead`, judged by its process, so a `run` killed without
  stopping shows as `dead` until the next one registers; one on another machine is `unknown`,
  since it can only be asked there.
- `run` advances every ready commission, at most `--parallel` steps at once (1 by default), oldest
  commission first. It prints one line per result, and keeps looking for ready commissions until it
  is stopped. A first Ctrl-C starts nothing new and waits for the running steps, leaving each
  commission ready at its next step; a second exits at once, and each interrupted attempt
  escalates when next advanced. A commission the engine cannot read is left alone, its error printed
  once on stderr; `commissions` lists it as unreadable. A commission ready at an attended step is
  left for the owner, said once. `run` is woken by each new event, and looks at least once a
  second, so it finds an attempt whose engine died.

## The TUI

```text
node medrengard/core/tui/medrengard-tui.ts [--factory <path>]
```

The owner's terminal UI, a default a factory can replace: it calls the engine's methods as the CLI
does, and needs the owner's terminal as stdin and stdout. The factory is found as for the CLI.

- Home lists what needs the owner (awaiting, escalated with its reason, or ready at a step to
  attend), then what is running, then what waits for `run`, each with how long since it last
  changed; finished commissions are folded under `f`. Enter opens a commission's record, which
  grows as the log does.
- On a commission, Enter opens the request, an attempt's transcript or an artifact in full in
  `$PAGER` (`less` if unset), and `e` an attempt's errors, with control characters made visible.
- `d` decides: an outcome, then no feedback, a line, or text from `$VISUAL` or `$EDITOR` (`vi` if
  unset), then a confirmation. The decision names the subject and wait the owner saw when they
  pressed `d`, so the engine refuses it if the commission has moved on.
- `x` cancels a running attempt, `a` attends a step in the same terminal and comes back after,
  `n` commissions a request (workflow, name, title, then the body in the editor), `?` lists the
  keys, `q` quits.
- The TUI never runs steps but the one the owner attends: keep `medrengard run` going beside it.
  Home's first line says whether one is: `run: alive on <host>, pid <pid>, since <time>`, or
  `run: not running`, from the engines registered on the log, looked at every few seconds. A ready
  commission says it waits for `run`, and how long it has.
