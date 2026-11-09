/**
 * What every harness's broker does: listens on the socket the engine names in MEDRENGARD_SOCKET,
 * and forwards each request that carries the placeholder credential to its upstream, with the
 * real one in its place. Outside the step's sandbox, so the credential never enters it; what the
 * step runs can use it through the broker while the attempt runs, but never read it.
 */
import { createServer, request as plainRequest, type IncomingHttpHeaders } from "node:http";
import { request as tlsRequest } from "node:https";

/** The credential a harness is given in place of the real one, which its broker replaces. */
export const placeholder = "medrengard-broker";

/** Exits as a broker that cannot start, saying why, which the engine records. */
export function refuse(problem: string): never {
  console.error(problem);
  process.exit(2);
}

/**
 * Serves as a broker: each request whose Authorization is the placeholder as a bearer token is
 * forwarded to `upstream` with `authorization` in its place; any other is refused as
 * unauthenticated and forwarded nowhere.
 */
export function serve(upstream: URL, authorization: string): void {
  const socket = process.env.MEDRENGARD_SOCKET;

  if (socket === undefined) {
    refuse("A broker listens on the socket MEDRENGARD_SOCKET names, which is not set.");
  }

  const send = upstream.protocol === "https:" ? tlsRequest : plainRequest;

  const server = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${placeholder}`) {
      request.resume();
      response.writeHead(401, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          type: "error",
          error: { type: "authentication_error", message: "Refused by Medrengard's broker." },
        }),
      );

      return;
    }

    const headers: IncomingHttpHeaders = {
      ...request.headers,
      host: upstream.host,
      authorization,
    };

    const forwarded = send(
      {
        protocol: upstream.protocol,
        host: upstream.hostname,
        port: upstream.port,
        path: request.url,
        method: request.method,
        headers,
      },
      (answer) => {
        response.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(response);
      },
    );

    forwarded.on("error", (error: NodeJS.ErrnoException) => {
      if (!response.headersSent) {
        response.writeHead(502, { "content-type": "text/plain" });
      }

      response.end(
        `Medrengard's broker could not reach ${upstream.host}: ${error.code ?? error.message}\n`,
      );
    });

    request.pipe(forwarded);
  });

  // A harness that asks to upgrade, as to a WebSocket, is told the server requires none.
  server.on("upgrade", (_, client) => {
    client.end("HTTP/1.1 426 Upgrade Required\r\ncontent-length: 0\r\n\r\n");
  });

  server.listen(socket);

  process.on("SIGTERM", () => process.exit(0));
}
