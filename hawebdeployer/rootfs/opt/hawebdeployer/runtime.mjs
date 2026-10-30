// Exécute un worker au format Cloudflare (export default { fetch(request, env) })
// derrière Caddy, qui lui transmet les requêtes non servies en statique.
import http from "node:http";
import { watchFile } from "node:fs";
import { pathToFileURL } from "node:url";

const workerPath = process.argv[2];
const PORT = 8787;
const MAX_BODY = 64 * 1024;

const env = Object.freeze({ HA_URL: process.env.HA_URL });
const ctx = { waitUntil() {}, passThroughOnException() {} };

let worker = null;
try {
  ({ default: worker } = await import(pathToFileURL(workerPath).href));
  if (typeof worker?.fetch !== "function") {
    worker = null;
    throw new Error("le fichier doit contenir « export default { async fetch(request, env) { ... } } »");
  }
} catch (err) {
  console.error(`Impossible de charger ${workerPath} :`, err);
  console.error("Il sera rechargé dès que le fichier sera modifié.");
}

process.on("unhandledRejection", (err) => console.error("Erreur non gérée dans le worker :", err));

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("Requête trop volumineuse"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

http.createServer(async (req, res) => {
  try {
    if (!worker) {
      res.writeHead(503).end();
      return;
    }

    // Caddy transmet l'adresse publique d'origine (Cloudflare ou Ingress)
    const first = (value) => value?.split(",")[0].trim();
    const proto = first(req.headers["x-forwarded-proto"]) || "http";
    const host = first(req.headers["x-forwarded-host"]) || req.headers.host;
    const url = new URL(req.url, `${proto}://${host}`);

    const headers = new Headers();
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      headers.append(req.rawHeaders[i], req.rawHeaders[i + 1]);
    }
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const request = new Request(url, {
      method: req.method,
      headers,
      body: hasBody ? await readBody(req) : undefined,
    });

    const response = await worker.fetch(request, env, ctx);

    const out = {};
    response.headers.forEach((value, name) => {
      if (name !== "set-cookie") out[name] = value;
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) out["set-cookie"] = cookies;
    res.writeHead(response.status, out);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(err.status || 500);
    res.end();
  }
}).listen(PORT, "127.0.0.1", () => {
  if (worker) console.log(`Worker ${workerPath} prêt`);
});

// Rechargement automatique : s6 relance le service quand le fichier change
watchFile(workerPath, { interval: 2000 }, () => {
  console.log(`${workerPath} a changé, rechargement...`);
  process.exit(0);
});
