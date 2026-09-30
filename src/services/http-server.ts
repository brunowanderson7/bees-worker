import { createServer, type ServerResponse, type IncomingMessage } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { getReturnsToday } from "./returns-today.js";
import { HttpError, validateJob, type Operations } from "./operations.js";
import { getRouteReport } from "./route-report.js";
import { resolveDate } from "./sync-cli.js";

type Report = Awaited<ReturnType<typeof getReturnsToday>>;

export function createApiServer(options: {
  apiKey?: string;
  getReturns?: typeof getReturnsToday;
  operations?: Operations;
  getRoute?: typeof getRouteReport;
} = {}) {
  const getReturns = options.getReturns ?? getReturnsToday;
  const operations = options.operations;
  // Concurrent refresh requests share one browser session and one result.
  let refreshInProgress: Promise<Report> | undefined;

  function send(response: ServerResponse, status: number, body: unknown) {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify(body));
  }

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname === "/health" && request.method === "GET") {
        send(response, 200, { status: "ok" });
        return;
      }
      if (options.apiKey) {
        const expected = Buffer.from(`Bearer ${options.apiKey}`);
        const provided = Buffer.from(request.headers.authorization ?? "");
        if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
          response.setHeader("WWW-Authenticate", "Bearer");
          send(response, 401, { error: "UNAUTHORIZED" });
          return;
        }
      }
      if (operations && (url.pathname === "/jobs" || url.pathname.startsWith("/jobs/") || url.pathname.startsWith("/browser/"))) {
        if (url.search) throw new HttpError(400, "Query não aceita nesta rota.");
        if (url.pathname === "/jobs" && request.method === "POST") {
          const job = operations.startJob(validateJob(await readBody(request)));
          response.setHeader("Location", job.statusUrl);
          send(response, 202, job);
        } else if (/^\/jobs\/[^/]+$/.test(url.pathname) && request.method === "GET") {
          send(response, 200, operations.getJob(url.pathname.slice(6)));
        } else if (url.pathname === "/browser/status" && request.method === "GET") {
          send(response, 200, operations.status());
        } else if (["/browser/login", "/browser/close"].includes(url.pathname) && request.method === "POST") {
          const body = await readBody(request);
          if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length) throw new HttpError(400, "Envie {} ou corpo vazio.");
          send(response, 200, url.pathname.endsWith("/login") ? await operations.openLogin() : await operations.closeLogin());
        } else {
          send(response, 405, { error: "METHOD_OR_ROUTE_NOT_ALLOWED" });
        }
        return;
      }
      const routeMatch = /^\/rota\/([^/]+)$/.exec(url.pathname);
      if (routeMatch) {
        if (request.method !== "GET") {
          response.setHeader("Allow", "GET");
          send(response, 405, { error: "METHOD_NOT_ALLOWED" });
          return;
        }
        let displayId: string;
        try { displayId = decodeURIComponent(routeMatch[1]); }
        catch { throw new HttpError(400, "displayId inválido."); }
        if (!/^\d{1,200}$/.test(displayId)) throw new HttpError(400, "Informe o número do mapa (displayId).");
        const refresh = url.searchParams.get("refresh");
        const dateInput = url.searchParams.get("date");
        if ([...url.searchParams.keys()].some((key) => !["date", "refresh"].includes(key))
          || ["date", "refresh"].some((key) => url.searchParams.getAll(key).length > 1)
          || (refresh !== null && refresh !== "true" && refresh !== "false")) {
          throw new HttpError(400, "Use date=YYYY-MM-DD e/ou refresh=true|false.");
        }
        let date: string | undefined;
        if (dateInput !== null) {
          try { date = resolveDate(dateInput); } catch { throw new HttpError(400, "Data inválida."); }
        }
        const query = () => (options.getRoute ?? getRouteReport)(displayId, { date, refresh: refresh === "true" });
        const report = refresh === "true" && operations ? await operations.exclusive(query) : await query();
        send(response, 200, report);
        return;
      }
      if (url.pathname !== "/returns/today") {
        send(response, 404, { error: "NOT_FOUND" });
        return;
      }

      if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        send(response, 405, { error: "METHOD_NOT_ALLOWED" });
        return;
      }
      const refresh = url.searchParams.get("refresh");
      if ([...url.searchParams.keys()].some((key) => key !== "refresh")
        || url.searchParams.getAll("refresh").length > 1
        || (refresh !== null && refresh !== "true" && refresh !== "false")) {
        send(response, 400, { error: "INVALID_QUERY", message: "Use refresh=true ou refresh=false." });
        return;
      }
      let report: Report;
      if (refresh === "true") {
        if (!refreshInProgress) {
          const refreshAction = () => getReturns({ offline: false, headless: true });
          refreshInProgress = (operations ? operations.exclusive(refreshAction) : refreshAction())
            .finally(() => { refreshInProgress = undefined; });
        }
        report = await refreshInProgress;
      } else {
        report = await getReturns({ offline: true });
      }
      send(response, report.metadata.complete ? 200 : 502, report);
    } catch (error) {
      if (error instanceof HttpError) {
        send(response, error.status, { error: error.message });
        return;
      }
      const routeQuery = request.url?.startsWith("/rota/");
      console.error(routeQuery ? "Falha na consulta do mapa:" : "Falha na consulta de devoluções:", error);
      send(response, 500, { metadata: { complete: false }, content: [], error: routeQuery ? "ROUTE_QUERY_FAILED" : "RETURNS_QUERY_FAILED" });
    }
  });
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  if (request.headers["content-type"] && !/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"])) {
    throw new HttpError(415, "Use Content-Type: application/json.");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16384) throw new HttpError(413, "Corpo excede 16 KB.");
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw new HttpError(400, "JSON inválido."); }
}

