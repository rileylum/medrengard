import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { claudeCode } from "./access.ts";

test("claudeCode gives the adapter the token file to read, and no token in the environment", () => {
  // In the environment, the token would be in reach of everything the agent runs.
  assert.ok(claudeCode.environment !== "all");
  assert.ok(!claudeCode.environment.includes("CLAUDE_CODE_OAUTH_TOKEN"));
  assert.ok(
    claudeCode.paths.some(
      ({ path, mode }) =>
        path === join(homedir(), ".config", "medrengard", "claude-token") && mode === "read",
    ),
  );
});
