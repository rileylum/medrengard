/**
 * The forwarder inside a step's sandbox when its access lists the hosts it may reach. The step has
 * no network of its own, only loopback: this listens there, relays each connection to the engine's
 * proxy over the socket bound into the sandbox, and runs the step's program with the proxy
 * variables pointing at it. The engine's proxy decides what is reached.
 *
 * Usage: forward.ts <socket> -- <program> [<argument>...]
 */
import { spawn } from "node:child_process";
import { connect, createServer, type AddressInfo } from "node:net";

const [socket, separator, program, ...args] = process.argv.slice(2);

if (socket === undefined || separator !== "--" || program === undefined) {
  console.error("Usage: forward.ts <socket> -- <program> [<argument>...]");
  process.exit(2);
}

const relay = createServer((client) => {
  const proxy = connect(socket);

  client.pipe(proxy).pipe(client);
  client.on("error", () => proxy.destroy());
  proxy.on("error", () => client.destroy());
});

relay.listen(0, "127.0.0.1", () => {
  // SAFETY: a TCP server listening on a port has an address of that kind.
  const { port } = relay.address() as AddressInfo;
  const proxy = `http://127.0.0.1:${port}`;

  // The step's descriptors as given: stdin, stdout, stderr, its notes and its usage reports.
  const child = spawn(program, args, {
    stdio: ["inherit", "inherit", "inherit", "inherit", "inherit"],
    env: {
      ...process.env,
      HTTPS_PROXY: proxy,
      https_proxy: proxy,
      HTTP_PROXY: proxy,
      http_proxy: proxy,
    },
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
});
