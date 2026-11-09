/**
 * The Claude Code adapter's broker: forwards claude's requests to the model API with the
 * subscription token, which only it reads, in place of the placeholder claude was given.
 *
 * Usage: claude-code-broker.ts [--token <file>] [--upstream <url>]
 *
 * --token is the file holding the subscription token, ~/.config/medrengard/claude-token unless
 * given; --upstream, where requests go, https://api.anthropic.com unless given.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { refuse, serve } from "./broker.ts";

const usage = "Usage: claude-code-broker.ts [--token <file>] [--upstream <url>]";

let options;

try {
  ({ values: options } = parseArgs({
    options: {
      token: { type: "string", default: join(homedir(), ".config", "medrengard", "claude-token") },
      upstream: { type: "string", default: "https://api.anthropic.com" },
    },
  }));
} catch (error) {
  refuse(`${error instanceof Error ? error.message : String(error)}\n${usage}`);
}

const tokenFile = resolve(options.token);

let token;

try {
  token = readFileSync(tokenFile, "utf8").trim();
} catch (error) {
  refuse(`Cannot read the token file: ${error instanceof Error ? error.message : String(error)}.`);
}

if (token === "") {
  refuse(`The token file ${tokenFile} is empty.`);
}

serve(new URL(options.upstream), `Bearer ${token}`);
