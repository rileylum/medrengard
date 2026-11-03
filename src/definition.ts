import { normalize } from "node:path";
import { hasExactly, isRecord, isText } from "./json.ts";
import type { Kinds } from "./kinds.ts";
import type { Access, Definition, Limits, Skill, Workflow } from "./replay.ts";

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
export function parseDefinition(name: string, text: string): Definition {
  const kinds = parseKinds(text);
  // The engine writes the skills, after the workflow has passed; a definition stored before skills
  // has none.
  const skills: Record<string, Skill> = JSON.parse(text).skills ?? {};
  const limits = JSON.parse(text).defaults === undefined ? before : parseDefaults(text);

  return { workflow: parseWorkflow(name, text, kinds, limits), kinds, skills };
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

  const problem = limitProblem(Object.entries(limits));

  if (problem !== undefined) {
    throw invalid(problem);
  }

  // SAFETY: each of the seven was checked above.
  return limits as Limits;
}

// Why one of the limits, by name and value, cannot bound a step, if one cannot: the seconds
// within what a timer can wait, the rest positive integers.
function limitProblem(limits: readonly (readonly [string, unknown])[]): string | undefined {
  for (const [limit, value] of limits) {
    if (limit === "idle" || limit === "attempt") {
      if (!Number.isFinite(value) || Number(value) <= 0 || Number(value) > longestLimit) {
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
      const { run, access, limit, memory, processes, kept } = stated;
      const bounds = ["limit", "memory", "processes", ...(verifying ? ["kept"] : [])];

      if (!hasExactly(stated, ["run", "access", ...bounds])) {
        throw refused(
          verifying
            ? `its verifier must be a program, its access, and its limit, memory, processes and kept`
            : `its ${program} must be a program, its access, and its limit, memory and processes`,
        );
      }

      if (!Array.isArray(run) || run.length === 0 || !run.every(isText)) {
        throw refused(`its ${program}'s program must be a command and its arguments`);
      }

      const problem = accessProblem(access);

      if (problem !== undefined) {
        throw refused(`its ${program}'s ${problem}`);
      }

      if (!Number.isFinite(limit) || limit <= 0 || limit > longestLimit) {
        throw refused(
          `its ${program}'s limit must be a positive number of seconds, at most ${longestLimit}`,
        );
      }

      for (const [bound, value] of Object.entries(
        verifying ? { memory, processes, kept } : { memory, processes },
      )) {
        if (!Number.isInteger(value) || value <= 0) {
          throw refused(`its ${program}'s ${bound} must be a positive integer`);
        }
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
function accessProblem(access: Access): string | undefined {
  if (!hasExactly(access, ["paths", "network", "environment", "workspace"])) {
    return "access must be its paths, network, environment and workspace";
  }

  const { paths, network, environment, workspace } = access;

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
          : hasExactly(entry, ["path", "mode"]) && (mode === "read" || mode === "write"))
      );
    })
  ) {
    return "paths must each be an absolute path and a mode: read, write, or empty with a size";
  }

  if (network !== true && network !== false) {
    return "network access must be true or false";
  }

  if (
    environment !== "all" &&
    !(Array.isArray(environment) && environment.every((each) => variable.test(each)))
  ) {
    return "environment must be all or a list of variable names";
  }

  if (workspace !== "read" && workspace !== "write") {
    return "workspace access must be read or write";
  }

  return undefined;
}

function parseWorkflow(
  name: string,
  text: string,
  defined: Kinds,
  defaults: Partial<Limits>,
): Workflow<string, { limits: Limits }> {
  const invalid = (problem: string) => new Error(`Workflow ${name} is invalid: ${problem}.`);
  const definition = JSON.parse(text).workflow;
  const claimable = Object.keys(defined);

  // Every kind a query can name: those a step may claim, and the owner's decision.
  const kinds = [...claimable, "decision"];
  const start = definition?.start;
  const steps = definition?.steps;

  if (!hasExactly(definition, ["start", "steps"]) || !isRecord(steps)) {
    throw invalid("it is not a start and its steps");
  }

  const names = Object.keys(steps);

  if (names.includes("end")) {
    throw invalid("end is reserved, so no step can be named end");
  }

  if (!names.includes(start)) {
    throw invalid("its start is not one of its steps");
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

    if (kind === "approval") {
      if (!hasExactly(step, ["kind", "on"])) {
        throw invalid(`step ${name} has fields an approval step does not define`);
      }

      continue;
    }

    if (kind !== "command" && kind !== "agent") {
      throw invalid(`step ${name} has an undeclared kind: ${JSON.stringify(kind)}`);
    }

    const program = kind === "command" ? "run" : "agent";
    const { workspace, inputs, claims, budget, access, limits } = step;
    const { agent } = step;
    const harness = agent?.harness;
    const argv = kind === "command" ? step.run : harness?.run;

    const fields = [
      "kind",
      "workspace",
      "inputs",
      "claims",
      program,
      "on",
      "budget",
      "access",
      ...(Object.hasOwn(step, "limits") ? ["limits"] : []),
    ];

    if (!hasExactly(step, fields)) {
      throw invalid(`step ${name} does not have exactly the fields a ${kind} step defines`);
    }

    // The query of the input the workspace is built from, which must name at most one artifact.
    const declared = new Map(isRecord(inputs) ? Object.entries(inputs) : []);
    const named = workspace?.input;
    const source = hasExactly(workspace, ["input"]) ? declared.get(named) : undefined;
    const take = source?.take;

    if (
      workspace !== "subject" &&
      workspace !== "empty" &&
      source !== "subject" &&
      source !== "request" &&
      !(isRecord(source) && take === "latest")
    ) {
      throw invalid(
        `step ${name}'s workspace must be subject, empty, or one of its inputs that names at most one artifact: subject, request or a query that takes the latest`,
      );
    }

    if (isRecord(inputs) && !Object.keys(inputs).every((input) => inputName.test(input))) {
      throw invalid(
        `step ${name}'s input names must each be letters, digits, - or _, starting with a letter`,
      );
    }

    if (
      !isRecord(inputs) ||
      !Object.values(inputs).every(
        (query) =>
          query === "subject" ||
          query === "request" ||
          (isRecord(query) &&
            Object.entries(query).every(
              ([field, value]) =>
                (field === "from" &&
                  Array.isArray(value) &&
                  value.every((from) => names.includes(from))) ||
                (field === "kind" && kinds.includes(value)) ||
                (field === "about" &&
                  (value === "subject" || value === "earlier" || value === "any")) ||
                (field === "take" && (value === "latest" || value === "all")),
            )),
      )
    ) {
      throw invalid(
        `step ${name}'s inputs must each be subject, request, or a query of its steps, a kind, a subject and latest or all`,
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
        !hasExactly(harness, ["run"]))
    ) {
      throw invalid(
        `step ${name}'s agent must be a harness, a model, a prompt and any skills, a list of paths`,
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

    const whole = { ...defaults, ...limits };

    if (!(limits === undefined || isRecord(limits)) || !hasExactly(whole, limitNames)) {
      throw invalid(
        `step ${name}'s limits may be only idle, attempt, transcript, input, memory, processes and disk`,
      );
    }

    const unbounded = limitProblem(Object.entries(limits ?? {}));

    if (unbounded !== undefined) {
      throw invalid(`step ${name}'s ${unbounded}`);
    }

    Object.assign(step, { limits: whole });
  }

  // SAFETY: every field the engine reads was checked above, and each step's limits made whole.
  return definition as Workflow<string, { limits: Limits }>;
}
