import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { node } from "../defaults/access.ts";
import { builtIn } from "../defaults/kinds.ts";
import { limits } from "../defaults/limits.ts";
import { defineWorkflow } from "../src/definition.ts";
import { createEngine } from "../src/engine.ts";

// Principle 2: TypeScript is a convenience layer over the step contract. A factory's own step,
// in its repository, reaches the layer as it reaches the rest of the package.
test("a step written in TypeScript reads its input, notes and claims through the contract's module", async (t) => {
  const factory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(factory, { recursive: true, force: true }));

  await mkdir(join(factory, "node_modules", "@medrengard"), { recursive: true });
  await symlink(
    join(import.meta.dirname, ".."),
    join(factory, "node_modules", "@medrengard", "core"),
  );
  await mkdir(join(factory, "steps"));
  await writeFile(
    join(factory, "steps", "reply.ts"),
    `import { artifactsOf, bodyOf, claim, note, readInput, reportUsage } from "@medrengard/core/step/contract.ts";

     const given = readInput();
     const [request] = artifactsOf(given, "request");

     note(\`Replying to \${request?.fields.title},\\n as step \${given.step}\`);
     reportUsage({ usd: 0.5 });
     claim("done", [
       { kind: "document", fields: { title: "Reply" }, text: \`Reply to: \${bodyOf(request ?? {})}\` },
     ]);`,
  );

  await mkdir(join(factory, "state"));

  const engine = createEngine({
    log: join(factory, "state", "log.sqlite"),
    kinds: builtIn,
    defaults: { limits },
    workflows: {
      reply: defineWorkflow({
        start: "reply",
        steps: {
          reply: {
            kind: "command",
            run: [process.execPath, join(factory, "steps", "reply.ts")],
            workspace: "empty",
            inputs: { request: "request" },
            claims: ["document"],
            on: { done: "end" },
            budget: 1,
            access: {
              ...node,
              paths: [
                ...node.paths,
                { path: join(factory, "steps"), mode: "read" },
                { path: join(factory, "node_modules"), mode: "read" },
              ],
            },
          },
        },
      }),
    },
  });

  engine.commission("reply", { title: "Greet", body: "Say hello." }, { name: "first" });

  const state = await engine.advance("first");
  const { entries } = engine.record("first");

  assert.equal(engine.errors("first", 1).toString(), "");
  assert.deepEqual(state, { status: "finished", by: "end" });
  assert.partialDeepStrictEqual(entries, [
    {
      entry: "attempt",
      outcome: "done",
      notes: [{ note: "Replying to Greet, as step reply", from: "step" }],
      usage: { usd: 0.5 },
      artifacts: [
        {
          artifact: { kind: "document", fields: { title: "Reply" }, body: "Reply to: Say hello." },
        },
      ],
    },
  ]);
});

// A kind's programs are written with the same module: a verifier reads the claim and accepts or
// rejects it, and a materialiser reads the artifact to build a workspace from.
test("a kind's verifier and materialiser written in TypeScript read the claim and the artifact through the contract's module", async (t) => {
  const factory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(factory, { recursive: true, force: true }));

  await mkdir(join(factory, "kinds"));
  await mkdir(join(factory, "state"));
  await writeFile(
    join(factory, "kinds", "verify.ts"),
    `import { writeFileSync } from "node:fs";
     import { join } from "node:path";
     import { accept, output, readClaim, reject } from ${JSON.stringify(join(import.meta.dirname, "contract.ts"))};

     const claim = readClaim();

     if (claim.fields.title === "Refuse me") {
       reject(\`A \${claim.kind} titled so, about the \${claim.subject.kind} \${claim.subject.fields.title}.\`);
     } else {
       writeFileSync(join(output, "seen"), claim.fields.title ?? "");
       accept(["seen"]);
     }`,
  );
  await writeFile(
    join(factory, "kinds", "build.ts"),
    `import { copyFileSync, writeFileSync } from "node:fs";
     import { join } from "node:path";
     import { bodyOf, input, readArtifact } from ${JSON.stringify(join(import.meta.dirname, "contract.ts"))};

     const artifact = readArtifact();

     writeFileSync("built", \`\${artifact.kind} \${artifact.fields.title}: \${bodyOf(artifact)}\`);
     copyFileSync(join(input, artifact.kept.seen ?? ""), "seen");`,
  );

  const access = {
    ...node,
    paths: [...node.paths, { path: join(factory, "kinds"), mode: "read" as const }],
  };

  const program = (file: string) => ({
    run: [process.execPath, join(factory, "kinds", file)] as const,
    access,
    limits: { attempt: 30, memory: 4 * 1024 * 1024 * 1024, processes: 1024 },
  });

  const verifier = program("verify.ts");

  const claiming = (title: string, next: "read" | "end") =>
    ({
      kind: "command",
      run: [
        "sh",
        "-c",
        `printf 'A note.' > "$MEDRENGARD_OUT/note.md"
         echo '{"outcome":"done","artifacts":[{"kind":"note","fields":{"title":"${title}"},"body":"note.md"}]}' > "$MEDRENGARD_OUT/output.json"`,
      ],
      workspace: "empty",
      inputs: {},
      claims: ["note"],
      on: { done: next },
      budget: 1,
      access: node,
    }) as const;

  const engine = createEngine({
    log: join(factory, "state", "log.sqlite"),
    kinds: {
      ...builtIn,
      note: {
        role: "subject",
        description: "A note.",
        fields: { title: { limit: 100, required: true } },
        body: { required: true, limit: 1024 },
        verifier: { ...verifier, limits: { ...verifier.limits, kept: 1024 } },
        materialiser: program("build.ts"),
      },
    },
    defaults: { limits },
    workflows: {
      keep: defineWorkflow({
        start: "write",
        steps: {
          write: claiming("Keep me", "read"),
          // Its workspace is built from the note by the materialiser.
          read: {
            kind: "command",
            run: [
              "sh",
              "-c",
              `cat built seen; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
            ],
            workspace: "subject",
            inputs: {},
            claims: [],
            on: { done: "end" },
            budget: 1,
            access: node,
          },
        },
      }),
      refuse: defineWorkflow({ start: "write", steps: { write: claiming("Refuse me", "end") } }),
    },
  });

  engine.commission("keep", { title: "Greet", body: "Say hello." }, { name: "kept" });
  assert.deepEqual(await engine.advance("kept"), { status: "finished", by: "end" });
  assert.equal(engine.transcript("kept", 2).toString(), "note Keep me: A note.Keep me");

  engine.commission("refuse", { title: "Greet", body: "Say hello." }, { name: "refused" });
  assert.partialDeepStrictEqual(await engine.advance("refused"), {
    status: "escalated",
    cause: "claim",
    reason:
      "Step write claimed a note its verifier rejected: A note titled so, about the document Greet.",
  });
});
