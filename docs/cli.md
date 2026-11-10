# The CLI and the TUI

Every command, what it prints and when it refuses, and the owner's terminal UI.

The words used here (commission, attempt, subject, wait and the rest) are defined in
[`core.md`](core.md). Each command calls the engine method of the same name;
[`engine.md`](engine.md) documents the methods, the JSON shapes and the refusals in full.

## The CLI

The CLI is `core/cli/medrengard.ts`, run by Node. The examples call it `medrengard`:

```sh
alias medrengard="node node_modules/@medrengard/core/cli/medrengard.ts"
```

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

### Global options

- `--factory <path>` names the factory's module. Without it, the CLI reads `MEDRENGARD_FACTORY`.
  The CLI never guesses a factory, because loading one runs its code.
- `--json` prints each result as one JSON value on one line. Without it, the output is for people,
  not for parsing.

The factory's module must default-export `{ log, kinds, workflows, defaults }`, and may add
`triggers`. A missing or extra key is refused:
`Factory <path> must default-export { log, kinds, workflows, defaults } and any triggers: missing defaults.`
A relative `log` is resolved against the module's directory, and the log's directory is created
if it is missing.

### Output and exit codes

| Exit | When                                                                       |
| ---- | -------------------------------------------------------------------------- |
| 0    | The call succeeded. A commission that escalated is a success.              |
| 1    | The engine refused the call or failed, or the factory could not be loaded. |
| 2    | Usage error: the call cannot be made as written.                           |

- A result goes to stdout. With `--json`, a command prints one value; `events` and `run` print one
  value per line.
- A refused or failed call prints the engine's message on stderr, nothing on stdout, and exits 1.
  With `--json` the message is `{"error":"…"}`. Only `check` differs: it prints its results on
  stdout and then exits 1.

  ```text
  $ medrengard state nope
  There is no commission named nope.
  $ medrengard state nope --json
  {"error":"There is no commission named nope."}
  ```

- An exit 2 prints what is wrong on stderr, then a blank line, then the usage. It is never JSON:

  ```text
  $ medrengard state
  state takes 1 argument, not 0.

  Usage: medrengard <command> [--json] [--factory <path>]
  …
  ```

  The usage errors: no command, `No command was given.`; an unknown one,
  `There is no command launch.`; the wrong number of arguments; an option the command does not
  take, `state does not take --parallel.`; an unknown option; and no factory,
  `No factory was given: pass --factory <path> or set MEDRENGARD_FACTORY.`

- Every control character a terminal would act on is printed as `\uXXXX`: the C0 controls but
  newline and tab, DEL, the C1 controls and the bidi controls. This holds for stdout and stderr,
  with or without `--json`. A step's text can hold them, and could otherwise move the cursor,
  rewrite what the owner reads, set the clipboard or reorder a line. In JSON the escape parses to
  the same character. The engine's record keeps the text as claimed, so another program that shows
  it to people must do the same.

A state prints for people as one line, and more when there is more to say:

```text
awaiting at approve since event 3, about 3b662a273f4a51598a69a7d2f80993fb424d31a05ba93364cabfb140583edfc0
```

```text
escalated at build since event 2, about a7a0f25bf3d05c522febd84728e6e92623c491840d88523c76d297493cedb957
cause: exit
reason: Step build exited with code 3.
```

- The first line is the status, the step and the subject's hash. `since event <n>` is there for a
  commission that is awaiting or escalated: `<n>` is what `decide --since` takes. A commission
  ready at an attended step says `ready at <step>, to attend`. A finished one prints only
  `finished by end`, `finished by abandoned` or `finished by withdrawn`.
- `cause:` and `reason:` follow for an escalated commission.
- `decision: <hash>` follows when the owner has decided about the subject.

With `--json`, a state is the engine's `CommissionState`:

```json
{
  "status": "awaiting",
  "step": { "name": "approve", "kind": "approval" },
  "subject": "3b66…",
  "since": 3,
  "outcomes": ["accept", "changes", "abandon"]
}
```

## Starting and running

### `commission`

```text
medrengard commission <workflow> [<commission>] [--trigger <name>] --title <title> (--body <text> | --body-file <path>)
```

Starts a commission of the workflow, named `<commission>`, about the request the title and body
make. With `--trigger`, the trigger starts it within its caps, and the name may be left out: the
commission is then named `<trigger>-<n>`. Nothing is attempted until `advance` or `run`.

- Prints the commission's name: `nightly-1`.
- `--json`: `{"commission":"nightly-1"}`.
- Exits 1 when the workflow is unknown or its definition invalid, the request breaks the document
  kind's limits, the name is taken, there is neither a name nor a trigger, or the trigger is past
  a cap: `Trigger nightly started 1 commission in the last 3600 s, its rate.`
- Exits 2 without `--title`, without a body, or with both `--body` and `--body-file`.

### `check`

```text
medrengard check [<workflow>]
```

Checks each of the factory's workflows, or the one named, as `commission` would, skills included.
It records nothing.

- Prints one line per workflow: `greet: ok`, or the refusal, `nope: There is no workflow named nope.`
- `--json`, with no workflow named: `[{"workflow":"greet"},{"workflow":"nope","error":"…"}]`.
- `--json`, with a workflow named: the definition it would be commissioned with, in the shape
  `definition` prints. So this compares a factory with what a commission runs on:

  ```sh
  diff <(medrengard definition first --json) <(medrengard check greet --json)
  ```

- Exits 1 if any workflow fails, so a hook or CI can call it on every change to a factory.

### `advance`

```text
medrengard advance <commission>
```

Attempts the commission's ready steps, one after another, until it awaits the owner, escalates or
finishes, or is ready at an attended step.

- Prints the state it stopped at.
- `--json`: the state.
- Exits 0 when the commission escalated. Exits 1 for an unknown commission.

### `attend`

```text
medrengard attend <commission>
```

Starts the attended step the commission is ready at, in the terminal you call it from, and returns
once that attempt ends. [`agents.md`](agents.md) describes attended steps.

- Prints the state after the attempt.
- `--json`: the state.
- Exits 1 when stdin or stdout is not a terminal,
  `Attending a step needs the owner's terminal as stdin and stdout.`, or
  `Commission <commission> is not ready at an attended step.`

### `run`

```text
medrengard run [--parallel <n>]
```

Advances every commission that is ready or attempting, oldest first, and keeps looking until you
stop it. At most `--parallel` ready commissions are advanced at once, 1 by default, so at most
that many steps start at once. It is woken by each
new event, and looks at least once a second, so it finds an attempt whose engine died. It
registers as an engine while it runs, so `engines` and the TUI show it.

- Prints one line when it starts, then each commission's state when its advance stops:

  ```text
  running at most 1 steps in parallel
  first: awaiting at approve since event 3, about 3b662a273f4a51598a69a7d2f80993fb424d31a05ba93364cabfb140583edfc0
  ```

- `--json`: one value per line: `{"parallel":1}`, then `{"commission":"first","state":{…}}` for
  each.
- A commission ready at an attended step is left for the owner. `run` prints its state once.
- A commission the engine cannot read is left alone. `run` prints its error once, on stderr:
  `broken: <error>`, or `{"commission":"broken","error":"…"}`.
- A first Ctrl-C or `SIGTERM` starts no further attempt and waits for those in flight. It prints
  `stopping, waiting for: first at build`, or `{"stopping":[{"commission":"first","step":"build"}]}`,
  then exits 0, leaving each commission ready at its next step.
- A second exits at once, with 130. Each attempt it interrupted escalates, with the cause
  `interrupted`, when its commission is next advanced.
- Exits 2 when `--parallel` is not a number from 1.

## Looking

### `state`

```text
medrengard state <commission>
```

- Prints the commission's state, as above.
- `--json`: the state.
- Exits 1 for an unknown commission.

### `commissions`

```text
medrengard commissions
```

Lists every commission in the log, oldest first.

- Prints each as `<commission>: <state>`. One the engine cannot read prints its error:

  ```text
  first: finished by end
  docs1: awaiting at approve since event 7, about 3b662a273f4a51598a69a7d2f80993fb424d31a05ba93364cabfb140583edfc0
  broken: unreadable: A decision cannot arrive while the commission is ready.
  ```

- `--json`: `[{"commission":"first","state":{…}},{"commission":"broken","error":"…"}]`.

### `show`

```text
medrengard show <commission>
```

Prints the commission's record. It is what the owner reads before deciding.

```text
docs1: awaiting at approve since event 7
request   9cb2b2bf  Greet
1 write        done (0.1 s)
    document  3b662a27  Reply  (no verifier)
  approve      changes: "Shorter."
2 write        done (0.1 s)
    document  3b662a27  Reply  (no verifier)

Subject:
document 3b662a273f4a51598a69a7d2f80993fb424d31a05ba93364cabfb140583edfc0
verifier: none
title: Reply

Hello. You asked: Say hello.
```

- The first line says where the commission is. `reason: …` follows for an escalated one.
- `request`, the first 8 characters of its hash, and its title. A trigger's commission then says
  `Started by trigger nightly.`, or
  `Started by trigger workers, from commission first's step spawn, attempt 1.`
- One line per attempt: its number, its step, its outcome and how long it took. Under it, each
  artifact it claimed: its kind, the start of its hash, its fields, and `(verified)` when a
  verifier accepted it or `(no verifier)` when its kind has none.
- An attempt that reported usage adds it: `1 build        done (0.1 s) ($0.25, 1.2k tokens)`.
- An attempt that wrote to stderr ends `(errors: medrengard errors first 1)`, naming the commission and the attempt: read them with
  `errors`.
- An attempt in flight prints `1 write        started`.
- An attempt that escalated prints its reason, and `On to <step>.` when its step routed it:

  ```text
  1 build        escalated (0.1 s): Step build exited with code 3.  (errors: medrengard errors first 1)
  ```

- An escalation before any attempt prints `  <step>  escalated: <reason>`; a withdrawal,
  `  <step>  withdrawn: <reason>`; a decision, its step, its outcome and any feedback, quoted.
- Unless the commission is finished, `Subject:` follows: the current subject in full, with its
  whole hash, its verifier's command or `verifier: none`, its fields and its body. Then, in full,
  every judgement about that subject that a step claimed.

`show` leaves out an attempt's notes; `watch` prints them. A log written before events carried
times shows no durations.

- `--json`: the engine's `CommissionRecord`, `{ state, request, origin?, entries }`. Its times are
  milliseconds since the epoch.
- Exits 1 for an unknown commission.

### `artifact`

```text
medrengard artifact <hash or a prefix of at least 8 characters>
```

Prints one artifact, by its hash or by a prefix as `show` prints them.

- Prints its kind, each field, then its body:

  ```text
  document
  title: Reply

  Hello. You asked: Say hello.
  ```

- `--json`: `{"kind":"document","fields":{"title":"Reply"},"body":"Hello. You asked: Say hello."}`.
- Exits 1 for a hash the log does not name as an artifact, or a prefix under 8 characters,
  `There is no artifact 3b66.`, and for `The prefix <prefix> names more than one artifact.`

### `transcript` and `errors`

```text
medrengard transcript <commission> <attempt>
medrengard errors     <commission> <attempt>
```

`transcript` prints everything the attempt's program wrote. `errors` prints its stderr alone, and
nothing when it wrote none. Attempts are numbered from 1, as `show` numbers them.

- To a file or a pipe, the bytes are written unchanged. To a terminal, they are printed as text
  with control characters made visible.
- `--json` changes nothing: the output is the bytes.
- Exits 1 for an attempt with no transcript, such as one in flight:
  `Commission docs1 has no transcript for attempt 9.`
- Exits 2 when the attempt is not a number from 1.

### `definition`

```text
medrengard definition <commission>
```

Prints the definition the commission was commissioned with and runs on, whatever the factory says
now: its workflow, with each step's access, agent, command and limits, the limits filled in from
the defaults the factory had then; its kinds; and its skills, each file by its hash.

- Prints it as indented JSON.
- `--json`: the same value on one line, `{ workflow, kinds, skills }`.
- Exits 1 for an unknown commission.

## Deciding

### `decide`

```text
medrengard decide <commission> <outcome> --subject <hash> --since <event>
                  [--feedback <text> | --feedback-file <path>]
```

Records the owner's decision. Take all three from `state`: `--subject` is the subject's full hash,
`--since` the event number it prints, and `<outcome>` one of the `outcomes` its `--json` lists. At
an approval step that is an outcome the step declares, or `abandon`; on an escalation, `retry` or
`abandon`.

```text
$ medrengard decide docs1 changes --subject 3b662a273f4a51598a69a7d2f80993fb424d31a05ba93364cabfb140583edfc0 --since 3 --feedback "Shorter."
ready at write, about 3b662a273f4a51598a69a7d2f80993fb424d31a05ba93364cabfb140583edfc0
decision: a3c65789d964850139804f4aa6de1512342c618789944816a920f8ab66c93076
```

- Prints the new state.
- `--json`: the new state.
- Exits 1, recording nothing, when:
  - the commission is not waiting: `Commission docs1 is ready, so no decision can be made.`
  - the subject has changed: `Commission docs1 is about 3b66…, not abc.`
  - the wait has changed: `Commission docs1 has waited since event 3, not 2.`
  - the outcome is not allowed: `Step approve does not declare outcome "nope".`
  - the feedback is over 1 MiB.
- Exits 2 without `--subject`, without a number for `--since`, or with both `--feedback` and
  `--feedback-file`.

### `cancel`

```text
medrengard cancel <commission>
```

Asks the engine running the commission's attempt to stop it. The commission escalates, with the
cause `cancelled`, and nothing is decided. `cancel` returns before the attempt has ended.

- Prints nothing.
- `--json`: `null`.
- Exits 1 unless the commission is attempting:
  `Commission docs1 is awaiting, so no attempt can be cancelled.`

### `renew`

```text
medrengard renew <trigger>
```

Renews the trigger's allowance: the commissions it started before no longer count against it.

- Prints nothing.
- `--json`: `null`.
- Exits 1 with `There is no trigger named <trigger>.` or
  `Trigger nightly has no allowance to renew.`

### `accept`

```text
medrengard accept
```

Accepts this engine for every commission that escalated with the cause `upgrade`, because it last
ran on another engine. It decides `retry` on each, and leaves every other commission as it is.

- Prints one line per commission it decided on, `first: ready at build`, and nothing when there
  are none.
- `--json`: `[{"commission":"first","state":{…}}]`.

## Observing

### `watch`

```text
medrengard watch <commission>
```

Follows one commission as the log records it: each attempt as it starts, its notes as they
arrive, its ending, and each escalation and decision. On a commission that is already waiting or
finished it prints everything so far. It stops once the commission awaits the owner, escalates or
finishes, and its last line says which. It is woken by each new event and does not poll.

```text
1 write        started
     Replying to Greet
1 write        done (0.1 s)
    document  3b662a27  Reply  (no verifier)
docs1: awaiting at approve
```

- A note the engine wrote prints as `     engine: <note>`. An escalated commission adds
  `reason: …` after the last line.
- `--json`: nothing while it follows, then the commission's record, as `show --json` prints it,
  once it stops.
- Exits 1 for an unknown commission.

### `events`

```text
medrengard events [--after <position>] [--follow]
```

Prints every commission's events after the log position `--after`, 0 if left out, oldest first.
With `--follow`, it then prints each new event as it is written, until you stop it.

- Prints one line per event: its position, its commission, its type, and its step and outcome, its
  note or its reason:

  ```text
  6 docs1 commissioned
  7 docs1 attempt-started write
  8 docs1 noted: Replying to Greet
  9 docs1 attempt-completed write: done
  10 docs1 decided approve: changes
  ```

- `--json`: one value per line, `{ position, commission, index, event }`. `position` is the event's
  place in the whole log, to pass as `--after`. `index` is its place among its own commission's
  events, which is what `decide --since` names:

  ```json
  {
    "position": 8,
    "commission": "docs1",
    "index": 2,
    "event": { "type": "noted", "attempt": 1, "note": "Replying to Greet", "at": 1794299982709 }
  }
  ```

- Exits 2 when `--after` is not a number from 0.

### `engines`

```text
medrengard engines
```

Lists the engines registered on the log, oldest first. `run` registers while it runs. On the log's
own machine an engine is `alive` or `dead`, judged by its process, so a `run` that died without
being stopped shows as `dead` until the next one registers. One registered on another machine is
`unknown`.

- Prints one line each, or `no engine is running`:

  ```text
  alive   <host>  pid 41327  since 2026-11-10T19:05:12.031Z
  ```

- `--json`: `[{"host":"<host>","pid":41327,"since":1794337512031,"status":"alive"}]`.

## The TUI

```text
node node_modules/@medrengard/core/tui/medrengard-tui.ts [--factory <path>]
```

The owner's terminal UI. It calls the engine's methods as the CLI does, and a factory can replace
it with a client of its own. It finds the factory as the CLI does.

It exits 2, printing its usage, without a factory, and 1 when stdin or stdout is not a terminal,
`The TUI needs the owner's terminal as stdin and stdout.`, or when the factory cannot be loaded.

The TUI attempts no step but the one you attend, so keep `medrengard run` going beside it.
Closing the TUI stops nothing.

Each screen redraws on every new event, and every 5 seconds. The last two lines are the result or
refusal of your last call, and the keys the screen takes.

### Home

The first lines say whether a `run` is registered on the log, one line per engine that is not
dead, with the time in your locale's form; or that none is:

```text
run: alive on <host>, pid 41327, since 10/11/2026, 19:05:12
run: on <host>, pid 41327, since 10/11/2026, 19:05:12, unknown from this machine
run: not running, so nothing ready advances
```

Then the commissions, in groups, each with where it is and how long ago it last changed:

| Group             | Holds                                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `Needs you`       | Commissions awaiting, escalated, with the first line of the reason beneath, or ready at an attended step, `ready at greet, to attend`. |
| `Running`         | Commissions attempting.                                                                                                                |
| `Waiting for run` | Commissions ready at any other step: `ready at build, waits for run`.                                                                  |
| `Unreadable`      | Commissions the engine cannot read, each with its error.                                                                               |
| `Finished`        | Folded to `1 finished (f to show)` until you press `f`.                                                                                |

With an empty log, it says `Nothing has been commissioned. n to commission a request.`

### A commission

Enter on a commission opens its record, which grows as the log does: where the commission is, the
reason if it escalated, the request, then every attempt with its notes, each escalation and each
decision, in the lines `watch` prints.

Enter on a row opens it in `$PAGER` (`less` if unset), with control characters made visible: the
request or a claimed artifact in full, or an ended attempt's transcript. `e` on an ended attempt
opens its errors.

### Deciding, cancelling, attending and commissioning

- `d` decides on the commission. You pick an outcome from those its state allows, then
  `No feedback`, `Write a line` or `Write it in the editor`, which opens `$VISUAL` or `$EDITOR`
  (`vi` if unset). You then confirm:
  `Decide approve on gate at review, about 1a2b3c4d, with feedback? (y/n)`. The decision names the
  subject and the wait as they were when you pressed `d`, so the engine refuses it if the commission
  has moved on since.
- `x` cancels the commission's attempt, once you confirm `Cancel busy's attempt at build? (y/n)`.
- `a` attends the step the commission is ready at, in the same terminal, and comes back to the TUI
  when the attempt ends.
- `n` commissions a request: you pick a workflow, type a name and a title, then write the body in
  the editor.

On Home these act on the selected commission; on a commission's screen, on that commission.

### Keys

| Key                | Does                                                            |
| ------------------ | --------------------------------------------------------------- |
| Up, Down, `k`, `j` | Move the selection.                                             |
| Enter              | Open the selected commission, artifact or attempt's transcript. |
| `e`                | Open the selected attempt's errors.                             |
| `d`                | Decide on a commission that is awaiting or escalated.           |
| `x`                | Cancel an attempt in flight.                                    |
| `a`                | Attend a step that waits for you.                               |
| `n`                | Commission a request.                                           |
| `f`                | On Home, show or fold the finished commissions.                 |
| Esc                | Go back to Home, or leave a prompt without answering.           |
| `?`                | List the keys. Any key closes the list.                         |
| `q`, Ctrl-C        | Quit.                                                           |

In a prompt: Up and Down choose and Enter picks; in a line of text, Enter ends it; a confirmation
takes `y` or `n`.
