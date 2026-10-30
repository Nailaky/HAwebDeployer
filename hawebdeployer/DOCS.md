# HA Web Deployer

Cette app héberge un site web directement sur Home Assistant, le rend
accessible sur ton réseau local et le publie sur Internet grâce à
Cloudflare Tunnel. Le site peut être purement statique (HTML, CSS, JS,
images) ou avoir du code côté serveur (`_worker.js`) capable d'appeler des
services Home Assistant choisis.

- Aucun port à ouvrir sur la box : le tunnel est une connexion sortante.
- Home Assistant n'est **pas** exposé : seul le site l'est.
- HTTPS, masquage de l'IP et protection anti-DDoS sont assurés par Cloudflare.

## 1. Publier le site

1. Démarre l'app, puis clique sur **Ouvrir l'interface web** (ou active
   **Afficher dans la barre latérale**).
2. Glisse le dossier de ton site dans le cadre **Publier**, ou utilise
   **Choisir un dossier**. Le dossier doit contenir un `index.html` à sa
   racine.

C'est en ligne immédiatement, sans redémarrage :

- **Un dossier** remplace tout le site d'un coup : les visiteurs voient
  l'ancienne version jusqu'à ce que la nouvelle soit entièrement envoyée.
- **Des fichiers seuls** (bouton **Ajouter des fichiers**) sont ajoutés ou
  remplacent ceux du même nom.
- Les fichiers et dossiers cachés (`.git`, `.env`, `.DS_Store`...) sont
  ignorés.

Le panneau liste les fichiers en ligne (avec un bouton pour les supprimer),
affiche l'état du tunnel Cloudflare et donne un lien vers l'aperçu du site.

Les fichiers sont stockés dans le dossier `share/www` de Home Assistant :
tu peux aussi les modifier avec l'app Samba ou Studio Code Server.

> Tout ce qui est publié est public, sauf `_worker.js`. Ne mets jamais de
> mot de passe ni de jeton dans les fichiers du site : utilise les
> variables du worker (plus bas).

## 2. Code côté serveur (`_worker.js`)

Comme sur Cloudflare Pages, un fichier `_worker.js` à la racine du site
reçoit toutes les requêtes qui ne correspondent à aucun fichier statique. Il
utilise le même format qu'un Cloudflare Worker :

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

- **Accès à Home Assistant** : `env.HA_URL` donne accès à l'API de
  Home Assistant **sans jeton**. L'app l'ajoute elle-même, et seuls les
  services listés dans l'option **Services Home Assistant autorisés**
  passent (ici `script.sonnette`). Tout le reste est refusé (403).
- **Variables et secrets** : ajoute-les dans l'option **Variables du
  worker** (nom + valeur masquée). Elles sont disponibles dans le worker sous
  la forme `env.NOM`, comme les secrets d'un Cloudflare Worker. Elles restent
  dans le stockage privé de l'app et ne sont jamais publiées avec le site.
  Redémarre l'app après les avoir modifiées.
- **Adresse du visiteur** : elle est dans l'en-tête `X-Real-IP`
  (impossible à falsifier par le visiteur).
- **Rechargement** : le worker est chargé dès que `_worker.js` est publié,
  et rechargé à chaque modification.
- **Scripts des pages** : les scripts écrits directement dans le HTML sont
  bloqués par la Content-Security-Policy. Mets le JavaScript de tes pages
  dans des fichiers `.js` séparés.
- **Chemins relatifs** : écris `fetch("sonner")` plutôt que
  `fetch("/sonner")` pour que la page fonctionne aussi dans l'aperçu.

Une action déclenchée depuis Internet doit être protégée (code, Cloudflare
Access...) et limitée contre les essais en série : le worker garde son état
en mémoire entre les requêtes, ce qui permet de compter les échecs.

## 3. Accès en réseau local

Le site est accessible depuis tous les appareils de ton réseau sur le port
8080 de Home Assistant, par exemple `http://192.168.1.20:8080`. Le panneau
affiche ce lien.

Pour changer ce port ou désactiver cet accès, va dans la section **Réseau**
de l'app (champ vide = désactivé), puis redémarre l'app.

## 4. Publier sur Internet avec Cloudflare Tunnel

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

Le panneau indique alors « Tunnel Cloudflare connecté » et le lien du site.

> Garde bien `localhost:8080` comme URL de service : le tunnel tourne dans
> l'app, donc `localhost` désigne l'app elle-même (pas Home Assistant ni la
> machine). Ne la fais jamais pointer vers `homeassistant:8123` : cela
> exposerait Home Assistant. Le panneau affiche un avertissement si c'est le
> cas.

## 5. Options

| Option | Rôle |
|---|---|
| Dossier du site | Sous-dossier de `share` qui contient le site. Défaut : `www`. |
| Jeton Cloudflare Tunnel | Vide = le site n'est pas publié sur Internet. |
| Services Home Assistant autorisés | Services que `_worker.js` peut appeler, par exemple `script.garage_ouvrir`. Vide = aucun. |
| Variables du worker | Variables et secrets disponibles dans `_worker.js` (`env.NOM`). |
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

### Aperçu dans Home Assistant

Le lien **Voir l'aperçu** du panneau affiche le site à travers
Home Assistant. Les liens absolus (`/style.css`) n'y fonctionnent pas :
utilise des liens relatifs (`style.css`), qui fonctionnent partout.

## 6. Dépannage

| Symptôme | Cause |
|---|---|
| Page « Bientôt disponible » | Aucun `index.html` à la racine du site. |
| `Impossible de charger /share/www/_worker.js` dans le journal | Erreur dans le code du worker (le détail suit dans le journal). |
| Le worker reçoit une erreur 403 de `env.HA_URL` | Le service n'est pas dans **Services Home Assistant autorisés**. |
| `Register tunnel error ... Failed to get tunnel` dans le journal | Jeton Cloudflare incorrect ou tunnel supprimé. |
| Erreur 502 sur le domaine public | Dans Cloudflare, l'URL du service n'est pas `localhost:8080`. |
| L'app ne démarre pas après une mise à jour | Le port 8080 est déjà utilisé par une autre app : change-le dans **Réseau**. |

## 7. Sécurité

Ce que fait l'app :

- Seuls les administrateurs Home Assistant ont accès au panneau. L'envoi de
  fichiers passe par un canal que seul le panneau peut utiliser : ni le site
  public, ni le worker, ni les autres apps ne peuvent modifier le site.
- Caddy, cloudflared et le worker tournent chacun avec leur propre
  utilisateur **sans privilèges** et ne peuvent pas modifier les fichiers du
  site.
- L'app a accès à l'API de Home Assistant (pour le worker), mais uniquement
  à travers un filtre : seuls les services listés dans les options, en POST,
  sont transmis. Le jeton du Supervisor est ajouté par ce filtre et n'est
  jamais visible par le worker, pas plus que le jeton du tunnel.
- Les variables du worker sont transmises par un fichier que lui seul peut
  lire, jamais en ligne de commande ni dans le journal.
- L'app n'a pas accès au réseau de l'hôte.
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
