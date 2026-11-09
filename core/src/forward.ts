/**
 * The forwarder inside a step's sandbox when its access lists the hosts or brokers it may reach.
 * The step has no network of its own, only loopback: this listens there, relays each connection to
 * the engine's proxy or to a broker over the socket bound into the sandbox, and runs the step's
 * program with the proxy variables pointing at the proxy and MEDRENGARD_BROKER_<NAME> at each
 * broker. The engine's proxy decides what is reached; a broker, what it forwards.
 *
 * Usage: forward.ts <socket> [<name>=<socket>...] -- <program> [<argument>...]
 */
import { spawn } from "node:child_process";
import { connect, createServer, type AddressInfo } from "node:net";

const usage = "Usage: forward.ts <socket> [<name>=<socket>...] -- <program> [<argument>...]";

const [socket, ...rest] = process.argv.slice(2);
const separator = rest.indexOf("--");
const named = rest.slice(0, separator);
const [program, ...args] = rest.slice(separator + 1);

const brokers = named.map((each) => each.split("="));

if (
  socket === undefined ||
  separator === -1 ||
  program === undefined ||
  !brokers.every((pair) => pair.length === 2)
) {
  console.error(usage);
  process.exit(2);
}

// Listens on loopback, relaying each connection to `target`; its address once it listens.
async function relayTo(target: string): Promise<string> {
  const relay = createServer((client) => {
    const upstream = connect(target);

    client.pipe(upstream).pipe(client);
    client.on("error", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
  });

  await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));

  // SAFETY: a TCP server listening on a port has an address of that kind.
  const { port } = relay.address() as AddressInfo;

  return `http://127.0.0.1:${port}`;
}

const proxy = await relayTo(socket);

const environment: NodeJS.ProcessEnv = {
  ...process.env,
  HTTPS_PROXY: proxy,
  https_proxy: proxy,
  HTTP_PROXY: proxy,
  http_proxy: proxy,
};

for (const [name, target] of brokers) {
  environment[`MEDRENGARD_BROKER_${name!.toUpperCase()}`] = await relayTo(target!);
}

// The step's descriptors as given: stdin, stdout, stderr, its notes and its usage reports.
const child = spawn(program, args, {
  stdio: ["inherit", "inherit", "inherit", "inherit", "inherit"],
  env: environment,
});

const signals = ["SIGTERM", "SIGINT", "SIGHUP"] as const;

for (const signal of signals) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error: NodeJS.ErrnoException) => {
  console.error(`${program}: ${error.code ?? error.message}`);
  process.exit(127);
});

// Ends as the program did, by its signal too, so the engine sees how it ended.
child.on("exit", (code, signal) => {
  if (signal !== null) {
    for (const each of signals) {
      process.removeAllListeners(each);
    }

    process.kill(process.pid, signal);

    return;
  }

  process.exit(code ?? 1);
});
