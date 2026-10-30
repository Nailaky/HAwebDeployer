// API du panneau d'administration (Ingress) : état du tunnel, liste, envoi et
// suppression des fichiers du site. Écoute sur un socket Unix que seul Caddy
// peut ouvrir : ni le worker ni le site public n'y ont accès.
import http from "node:http";
import { createWriteStream } from "node:fs";
import { chmod, chown, mkdir, readdir, rename, rm, rmdir, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";

const SITE = process.env.SITE_ROOT;
const PARENT = path.dirname(SITE);
const TEMP_PREFIX = `.${path.basename(SITE)}.`;
const SOCKET = "/run/hawebdeployer/admin.sock";
const MAX_FILE = 25 * 1024 * 1024;

// Envois en cours : chaque nouvelle version est préparée à côté du site, puis
// échangée avec lui d'un coup pour ne jamais servir un site à moitié envoyé
const deploys = new Map();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
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

async function deleteFile(rel) {
  const target = path.join(SITE, rel);
  await rm(target, { force: true, recursive: true });
  // Supprime les dossiers devenus vides, sans remonter au-delà du site
  for (let dir = path.dirname(target); dir !== SITE && dir.startsWith(SITE); dir = path.dirname(dir)) {
    try {
      await rmdir(dir);
    } catch {
      break;
    }
  }
}

async function clearSite() {
  for (const entry of await readdir(SITE).catch(() => [])) {
    await rm(path.join(SITE, entry), { force: true, recursive: true });
  }
}

async function startDeploy() {
  const id = randomUUID();
  const dir = path.join(PARENT, `${TEMP_PREFIX}deploy-${id}`);
  await mkdir(dir, { recursive: true });
  deploys.set(id, dir);
  return id;
}

async function publishDeploy(id) {
  const staging = deploys.get(id);
  const old = path.join(PARENT, `${TEMP_PREFIX}old-${id}`);
  const hadSite = await rename(SITE, old).then(() => true, (err) => {
    if (err.code === "ENOENT") return false;
    throw err;
  });
  try {
    await rename(staging, SITE);
  } catch (err) {
    if (hadSite) await rename(old, SITE);
    throw err;
  }
  deploys.delete(id);
  if (hadSite) await rm(old, { force: true, recursive: true });
}

async function cancelDeploy(id) {
  await rm(deploys.get(id), { force: true, recursive: true });
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

async function route(req, url) {
  const p = url.pathname;
  const m = req.method;

  if (m === "GET" && p === "/api/status") {
    const files = await listFiles(SITE);
    return {
      folder: process.env.SITE_FOLDER,
      tunnel: await tunnelStatus(),
      hasIndex: files.some((f) => f.path === "index.html"),
      hasWorker: files.some((f) => f.path === "_worker.js"),
    };
  }
  if (m === "GET" && p === "/api/files") return { files: await listFiles(SITE) };
  if (m === "DELETE" && p === "/api/files") {
    await clearSite();
    console.log("Site vidé depuis le panneau");
    return { ok: true };
  }
  if (p.startsWith("/api/files/")) {
    const rel = cleanPath(p.slice("/api/files/".length));
    if (m === "PUT") {
      await writeFile(SITE, rel, req);
      console.log(`Fichier envoyé : ${rel}`);
      return { ok: true };
    }
    if (m === "DELETE") {
      await deleteFile(rel);
      console.log(`Fichier supprimé : ${rel}`);
      return { ok: true };
    }
  }

  if (m === "POST" && p === "/api/deploys") return { id: await startDeploy() };
  const deploy = p.match(/^\/api\/deploys\/([0-9a-f-]{36})(\/.*)?$/);
  if (deploy && deploys.has(deploy[1])) {
    const [, id, rest = ""] = deploy;
    if (m === "PUT" && rest.startsWith("/files/")) {
      await writeFile(deploys.get(id), cleanPath(rest.slice("/files/".length)), req);
      return { ok: true };
    }
    if (m === "POST" && rest === "/publish") {
      await publishDeploy(id);
      const files = await listFiles(SITE);
      console.log(`Nouvelle version du site publiée : ${files.length} fichier(s)`);
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
for (const entry of await readdir(PARENT).catch(() => [])) {
  if (entry.startsWith(TEMP_PREFIX)) await rm(path.join(PARENT, entry), { force: true, recursive: true });
}
await mkdir(SITE, { recursive: true });
await rm(SOCKET, { force: true });
server.listen(SOCKET, async () => {
  await chown(SOCKET, 0, Number(process.env.CADDY_GID));
  await chmod(SOCKET, 0o660);
  console.log("Panneau d'administration prêt");
});
