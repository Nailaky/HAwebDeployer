// Aperçu des sites dans Home Assistant. Chaque site y est servi sous
// /api/hassio_ingress/<jeton>/apercu/<port>/ : ses adresses absolues
// (/style.css, /_astro/…) pointeraient sinon vers Home Assistant lui-même.
// Ce service worker, installé par le panneau, les ramène dans l'aperçu.
const SCOPE = new URL(self.registration.scope).pathname; // …/apercu/
const INGRESS = SCOPE.slice(0, -"apercu/".length); // /api/hassio_ingress/<jeton>/

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Base du site affiché (…/apercu/8081/) d'après l'adresse d'une page
function siteBase(pageUrl) {
  const match = new URL(pageUrl).pathname.match(/^(.*\/apercu\/\d+\/)/);
  return match && match[1].startsWith(SCOPE) ? match[1] : null;
}

// Liens absolus du HTML (href="/x", srcset, redirection meta) -> href="<base>x"
function rewriteHtml(html, base) {
  return html
    .replace(/(\s(?:href|src|action|poster)=)(["']?)\/(?!\/)/gi, `$1$2${base}`)
    .replace(/(\ssrcset=)(["'])([^"']*)\2/gi, (all, attr, quote, list) =>
      `${attr}${quote}${list.replace(/(^|,\s*)\/(?!\/)/g, `$1${base}`)}${quote}`)
    .replace(/(content=["']\s*\d+\s*;\s*url=)\/(?!\/)/gi, `$1${base}`);
}

// Pages de l'aperçu : leurs liens sont réécrits pour rester dans l'aperçu
async function navigate(request, base) {
  const response = await fetch(request);
  if (!(response.headers.get("content-type") ?? "").includes("text/html")) return response;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(rewriteHtml(await response.text(), base), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Ressources demandées par une page de l'aperçu (CSS, scripts, images,
// polices, vidéos, fetch) : les adresses absolues sont ramenées dans le site
async function subresource(event) {
  const { request } = event;
  const url = new URL(request.url);
  const client = event.clientId ? await self.clients.get(event.clientId) : null;
  const base = client && siteBase(client.url);
  if (!base || url.pathname.startsWith(INGRESS)) return fetch(request);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return fetch(base + url.pathname.slice(1) + url.search, {
    method: request.method,
    headers: request.headers,
    body: hasBody ? await request.blob() : undefined,
    credentials: "include",
  });
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    const base = siteBase(url);
    if (base) event.respondWith(navigate(event.request, base));
    return;
  }
  event.respondWith(subresource(event));
});
