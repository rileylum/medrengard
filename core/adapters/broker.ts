/**
 * What every harness's broker does: listens on the socket the engine names in MEDRENGARD_SOCKET,
 * and forwards each request that carries the placeholder credential to its upstream, with the
 * real one in its place. Outside the step's sandbox, so the credential never enters it; what the
 * step runs can use it through the broker while the attempt runs, but never read it.
 */
import { createServer, request as plainRequest, type OutgoingHttpHeaders } from "node:http";
import { request as tlsRequest } from "node:https";

/** The credential a harness is given in place of the real one, which its broker replaces. */
export const placeholder = "medrengard-broker";

/** Exits as a broker that cannot start, saying why, which the engine records. */
export function refuse(problem: string): never {
  console.error(problem);
  process.exit(2);
}

/**
 * What a broker does with a request: answers it itself, or forwards it to `path` upstream, or to
 * `upstream` when given, with `headers` set over the request's own. `unauthorised`, when given, is
 * told of an upstream 401, which the harness then sees as 403, so it does not try to refresh a
 * credential it does not hold.
 */
export type Route =
  | { status: number; body: string }
  | {
      path: string;
      headers: OutgoingHttpHeaders;
      upstream?: URL;
      unauthorised?: () => void;
    };

/**
 * Serves as a broker: each request whose Authorization is the placeholder as a bearer token goes
 * where `route` says, given its method and path; any other is refused as unauthenticated and
 * forwarded nowhere. A request to upgrade, as to a WebSocket, is told none is offered.
 */
export function serve(
  upstream: URL,
  route: (method: string, path: string) => Promise<Route>,
): void {
  const socket = process.env.MEDRENGARD_SOCKET;

  if (socket === undefined) {
    refuse("A broker listens on the socket MEDRENGARD_SOCKET names, which is not set.");
  }

  const server = createServer(async (request, response) => {
    const answer = (status: number, body: string) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(body);
    };

    if (request.headers.authorization !== `Bearer ${placeholder}`) {
      request.resume();
      answer(
        401,
        JSON.stringify({
          type: "error",
          error: { type: "authentication_error", message: "Refused by Medrengard's broker." },
        }),
      );

      return;
    }

    let routed: Route;

    try {
      routed = await route(request.method!, request.url!);
    } catch (error) {
      request.resume();
      answer(
        502,
        JSON.stringify({
          error: { message: error instanceof Error ? error.message : String(error) },
        }),
      );

      return;
    }

    if ("status" in routed) {
      request.resume();
      answer(routed.status, routed.body);

      return;
    }

    const target = routed.upstream ?? upstream;
    const send = target.protocol === "https:" ? tlsRequest : plainRequest;

    const forwarded = send(
      {
        protocol: target.protocol,
        host: target.hostname,
        port: target.port,
        path: routed.path,
        method: request.method,
        headers: { ...request.headers, host: target.host, ...routed.headers },
      },
      (upstreamResponse) => {
        let status = upstreamResponse.statusCode ?? 502;

        if (status === 401 && routed.unauthorised !== undefined) {
          routed.unauthorised();
          status = 403;
        }

        response.writeHead(status, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      },
    );

    forwarded.on("error", (error: NodeJS.ErrnoException) => {
      if (!response.headersSent) {
        response.writeHead(502, { "content-type": "text/plain" });
      }

      response.end(
        `Medrengard's broker could not reach ${target.host}: ${error.code ?? error.message}\n`,
      );
    });

    request.pipe(forwarded);
  });

  server.on("upgrade", (_, client) => {
    client.end("HTTP/1.1 426 Upgrade Required\r\ncontent-length: 0\r\n\r\n");
  });

  server.listen(socket);

  process.on("SIGTERM", () => process.exit(0));
}
