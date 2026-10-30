// Panneau d'administration : chemins relatifs, car il est servi par l'Ingress
// de Home Assistant sous /api/hassio_ingress/<jeton>/
const $ = (selector) => document.querySelector(selector);
const dropzone = $("#dropzone");
const message = $("#message");

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

function formatSize(bytes) {
	if (bytes < 1024) return `${bytes} o`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
	return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

function say(text, kind = "") {
	message.textContent = text;
	message.className = `message ${kind}`;
}

function setDot(el, kind) {
	el.className = `dot ${kind}`;
}

async function refreshStatus() {
	const status = await apiJson("status");

	const tunnel = {
		connecte: ["ok", "Tunnel Cloudflare connecté : le site est en ligne"],
		deconnecte: ["warn", "Tunnel Cloudflare configuré mais pas connecté (voir le journal)"],
		desactive: ["", "Pas de tunnel Cloudflare : le site n'est pas publié sur Internet"],
	}[status.tunnel.state];
	setDot($("#tunnel-dot"), tunnel[0]);
	$("#tunnel-text").textContent = tunnel[1];

	const site = status.hasWorker && status.hasIndex ? "index.html et _worker.js présents"
		: status.hasWorker ? "_worker.js présent"
		: status.hasIndex ? "index.html présent"
		: "Aucun index.html : une page d'attente est affichée";
	setDot($("#site-dot"), status.hasIndex || status.hasWorker ? "ok" : "warn");
	$("#site-text").textContent = `Dossier share/${status.folder} — ${site}`;

	const list = $("#hostnames");
	list.replaceChildren(...status.tunnel.hostnames.map(({ hostname, service }) => {
		const li = document.createElement("li");
		const link = document.createElement("a");
		link.href = `https://${hostname}/`;
		link.target = "_blank";
		link.rel = "noopener";
		link.textContent = `https://${hostname}`;
		li.append(link);
		if (!/^https?:\/\/(localhost|127\.0\.0\.1):8080\/?$/.test(service)) {
			const alert = document.createElement("div");
			alert.className = "alert";
			alert.textContent = `⚠ Ce nom pointe vers ${service} au lieu de localhost:8080`;
			li.append(alert);
		}
		return li;
	}));
}

async function refreshFiles() {
	const { files } = await apiJson("files");
	const rows = files.map((file) => {
		const tr = document.createElement("tr");
		const name = document.createElement("td");
		name.className = "path";
		name.textContent = file.path;
		const size = document.createElement("td");
		size.className = "size";
		size.textContent = formatSize(file.size);
		const actions = document.createElement("td");
		actions.className = "actions";
		const remove = document.createElement("button");
		remove.type = "button";
		remove.className = "link danger";
		remove.textContent = "Supprimer";
		remove.addEventListener("click", () => removeFile(file.path));
		actions.append(remove);
		tr.append(name, size, actions);
		return tr;
	});
	$("#files tbody").replaceChildren(...rows);
	$("#empty").hidden = files.length > 0;
	$("#clear").hidden = files.length === 0;
}

async function refresh() {
	try {
		await Promise.all([refreshStatus(), refreshFiles()]);
	} catch (err) {
		say(`Impossible de joindre l'app : ${err.message}`, "error");
	}
}

// items : [{ path, file }] ; replace : remplacer tout le site par ces fichiers
async function publish(items, replace) {
	const kept = items.filter((item) => !isHidden(item.path));
	const skipped = items.length - kept.length;
	if (kept.length === 0) {
		say("Aucun fichier à envoyer.", "error");
		return;
	}
	if (replace && !kept.some((i) => i.path === "index.html" || i.path === "_worker.js")
		&& !confirm("Ce dossier n'a pas d'index.html à sa racine. Le publier quand même ?")) {
		return;
	}

	dropzone.classList.add("busy");
	let deployId = null;
	try {
		let base = "files/";
		if (replace) {
			deployId = (await apiJson("deploys", { method: "POST" })).id;
			base = `deploys/${deployId}/files/`;
		}
		for (const [index, { path, file }] of kept.entries()) {
			say(`Envoi ${index + 1}/${kept.length} : ${path}`);
			await apiJson(base + encodePath(path), { method: "PUT", body: file });
		}
		if (deployId) await apiJson(`deploys/${deployId}/publish`, { method: "POST" });

		const ignored = skipped ? ` (${skipped} fichier(s) caché(s) ignoré(s))` : "";
		say(replace ? `Site publié : ${kept.length} fichier(s)${ignored}.`
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
		await apiJson(`files/${encodePath(path)}`, { method: "DELETE" });
		say(`${path} supprimé.`, "ok");
	} catch (err) {
		say(err.message, "error");
	}
	refresh();
}

$("#clear").addEventListener("click", async () => {
	if (!confirm("Supprimer tous les fichiers du site ?")) return;
	try {
		await apiJson("files", { method: "DELETE" });
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

// Adresse du site sur le réseau local : même machine que Home Assistant, port 8080
const host = location.hostname;
if (/^(10|127)\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|\.local$|^[^.:]+$/.test(host)) {
	const link = $("#lan-link");
	link.href = `http://${host}:8080/`;
	link.textContent = `http://${host}:8080`;
	$("#lan").hidden = false;
}

refresh();
setInterval(refreshStatus, 15000);
