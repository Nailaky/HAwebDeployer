# HA Web Deployer

Cette app héberge un site web directement sur Home Assistant et le publie sur
Internet grâce à Cloudflare Tunnel. Le site peut être purement statique
(HTML, CSS, JS, images) ou avoir du code côté serveur (`_worker.js`) capable
d'appeler des services Home Assistant choisis.

- Aucun port à ouvrir sur la box : le tunnel est une connexion sortante.
- Home Assistant n'est **pas** exposé : seul le site l'est.
- HTTPS, masquage de l'IP et protection anti-DDoS sont assurés par Cloudflare.

## 1. Déposer le site

1. Copie les fichiers du site dans le dossier `share/www` de Home Assistant
   (via l'app Samba, l'app File editor ou Studio Code Server).
2. Le dossier doit contenir un `index.html` (ou un `_worker.js`, voir plus
   bas) à sa racine.
3. Démarre (ou redémarre) l'app.

Tant que le dossier est vide, une page « Bientôt disponible » est servie et
le journal de l'app indique où déposer les fichiers. Une fois le site en
place, les modifications de fichiers sont prises en compte immédiatement,
sans redémarrage.

> Tout ce qui se trouve dans ce dossier est public, sauf `_worker.js` et les
> fichiers cachés. N'y mets jamais de mot de passe ni de jeton.

## 2. Code côté serveur (`_worker.js`)

Comme sur Cloudflare Pages, un fichier `_worker.js` à la racine du site reçoit
toutes les requêtes qui ne correspondent à aucun fichier statique. Il utilise
le même format qu'un Cloudflare Worker :

```js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/sonner") {
      const r = await fetch(env.HA_URL + "/api/services/script/sonnette", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      return new Response(null, { status: r.ok ? 204 : 502 });
    }
    return new Response("Non trouvé", { status: 404 });
  },
};
```

- `env.HA_URL` donne accès à l'API de Home Assistant **sans jeton** : l'app
  l'ajoute elle-même, et seuls les services listés dans l'option
  **Services Home Assistant autorisés** passent (ici `script.sonnette`).
  Tout le reste est refusé (403).
- L'adresse IP du visiteur est dans l'en-tête `X-Real-IP` (impossible à
  falsifier par le visiteur).
- Après avoir ajouté `_worker.js` pour la première fois, redémarre l'app.
  Ensuite, chaque modification du fichier recharge le worker automatiquement.
- Les scripts écrits directement dans le HTML sont bloqués par la
  Content-Security-Policy : mets le JavaScript de tes pages dans des fichiers
  `.js` séparés.
- Utilise des chemins relatifs (`fetch("sonner")` plutôt que
  `fetch("/sonner")`) pour que la page fonctionne aussi dans l'aperçu
  Home Assistant.

Une action déclenchée depuis Internet doit être protégée (code, Cloudflare
Access...) et limitée contre les essais en série : le worker garde son état
en mémoire entre les requêtes, ce qui permet de compter les échecs.

## 3. Publier le site avec Cloudflare Tunnel

Prérequis : un nom de domaine géré par Cloudflare (compte gratuit suffisant).

1. Dans le tableau de bord Cloudflare, ouvre **Zero Trust → Networks →
   Tunnels** et crée un tunnel de type **Cloudflared**.
2. À l'étape d'installation, copie le **jeton** : c'est la longue chaîne
   après `--token` dans la commande proposée. N'exécute pas cette commande.
3. Ajoute un **Public hostname** :
   - Sous-domaine et domaine : par exemple `www.mondomaine.fr`
   - Type de service : `HTTP`
   - URL : `localhost:8080`
4. Colle le jeton dans l'option **Jeton Cloudflare Tunnel** de l'app,
   enregistre et redémarre l'app.

Le journal de l'app doit afficher `Registered tunnel connection`. Le site est
alors accessible sur `https://www.mondomaine.fr`.

> L'URL du service doit rester `localhost:8080`. Ne la fais jamais pointer
> vers `homeassistant:8123` : cela exposerait Home Assistant.

## 4. Options

| Option | Rôle |
|---|---|
| Dossier du site | Sous-dossier de `share` qui contient le site. Défaut : `www`. |
| Jeton Cloudflare Tunnel | Vide = le site n'est pas publié sur Internet. |
| Services Home Assistant autorisés | Services que `_worker.js` peut appeler, par exemple `script.garage_ouvrir`. Vide = aucun. |
| Content-Security-Policy | Limite ce que les pages peuvent charger. Voir ci-dessous. |

### Content-Security-Policy

Par défaut, les pages ne peuvent charger que leurs propres fichiers
(scripts, styles, images). Les scripts écrits directement dans le HTML
(`<script>...</script>`) et les ressources externes (Google Fonts, CDN...)
sont bloqués. Si ton site en a besoin, ajoute les domaines concernés, par
exemple :

```
default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

La console du navigateur (F12) indique ce qui a été bloqué.

## 5. Aperçu dans Home Assistant

Le bouton **Ouvrir l'interface web** affiche le site dans Home Assistant,
sans ouvrir de port. Seuls les utilisateurs connectés à Home Assistant y ont
accès. Tu peux aussi l'ajouter à la barre latérale (option **Afficher dans
la barre latérale**).

Dans cet aperçu, les liens absolus (`/style.css`, `/page.html`) ne
fonctionnent pas, car le site est servi sous une adresse du type
`/api/hassio_ingress/...`. Utilise des liens relatifs (`style.css`,
`page.html`, `../index.html`) : ils fonctionnent partout. Le site public
n'est pas concerné.

### Accès en réseau local (facultatif)

Le port 8080 n'est pas ouvert par défaut. Pour tester le site depuis ton
réseau local sans passer par Internet, indique un port dans la section
**Réseau** de l'app (par exemple `8080`), puis ouvre
`http://<ip-de-home-assistant>:8080`.

## 6. Dépannage

| Message dans le journal | Cause |
|---|---|
| `Aucun index.html ni _worker.js trouvé dans /share/www` | Le dossier du site est vide ou mal nommé. |
| `Impossible de charger /share/www/_worker.js` | Erreur dans le code du worker (le détail suit dans le journal). |
| Le worker reçoit une erreur 403 de `env.HA_URL` | Le service n'est pas dans **Services Home Assistant autorisés**. |
| `Register tunnel error ... Failed to get tunnel` | Jeton Cloudflare incorrect ou tunnel supprimé. |
| `Registered tunnel connection` | Tout va bien : le tunnel est connecté. |
| Erreur 502 sur le domaine | Dans Cloudflare, l'URL du service n'est pas `localhost:8080`. |

## 7. Sécurité

Ce que fait l'app :

- Le dossier `share` est monté en **lecture seule** : le serveur web ne
  peut rien modifier.
- Caddy, cloudflared et le worker tournent chacun avec leur propre
  utilisateur **sans privilèges**.
- L'app a accès à l'API de Home Assistant (pour le worker), mais uniquement
  à travers un filtre : seuls les services listés dans les options, en POST,
  sont transmis. Le jeton du Supervisor est ajouté par ce filtre et n'est
  jamais visible par le worker, pas plus que le jeton du tunnel.
- L'app n'a pas accès au réseau de l'hôte.
- L'aperçu Ingress n'accepte que les connexions du proxy de Home Assistant :
  les autres apps du réseau interne sont refusées.
- Les fichiers cachés (`.git`, `.env`...) et `_worker.js` ne sont jamais
  servis, et les dossiers ne sont jamais listés.
- En-têtes de sécurité envoyés avec chaque page : CSP, HSTS,
  `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`.
- Le binaire cloudflared est vérifié par sa somme SHA-256 à la construction.

Ce que tu peux ajouter côté Cloudflare :

- **Cloudflare Access** (Zero Trust → Access → Applications) pour réserver
  le site à certaines adresses e-mail (code envoyé par e-mail).
- Une règle de **limitation de débit** (Security → WAF → Rate limiting rules).
- Le mode **Always Use HTTPS** (SSL/TLS → Edge Certificates).
