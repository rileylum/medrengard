**Goal.** Medrengard is a framework for building a personal software factory: workflows that take an idea to merged code. It provides the primitives. Its defaults are extensions built only from those primitives, and each can be replaced on its own. Default workflows are planned: ordinary workflows built the same way, shipped once one is shown to earn its steps.

**Scope.** One owner, on the owner's machine, running the owner's trusted code. Multiplayer is a non-goal: no accounts, tenants or shared control. The owner still works with others through the repositories and PRs the factory produces.

**Transparent**

- Observable: every state change is an event you can watch as it happens.
- Traceable: every artifact, judgement and decision can be followed back to the step, inputs and subject that produced it.

**Adaptable**

- Extensible: new artifact kinds, harness adapters, commands and observers plug in through extension points; the built-ins use the same points.
- Configurable: every default (harness adapter, access, kinds, limits, and workflows once shipped) can be replaced without touching the core.

**Principles**

**Shape**

1. Safety invariants, not policy. The core runs steps, keeps the record and enforces what makes a factory safe to leave running. Workflows decide everything else a factory does.
2. A step is a program. An agent or command step runs in its workspace, reads its declared inputs from one directory and writes its outcome and artifacts to another. TypeScript is a convenience layer over this contract, not a replacement for it.
3. Typed composition, open vocabulary. Outcomes are finite labels the engine routes on. Artifacts are hashed records whose kind defines their schema; kinds are extensions.
4. Declared inputs. A step sees only what it is deliberately given.
5. Vendor neutral. Harness, model and prompt are independent. A harness adapter is a program that fulfils the step contract.
6. Small surface. A new primitive or extension point is built only when a real workflow, one the owner has run, can't be built without it.

**Trust**

7. Agents claim, the record binds. A step's output is a claim. Its kind verifies what it can (a commit exists and is the workspace HEAD), and the record shows when a kind has no verifier. Every judgement names the subject it is about; a new subject turns earlier judgements into history, not evidence. Each verification is specified by a test in which a fake step makes a false claim and the engine must catch it.
8. The owner is a participant. Any agent step can run attended or unattended. Approvals are steps that bind to what they approve.

**Safe to leave running**

9. Durable. The log is a commission's only state. Replaying it rebuilds every commission. Beside it are only what engines tell one another, which changes nothing until an event records it (a cancel, a withdrawal, a watching attempt's checks and the engines running), and the owner's renewals of triggers. An interrupted attempt is never silently re-run. An outward step is safe to retry: attempted again, it finds what it already did.
10. Bounded. Every step that starts attempts has a budget, which only the owner renews, so every unattended loop terminates. A commission is refused before it starts if a step lacks one.
11. Unknown stops and asks. Anything the engine cannot classify pauses the commission for the owner. Every escalation names its cause, from a closed set, so what the engine can classify can be told apart from what it cannot. What it can classify, a workflow may route to a step in place of the owner; what it cannot, and what is the owner's alone to answer, never.
12. Safe by default, risk visible. The defaults confine candidate code and keep outward actions as explicit steps. Leaving a default is possible, and readable in the workflow definition. A credential never enters a sandbox: a broker holds it outside. The sandbox confines an agent's mistakes and instructions injected into it; it shares the machine's kernel, so it is no boundary against code written to escape it. A host a step may reach is a way out for whatever the step can read.

**Constraints**

1. No extension code in the engine. Commands, harness adapters, verifiers, materialisers and observers are programs. Workflow definitions are TypeScript that evaluates to data.
2. Everything has a declared limit. Every attempt, output stream, artifact, transcript and disk area has an explicit bound; only an attended step's time may be declared unbounded. Money is bounded where the owner declares it, per step and per commission: an attempt that reports no cost counts as over a money limit, since unknown cost is not zero, but for an attended one, which reports none and which the owner is there for, and an agent whose harness declares it reports no cost cannot be given one. Exceeding a bound escalates; nothing is silently truncated or allowed to grow without limit. A wait has no bound: nothing runs while the commission waits for the owner.
3. A commission runs on the definitions it started with. Commissioning records its workflow, agent and kind definitions and the factory's defaults by hash. Editing a definition affects only new commissions. It runs on the engine it last ran on, too: every attempt records the engine's version, a hash of its package's source, the adapters and kinds' programs it ships among it, and before an attempt on another engine the commission escalates, until the owner decides to go on with it, for one commission or for every one it stopped.
4. Hermetic steps. A step sees only its declared inputs, workspace, environment and tools. A harness adapter loads only declared skills and configuration, or records the leak on every attempt.
5. Commissions are independent. Commissions share no mutable state, and each has one writer at a time. A parent gives its children artifacts and reads theirs, by hash; nothing else passes between commissions. Any number of commissions, across repositories and workflows, can advance at once.
6. Large data by reference. The log holds events and hashes; artifact bodies, kept files, transcripts and definitions live in a content-addressed store.
7. A pinned surface. The public exports and types, the definition's schema, the event types, the step's and kind programs' contracts, the engine's methods and the CLI's commands and JSON results are listed in tests. Growing any list is a logged decision.
8. The fold is pure. Rebuilding state from the log does no I/O and reads no clock or randomness. So is judging what a commission may do next from its log: whether its engine, budget and money admit another attempt, whether one would repeat an earlier, and how a children step's wait stands, given how long it has waited.
9. Old logs stay readable. An event gains fields and the vocabulary gains types; neither loses one. A test keeps a log written by an earlier engine readable.

**Technology.** Node 24 and its built-ins, with zero runtime dependencies. Linux, with bubblewrap as the default sandbox, in a systemd user scope that bounds each program's memory and processes. An engine that runs in a step whose access gives it a control group of its own bounds each program in a group it makes there, with the same limits, since no systemd answers it. Workflows are TypeScript modules.

**Step contract**

Every step except an approval step is a program. The engine starts it with:

- its workspace as the working directory, at `/workspace`;
- `MEDRENGARD_IN`: `/input`, a read-only directory holding `input.json` and the bodies of the step's declared inputs;
- `MEDRENGARD_OUT`: `/output`, an empty directory where the step writes `output.json` and the files its artifacts refer to, and may leave `session`: its harness's conversation, opaque to the engine, which a later attempt may continue. The engine keeps it however the attempt ends, an interrupted one's included, if it is a regular file within the step's transcript limit; one over it is not kept, and a claim cannot complete the attempt;
- file descriptor 3, where the step may write notes for the owner, one per line, each at most 4096 bytes and all counted with its transcript;
- file descriptor 4, where the step may report what it has used so far, one JSON line per report: money in US dollars, `usd`, and tokens, `input`, `output`, `cacheRead` and `cacheWrite`, as its harness counts them. The latest report stands. Each is at most 4096 bytes and counted with its transcript; a line that is not a report escalates. A report is the step's claim: nothing verifies it;
- only the environment its access declares, with `PWD` naming its workspace; when its access lists the hosts it may reach, also the proxy variables, pointing at the engine's proxy for them, and for each broker it names, `MEDRENGARD_BROKER_<NAME>`, the broker's address on loopback.

An attended step has the owner's terminal, recorded through a pseudo-terminal: it starts only when the owner attends it, in their terminal, and ends when its program does, so the owner can go back and forth with its agent until they leave. Their typing counts as activity, though what they type is not kept. While it runs, the engine notes for the owner what each `output.json` it writes would amount to: its outcome and artifacts, or why it would escalate. An unattended step gets empty stdin, and its stdout and stderr are its transcript.

`input.json` names the commission, step, attempt and declared outcomes, and, when an escalation routed the commission to the step, the step it left, its attempt, the cause and the reason, and lists each declared input's artifacts, oldest first, as a list even when it holds one artifact or none; the rules of each kind the step may claim; an agent step's also carries its agent and whether it is attended. `output.json` holds one outcome and the claimed artifacts, at most 64 KiB. Instead of writing an artifact out, a claim may adopt one of the attempt's inputs by its hash, of a kind the step may claim: it is recorded as it is, with the files its verifier kept, and becomes the subject if it is a subject; adopting the current subject is invalid. Bodies are files, referenced by a path relative to their directory: an input's body is at `<input>/<hash>` under `MEDRENGARD_IN`.

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
  - `take`: the latest, or all, which is the default;
- `children` and a children step, with a kind and a take, which it always states: from the step's latest attempt, each child that reached its end, in the order commissioned, its latest artifact of that kind, or all of them. `input.json` names the child each artifact came from;
- `across` and a relation, with `from`, `kind` and `take` as a query over the record has them, applied to each related commission's record as it is when the attempt starts, finished or not: `origin`, the commission that started this one, as its parent or through a commission step; `started`, those this one started, in the order started; or `siblings`, those the same attempt started, but this one. `input.json` names the commission each artifact came from. No workspace is built from them, nor branches added;
- `session` and a step: the latest session an attempt of that step left, however it ended, or none. It is no artifact: `input.json` lists it by its hash and body alone, and no workspace is built from it. A harness adapter continues it as a fork, so the session kept never changes, and escalates rather than start afresh when it cannot.

The commission is refused before it starts if a query names a step the workflow lacks, a kind there is not, or a field or value a query does not define. Passing data between steps is a query in the workflow; a new form of query is a change to the core.

A step's workspace starts empty, or is built from the current subject or from the one artifact an input names, its base. Built from an input, it may also add as branches the artifacts another input names, which may not be a session, nor take all of each child's: each is named `<input>-<n>`, `n` being a child's number or else the artifact's position, from 1, and `input.json` gives each its `branch`. Each branch must be of its base's kind, or the commission escalates when the step is reached.

A step's input limit bounds the bytes of all its input bodies together, with an agent step's prompt and skills. Over it, the commission escalates before an attempt starts, so no budget is spent.

The JSON files are a wire format. The engine encodes `input.json` from its domain types and parses `output.json` into them, or escalates; the domain model is never shaped by the JSON.

**Commission lifecycle**

Replay derives a commission's state; none is stored.

- Ready: at an agent or command step, with no attempt in flight. At an attended step, it waits for the owner to attend.
- Attempting: an attempt has started and not completed.
- Awaiting: at an approval step, waiting for the owner's decision.
- Escalated: paused for the owner, with a cause and a reason.
- Finished: an edge reached the end, the owner abandoned the commission, or its parent withdrew it; what finished it is recorded.

Seven events are the whole log vocabulary. Each carries the time the engine wrote it:

- `commissioned`: the workflow, its definitions by hash, the request artifact and the engine's version; a child's also names its parent's commission, step and attempt, and the artifacts it was given, by hash with their kinds and kept files; one a trigger started names the trigger as its origin, and one a commission step started also its commission, step and attempt.
- `attempt-started`: the step and attempt, the subject and each input's artifacts by hash, the engine's version and the engine process running it; spends one unit of the step's budget.
- `attempt-completed`: the attempt, its outcome, the recorded artifacts with their kinds, its transcript and, when it wrote to stderr, its errors, its latest usage report when it made one, the session it left when it left one, and the next step or end.
- `decided`: the step and the decision artifact, with its outcome, the subject it names and any feedback, at most 1 MiB, and the next step or end.
- `noted`: the attempt and one note for the owner, recorded as it arrives: one the attempt wrote, or the engine's, marked as such. It changes no state.
- `withdrawn`: the reason a child's parent no longer waits for it. It finishes the child; it is the engine's, not the owner's decision.
- `escalated`: the step the commission was at, the cause and the reason, the step it was routed to if its step routed it, and the attempt if one was involved, with its transcript and errors when its program ran, its latest usage report when it made one, and the session it left when it left one. A kind's program that fails ends the reason with its stderr, or the last 1024 bytes of it. A reason is at most 4096 bytes; a longer one is cut on a character boundary and says so. The cause is one of: `budget`, the step's budget spent; `money`, a money limit reached or spend unknown; `limit`, any other declared limit reached; `repeat`, the step already attempted on this subject and these inputs; `inputs`, what the step was to be given cannot be given; `claim`, an invalid claim or one its kind's verifier rejected; `exit`, the step's program failed or could not start; `kind`, a kind's program failed; `broker`, a broker did not start; `interrupted`, no engine was running the attempt; `engine`, the engine's own failure; `cancelled`, by the owner; `withdrawn`, by its parent; `upgrade`, another engine than the commission last ran on; `unmet`, a children step's wait that can no longer be met; `trigger`, a commission step's trigger that cannot start its commissions now.

Transitions:

- Commissioned, the commission is ready or awaiting, by its start step's kind.
- Ready, with budget left, inputs within the input limit and the step not yet attempted on the same subject and inputs, an attempt starts; at an attended step, once the owner attends it.
- Ready, with the budget spent, the commission's money limit spent since the latest decision or its spend unknown, inputs over the input limit, the step already attempted on the same subject and inputs, or a failure of the engine's own while preparing its inputs, the commission escalates.
- Attempting, an escalation whose cause the attempt's step routes goes on at the step the route names, in place of the owner: the commission is ready or awaiting there, with nothing renewed. A step routes `limit`, `claim`, `exit`, `kind`, `broker`, `interrupted` or `unmet`, or `any` for each of them without a route of its own, to a step of its workflow, never to the end; a workflow that routes another cause is refused before it starts. An escalation before an attempt starts is never routed.
- Attempting, a valid claim completes the attempt and follows the outcome's edge. An invalid claim, a non-zero exit, a reached limit, the owner cancelling, a failure of the engine's own or an interruption found on replay escalates. An attempt is interrupted once no engine is running it, even if the process that started it lives on.
- Awaiting, a decision naming the current subject, the wait and a declared outcome follows its edge; a decision to abandon finishes the commission, so an approval step cannot declare abandon. A stale or undeclared decision is refused and records nothing: a decision made in an earlier wait, at an approval step or escalation, is stale, even about the same subject.
- Escalated, a decision to retry makes the step ready again; a decision to abandon finishes the commission. It too names the current subject and the wait.
- Finished, nothing is accepted.

A step's budget counts its attempts since the commission's latest decision, so only the owner renews a budget. Every agent, command and children step has a budget above zero, which bounds every unattended loop. A step is never attempted twice on the same subject and inputs without a decision or a route between. A routed escalation is of an attempt, which spent a unit of its step's budget, and renews none, so routes are bounded as every loop is. An edge leads to a step or to the end; a children step starts child commissions of a named workflow and waits on them, bounded, while the parent stays in charge.

**Children**

A children step commissions child commissions of one workflow: one per document a query names, each the child's request, or a declared count on the parent's request or a document a query names. Each child is also given the artifacts named queries name, and its first subject is the latest subject among them, or its request. A child is a commission like any other, named `<parent>.<step>.<attempt>.<n>`; its workflow is the one the parent's commission pinned, which may not lead back to a workflow it is within. At most its width are commissioned, more escalating before any starts, and at most its concurrent number are unfinished at once.

The attempt is the wait: it spends a unit of the step's budget and runs no program. A child succeeds when its workflow reaches its end, on the wait's outcome when the wait names one. The wait is for every child, the first or at least some; without an outcome, met it follows `done` and once it can no longer be met the commission escalates; with one, met it follows `met` and once it can no longer be met, `unmet`. Past its wait limit, or cancelled by the owner, it escalates. Once the wait is decided, the children still unfinished are withdrawn, an attempt in flight stopped first, and the attempt ends once every child has finished. An engine stopping does not interrupt the wait: the next engine to look carries it on.

**Triggers**

A program outside the engine, such as a timer or a webhook's receiver, starts a commission only through a trigger the factory declares: the workflows it may start, at most a count of commissions in a period, at most a count until the owner renews it, its allowance, or both, at most a number unfinished at once, and optionally a money limit on what those it started in the period, or without one since its renewal, cost, unknown cost counting as over. Each is judged from the log when commissioning, in one write with the commission, so programs asking at the same moment start no more than a cap allows; past one, the commission is refused and nothing is recorded. A renewal is the owner's, recorded with its time beside the events; it belongs to no commission. A trigger's commission, unless named, is named after it and numbered, `nightly-3`. The owner's own commissions have no trigger and no caps.

A commission step starts top-level commissions of a workflow through a trigger, one per document a query names, each its request, each given the artifacts named queries name, as a child is; it runs no program and waits on none of them. Its attempt starts all or none in one write: if the trigger cannot start every one now, it starts none and the commission escalates; otherwise it completes at once, on `done`. Commissions that start commissions are a loop no budget bounds, so an engine refuses one whose trigger has no allowance, or that it lacks or that may not start the workflow. Each started commission names the trigger, commission, step and attempt as its origin, runs on the factory's definitions as they are when it starts, and is no child: nothing withdraws it.

**Watching**

A command step may watch, with an interval of at least 1 s and a wait limit. Its attempt is the wait: it spends a unit of the step's budget and holds no program. Each interval its program runs as a check, under the step contract with the attempt's inputs and an empty workspace, one check at a time whichever engines look. A check that exits 0 without writing `output.json` found nothing yet, and leaves no event; one that writes it claims, as any step does, and ends the attempt. A check that fails is the engine's note, and the wait goes on; the third to fail in a row escalates with its reason. Past its wait limit, or cancelled by the owner, the attempt escalates. An engine stopping does not interrupt the wait: the next engine to look carries it on.

**Artifact kinds**

A step declares the kinds it may claim; a claim of any other kind is invalid. A kind is data: a name; a role, subject or judgement; a schema for its fields, each with a size limit; whether it has a body, UTF-8 text, with its size limit; and optionally a verifier, a materialiser and an outcome field. An artifact's hash covers its kind, fields and body hash, the same way for every kind. A judgement's subject is always named by artifact hash.

A kind's verifier and materialiser are programs, each with its own access and limits, run in a sandbox like a step's; a verifier's limits include the bytes it may keep. They get less of the step contract: no descriptor for notes, their stdout discarded, and their stderr only as the end of a failure's reason. The record names the verifier that accepted an artifact; a materialiser's run is recorded only when it fails. A factory defines its kinds; a commission records them by hash with its workflow, and they must include document and cannot include decision. The owner's request is a document with a title and a body, so document must be a subject, define a title, require no other field and have no verifier; a request that breaks its rules is refused before the commission starts.

A verifier is a program run after a claim parses, under the step contract:

- the attempt's workspace as its working directory, in the mode its access gives: read-only for the built-in commit verifier;
- `MEDRENGARD_IN` holding `claim.json`: the claim's kind and fields, its body and the commission's current subject;
- `MEDRENGARD_OUT`, where it writes `output.json`: accepted, with the files to keep, or rejected, with a reason.

Kept files go to the store, attached to the artifact. A rejected claim or a failed verifier escalates. The record names the verifier that accepted an artifact, or that its kind has none.

A materialiser is a program that builds a later step's workspace from an artifact and its kept files, in an empty directory; a workflow whose workspace may be built from a kind without one is refused before it starts. `MEDRENGARD_IN` holds `artifact.json`, describing the artifact, and when the step adds branches, `branches.json`, describing each with its branch, its files under `branches/<branch>/`. A kind whose materialiser can add them says so; a workflow whose workspace may add branches of any other kind is refused before it starts. A kind's outcome field must equal the outcome of the step that claims it, and a step that may claim it needs an edge for each of its values.

The latest subject artifact an attempt claims becomes the subject; a judgement leaves the subject where it was. A judgement a step claims is about the subject that attempt was given, so an attempt that claims a new subject cannot also claim a judgement whose outcome field routes it: the commission escalates.

Built in:

- Document: a subject with a title and a required text body, such as markdown. No verifier; its materialiser writes the body.
- Commit: a subject with a SHA and an optional report. Its verifier accepts a SHA that is the workspace HEAD, not already the current subject, and whose tree differs from its parent's and the subject's, and keeps a Git bundle that holds its whole history, or refuses it; its materialiser clones the bundle at that SHA, then fetches each branch's commit from its bundle as that branch, leaving no remote.
- Verdict: a judgement with pass or fail, an optional one-line summary and its findings as an optional text body. Its outcome field is the verdict. The step never names the subject; the engine records the one the attempt was given.
- Decision: a judgement with the owner's outcome and optional feedback.

Decisions are the owner's. A decision renews budgets, approves a subject and resolves escalations, so only the owner makes one, at an approval step or on an escalated commission; no step or kind's program sees the log or store, whatever its access, unless the access names them. A step that claims a decision escalates. Cancelling is not a decision: it stops an attempt and escalates, and the owner then decides on the escalation. A model's choice is an outcome or a judgement, routed like any other.

**Language**

One word per concept, used the same way in speech, docs, code and tests. Each context owns its words.

_Definition: what the owner writes; data, verified before anything runs._

- Factory: the owner's workflows, agents and extensions. Medrengard builds factories; it is not one.
- Workflow: a graph of steps whose edges are labelled by outcome.
- Step: a node of a workflow, of one kind: an agent step runs an agent through its harness adapter, attended or unattended; a command step runs the owner's program, once or, watching, as a check each interval; an approval step waits for the owner's decision; a children step waits on child commissions; a commission step starts commissions through a trigger and waits on none.
- Agent: a reusable definition of harness, model, prompt and skills. The step supplies its workspace and inputs.
- Harness: the vendor tool an agent runs in, such as Claude Code, Codex, Pi or OpenCode.
- Prompt: what the agent is told to do at a step.
- Skill: packaged instructions or tools given to an agent.
- Artifact kind: a role, subject or judgement, a schema and a body rule, with an optional verifier, materialiser and outcome field. Built in: document, commit, verdict and decision.
- Outcome: a label a step declares; the engine routes on it.
- Access: what a step's process may read, write and reach, and its scratch areas: fresh directories on disk at the paths it names, which its disk limit bounds.
- Query: what a step declares to name the artifacts one of its inputs holds.
- Budget: the attempts a step may spend between the owner's decisions.
- Limit: any other declared bound, such as time, size, disk or money.

_Execution: the core. The commission is the aggregate root._

- Commission: one idea taken through one workflow, from the owner's request to a terminal state, with its whole history.
- Child: a commission a parent's children step commissioned, which the parent waits on.
- Trigger: a factory's declared way for a program outside the engine, or a commission step, to start commissions, within its caps; the commissions it starts name it as their origin.
- Allowance: how many commissions a trigger may start until the owner renews it.
- Check: one run of a watching step's program, which claims, finds nothing yet, or fails.
- Attempt: one start of a step's program within a commission, through to its completion or escalation.
- Claim: what an attempt wrote to its output, untrusted until it parses and its kind's verifier, if any, accepts it.
- Artifact: an immutable record of an accepted claim, identified by its hash, naming the verifier that accepted it or that its kind has none.
- Subject: the artifact the commission is currently about: its latest subject artifact, such as a document or commit.
- Judgement: an artifact that names a subject, such as a verdict or a decision.
- Evidence: the judgements about the current subject. Judgements about earlier subjects are history.
- Decision: the owner's outcome at an approval step or on an escalation, naming the current subject and the wait it ends.
- Wait: the time a commission is awaiting or escalated, from the event that began it until the owner's decision; a decision names it by that event.
- Escalation: a step that could not go on, with a cause, from a closed set, and a reason, in words. It pauses the commission for the owner, unless it is an attempt's and its step routes its cause.
- Route: a step's declared edge for an escalation of one of its attempts, by cause, to another step.
- Cancel: the owner stopping an attempt in flight; the commission escalates, and nothing is decided.
- Attend: the owner starting an attended step in their terminal and taking part in it until they leave.

_Step contract: the process boundary._

- Workspace: the directory a step's process runs in: empty, or built from the current subject or from the one artifact an input names, with the artifacts another input names as branches.
- Input: what a step declares by name and query, and receives as the artifacts the query names. Every input's bodies sit in `MEDRENGARD_IN`, beside `input.json`.
- Output: the directory where a step writes its claim, `output.json`, and the files it refers to.
- Sandbox: the confinement that enforces a step's access.
- Broker: a program a step's access names, which the engine runs outside its sandbox while an attempt runs and the step reaches on loopback: it holds a credential and adds it to what it forwards, so the credential never enters the sandbox. What the step runs can use it through the broker, but never read it.
- Harness adapter: the program that translates the step contract into a harness's own interface; vendor concepts stop there.
- Verifier: the program a kind runs to accept or reject a claim, and to name the files the store keeps.
- Materialiser: the program a kind runs to build a later step's workspace from an artifact.
- Transcript: everything a step's process wrote to its terminal or stdout and stderr during an attempt.

_Record: the log and the store._

- Event: a past-tense fact about a commission: commissioned, attempt-started, attempt-completed, noted, decided, withdrawn or escalated.
- Log: the ordered events of every commission.
- Store: content-addressed artifact bodies, kept files, transcripts and definitions.
- Replay: the pure fold from a commission's events to its state.
- Observer: a program that reads the log and never writes: every commission's events after a position, woken by the next one. Each event comes with its position in the log, to read on from, and its index among its commission's own events, which is what a decision's wait names. A waiting commission's state says which outcomes the owner may decide.
- Extension: a package supplying artifact kinds, harness adapters, commands or observers.
- Owner: the one person the factory serves.

_Not used:_ stage (step), work, run or job (commission), role, of an agent (prompt), run or execution (attempt), abort or kill (cancel, for the owner), check (verify, for the engine), runtime (harness or harness adapter), ticket and cycle (workflow policy, not core).
