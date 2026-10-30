// Exécute les workers des sites (format Cloudflare : export default { fetch })
// derrière Caddy, qui leur transmet les requêtes non servies en statique et
// indique le site concerné dans l'en-tête X-Site (son port).
import http from "node:http";
import { existsSync, readFileSync, watchFile } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BASE = process.env.SITE_BASE;
const PORTS = Array.from({ length: 10 }, (_, i) => 8080 + i);
const PORT = 8787;
const MAX_BODY = 64 * 1024;

const siteRoot = (port) => (port === 8080 ? BASE : `${BASE}-${port}`);

// Variables définies dans les options de l'app (secrets compris)
let vars = {};
try {
  vars = JSON.parse(readFileSync("/run/worker/vars.json", "utf8"));
} catch {}
const env = Object.freeze({ ...vars, HA_URL: process.env.HA_URL });
const ctx = { waitUntil() {}, passThroughOnException() {} };

// port -> worker chargé, ou null si son fichier contient une erreur
const workers = new Map();
for (const port of PORTS) {
  const file = path.join(siteRoot(port), "_worker.js");
  if (existsSync(file)) {
    try {
      const { default: worker } = await import(pathToFileURL(file).href);
      if (typeof worker?.fetch !== "function") {
        throw new Error("le fichier doit contenir « export default { async fetch(request, env) { ... } } »");
      }
      workers.set(port, worker);
      console.log(`Worker du site ${port} prêt (${file})`);
    } catch (err) {
      workers.set(port, null);
      console.error(`Impossible de charger ${file} :`, err);
      console.error("Il sera rechargé dès que le fichier sera modifié.");
    }
  }

  // Rechargement automatique : s6 relance le service quand un fichier
  // apparaît, change ou disparaît
  watchFile(file, { interval: 2000 }, (curr, prev) => {
    if (curr.mtimeMs === prev.mtimeMs && curr.ino === prev.ino && curr.size === prev.size) return;
    console.log(`${file} a changé, rechargement des workers...`);
    process.exit(0);
  });
}

process.on("unhandledRejection", (err) => console.error("Erreur non gérée dans un worker :", err));

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
    const port = Number(req.headers["x-site"]);
    if (!workers.has(port)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("404 Not Found");
      return;
    }
    const worker = workers.get(port);
    if (!worker) {
      res.writeHead(503).end();
      return;
    }

    // Caddy transmet l'adresse publique d'origine (Cloudflare, réseau local ou Ingress)
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
    // Comme sur Cloudflare, le worker gère sa propre CSP. S'il n'en envoie pas,
    // ce minimum évite que Caddy applique celle des fichiers statiques, qui
    // bloquerait ses scripts intégrés au HTML.
    if (!response.headers.has("content-security-policy")) {
      out["content-security-policy"] = "object-src 'none'; base-uri 'self'";
    }
    res.writeHead(response.status, out);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(err.status || 500);
    res.end();
  }
}).listen(PORT, "127.0.0.1");
