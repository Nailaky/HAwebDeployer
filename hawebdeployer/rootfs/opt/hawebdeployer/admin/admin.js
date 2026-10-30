// Panneau d'administration : chemins relatifs, car il est servi par l'Ingress
// de Home Assistant sous /api/hassio_ingress/<jeton>/
const $ = (selector) => document.querySelector(selector);
const dropzone = $("#dropzone");
const message = $("#message");

const PORTS = Array.from({ length: 10 }, (_, i) => 8080 + i);
let status = { tunnel: { state: "desactive", hostnames: [] }, sites: [] };
let current = PORTS.includes(Number(location.hash.slice(1))) ? Number(location.hash.slice(1)) : 8080;
const created = new Set([current]); // nouveaux sites encore vides, affichés quand même

function api(path, options = {}) {
	return fetch(`api/${path}`, {
		...options,
		headers: { "X-Requested-With": "hawebdeployer", ...options.headers },
	});
}

async function apiJson(path, options) {
	const res = await api(path, options);
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data.erreur || `Erreur ${res.status}`);
	return data;
}

const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");
const isHidden = (p) => p.split("/").some((part) => part.startsWith(".") && part !== ".well-known");
const servicePort = (service) => Number(service?.match(/^https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)\/?$/)?.[1]);

function formatSize(bytes) {
	if (bytes < 1024) return `${bytes} o`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
	return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

function say(text, kind = "") {
	message.textContent = text;
	message.className = `message ${kind}`;
}

function element(tag, props = {}, ...children) {
	const el = Object.assign(document.createElement(tag), props);
	el.append(...children);
	return el;
}

const siteInfo = (port) => status.sites.find((s) => s.port === port);
const siteState = (site) => (site?.strayWorker ? "warn" : site?.hasIndex || site?.hasWorker ? "ok" : "");

// Adresse sur le réseau local : même machine que Home Assistant
const host = location.hostname;
const isLocalHost = /^(10|127)\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|\.local$|^[^.:]+$/.test(host);

function renderTunnel() {
	const [kind, text] = {
		connecte: ["ok", "Tunnel Cloudflare connecté"],
		deconnecte: ["warn", "Tunnel Cloudflare configuré mais pas connecté (voir le journal de l'app)"],
		desactive: ["", "Pas de tunnel Cloudflare : les sites ne sont pas publiés sur Internet"],
	}[status.tunnel.state];
	$("#tunnel-dot").className = `dot ${kind}`;
	$("#tunnel-text").textContent = text;

	// Noms de domaine qui ne pointent vers aucun site de l'app
	$("#tunnel-alerts").replaceChildren(...status.tunnel.hostnames
		.filter(({ service }) => !PORTS.includes(servicePort(service)))
		.map(({ hostname, service }) => element("li", {
			textContent: `⚠ ${hostname} pointe vers ${service} : il doit pointer vers localhost:8080 à 8089`,
		})));
}

function renderTabs() {
	const visible = PORTS.filter((port) => port === 8080 || created.has(port) || siteInfo(port)?.files > 0);
	const tabs = visible.map((port) => {
		const tab = element("button", { type: "button", className: "tab" },
			element("span", { className: `dot ${siteState(siteInfo(port))}` }), `Port ${port}`);
		tab.setAttribute("aria-current", String(port === current));
		tab.addEventListener("click", () => select(port));
		return tab;
	});
	const free = PORTS.find((port) => !visible.includes(port));
	if (free) {
		const add = element("button", { type: "button", className: "tab new", textContent: "+ Nouveau site" });
		add.addEventListener("click", () => {
			created.add(free);
			select(free);
		});
		tabs.push(add);
	}
	$("#tabs").replaceChildren(...tabs);
}

function renderSite() {
	const site = siteInfo(current);
	$("#site-title").textContent = `Site du port ${current}`;
	$("#preview").href = `apercu/${current}/`;

	const state = site?.strayWorker ? "worker.js n'est pas exécuté : il doit s'appeler _worker.js (republie-le depuis ce panneau)"
		: site?.hasWorker && site?.hasIndex ? "index.html et _worker.js présents"
		: site?.hasWorker ? "_worker.js présent"
		: site?.hasIndex ? "index.html présent"
		: "Rien de publié : une page d'attente est affichée";
	$("#site-dot").className = `dot ${siteState(site) || "warn"}`;
	$("#site-text").textContent = `Dossier share/${site?.folder ?? ""} — ${state}`;

	const links = [];
	if (isLocalHost) {
		const url = `http://${host}:${current}`;
		links.push(element("li", {}, element("span", { className: "label", textContent: "Réseau local : " }),
			element("a", { href: `${url}/`, target: "_blank", rel: "noopener", textContent: url })));
	}
	for (const { hostname } of status.tunnel.hostnames.filter(({ service }) => servicePort(service) === current)) {
		links.push(element("li", {}, element("span", { className: "label", textContent: "Internet : " }),
			element("a", { href: `https://${hostname}/`, target: "_blank", rel: "noopener", textContent: `https://${hostname}` })));
	}
	$("#links").replaceChildren(...links);

	const hint = $("#port-hint");
	hint.hidden = current === 8080;
	hint.textContent = `Sur le réseau local, ce site n'est visible que si le port ${current} est activé dans l'onglet Réseau de l'app. `
		+ `Sur Internet, ajoute un nom de domaine qui pointe vers localhost:${current} dans le tunnel Cloudflare.`;
}

async function refreshFiles() {
	const { files } = await apiJson(`sites/${current}/files`);
	const rows = files.map((file) => {
		const remove = element("button", { type: "button", className: "link danger", textContent: "Supprimer" });
		remove.addEventListener("click", () => removeFile(file.path));
		return element("tr", {},
			element("td", { className: "path", textContent: file.path }),
			element("td", { className: "size", textContent: formatSize(file.size) }),
			element("td", { className: "actions" }, remove));
	});
	$("#files tbody").replaceChildren(...rows);
	$("#empty").hidden = files.length > 0;
	$("#clear").hidden = files.length === 0;
}

async function refresh() {
	try {
		status = await apiJson("status");
		renderTunnel();
		renderTabs();
		renderSite();
		await refreshFiles();
	} catch (err) {
		say(`Impossible de joindre l'app : ${err.message}`, "error");
	}
}

function select(port) {
	current = port;
	history.replaceState(null, "", `#${port}`);
	say("");
	refresh();
}

// items : [{ path, file }] ; replace : remplacer tout le site par ces fichiers
async function publish(items, replace) {
	const port = current;

	// Un Cloudflare Worker gardé sous son nom d'origine ne serait pas exécuté
	const plain = items.find((item) => item.path === "worker.js");
	if (plain && !items.some((item) => item.path === "_worker.js")
		&& /export\s+default/.test(await plain.file.text())
		&& confirm("worker.js ressemble à un Cloudflare Worker. Le publier sous le nom _worker.js, pour qu'il soit exécuté par le serveur (et jamais envoyé tel quel aux visiteurs) ?")) {
		plain.path = "_worker.js";
	}

	const kept = items.filter((item) => !isHidden(item.path));
	const skipped = items.length - kept.length;
	if (kept.length === 0) {
		say("Aucun fichier à envoyer.", "error");
		return;
	}
	if (replace && !kept.some((i) => i.path === "index.html" || i.path === "_worker.js")
		&& !confirm("Ce dossier n'a ni index.html ni _worker.js à sa racine. Le publier quand même ?")) {
		return;
	}

	dropzone.classList.add("busy");
	let deployId = null;
	try {
		let base = `sites/${port}/files/`;
		if (replace) {
			deployId = (await apiJson(`sites/${port}/deploys`, { method: "POST" })).id;
			base = `deploys/${deployId}/files/`;
		}
		for (const [index, { path, file }] of kept.entries()) {
			say(`Envoi ${index + 1}/${kept.length} : ${path}`);
			await apiJson(base + encodePath(path), { method: "PUT", body: file });
		}
		if (deployId) await apiJson(`deploys/${deployId}/publish`, { method: "POST" });

		const ignored = skipped ? ` (${skipped} fichier(s) caché(s) ignoré(s))` : "";
		say(replace ? `Site publié sur le port ${port} : ${kept.length} fichier(s)${ignored}.`
			: `${kept.length} fichier(s) ajouté(s)${ignored}.`, "ok");
	} catch (err) {
		if (deployId) await api(`deploys/${deployId}`, { method: "DELETE" }).catch(() => {});
		say(`Échec de l'envoi : ${err.message}. Le site en ligne n'a pas changé.`, "error");
	} finally {
		dropzone.classList.remove("busy");
		refresh();
	}
}

async function removeFile(path) {
	if (!confirm(`Supprimer ${path} du site ?`)) return;
	try {
		await apiJson(`sites/${current}/files/${encodePath(path)}`, { method: "DELETE" });
		say(`${path} supprimé.`, "ok");
	} catch (err) {
		say(err.message, "error");
	}
	refresh();
}

$("#clear").addEventListener("click", async () => {
	if (!confirm(`Supprimer tous les fichiers du site du port ${current} ?`)) return;
	try {
		await apiJson(`sites/${current}/files`, { method: "DELETE" });
		created.delete(current);
		// Un site supplémentaire vidé disparaît : on revient au site principal
		if (current !== 8080) {
			select(8080);
			return;
		}
		say("Site vidé.", "ok");
	} catch (err) {
		say(err.message, "error");
	}
	refresh();
});

// Lecture récursive d'un dossier déposé
function readEntries(reader) {
	return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

async function collect(entry, prefix) {
	if (entry.isFile) {
		const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
		return [{ path: prefix + entry.name, file }];
	}
	const reader = entry.createReader();
	const children = [];
	for (let batch = await readEntries(reader); batch.length; batch = await readEntries(reader)) {
		children.push(...batch);
	}
	const items = [];
	for (const child of children) items.push(...await collect(child, `${prefix}${entry.name}/`));
	return items;
}

// Retire le nom du dossier choisi : mon-site/index.html -> index.html
const stripRoot = (items) => items.map(({ path, file }) => ({ path: path.slice(path.indexOf("/") + 1), file }));

dropzone.addEventListener("dragover", (event) => {
	event.preventDefault();
	dropzone.classList.add("over");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("over"));
dropzone.addEventListener("drop", async (event) => {
	event.preventDefault();
	dropzone.classList.remove("over");
	const entries = [...event.dataTransfer.items]
		.map((item) => item.webkitGetAsEntry?.())
		.filter(Boolean);
	if (entries.length === 1 && entries[0].isDirectory) {
		publish(stripRoot(await collect(entries[0], "")), true);
	} else {
		const items = [];
		for (const entry of entries) items.push(...await collect(entry, ""));
		publish(items, false);
	}
});

$("#pick-folder").addEventListener("change", (event) => {
	const items = [...event.target.files].map((file) => ({ path: file.webkitRelativePath, file }));
	event.target.value = "";
	if (items.length) publish(stripRoot(items), true);
});

$("#pick-files").addEventListener("change", (event) => {
	const items = [...event.target.files].map((file) => ({ path: file.name, file }));
	event.target.value = "";
	if (items.length) publish(items, false);
});

refresh();
setInterval(async () => {
	try {
		status = await apiJson("status");
		renderTunnel();
		renderTabs();
		renderSite();
	} catch {}
}, 15000);
