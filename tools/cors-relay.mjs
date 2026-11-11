/**
 * DualTran local CORS relay for Ollama Cloud.
 *
 * ollama.com answers no Access-Control-Allow-Origin and rejects the browser
 * preflight (OPTIONS → 405), so the Logseq plugin iframe can never call it
 * directly. This relay listens on loopback only, adds the CORS headers, and
 * forwards /v1/* to https://ollama.com/v1 (including SSE streams).
 *
 * The API key is NOT stored here: the plugin sends its own Authorization header
 * and the relay forwards it.
 *
 *   node dualtran-relay.mjs            # 127.0.0.1:11435
 *   DUALTRAN_RELAY_PORT=12345 node …   # custom port
 */
import http from "node:http";

const PORT = Number(process.env.DUALTRAN_RELAY_PORT || 11435);
const UPSTREAM = process.env.DUALTRAN_RELAY_UPSTREAM || "https://ollama.com";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "authorization,content-type,accept",
  "access-control-max-age": "86400",
};

function json(res, status, payload) {
  res.writeHead(status, { ...CORS, "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  if (!req.url || !req.url.startsWith("/v1/")) {
    json(res, 404, { error: { message: "DualTran relay: only /v1/* is proxied" } });
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  try {
    const upstream = await fetch(`${UPSTREAM}${req.url}`, {
      method: req.method,
      headers: {
        authorization: req.headers.authorization || "",
        "content-type": req.headers["content-type"] || "application/json",
        accept: req.headers.accept || "application/json",
      },
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
    });
    res.writeHead(upstream.status, {
      ...CORS,
      "content-type": upstream.headers.get("content-type") || "application/json",
      "cache-control": "no-store",
    });
    if (upstream.body) {
      for await (const chunk of upstream.body) res.write(chunk);
    }
    res.end();
  } catch (error) {
    json(res, 502, { error: { message: `DualTran relay upstream error: ${String(error?.message || error)}` } });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[dualtran-relay] http://127.0.0.1:${PORT}/v1 -> ${UPSTREAM}/v1`);
});
