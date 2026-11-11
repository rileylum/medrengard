/**
 * What every harness's broker does: listens on the socket the engine names in MEDRENGARD_SOCKET,
 * and forwards each request that carries the placeholder credential to its upstream, with the
 * real one in its place. Outside the step's sandbox, so the credential never enters it; what the
 * step runs can use it through the broker while the attempt runs, but never read it.
 */
import { createServer, request as plainRequest, type OutgoingHttpHeaders } from "node:http";
import { Agent, request as tlsRequest } from "node:https";

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
      // Judges the request by the start of its body, given as much as has arrived and whether
      // that is all of it: a refusal, "forward", "more" to be given more, or the body to forward
      // in place of the request's, so that upstream reads what was judged and nothing else. A
      // body it still wants more of at `most` bytes, 64 KiB unless given, or at its end, is
      // refused.
      screen?: (
        start: Buffer,
        ended: boolean,
      ) => { refused: string } | { body: Buffer } | "forward" | "more";
      most?: number;
    };

// A broker an engine starts inside a step that may reach only some hosts has no way out but the
// step's proxy, which its environment names. Node tunnels through it, and leaves it out for a host
// NO_PROXY lists. Without one in the environment, a broker connects as it always has.
const proxied =
  (process.env.HTTPS_PROXY ?? process.env.https_proxy) === undefined
    ? undefined
    : new Agent({ keepAlive: true, proxyEnv: process.env });

// An upstream on this machine, such as a test's, is reached without the proxy, which is for hosts
// outside it.
const local = (host: string) => host === "localhost" || host === "[::1]" || host.startsWith("127.");

// The most of a request's body a route may ask for before it judges the request, unless it names
// its own.
const screened = 64 * 1024;

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

    // The start of the body, read for a route that judges the request by it.
    let start = Buffer.alloc(0);

    // The body a route that judged the whole request forwards in its place.
    let whole: Buffer | undefined;

    if (routed.screen !== undefined) {
      const most = routed.most ?? screened;
      let verdict = routed.screen(start, false);
      let ended = true;

      for await (const chunk of request) {
        // SAFETY: an incoming request without an encoding set yields buffers.
        start = Buffer.concat([start, chunk as Buffer]);
        verdict = routed.screen(start, false);

        if (verdict !== "more" || start.length > most) {
          ended = false;

          break;
        }
      }

      if (ended && verdict === "more") {
        verdict = routed.screen(start, true);
      }

      if (verdict !== "forward" && verdict !== "more" && "body" in verdict) {
        whole = verdict.body;
      } else if (verdict !== "forward") {
        request.resume();
        answer(
          403,
          JSON.stringify({
            message:
              verdict === "more"
                ? "Refused by Medrengard's broker: the request's body could not be judged."
                : verdict.refused,
          }),
        );

        return;
      }
    }

    // A body forwarded in place of the request's is sent whole, with its own length.
    const received =
      whole === undefined
        ? request.headers
        : Object.fromEntries(
            Object.entries(request.headers).filter(([name]) => name !== "transfer-encoding"),
          );

    const length = whole === undefined ? undefined : { "content-length": whole.length };
    const target = routed.upstream ?? upstream;
    const send = target.protocol === "https:" ? tlsRequest : plainRequest;

    const forwarded = send(
      {
        protocol: target.protocol,
        // Undefined is Node's own agent.
        agent: target.protocol === "https:" && !local(target.hostname) ? proxied : undefined,
        host: target.hostname,
        port: target.port,
        path: routed.path,
        method: request.method,
        headers: { ...received, host: target.host, ...routed.headers, ...length },
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

    if (whole !== undefined) {
      request.resume();
      forwarded.end(whole);

      return;
    }

    forwarded.write(start);
    request.pipe(forwarded);
  });

  server.on("upgrade", (_, client) => {
    client.end("HTTP/1.1 426 Upgrade Required\r\ncontent-length: 0\r\n\r\n");
  });

  server.listen(socket);

  process.on("SIGTERM", () => process.exit(0));
}
