# Medrengard

Medrengard runs AI coding agents on your own machine, one step at a time,
following steps you write yourself. A typical set of steps is: plan the
change, build it, check it, review it, then ask you. Medrengard runs each step,
records everything that happens, and stops to ask you whenever the decision is
yours or something goes wrong.

New to it? The [guide](docs/guide.md) explains how it fits together, how to
set up your own factory and how to change the core.

## What it does

- **You stay in charge.** Whatever an agent produces is only a claim until
  Medrengard has checked it. Nothing passes an approval step without your
  decision on the exact version you were shown.
- **Agents are fenced in.** Each one runs in a sandbox that sees only what you
  allow, with no network or secrets unless you grant them.
- **Everything is recorded.** Every step is written to a local database. If a
  run is interrupted, Medrengard stops and asks you rather than quietly
  starting it again.
- **The rules are yours.** The steps, the agents' roles, how many reviews to
  run and what happens at the end are your own code, not built in.

Today it can take an idea to a plan you have approved, with Claude Code as the
planner. Building, checking and reviewing the change with real agents comes
next. The [default workflow](workflows/default.ts) already describes that whole
path, and the tests run it with stand-in agents.

## Try it

You need Linux, Node 24 or later, Git and bubblewrap, with unprivileged user
namespaces allowed. There are no npm packages to install.

```sh
npm test
```

The tests use stand-in agents and never call a paid model.

## Run it

A **factory** is a folder of your own, outside this checkout, holding a
`factory.ts` that names the repository to work on, the steps and the agents.
The [guide](docs/guide.md#building-a-factory) walks through one. From that
folder, with this checkout linked in as `.medrengard`:

```sh
export CLAUDE_CODE_OAUTH_TOKEN=...   # if your agents use Claude Code; keep the token outside the factory
node .medrengard/cli/medrengard.ts start "<idea>"
node .medrengard/cli/medrengard.ts show <work>
node .medrengard/cli/medrengard.ts decide <work> <outcome> <hash> ["feedback"]
node .medrengard/cli/medrengard.ts recover <work>
```

`start` begins a new piece of work and runs it until it needs you, printing
each step as it starts and finishes, then shows the plan and its hash. `show`
prints where a piece of work has got to: the plan, or once there is code, the
commit and every review of it with its findings. `decide` gives your answer,
such as `accept`, or `changes` with feedback, for that exact version, and
carries on; the first seven or more characters of the hash are enough.
`recover` marks a run that was cut off (a closed terminal, a crash) as needing
you, when `show` says one is in progress and nothing is running it.

## Safety in brief

- Your `factory.ts` and everything it imports are trusted code. Text from
  agents, issues or repositories is only ever treated as data.
- For now an agent either has the network or does not; there is no way to
  allow only some destinations. The owner accepted this for the first phase.

The [threat model](docs/security/threat-model.md) says exactly who can reach
what, with the [accepted risks](docs/work/accepted-risks.md) and
[parked findings](docs/work/parked.md).

## Learn more

- [Guide](docs/guide.md): how it works, building a factory, changing the core.
- [Core rules](docs/core.md): what the core must always hold.
- [Status](docs/STATUS.md) and [roadmap](docs/roadmap.md): where it is and
  where it is going.
- [Live runs](docs/live-runs.md): how runs with paid models are approved and
  recorded.
- [Owner decisions](docs/decisions.md), the [refactor log](docs/refactor/log.md)
  and the [architecture](docs/architecture/source-v0.3.md): the project's
  history. These may describe things that no longer exist.
