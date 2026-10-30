// API du panneau d'administration (Ingress) : état du tunnel et, pour chaque
// site (un par port), liste, envoi et suppression des fichiers. Écoute sur un
// socket Unix que seul Caddy peut ouvrir : ni les workers ni les sites publics
// n'y ont accès.
import http from "node:http";
import { createWriteStream } from "node:fs";
import { chmod, chown, mkdir, readdir, rename, rm, rmdir, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";

const BASE = process.env.SITE_BASE;
const PARENT = path.dirname(BASE);
const PORTS = Array.from({ length: 10 }, (_, i) => 8080 + i);
const SOCKET = "/run/hawebdeployer/admin.sock";
const MAX_FILE = 25 * 1024 * 1024;

// Site du port 8080 : le dossier des options ; les autres : <dossier>-<port>
const siteRoot = (port) => (port === 8080 ? BASE : `${BASE}-${port}`);
const tempPrefix = (port) => `.${path.basename(siteRoot(port))}.`;

// Envois en cours : chaque nouvelle version est préparée à côté du site, puis
// échangée avec lui d'un coup pour ne jamais servir un site à moitié envoyé
const deploys = new Map(); // id -> { port, dir }

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function parsePort(raw) {
  const port = Number(raw);
  if (!PORTS.includes(port)) throw new HttpError(404, `Pas de site sur le port ${raw}`);
  return port;
}

// Chemin relatif sûr : pas de « .. », pas de fichiers cachés (sauf .well-known)
function cleanPath(raw) {
  let rel;
  try {
    rel = decodeURIComponent(raw);
  } catch {
    rel = "";
  }
  const parts = rel.split("/");
  const valid = rel.length > 0 && rel.length <= 1024 && parts.every((p) =>
    p && p !== "." && p !== ".." && p.length <= 255 && !/[\\\0]/.test(p)
    && (!p.startsWith(".") || p === ".well-known"));
  if (!valid) throw new HttpError(400, `Chemin refusé : ${rel || raw}`);
  return parts.join("/");
}

async function listFiles(dir, prefix = "") {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".upload-")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(full, `${prefix}${entry.name}/`));
    } else if (entry.isFile()) {
      const info = await stat(full);
      files.push({ path: prefix + entry.name, size: info.size, modified: info.mtimeMs });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function writeFile(base, rel, req) {
  if (Number(req.headers["content-length"]) > MAX_FILE) {
    throw new HttpError(413, `${rel} dépasse ${MAX_FILE / 1024 / 1024} Mo`);
  }
  const dest = path.join(base, rel);
  try {
    await mkdir(path.dirname(dest), { recursive: true });
  } catch {
    throw new HttpError(409, `Impossible de créer le dossier de ${rel}`);
  }

  const tmp = path.join(path.dirname(dest), `.upload-${randomUUID()}`);
  let size = 0;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_FILE) req.destroy(new HttpError(413, `${rel} dépasse ${MAX_FILE / 1024 / 1024} Mo`));
  });
  try {
    await pipeline(req, createWriteStream(tmp, { mode: 0o644 }));
    await rename(tmp, dest);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err instanceof HttpError ? err : new HttpError(409, `Impossible d'écrire ${rel}`);
  }
}

async function deleteFile(port, rel) {
  const root = siteRoot(port);
  const target = path.join(root, rel);
  await rm(target, { force: true, recursive: true });
  // Supprime les dossiers devenus vides, sans remonter au-delà du site
  for (let dir = path.dirname(target); dir !== root && dir.startsWith(root); dir = path.dirname(dir)) {
    try {
      await rmdir(dir);
    } catch {
      break;
    }
  }
}

async function clearSite(port) {
  const root = siteRoot(port);
  for (const entry of await readdir(root).catch(() => [])) {
    await rm(path.join(root, entry), { force: true, recursive: true });
  }
  // Les sites supplémentaires disparaissent complètement une fois vidés
  if (port !== 8080) await rmdir(root).catch(() => {});
}

async function startDeploy(port) {
  const id = randomUUID();
  const dir = path.join(PARENT, `${tempPrefix(port)}deploy-${id}`);
  await mkdir(dir, { recursive: true });
  deploys.set(id, { port, dir });
  return id;
}

async function publishDeploy(id) {
  const { port, dir } = deploys.get(id);
  const root = siteRoot(port);
  const old = path.join(PARENT, `${tempPrefix(port)}old-${id}`);
  const hadSite = await rename(root, old).then(() => true, (err) => {
    if (err.code === "ENOENT") return false;
    throw err;
  });
  try {
    await rename(dir, root);
  } catch (err) {
    if (hadSite) await rename(old, root);
    throw err;
  }
  deploys.delete(id);
  if (hadSite) await rm(old, { force: true, recursive: true });
  return port;
}

async function cancelDeploy(id) {
  await rm(deploys.get(id).dir, { force: true, recursive: true });
  deploys.delete(id);
}

async function tunnelStatus() {
  if (process.env.TUNNEL_ENABLED !== "1") return { state: "desactive", hostnames: [] };

  const metrics = "http://127.0.0.1:20241";
  let state = "deconnecte";
  let hostnames = [];
  try {
    const ready = await fetch(`${metrics}/ready`, { signal: AbortSignal.timeout(2000) });
    if (ready.ok) state = "connecte";
  } catch {}
  // Configuration envoyée par Cloudflare (noms de domaine publics), si disponible
  try {
    const res = await fetch(`${metrics}/config`, { signal: AbortSignal.timeout(2000) });
    const { config } = await res.json();
    hostnames = (config?.ingress ?? [])
      .filter((rule) => rule.hostname)
      .map((rule) => ({ hostname: rule.hostname, service: rule.service }));
  } catch {}
  return { state, hostnames };
}

async function siteSummary(port) {
  const files = await listFiles(siteRoot(port));
  const has = (name) => files.some((f) => f.path === name);
  return {
    port,
    folder: path.relative("/share", siteRoot(port)),
    files: files.length,
    size: files.reduce((total, f) => total + f.size, 0),
    hasIndex: has("index.html"),
    hasWorker: has("_worker.js"),
    // Un Cloudflare Worker publié sous son nom d'origine n'est pas exécuté
    strayWorker: has("worker.js") && !has("_worker.js"),
  };
}

async function route(req, url) {
  const p = url.pathname;
  const m = req.method;

  if (m === "GET" && p === "/api/status") {
    return { tunnel: await tunnelStatus(), sites: await Promise.all(PORTS.map(siteSummary)) };
  }

  const site = p.match(/^\/api\/sites\/(\d+)(\/.*)$/);
  if (site) {
    const port = parsePort(site[1]);
    const rest = site[2];
    if (m === "GET" && rest === "/files") return { files: await listFiles(siteRoot(port)) };
    if (m === "DELETE" && rest === "/files") {
      await clearSite(port);
      console.log(`Site ${port} vidé depuis le panneau`);
      return { ok: true };
    }
    if (m === "POST" && rest === "/deploys") return { id: await startDeploy(port) };
    if (rest.startsWith("/files/")) {
      const rel = cleanPath(rest.slice("/files/".length));
      if (m === "PUT") {
        await writeFile(siteRoot(port), rel, req);
        console.log(`Site ${port} : fichier envoyé ${rel}`);
        return { ok: true };
      }
      if (m === "DELETE") {
        await deleteFile(port, rel);
        console.log(`Site ${port} : fichier supprimé ${rel}`);
        return { ok: true };
      }
    }
  }

  const deploy = p.match(/^\/api\/deploys\/([0-9a-f-]{36})(\/.*)?$/);
  if (deploy && deploys.has(deploy[1])) {
    const [, id, rest = ""] = deploy;
    if (m === "PUT" && rest.startsWith("/files/")) {
      await writeFile(deploys.get(id).dir, cleanPath(rest.slice("/files/".length)), req);
      return { ok: true };
    }
    if (m === "POST" && rest === "/publish") {
      const port = await publishDeploy(id);
      const files = await listFiles(siteRoot(port));
      console.log(`Site ${port} : nouvelle version publiée (${files.length} fichier(s))`);
      return { ok: true, files: files.length };
    }
    if (m === "DELETE" && rest === "") {
      await cancelDeploy(id);
      return { ok: true };
    }
  }
  throw new HttpError(404, "Introuvable");
}

const server = http.createServer(async (req, res) => {
  const send = (status, body) => {
    if (res.headersSent) return res.end();
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
  };
  try {
    // Un autre site ne peut pas ajouter cet en-tête sans autorisation CORS
    if (req.method !== "GET" && req.headers["x-requested-with"] !== "hawebdeployer") {
      throw new HttpError(403, "Requête refusée");
    }
    send(200, await route(req, new URL(req.url, "http://admin")));
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    send(err.status || 500, { erreur: err.status ? err.message : "Erreur interne" });
  }
});

// Nettoie les envois interrompus par un redémarrage
const prefixes = PORTS.map(tempPrefix);
for (const entry of await readdir(PARENT).catch(() => [])) {
  if (prefixes.some((prefix) => entry.startsWith(prefix))) {
    await rm(path.join(PARENT, entry), { force: true, recursive: true });
  }
}
await mkdir(BASE, { recursive: true });
await rm(SOCKET, { force: true });
server.listen(SOCKET, async () => {
  await chown(SOCKET, 0, Number(process.env.CADDY_GID));
  await chmod(SOCKET, 0o660);
  console.log("Panneau d'administration prêt");
});
