import { normalize } from "node:path";
import { hasExactly, isRecord, isText } from "./json.ts";
import type { Kinds } from "./kinds.ts";
import type {
  Access,
  Children,
  Commissioning,
  Definition,
  Limits,
  Money,
  Query,
  Skill,
  Wait,
  Workflow,
} from "./replay.ts";

// An input name, which is also a directory in the step's input, so it cannot leave that directory
// or collide with input.json.
const inputName = /^[A-Za-z][A-Za-z0-9_-]*$/;

// A variable name the shell can pass on.
const variable = /^[A-Za-z_][A-Za-z0-9_]*$/;

// setTimeout fires at once past 2^31 - 1 ms, so a longer limit would stop a step immediately.
const longestLimit = 2_147_483;

/**
 * Parses the definition `text`, the workflow named `name`, the factory's kinds and its defaults as
 * stored for the commission, refusing one the engine could not run as written. Each step's limits
 * come out whole: those it states, and the factory's for the rest.
 */
export function parseDefinition(name: string, stored: string): Definition {
  const text = grantSandboxes(stored);
  const kinds = parseKinds(text);
  // The engine writes the skills, after the workflow has passed; a definition stored before skills
  // has none.
  const skills: Record<string, Skill> = JSON.parse(text).skills ?? {};
  const limits = JSON.parse(text).defaults === undefined ? before : parseDefaults(text);
  const workflow = parseWorkflow(name, text, kinds, limits);

  refuseChildren(name, workflow, text, kinds, limits);

  return { workflow, kinds, skills };
}

// Refuses children steps whose workflow the definition does not hold, or that lead back to a
// workflow they are within, so nesting is bounded; and a wait for an outcome that the child
// workflow can never end on. The definition holds every workflow its children steps reach, as
// commissioning pinned them.
function refuseChildren(
  name: string,
  workflow: Workflow<string, { limits: Limits & Money }>,
  text: string,
  kinds: Kinds,
  limits: Partial<Limits>,
): void {
  const held = JSON.parse(text).workflows ?? {};
  const parsed = new Map([[name, workflow]]);

  const visit = (at: string, within: readonly string[]) => {
    for (const [step, declared] of Object.entries(parsed.get(at)!.steps)) {
      if (declared.kind !== "children") {
        continue;
      }

      const invalid = (problem: string) =>
        new Error(`Workflow ${at} is invalid: step ${step}'s ${problem}.`);

      const child = declared.workflow;

      if (within.includes(child)) {
        throw invalid(`children lead back to workflow ${child}, which they are within`);
      }

      if (!Object.hasOwn(held, child)) {
        throw invalid(`workflow ${child} is not one of the factory's workflows`);
      }

      if (!parsed.has(child)) {
        parsed.set(
          child,
          parseWorkflow(child, JSON.stringify({ workflow: held[child] }), kinds, limits),
        );
      }

      const outcome = waitOutcome(declared.wait);

      const ends = Object.values(parsed.get(child)!.steps).some(
        (each) => outcome !== undefined && outcome !== null && each.on[outcome] === "end",
      );

      if (isText(outcome) && !ends) {
        throw invalid(
          `wait counts children ending on ${outcome}, which workflow ${child} never ends on`,
        );
      }

      visit(child, [...within, child]);
    }
  };

  visit(name, [name]);
}

const limitNames = ["idle", "attempt", "transcript", "input", "memory", "processes", "disk"];

// What a step of a definition stored before the factory had defaults ran with when it left a
// limit out; it stated the other four.
const before: Partial<Limits> = {
  memory: 4 * 1024 * 1024 * 1024,
  processes: 1024,
  disk: 4 * 1024 * 1024 * 1024,
};

function parseDefaults(text: string): Limits {
  const invalid = (problem: string) =>
    new Error(`The factory's default limits are invalid: ${problem}.`);

  const { defaults } = JSON.parse(text);
  const limits = defaults?.limits;

  if (!hasExactly(defaults, ["limits"]) || !hasExactly(limits, limitNames)) {
    throw invalid(`they must be idle, attempt, transcript, input, memory, processes and disk`);
  }

  const problem = limitProblem(Object.entries(limits), false);

  if (problem !== undefined) {
    throw invalid(problem);
  }

  // SAFETY: each of the seven was checked above.
  return limits as Limits;
}

// Why one of the limits, by name and value, cannot bound a step, attended or not, if one cannot:
// the seconds within what a timer can wait, or unbounded for an attended step, the rest positive
// integers.
function limitProblem(
  limits: readonly (readonly [string, unknown])[],
  attended: boolean,
): string | undefined {
  for (const [limit, value] of limits) {
    if (limit === "idle" || limit === "attempt") {
      if (value === "unbounded") {
        if (!attended) {
          return `${limit} limit may be unbounded only for an attended step`;
        }
      } else if (!Number.isFinite(value) || Number(value) <= 0 || Number(value) > longestLimit) {
        return `${limit} limit must be a positive number of seconds, at most ${longestLimit}`;
      }
    } else if (!Number.isInteger(value) || Number(value) <= 0) {
      return `${limit} limit must be a positive integer`;
    }
  }

  return undefined;
}

// A kind's name, which a query, a claim and a message name it by.
const kindName = /^[A-Za-z][A-Za-z0-9-]*$/;

// What a kind's program of a definition stored before the factory had defaults ran with; it
// stated only its program, access and time limit. A verifier then kept files of at most 64 MiB
// each, now read as 64 MiB in all.
const programBefore = { memory: 4 * 1024 * 1024 * 1024, processes: 1024 };
const keptBefore = 64 * 1024 * 1024;

function parseKinds(text: string): Kinds {
  const { kinds, defaults } = JSON.parse(text);
  const invalid = (problem: string) => new Error(`The kinds are invalid: ${problem}.`);

  if (!isRecord(kinds)) {
    throw invalid("they must be kinds by name");
  }

  if (!Object.hasOwn(kinds, "document")) {
    throw invalid("they must include document, the kind of the owner's request");
  }

  if (Object.hasOwn(kinds, "decision")) {
    throw invalid("decision is the owner's, so no kind can be named decision");
  }

  for (const [name, kind] of Object.entries(kinds)) {
    const refused = (problem: string) => new Error(`Kind ${name} is invalid: ${problem}.`);

    if (!kindName.test(name)) {
      throw invalid(`${JSON.stringify(name)} is not letters, digits or -, starting with a letter`);
    }

    // Read before hasExactly, which narrows what it checks to object.
    const { role, description, fields, body, outcome, verifier, materialiser } = kind ?? {};
    const programs = { verifier, materialiser };

    const optional = ["outcome", "verifier", "materialiser"].filter((field) =>
      Object.hasOwn(kind ?? {}, field),
    );

    if (!hasExactly(kind, ["role", "description", "fields", "body", ...optional])) {
      throw refused("it does not have exactly the fields a kind defines");
    }

    if (role !== "subject" && role !== "judgement") {
      throw refused("its role must be subject or judgement");
    }

    if (!isText(description)) {
      throw refused("its description must be text");
    }

    const rules = new Map(isRecord(fields) ? Object.entries(fields) : []);

    if (!isRecord(fields)) {
      throw refused("its fields must be each field's rule by name");
    }

    for (const [field, rule] of rules) {
      if (role === "judgement" && field === "subject") {
        throw refused(
          "the engine names a judgement's subject, so it cannot define a subject field",
        );
      }

      const { limit, required, values } = rule ?? {};

      const given = ["required", "values"].filter((each) => Object.hasOwn(rule ?? {}, each));

      if (!hasExactly(rule, ["limit", ...given])) {
        throw refused(`field ${field} must be its limit, and whether it is required or its values`);
      }

      if (!Number.isInteger(limit) || limit <= 0) {
        throw refused(`field ${field}'s limit must be a positive integer`);
      }

      if (required !== undefined && required !== true) {
        throw refused(`field ${field} may only be required: true`);
      }

      if (values !== undefined && !(Array.isArray(values) && values.every(isText))) {
        throw refused(`field ${field}'s values must be a list of text`);
      }
    }

    const { required, limit } = body ?? {};

    if (
      (required !== true && required !== false) ||
      !Number.isInteger(limit) ||
      limit <= 0 ||
      !hasExactly(body, ["required", "limit"])
    ) {
      throw refused("its body must be whether it is required, and its limit, a positive integer");
    }

    // The outcome is checked against the field's value, so the field must always hold one of them.
    if (
      outcome !== undefined &&
      !(isText(outcome) && rules.get(outcome)?.required === true && rules.get(outcome).values)
    ) {
      throw refused("its outcome must name a required field with values");
    }

    for (const [program, given] of Object.entries(programs)) {
      // JSON has no undefined, so an absent program is the only one that is.
      if (given === undefined) {
        continue;
      }

      const verifying = program === "verifier";
      const before = verifying ? { ...programBefore, kept: keptBefore } : programBefore;
      const stated = defaults === undefined ? { ...before, ...given } : given;
      const { run, access, limit, memory, processes, kept, branches } = stated;
      const bounds = ["limit", "memory", "processes", ...(verifying ? ["kept"] : [])];
      const adds = !verifying && Object.hasOwn(stated, "branches") ? ["branches"] : [];

      if (!hasExactly(stated, ["run", "access", ...bounds, ...adds])) {
        throw refused(
          verifying
            ? `its verifier must be a program, its access, and its limit, memory, processes and kept`
            : `its ${program} must be a program, its access, and its limit, memory and processes`,
        );
      }

      if (!Array.isArray(run) || run.length === 0 || !run.every(isText)) {
        throw refused(`its ${program}'s program must be a command and its arguments`);
      }

      const problem = accessProblem(access, false);

      if (problem !== undefined) {
        throw refused(`its ${program}'s ${problem}`);
      }

      if (!Number.isFinite(limit) || limit <= 0 || limit > longestLimit) {
        throw refused(
          `its ${program}'s limit must be a positive number of seconds, at most ${longestLimit}`,
        );
      }

      for (const [bound, value] of Object.entries({ memory, processes })) {
        if (!Number.isInteger(value) || value <= 0) {
          throw refused(`its ${program}'s ${bound} must be a positive integer`);
        }
      }

      if (adds.length > 0 && branches !== true) {
        throw refused("its materialiser may only state branches: true");
      }

      // A verifier that only judges keeps nothing.
      if (verifying && (!Number.isInteger(kept) || kept < 0)) {
        throw refused("its verifier's kept must be an integer, 0 or more");
      }

      Object.assign(given, stated);
    }
  }

  // SAFETY: every field the engine reads was checked above.
  const parsed = kinds as Kinds;

  // The engine makes the owner's request a document itself, with a title and a body.
  const { document } = parsed;

  const unfit = (problem: string) =>
    new Error(`Kind document is invalid: the owner's request is a document, ${problem}.`);

  if (document.role !== "subject") {
    throw unfit("so it must be a subject");
  }

  if (!Object.hasOwn(document.fields, "title")) {
    throw unfit("so it must define a title");
  }

  if (Object.entries(document.fields).some(([field, rule]) => field !== "title" && rule.required)) {
    throw unfit("so only its title can be required");
  }

  if (document.verifier !== undefined) {
    throw unfit("and no attempt claims it, so it cannot have a verifier");
  }

  return parsed;
}

// What is wrong with `access`, said of whatever it belongs to, or undefined when nothing is.
// A host a step's access may list: a name or address, any of its subdomains as *.name, and a port.
const host = /^(\*\.)?[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*(:[0-9]{1,5})?$/;

// A broker's name, which names the variable that gives the step its address.
const brokerName = /^[a-z][a-z0-9]*$/;

// Whether `network` lists what a step may reach: hosts, and any brokers, at least one of either.
function networkListed(network: Exclude<Access["network"], boolean>): boolean {
  if (!hasExactly(network, Object.hasOwn(network, "brokers") ? ["hosts", "brokers"] : ["hosts"])) {
    return false;
  }

  const fields = new Map(Object.entries(network));
  const named = fields.get("hosts");
  const brokers = fields.get("brokers") ?? {};

  const hostsListed =
    Array.isArray(named) && named.every((each) => isText(each) && host.test(each));

  const brokersListed =
    isRecord(brokers) &&
    Object.entries(brokers).every(
      ([name, run]) =>
        brokerName.test(name) && Array.isArray(run) && run.length > 0 && run.every(isText),
    );

  return hostsListed && brokersListed && (named.length > 0 || Object.keys(brokers).length > 0);
}

// Why `access` cannot confine a program, if it cannot. `hosts`, whether its network may list the
// hosts it reaches: a step's may, a kind program's not.
function accessProblem(access: Access, hosts = true): string | undefined {
  const keys = ["paths", "network", "environment", "workspace", "sandboxes"];

  if (!hasExactly(access, Object.hasOwn(access, "values") ? [...keys, "values"] : keys)) {
    return "access must be its paths, network, environment, workspace and sandboxes, and any values";
  }

  const { paths, network, environment, values = {}, workspace, sandboxes } = access;

  if (
    !Array.isArray(paths) ||
    !paths.every((entry) => {
      const { path, mode } = entry;
      const size = mode === "empty" ? entry.size : undefined;

      return (
        isText(path) &&
        path === normalize(path) &&
        path.startsWith("/") &&
        (mode === "empty"
          ? hasExactly(entry, ["path", "mode", "size"]) && Number.isInteger(size) && size! > 0
          : hasExactly(entry, ["path", "mode"]) &&
            (mode === "read" || mode === "write" || mode === "scratch"))
      );
    })
  ) {
    return "paths must each be an absolute path and a mode: read, write, scratch, or empty with a size";
  }

  if (
    paths.some(({ path }) =>
      ["/workspace", "/input", "/output", "/network"].some(
        (area) => path === area || path.startsWith(`${area}/`),
      ),
    )
  ) {
    return "paths cannot name /workspace, /input, /output or /network, where the step contract's directories and its network's proxy are";
  }

  // lazy: a kind program's network is all or none. Let it list hosts once a verifier needs some.
  const listed = hosts && network !== true && network !== false && networkListed(network);

  if (network !== true && network !== false && !listed) {
    return hosts
      ? "network access must be true, false, or hosts it may reach and any brokers, each a name of lowercase letters and digits and a program"
      : "network access must be true or false";
  }

  if (listed && paths.some(({ path }) => path === "/")) {
    return "network access cannot list hosts when its paths grant /, which leaves no place for its proxy";
  }

  if (
    environment !== "all" &&
    !(Array.isArray(environment) && environment.every((each) => variable.test(each)))
  ) {
    return "environment must be all or a list of variable names";
  }

  if (
    !isRecord(values) ||
    !Object.entries(values).every(
      ([name, value]) =>
        variable.test(name) &&
        isText(value) &&
        name !== "MEDRENGARD_IN" &&
        name !== "MEDRENGARD_OUT" &&
        (environment === "all" || !environment.includes(name)),
    )
  ) {
    return (
      "values must each set a variable by name to text, " +
      "neither MEDRENGARD_IN nor MEDRENGARD_OUT nor one its environment passes through"
    );
  }

  if (workspace !== "read" && workspace !== "write") {
    return "workspace access must be read or write";
  }

  if (sandboxes !== true && sandboxes !== false) {
    return "sandboxes must be true or false";
  }

  return undefined;
}

// A definition stored before the factory had defaults predates `sandboxes`: its steps' and kinds'
// programs could make namespaces of their own, so they read as they ran.
function grantSandboxes(text: string): string {
  // Only what is read here is typed: the parsers below check the rest.
  const stored: {
    defaults?: unknown;
    workflow?: { steps?: Record<string, { access?: unknown }> };
    kinds?: Record<
      string,
      { verifier?: { access?: unknown }; materialiser?: { access?: unknown } }
    >;
  } = JSON.parse(text);

  if (stored.defaults !== undefined) {
    return text;
  }

  const programs = [
    ...Object.values(stored.workflow?.steps ?? {}),
    ...Object.values(stored.kinds ?? {}).flatMap((kind) => [kind?.verifier, kind?.materialiser]),
  ];

  for (const program of programs) {
    const access = program?.access;

    if (isRecord(access) && !Object.hasOwn(access, "sandboxes")) {
      Object.assign(access, { sandboxes: true });
    }
  }

  return JSON.stringify(stored);
}

function parseWorkflow(
  name: string,
  text: string,
  defined: Kinds,
  defaults: Partial<Limits>,
): Workflow<string, { limits: Limits & Money }> {
  const invalid = (problem: string) => new Error(`Workflow ${name} is invalid: ${problem}.`);
  const definition = JSON.parse(text).workflow;
  const claimable = Object.keys(defined);

  // Every kind a query can name: those a step may claim, and the owner's decision.
  const kinds = [...claimable, "decision"];
  const start = definition?.start;
  const steps = definition?.steps;
  const usd = definition?.usd;

  const fields = ["start", "steps", ...(Object.hasOwn(definition ?? {}, "usd") ? ["usd"] : [])];

  if (!hasExactly(definition, fields) || !isRecord(steps)) {
    throw invalid("it is not a start and its steps, and a money limit if it has one");
  }

  // A money limit is a positive, finite number of US dollars.
  if (fields.includes("usd") && !(Number.isFinite(usd) && usd > 0)) {
    throw invalid("its money limit must be a positive number of dollars");
  }

  const names = Object.keys(steps);

  if (names.includes("end")) {
    throw invalid("end is reserved, so no step can be named end");
  }

  if (!names.includes(start)) {
    throw invalid("its start is not one of its steps");
  }

  // Whether a session query names a step of the workflow whose attempts run a program.
  const kindsOfSteps = new Map(
    Object.entries(steps).map(([step, declared]) => [step, declared?.kind]),
  );

  const runsProgram = (step: string) =>
    names.includes(step) &&
    kindsOfSteps.get(step) !== "approval" &&
    kindsOfSteps.get(step) !== "children" &&
    kindsOfSteps.get(step) !== "commission";

  // Whether `query` is one the engine can resolve: subject, request, a query over the record, a
  // session of a step that runs a program, or the artifacts of one kind a children step's
  // children claimed.
  const validQuery = (query: Query) =>
    query === "subject" ||
    query === "request" ||
    (hasExactly(query, ["session"]) && runsProgram(String(Object.values(query)[0]))) ||
    childrenQuery(query) ||
    (isRecord(query) &&
      !Object.hasOwn(query, "session") &&
      !Object.hasOwn(query, "children") &&
      Object.entries(query).every(
        ([field, value]) =>
          (field === "from" &&
            Array.isArray(value) &&
            value.every((from) => names.includes(from))) ||
          (field === "kind" && isText(value) && kinds.includes(value)) ||
          (field === "about" && (value === "subject" || value === "earlier" || value === "any")) ||
          (field === "take" && (value === "latest" || value === "all")),
      ));

  // Whether `query` reads a children step's children: names one, a kind, and any take.
  function childrenQuery(query: Query): boolean {
    if (!isRecord(query) || !Object.hasOwn(query, "children")) {
      return false;
    }

    const fields = new Map<string, unknown>(Object.entries(query));
    const take = fields.get("take");
    const kind = fields.get("kind");

    return (
      hasExactly(query, take === undefined ? ["children", "kind"] : ["children", "kind", "take"]) &&
      kindsOfSteps.get(String(fields.get("children"))) === "children" &&
      isText(kind) &&
      kinds.includes(kind) &&
      (take === undefined || take === "latest" || take === "all")
    );
  }

  for (const [name, step] of Object.entries(steps)) {
    const on = step?.on;
    const kind = step?.kind;

    const leads =
      isRecord(on) &&
      Object.values(on).every((next) => isText(next) && (next === "end" || names.includes(next)));

    if (!leads) {
      throw invalid(`step ${name}'s edges must each lead to a step or the end`);
    }

    // An approval with none could never be decided, and a program step's every claim would escalate.
    if (Object.keys(on).length === 0) {
      throw invalid(`step ${name} has no outcomes`);
    }

    if (kind === "approval") {
      if (!hasExactly(step, ["kind", "on"])) {
        throw invalid(`step ${name} has fields an approval step does not define`);
      }

      if (Object.hasOwn(on, "abandon")) {
        throw invalid(
          `step ${name} cannot declare abandon, which the owner may decide at every wait`,
        );
      }

      continue;
    }

    if (kind === "children") {
      const problem = childrenProblem(step, validQuery);

      if (problem !== undefined) {
        throw invalid(`step ${name}'s ${problem}`);
      }

      continue;
    }

    if (kind === "commission") {
      const problem = commissioningProblem(step, validQuery);

      if (problem !== undefined) {
        throw invalid(`step ${name}'s ${problem}`);
      }

      continue;
    }

    if (kind !== "command" && kind !== "agent") {
      throw invalid(`step ${name} has an undeclared kind: ${JSON.stringify(kind)}`);
    }

    const program = kind === "command" ? "run" : "agent";
    const { workspace, inputs, claims, budget, access, limits, attended } = step;
    const { agent } = step;
    const harness = agent?.harness;
    const argv = kind === "command" ? step.run : harness?.run;

    const watch = step.watch;

    const fields = [
      "kind",
      "workspace",
      "inputs",
      "claims",
      program,
      ...(kind === "agent" && Object.hasOwn(step, "attended") ? ["attended"] : []),
      ...(kind === "command" && Object.hasOwn(step, "watch") ? ["watch"] : []),
      "on",
      "budget",
      "access",
      ...(Object.hasOwn(step, "limits") ? ["limits"] : []),
    ];

    if (!hasExactly(step, fields)) {
      throw invalid(`step ${name} does not have exactly the fields a ${kind} step defines`);
    }

    // Read before hasExactly, which narrows what it checks to object.
    const { interval, wait } = watch ?? {};

    if (
      watch !== undefined &&
      !(
        hasExactly(watch, ["interval", "wait"]) &&
        Number.isFinite(interval) &&
        interval >= 1 &&
        Number.isFinite(wait) &&
        wait > 0 &&
        wait <= longestLimit
      )
    ) {
      throw invalid(
        `step ${name}'s watch must be an interval of at least 1 s and a wait limit of at most ${longestLimit} s`,
      );
    }

    // A check reads the world; it builds nothing to read.
    if (watch !== undefined && workspace !== "empty") {
      throw invalid(`step ${name}'s workspace must be empty, since it watches`);
    }

    // The query of the input the workspace is built from, which must name at most one artifact.
    const declared = new Map(isRecord(inputs) ? Object.entries(inputs) : []);
    const named = workspace?.input;
    const branches = workspace?.branches;
    const addsBranches = Object.hasOwn(workspace ?? {}, "branches");
    const fromInput = addsBranches ? ["input", "branches"] : ["input"];
    const source = hasExactly(workspace, fromInput) ? declared.get(named) : undefined;
    const take = source?.take;

    if (
      workspace !== "subject" &&
      workspace !== "empty" &&
      source !== "subject" &&
      source !== "request" &&
      !(isRecord(source) && take === "latest" && !Object.hasOwn(source, "children"))
    ) {
      throw invalid(
        `step ${name}'s workspace must be subject, empty, or one of its inputs that names at most one artifact: subject, request or a query that takes the latest`,
      );
    }

    // Branches are any artifacts an input names, a session being none.
    const added = addsBranches ? declared.get(branches) : undefined;

    if (addsBranches && (added === undefined || Object.hasOwn(added, "session"))) {
      throw invalid(
        `step ${name}'s workspace branches must name one of its inputs that names artifacts`,
      );
    }

    // A child's branch is named after the child, so it can hold only one of its artifacts.
    if (Object.hasOwn(added ?? {}, "children") && added.take === "all") {
      throw invalid(
        `step ${name}'s workspace branches cannot take all of each child's artifacts, since a child's branch holds one`,
      );
    }

    if (isRecord(inputs) && !Object.keys(inputs).every((input) => inputName.test(input))) {
      throw invalid(
        `step ${name}'s input names must each be letters, digits, - or _, starting with a letter`,
      );
    }

    if (!isRecord(inputs) || !Object.values(inputs).every(validQuery)) {
      throw invalid(
        `step ${name}'s inputs must each be subject, request, a query whose from names its steps, kind a kind, about subject, earlier or any, and take latest or all, a session of one of its steps that runs a program, or a children step's children, a kind and any take`,
      );
    }

    if (
      !Array.isArray(claims) ||
      !claims.every((claim) => isText(claim) && claimable.includes(claim))
    ) {
      throw invalid(
        `step ${name}'s claims must each be a kind a step may claim: ${claimable.join(", ")}`,
      );
    }

    if (!(attended === undefined || attended === true || attended === false)) {
      throw invalid(`step ${name}'s attended must be true or false`);
    }

    const skills = agent?.skills;

    if (
      kind === "agent" &&
      (!isText(agent?.model) ||
        !isText(agent?.prompt) ||
        !(skills === undefined || (Array.isArray(skills) && skills.every(isText))) ||
        !hasExactly(agent, [
          "harness",
          "model",
          "prompt",
          ...(skills === undefined ? [] : ["skills"]),
        ]) ||
        !hasExactly(harness, Object.hasOwn(harness ?? {}, "costs") ? ["run", "costs"] : ["run"]))
    ) {
      throw invalid(
        `step ${name}'s agent must be a harness, a model, a prompt and any skills, a list of paths`,
      );
    }

    const costless = kind === "agent" && Object.hasOwn(harness, "costs");

    if (costless && harness.costs !== false) {
      throw invalid(`step ${name}'s harness may say only costs: false, when it reports no cost`);
    }

    if (costless && Object.hasOwn(definition, "usd")) {
      throw invalid(
        `its money limit cannot be kept: step ${name}'s agent's harness reports no cost`,
      );
    }

    if (!Array.isArray(argv) || argv.length === 0 || !argv.every(isText)) {
      throw invalid(`step ${name}'s program must be a command and its arguments`);
    }

    if (!Number.isInteger(budget) || budget <= 0) {
      throw invalid(`step ${name}'s budget must be a positive integer`);
    }

    const problem = accessProblem(access);

    if (problem !== undefined) {
      throw invalid(`step ${name}'s ${problem}`);
    }

    // The money limit apart: it is the step's alone, never a default.
    const stated = new Map(Object.entries(isRecord(limits) ? limits : {}));
    const money = stated.get("usd");

    stated.delete("usd");

    const bounds = Object.fromEntries(stated);
    const whole = { ...defaults, ...bounds };

    if (!(limits === undefined || isRecord(limits)) || !hasExactly(whole, limitNames)) {
      throw invalid(
        `step ${name}'s limits may be only idle, attempt, transcript, input, memory, processes, disk and usd`,
      );
    }

    if (money !== undefined && !(Number.isFinite(money) && Number(money) > 0)) {
      throw invalid(`step ${name}'s money limit must be a positive number of dollars`);
    }

    if (money !== undefined && costless) {
      throw invalid(
        `step ${name}'s money limit cannot be kept: its agent's harness reports no cost`,
      );
    }

    // lazy: money only. Add a token limit once an adapter can report tokens but not cost.
    if (money !== undefined && attended === true) {
      throw invalid(
        `step ${name}'s money limit cannot be kept at an attended step, which reports no cost`,
      );
    }

    if (money !== undefined) {
      Object.assign(whole, { usd: money });
    }

    const unbounded = limitProblem(Object.entries(bounds), attended === true);

    if (unbounded !== undefined) {
      throw invalid(`step ${name}'s ${unbounded}`);
    }

    // A kind whose field is the outcome makes each of its values an outcome the step may claim.
    for (const claim of claims) {
      const field = defined[claim].outcome;
      const values = field === undefined ? [] : (defined[claim].fields[field].values ?? []);
      const unrouted = values.find((value) => !Object.hasOwn(on, value));

      if (unrouted !== undefined) {
        throw invalid(
          `step ${name} may claim a ${claim} whose ${field} is ${unrouted}, an outcome it has no edge for`,
        );
      }
    }

    Object.assign(step, { limits: whole });
  }

  // SAFETY: every field the engine reads was checked above, and each step's limits made whole.
  const parsed = definition as Workflow<string, { limits: Limits & Money }>;

  refuseUnbuildable(parsed, defined, invalid);

  return parsed;
}

// The fields a children step may have: each or count, a request only with count, and given only
// when there are some.
function childrenFields(step: Children<string>): string[] {
  const has = (field: string) => Object.hasOwn(step, field);

  return [
    "kind",
    "workflow",
    ...(has("each") ? ["each"] : []),
    ...(has("count") ? ["count"] : []),
    ...(has("request") ? ["request"] : []),
    ...(has("given") ? ["given"] : []),
    "width",
    "concurrent",
    "wait",
    "on",
    "budget",
    "limits",
  ];
}

const positive = (value: number) => Number.isSafeInteger(value) && value > 0;

// Why the children step `step` cannot run, if it cannot; `valid` says whether a query is one its
// workflow can resolve. That the workflow it names is the factory's, and leads not back to its
// own, is checked with the definition's workflows.
function childrenProblem(
  step: Children<string>,
  valid: (query: Query) => boolean,
): string | undefined {
  const { workflow, each, count, request, given, width, concurrent, wait, on, budget, limits } =
    step;

  if (!hasExactly(step, childrenFields(step))) {
    return "fields must be a children step's: its workflow, each or count, any request and given, width, concurrent, wait, on, budget and limits";
  }

  if (!isText(workflow)) {
    return "workflow must name a workflow";
  }

  if ((each === undefined) === (count === undefined)) {
    return "children must come from each, or count, not both";
  }

  // A child's request is a document.
  const documents = (query: Query | undefined) =>
    query !== undefined &&
    valid(query) &&
    isRecord(query) &&
    new Map(Object.entries(query)).get("kind") === "document";

  if (each !== undefined && !documents(each)) {
    return "each must be a query of documents, which become the children's requests";
  }

  if (count !== undefined && !positive(count)) {
    return "count must be a positive integer";
  }

  if (
    request !== undefined &&
    (count === undefined ||
      !(
        request === "request" ||
        (documents(request) && new Map(Object.entries(request)).get("take") === "latest")
      ))
  ) {
    return "request must be request, or a query of documents that takes the latest, and goes with count";
  }

  if (
    given !== undefined &&
    !(
      isRecord(given) &&
      Object.entries(given).every(
        ([input, query]) =>
          inputName.test(input) &&
          input !== "each" &&
          input !== "request" &&
          valid(query) &&
          !(isRecord(query) && Object.hasOwn(query, "session")),
      )
    )
  ) {
    return "given must name artifacts, each by an input name other than each or request and a query that is no session";
  }

  if (!positive(width) || !positive(concurrent) || concurrent > width) {
    return "width and concurrent must be positive integers, concurrent at most width";
  }

  if (count !== undefined && count > width) {
    return `count of ${count} is over its width of ${width}`;
  }

  const outcome = waitOutcome(wait);

  if (outcome === null) {
    return 'wait must be "all", "first", { atLeast: N } with any outcome, or { all: <outcome> }';
  }

  if (isRecord(wait) && "atLeast" in wait && wait.atLeast > (count ?? width)) {
    return `wait for at least ${wait.atLeast} children is over the ${count ?? width} it may have`;
  }

  const outcomes = outcome === undefined ? ["done"] : ["met", "unmet"];

  if (!hasExactly(on, outcomes)) {
    return `edges must be ${outcomes.join(" and ")}, the outcomes of its wait`;
  }

  if (!positive(budget)) {
    return "budget must be a positive integer";
  }

  if (
    !hasExactly(limits, ["wait"]) ||
    !positive(new Map(Object.entries(limits)).get("wait") ?? 0)
  ) {
    return "limits must be wait, a positive number of seconds";
  }

  return undefined;
}

// Why the commission step `step` cannot run, if it cannot; `valid` says whether a query is one its
// workflow can resolve. Its trigger and workflow are the factory's, checked when an engine starts.
function commissioningProblem(
  step: Commissioning<string>,
  valid: (query: Query) => boolean,
): string | undefined {
  const { trigger, workflow, each, given, on, budget } = step;

  const fields = [
    "kind",
    "trigger",
    "workflow",
    "each",
    ...(Object.hasOwn(step, "given") ? ["given"] : []),
    "on",
    "budget",
  ];

  if (!hasExactly(step, fields)) {
    return "fields must be a commission step's: its trigger, workflow, each, any given, on and budget";
  }

  if (!isText(trigger) || !isText(workflow)) {
    return "trigger and workflow must name the factory's";
  }

  // Each commission's request is a document.
  if (
    !(
      each === "request" ||
      (valid(each) && isRecord(each) && new Map(Object.entries(each)).get("kind") === "document")
    )
  ) {
    return "each must be request, or a query of documents, which become the commissions' requests";
  }

  if (
    given !== undefined &&
    !(
      isRecord(given) &&
      Object.entries(given).every(
        ([input, query]) =>
          inputName.test(input) &&
          input !== "each" &&
          valid(query) &&
          !(isRecord(query) && Object.hasOwn(query, "session")),
      )
    )
  ) {
    return "given must name artifacts, each by an input name other than each and a query that is no session";
  }

  if (!hasExactly(on, ["done"])) {
    return "edges must be done alone: it goes on once it has started its commissions";
  }

  if (!positive(budget)) {
    return "budget must be a positive integer";
  }

  return undefined;
}

/**
 * The outcome a wait counts children ending on: undefined for one that counts any end, or null for
 * a wait that is none.
 */
export function waitOutcome(wait: Wait): string | undefined | null {
  if (wait === "all" || wait === "first") {
    return undefined;
  }

  if (!isRecord(wait)) {
    return null;
  }

  const fields = new Map<string, unknown>(Object.entries(wait));
  const all = fields.get("all");
  const atLeast = fields.get("atLeast");
  const outcome = fields.get("outcome");

  if (hasExactly(wait, ["all"])) {
    return isText(all) ? all : null;
  }

  if (!Number.isSafeInteger(atLeast) || Number(atLeast) <= 0) {
    return null;
  }

  if (hasExactly(wait, ["atLeast"])) {
    return undefined;
  }

  return hasExactly(wait, ["atLeast", "outcome"]) && isText(outcome) ? outcome : null;
}

// Refuses a step whose workspace may be built from an artifact whose kind has no materialiser, so
// the commission does not find out only once the earlier steps have run. Every kind that could be
// the subject counts, wherever in the workflow it is claimed.
function refuseUnbuildable(
  workflow: Workflow<string, { limits: Limits & Money }>,
  kinds: Kinds,
  invalid: (problem: string) => Error,
): void {
  const programs = Object.values(workflow.steps).flatMap((step) =>
    step.kind === "approval" || step.kind === "children" || step.kind === "commission"
      ? []
      : [step],
  );

  const subjects = [
    "document",
    ...programs.flatMap((step) => step.claims.filter((kind) => kinds[kind].role === "subject")),
  ];

  // The kinds the artifacts `from` the steps named may be: a decision from an approval.
  const claimedBy = (from: readonly string[]) =>
    from.flatMap((name) => {
      const step = workflow.steps[name];

      return step.kind === "approval"
        ? ["decision"]
        : step.kind === "children" || step.kind === "commission"
          ? []
          : step.claims;
    });

  // The kinds the artifacts `query` names may be; a session is no artifact.
  const possible = (query: Query) =>
    query === "subject"
      ? subjects
      : query === "request"
        ? ["document"]
        : "session" in query
          ? []
          : query.kind !== undefined
            ? [query.kind]
            : "from" in query && query.from !== undefined
              ? claimedBy(query.from)
              : [...Object.keys(kinds), "decision"];

  for (const [name, step] of Object.entries(workflow.steps)) {
    if (
      step.kind === "approval" ||
      step.kind === "children" ||
      step.kind === "commission" ||
      step.workspace === "empty"
    ) {
      continue;
    }

    const { workspace } = step;
    const base = possible(workspace === "subject" ? "subject" : step.inputs[workspace.input]);
    const unbuildable = base.find((kind) => kinds[kind]?.materialiser === undefined);

    if (unbuildable !== undefined) {
      throw invalid(
        `step ${name}'s workspace may be built from a ${unbuildable}, whose kind has no materialiser`,
      );
    }

    // lazy: a branch of another kind than the base's escalates only once the step is reached.
    // Refuse it here once a workflow is found to mix them.
    const added =
      workspace === "subject" || workspace.branches === undefined
        ? []
        : possible(step.inputs[workspace.branches]);

    const unbranchable = added.find((kind) => kinds[kind]?.materialiser?.branches !== true);

    if (unbranchable !== undefined) {
      throw invalid(
        `step ${name}'s workspace may add branches of a ${unbranchable}, whose kind's materialiser cannot add them`,
      );
    }
  }
}
