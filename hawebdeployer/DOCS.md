# HA Web Deployer

Cette app héberge jusqu'à 10 sites web directement sur Home Assistant, un par
port (8080 à 8089). Elle les rend accessibles sur ton réseau local et les
publie sur Internet grâce à Cloudflare Tunnel. Chaque site peut être purement
statique (HTML, CSS, JS, images) ou avoir du code côté serveur (`_worker.js`,
au format Cloudflare Worker) capable d'appeler des services Home Assistant
choisis.

- Aucun port à ouvrir sur la box : le tunnel est une connexion sortante.
- Home Assistant n'est **pas** exposé : seuls les sites le sont.
- HTTPS, masquage de l'IP et protection anti-DDoS sont assurés par Cloudflare.

## 1. Publier un site

1. Démarre l'app, puis clique sur **Ouvrir l'interface web** (ou active
   **Afficher dans la barre latérale**).
2. Choisis le site avec les onglets **Port 8080**, **Port 8081**... ou crée-en
   un avec **+ Nouveau site**.
3. Glisse le dossier du site dans le cadre, ou utilise **Choisir un
   dossier**. Le dossier doit contenir un `index.html` (ou un `_worker.js`) à
   sa racine.

C'est en ligne immédiatement, sans redémarrage :

- **Un dossier** remplace tout le site d'un coup : les visiteurs voient
  l'ancienne version jusqu'à ce que la nouvelle soit entièrement envoyée.
- **Des fichiers seuls** (bouton **Ajouter des fichiers**) sont ajoutés ou
  remplacent ceux du même nom.
- Les fichiers et dossiers cachés (`.git`, `.env`, `.DS_Store`...) sont
  ignorés.
- **Tout supprimer** vide le site ; un site autre que celui du port 8080
  disparaît alors des onglets.

Pour chaque site, le panneau liste les fichiers en ligne, donne ses adresses
(réseau local et Internet) et un lien vers son aperçu.

Les fichiers sont stockés dans `share/www` (port 8080) et `share/www-8081`,
`share/www-8082`... pour les autres ports. Tu peux aussi les modifier avec
l'app Samba ou Studio Code Server.

> Tout ce qui est publié est public, sauf `_worker.js`. Ne mets jamais de
> mot de passe ni de jeton dans les fichiers d'un site : utilise les
> variables des workers (plus bas).

## 2. Code côté serveur (`_worker.js`)

Un fichier `_worker.js` à la racine d'un site reçoit toutes les requêtes qui
ne correspondent à aucun fichier statique de ce site. Il utilise le même
format qu'un Cloudflare Worker, et un worker existant fonctionne en général
tel quel :

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

- **Nom du fichier** : il doit s'appeler `_worker.js`. Si tu publies un
  `worker.js`, le panneau propose de le renommer.
- **Accès à Home Assistant** : `env.HA_URL` donne accès à l'API de
  Home Assistant **sans jeton**. L'app l'ajoute elle-même (un
  `env.HA_TOKEN` venant de Cloudflare est inutile et ignoré), et seuls les
  services listés dans l'option **Services Home Assistant autorisés**
  passent (ici `script.sonnette`). Tout le reste est refusé (403).
- **Variables et secrets** : ajoute-les dans l'option **Variables des
  workers** (nom + valeur masquée). Ils sont disponibles dans tous les
  workers sous la forme `env.NOM`, comme les secrets d'un Cloudflare Worker.
  Ils restent dans le stockage privé de l'app et ne sont jamais publiés.
  Redémarre l'app après les avoir modifiés.
- **Sécurité des pages** : comme sur Cloudflare, un worker gère ses propres
  en-têtes. La Content-Security-Policy des options ne s'applique pas à ses
  réponses : le HTML qu'il renvoie peut contenir des `<script>` intégrés.
- **Adresse du visiteur** : elle est dans l'en-tête `X-Real-IP`
  (impossible à falsifier par le visiteur).
- **Rechargement** : un worker est chargé dès que `_worker.js` est publié,
  et rechargé à chaque modification.
- **Chemins relatifs** : écris `fetch("sonner")` plutôt que
  `fetch("/sonner")` pour que la page fonctionne aussi dans l'aperçu.

Une action déclenchée depuis Internet doit être protégée (code, Cloudflare
Access...) et limitée contre les essais en série : un worker garde son état
en mémoire entre les requêtes, ce qui permet de compter les échecs.

## 3. Accès en réseau local

Chaque site est accessible depuis ton réseau sur son port, par exemple
`http://192.168.1.20:8080` pour le site du port 8080. Le panneau affiche ce
lien.

Seul le port 8080 est ouvert par défaut. Pour un autre site, active son port
dans la section **Réseau** de l'app (par exemple `8081` en face de
« Site du port 8081 »), puis redémarre l'app. Un champ vide désactive
l'accès en réseau local, sans toucher à la publication sur Internet.

## 4. Publier sur Internet avec Cloudflare Tunnel

Prérequis : un nom de domaine géré par Cloudflare (compte gratuit suffisant).
Un seul tunnel suffit pour tous les sites.

1. Dans le tableau de bord Cloudflare, ouvre **Zero Trust → Networks →
   Tunnels** et crée un tunnel de type **Cloudflared**.
2. À l'étape d'installation, copie le **jeton** : c'est la longue chaîne
   après `--token` dans la commande proposée. N'exécute pas cette commande.
3. Ajoute un **Public hostname** par site :
   - Sous-domaine et domaine : par exemple `garage.mondomaine.fr`
   - Type de service : `HTTP`
   - URL : `localhost:8080` pour le site du port 8080, `localhost:8081` pour
     celui du port 8081, etc.
4. Colle le jeton dans l'option **Jeton Cloudflare Tunnel** de l'app,
   enregistre et redémarre l'app.

Le panneau indique alors « Tunnel Cloudflare connecté » et affiche chaque nom
de domaine dans l'onglet du site correspondant.

> `localhost` désigne ici l'app elle-même (le tunnel tourne dedans), pas
> Home Assistant ni la machine. Ne fais jamais pointer un nom vers
> `homeassistant:8123` : cela exposerait Home Assistant. Le panneau affiche
> un avertissement si c'est le cas.

## 5. Options

| Option | Rôle |
|---|---|
| Dossier des sites | Dossier de `share` du site du port 8080 ; les autres sont dans `<dossier>-<port>`. Défaut : `www`. |
| Jeton Cloudflare Tunnel | Vide = les sites ne sont pas publiés sur Internet. |
| Services Home Assistant autorisés | Services que les workers peuvent appeler, par exemple `script.garage_ouvrir`. Vide = aucun. |
| Variables des workers | Variables et secrets disponibles dans les workers (`env.NOM`). |
| Content-Security-Policy | Limite ce que les pages statiques peuvent charger. Voir ci-dessous. |

### Content-Security-Policy

Par défaut, les pages statiques ne peuvent charger que leurs propres fichiers
(scripts, styles, images). Les scripts écrits directement dans le HTML
(`<script>...</script>`) et les ressources externes (Google Fonts, CDN...)
sont bloqués. Si ton site en a besoin, ajoute les domaines concernés, par
exemple :

```
default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

La console du navigateur (F12) indique ce qui a été bloqué. Les réponses des
workers ne sont pas concernées.

### Aperçu dans Home Assistant

Le lien **Voir l'aperçu** du panneau affiche le site à travers
Home Assistant. Les liens absolus (`/style.css`) n'y fonctionnent pas :
utilise des liens relatifs (`style.css`), qui fonctionnent partout.

## 6. Dépannage

| Symptôme | Cause |
|---|---|
| Page « Bientôt disponible » | Ni `index.html` ni `_worker.js` à la racine du site. |
| « worker.js n'est pas exécuté » dans le panneau | Le worker doit s'appeler `_worker.js` : republie-le depuis le panneau. |
| `Impossible de charger .../_worker.js` dans le journal | Erreur dans le code du worker (le détail suit dans le journal). |
| Le worker reçoit une erreur 403 de `env.HA_URL` | Le service n'est pas dans **Services Home Assistant autorisés**. |
| Un site n'est pas visible sur le réseau local | Son port n'est pas activé dans la section **Réseau** de l'app. |
| `Register tunnel error ... Failed to get tunnel` dans le journal | Jeton Cloudflare incorrect ou tunnel supprimé. |
| Erreur 502 sur un domaine public | Dans Cloudflare, l'URL du service n'est pas `localhost:808X`. |
| L'app ne démarre pas après avoir activé un port | Ce port est déjà utilisé par une autre app : choisis-en un autre dans **Réseau**. |

## 7. Sécurité

Ce que fait l'app :

- Seuls les administrateurs Home Assistant ont accès au panneau. L'envoi de
  fichiers passe par un canal que seul le panneau peut utiliser : ni les
  sites publics, ni les workers, ni les autres apps ne peuvent modifier un
  site.
- Caddy, cloudflared et les workers tournent chacun avec leur propre
  utilisateur **sans privilèges** et ne peuvent pas modifier les fichiers des
  sites.
- Chaque requête indique à son worker le site dont elle vient ; un visiteur
  ne peut pas atteindre le worker d'un autre site.
- L'app a accès à l'API de Home Assistant (pour les workers), mais uniquement
  à travers un filtre : seuls les services listés dans les options, en POST,
  sont transmis. Le jeton du Supervisor est ajouté par ce filtre et n'est
  jamais visible par les workers, pas plus que le jeton du tunnel.
- Les variables des workers sont transmises par un fichier qu'eux seuls
  peuvent lire, jamais en ligne de commande ni dans le journal.
- L'app n'a pas accès au réseau de l'hôte.
- Les fichiers cachés (`.git`, `.env`...) et `_worker.js` ne sont jamais
  servis, et les dossiers ne sont jamais listés.
- En-têtes de sécurité envoyés avec chaque page : HSTS,
  `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`, et la CSP des options pour les fichiers statiques.
- Le binaire cloudflared est vérifié par sa somme SHA-256 à la construction.

Ce que tu peux ajouter côté Cloudflare :

- **Cloudflare Access** (Zero Trust → Access → Applications) pour réserver
  un site à certaines adresses e-mail (code envoyé par e-mail).
- Une règle de **limitation de débit** (Security → WAF → Rate limiting rules).
- Le mode **Always Use HTTPS** (SSL/TLS → Edge Certificates).
