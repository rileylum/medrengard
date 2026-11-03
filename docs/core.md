**Goal.** Medrengard is a framework for building a personal software factory: workflows that take an idea to merged code. It provides the primitives. Its defaults are ordinary workflows and extensions built only from those primitives, and each can be replaced on its own.

**Scope.** One owner, on the owner's machine, running the owner's trusted code. Multiplayer is a non-goal: no accounts, tenants or shared control. The owner still works with others through the repositories and PRs the factory produces.

**Transparent**

- Observable: every state change is an event you can watch as it happens.
- Traceable: every artifact, judgement and decision can be followed back to the step, inputs and subject that produced it.

**Adaptable**

- Extensible: new artifact kinds, harness adapters, commands and observers plug in through extension points; the built-ins use the same points.
- Configurable: every default (workflow, agents, access) can be replaced without touching the core.

**Principles**

**Shape**

1. Mechanism, not policy. The core runs steps and keeps the record. Workflows decide what a factory does.
2. A step is a program. An agent or command step runs in its workspace, reads its declared inputs from one directory and writes its outcome and artifacts to another. TypeScript is a convenience layer over this contract, not a replacement for it.
3. Typed composition, open vocabulary. Outcomes are finite labels the engine routes on. Artifacts are hashed records whose kind defines their schema; kinds are extensions.
4. Declared inputs. A step sees only what it is deliberately given.
5. Vendor neutral. Harness, model and prompt are independent. A harness adapter is a program that fulfils the step contract.
6. Small surface. A new primitive or extension point is built only when a real workflow can't be built without it.

**Trust**

7. Agents claim, the record binds. A step's output is a claim. Its kind verifies what it can (a commit exists and is the workspace HEAD), and the record shows when a kind has no verifier. Every judgement names the subject it is about; a new subject turns earlier judgements into history, not evidence. Each verification is specified by a test in which a fake step makes a false claim and the engine must catch it.
8. The owner is a participant. Any agent step can run attended or unattended. Approvals are steps that bind to what they approve.

**Safe to leave running**

9. Durable. The log is the only state. Replaying it rebuilds every commission. An interrupted attempt is never silently re-run.
10. Bounded. Before anything runs, the engine verifies that every unattended loop terminates.
11. Unknown stops and asks. Anything the engine cannot classify pauses the commission for the owner.
12. Safe by default, risk visible. The defaults confine candidate code and keep outward actions as explicit steps. Leaving a default is possible, and readable in the workflow definition.

**Constraints**

1. No extension code in the engine. Commands, harness adapters, verifiers, materialisers and observers are programs. Workflow definitions are TypeScript that evaluates to data.
2. Everything has a declared limit. Every attempt, wait, output stream, artifact, transcript and disk area has an explicit bound, or is declared unbounded, which only an attended step may be. Exceeding a bound escalates; nothing is silently truncated or allowed to grow without limit.
3. A commission runs on the definitions it started with. Commissioning records its workflow, agent and kind definitions and the factory's defaults by hash. Editing a definition affects only new commissions.
4. Hermetic steps. A step sees only its declared inputs, workspace, environment and tools. A harness adapter loads only declared skills and configuration, or records the leak on every attempt.
5. Commissions are independent. Commissions share no state, and each has one writer at a time. Any number of commissions, across repositories and workflows, can advance at once.
6. Large data by reference. The log holds events and hashes; artifact bodies, kept files, transcripts and definitions live in a content-addressed store.
7. A pinned surface. The public exports and types, the definition's schema, the event types, the step's and kind programs' contracts, the engine's methods and the CLI's commands and JSON results are listed in tests. Growing any list is a logged decision.
8. The fold is pure. Rebuilding state from the log does no I/O and reads no clock or randomness.

**Technology.** Node 24 and its built-ins, with zero runtime dependencies. Linux, with bubblewrap as the default sandbox, in a systemd user scope that bounds each program's memory and processes. Workflows are TypeScript modules.

**Step contract**

Every step except an approval step is a program. The engine starts it with:

- its workspace as the working directory;
- `MEDRENGARD_IN`: a read-only directory holding `input.json` and the bodies of the step's declared inputs;
- `MEDRENGARD_OUT`: an empty directory where the step writes `output.json` and the files its artifacts refer to;
- file descriptor 3, where the step may write notes for the owner, one per line, each at most 4096 bytes and all counted with its transcript;
- only the environment its access declares.

An attended step has the owner's terminal, recorded through a pseudo-terminal. An unattended step gets empty stdin, and its stdout and stderr are its transcript.

`input.json` names the commission, step, attempt and declared outcomes, and lists each declared input's artifacts, oldest first, as a list even when it holds one artifact or none; the rules of each kind the step may claim; an agent step's also carries its agent. `output.json` holds one outcome and the claimed artifacts, at most 64 KiB. Bodies are files, referenced by path: an input's body is at `<input>/<hash>` under `MEDRENGARD_IN`.

The exit code reports the step's health; the outcome reports its result. A test run that finds failures exits 0 with a failing verdict. When the step ends:

- exit 0 with a valid output: the attempt completes, its artifacts are recorded and the outcome's edge is followed;
- exit 0 with a missing or invalid output (an undeclared outcome or kind, or an artifact its kind rejects): the commission escalates;
- a non-zero exit: the commission escalates;
- a limit reached: the engine sends `SIGTERM`, then `SIGKILL` after a grace period, and the commission escalates naming the limit;
- the owner cancels: the engine stops the step, or the kind's program running for it, the same way, and the commission escalates naming the cancellation. A cancel that arrives before the attempt's end is written wins, and nothing the attempt claimed is recorded; with no engine running the attempt, cancelling escalates it at once.

The owner's request is the commission's first artifact, a document, and a decision with its feedback is a judgement. Steps receive both as declared inputs, like any other artifact.

**Inputs**

A step declares each input as a name and a query. The name is the input's directory under `MEDRENGARD_IN`: letters, digits, `-` and `_`, starting with a letter. A query is one of:

- `subject`: the current subject;
- `request`: the owner's request;
- a query over the commission's record: every artifact, oldest first, which is the request, each artifact a step claimed, and each decision. Each field narrows it, and every field is optional:
  - `from`: the steps that claimed or decided it; the request has none;
  - `kind`: one artifact kind;
  - `about`: judgements only, about the current subject (the evidence), earlier subjects (history), or any;
  - `take`: the latest, or all, which is the default.

The commission is refused before it starts if a query names a step the workflow lacks, a kind there is not, or a field or value a query does not define. Passing new data between steps is a new query in the workflow, not a change to the core.

A step's input limit bounds the bytes of all its input bodies together. Over it, the commission escalates before an attempt starts, so no budget is spent.

The JSON files are a wire format. The engine encodes `input.json` from its domain types and parses `output.json` into them, or escalates; the domain model is never shaped by the JSON.

**Commission lifecycle**

Replay derives a commission's state; none is stored.

- Ready: at an agent or command step, with no attempt in flight.
- Attempting: an attempt has started and not completed.
- Awaiting: at an approval step, waiting for the owner's decision.
- Escalated: paused for the owner, with a reason.
- Finished: an edge reached the end, or the owner abandoned the commission; what finished it is recorded.

Six events are the whole log vocabulary. Each carries the time the engine wrote it:

- `commissioned`: the workflow, its definitions by hash and the request artifact.
- `attempt-started`: the step and attempt, the subject and each input's artifacts by hash; spends one unit of the step's budget.
- `attempt-completed`: the attempt, its outcome, the recorded artifacts with their kinds, its transcript and, when it wrote to stderr, its errors, and the next step or end.
- `decided`: the step and the decision artifact, with its outcome, the subject it names and any feedback, at most 1 MiB, and the next step or end.
- `noted`: the attempt and one note it wrote for the owner, recorded as it arrives. It changes no state.
- `escalated`: the reason, and the attempt if one was involved, with its transcript and errors when its program ran. A kind's program that fails ends the reason with its stderr, or the last 1024 bytes of it. A reason is at most 4096 bytes; a longer one is cut on a character boundary and says so.

Transitions:

- Commissioned, the commission is ready or awaiting, by its start step's kind.
- Ready, with budget left, inputs within the input limit and the step not yet attempted on the same subject and inputs, an attempt starts.
- Ready, with the budget spent, inputs over the input limit, the step already attempted on the same subject and inputs, or a failure of the engine's own while preparing its inputs, the commission escalates.
- Attempting, a valid claim completes the attempt and follows the outcome's edge. An invalid claim, a non-zero exit, a reached limit, the owner cancelling, a failure of the engine's own or an interruption found on replay escalates. An attempt is interrupted once no engine is running it, even if the process that started it lives on.
- Awaiting, a decision naming the current subject, the event the commission has waited since and a declared outcome follows its edge. A stale or undeclared decision is refused and records nothing: a decision made while the commission waited at an earlier approval step or escalation is stale, even about the same subject.
- Escalated, a decision to retry makes the step ready again; a decision to abandon finishes the commission. It too names the current subject and the event the commission has waited since.
- Finished, nothing is accepted.

A step's budget counts its attempts since the commission's latest decision, so only the owner renews a budget. Every agent and command step has a budget above zero, which bounds every unattended loop. A step is never attempted twice on the same subject and inputs without a decision between. An edge leads to a step or to the end; there are no handoffs between workflows.

**Artifact kinds**

A step declares the kinds it may claim; a claim of any other kind is invalid. A kind is data: a name; a role, subject or judgement; a schema for its fields, each with a size limit; whether it has a body, with its media types and size limit; and optionally a verifier, a materialiser and an outcome field. An artifact's hash covers its kind, fields and body hash, the same way for every kind. A judgement's subject is always named by artifact hash.

A kind's verifier and materialiser are programs, each with its own access and limits, run in a sandbox like a step's; a verifier's limits include the bytes it may keep. A factory defines its kinds; a commission records them by hash with its workflow, and they must include document and cannot include decision. The owner's request is a document with a title and a body, so document must be a subject, define a title, require no other field and have no verifier; a request that breaks its rules is refused before the commission starts.

A verifier is a program run after a claim parses, under the step contract:

- the attempt's workspace as its working directory, in the mode its access gives: read-only for the built-in commit verifier;
- `MEDRENGARD_IN` holding `claim.json`: the claim's fields, its body and the commission's current subject;
- `MEDRENGARD_OUT`, where it writes `output.json`: accepted, with the files to keep, or rejected, with a reason.

Kept files go to the store, attached to the artifact. A rejected claim or a failed verifier escalates. The record names the verifier that accepted an artifact, or that its kind has none.

A materialiser is a program that builds a later step's workspace from an artifact and its kept files, in an empty directory. A kind's outcome field must equal the outcome of the step that claims it.

The latest subject artifact an attempt claims becomes the subject; a judgement leaves the subject where it was. A judgement a step claims is about the subject that attempt was given.

Built in:

- Document: a subject with a title and a required markdown, HTML or text body. No verifier; its materialiser writes the body.
- Commit: a subject with a SHA and an optional report. Its verifier accepts a SHA that is the workspace HEAD, not already the current subject, and whose tree differs from its parent's and the subject's, and keeps a Git bundle that holds its whole history, or refuses it; its materialiser clones the bundle at that SHA.
- Verdict: a judgement with pass or fail, an optional one-line summary and its findings as an optional text body. Its outcome field is the verdict. The step never names the subject; the engine records the one the attempt was given.
- Decision: a judgement with the owner's outcome and optional feedback.

Decisions are the owner's. A decision renews budgets, approves a subject and resolves escalations, so only the owner makes one, at an approval step or on an escalated commission. A step that claims a decision escalates. Cancelling is not a decision: it stops an attempt and escalates, and the owner then decides on the escalation. A model's choice is an outcome or a judgement, routed like any other.

**Language**

One word per concept, used the same way in speech, docs, code and tests. Each context owns its words.

_Definition: what the owner writes; data, verified before anything runs._

- Factory: the owner's workflows, agents and extensions. Medrengard builds factories; it is not one.
- Workflow: a graph of steps whose edges are labelled by outcome.
- Step: a node of a workflow, of one kind: an agent step runs an agent through its harness adapter, attended or unattended; a command step runs the owner's program; an approval step waits for the owner's decision.
- Agent: a reusable definition of harness, model, prompt and skills. The step supplies its workspace and inputs.
- Harness: the vendor tool an agent runs in, such as Claude Code, Codex, Pi or OpenCode.
- Prompt: what the agent is told to do at a step.
- Skill: packaged instructions or tools given to an agent.
- Artifact kind: a role, subject or judgement, a schema and a body rule, with an optional verifier, materialiser and outcome field. Built in: document (with a media type), commit, verdict and decision.
- Outcome: a label a step declares; the engine routes on it.
- Access: what a step's process may read, write and reach.
- Query: what a step declares to name the artifacts one of its inputs holds.
- Budget: the attempts a step may spend between the owner's decisions.
- Limit: any other declared bound, such as time, size or disk.

_Execution: the core. The commission is the aggregate root._

- Commission: one idea taken through one workflow, from the owner's request to a terminal state, with its whole history.
- Attempt: one start of a step's program within a commission, through to its completion or escalation.
- Claim: what an attempt wrote to its output, untrusted until it parses and its kind's verifier, if any, accepts it.
- Artifact: an immutable record of an accepted claim, identified by its hash, naming the verifier that accepted it or that its kind has none.
- Subject: the artifact the commission is currently about: its latest subject artifact, such as a document or commit.
- Judgement: an artifact that names a subject, such as a verdict or a decision.
- Evidence: the judgements about the current subject. Judgements about earlier subjects are history.
- Decision: the owner's outcome at an approval step or on an escalation, naming the current subject and the event the commission has waited since.
- Escalation: the commission paused for the owner, with a reason.
- Cancel: the owner stopping an attempt in flight; the commission escalates, and nothing is decided.

_Step contract: the process boundary._

- Workspace: the directory a step's process runs in: empty, or built from the current subject or from the one artifact an input names.
- Input: what a step declares by name and query, and receives as the artifacts the query names. Every input's bodies sit in `MEDRENGARD_IN`, beside `input.json`.
- Output: the directory where a step writes its claim, `output.json`, and the files it refers to.
- Sandbox: the confinement that enforces a step's access.
- Harness adapter: the program that translates the step contract into a harness's own interface; vendor concepts stop there.
- Verifier: the program a kind runs to accept or reject a claim, and to name the files the store keeps.
- Materialiser: the program a kind runs to build a later step's workspace from an artifact.
- Transcript: everything a step's process wrote to its terminal or stdout and stderr during an attempt.

_Record: the log and the store._

- Event: a past-tense fact about a commission: commissioned, attempt-started, attempt-completed, decided or escalated.
- Log: the ordered events of every commission.
- Store: content-addressed artifact bodies, kept files, transcripts and definitions.
- Replay: the pure fold from a commission's events to its state.
- Observer: a program that reads the log and never writes.
- Extension: a package supplying artifact kinds, harness adapters, commands or observers.
- Owner: the one person the factory serves.

_Not used:_ stage (step), work, run or job (commission), role (prompt), run or execution (attempt), abort or kill (cancel, for the owner), check (verify, for the engine), runtime (harness or harness adapter), ticket and cycle (workflow policy, not core).
