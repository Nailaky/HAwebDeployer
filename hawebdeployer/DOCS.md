# HA Web Deployer

Cette app héberge un site web statique (HTML, CSS, JS, images) directement
sur Home Assistant et le publie sur Internet grâce à Cloudflare Tunnel.

- Aucun port à ouvrir sur la box : le tunnel est une connexion sortante.
- Home Assistant n'est **pas** exposé : seul le site l'est.
- HTTPS, masquage de l'IP et protection anti-DDoS sont assurés par Cloudflare.

## 1. Déposer le site

1. Copie les fichiers du site dans le dossier `share/www` de Home Assistant
   (via l'app Samba, l'app File editor ou Studio Code Server).
2. Le dossier doit contenir un `index.html` à sa racine.
3. Démarre (ou redémarre) l'app.

Tant qu'aucun `index.html` n'est trouvé, une page « Bientôt disponible » est
servie et le journal de l'app indique où déposer les fichiers. Une fois le
site en place, les modifications de fichiers sont prises en compte
immédiatement, sans redémarrage.

> Tout ce qui se trouve dans ce dossier est public. N'y mets jamais de mot de
> passe, de jeton ou de fichier de configuration.

## 2. Publier le site avec Cloudflare Tunnel

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

## 3. Options

| Option | Rôle |
|---|---|
| Dossier du site | Sous-dossier de `share` qui contient le site. Défaut : `www`. |
| Jeton Cloudflare Tunnel | Vide = le site n'est pas publié sur Internet. |
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

## 4. Accès en réseau local (facultatif)

Le port 8080 n'est pas ouvert par défaut. Pour tester le site depuis ton
réseau local sans passer par Internet, indique un port dans la section
**Réseau** de l'app (par exemple `8080`), puis ouvre
`http://<ip-de-home-assistant>:8080`.

## 5. Dépannage

| Message dans le journal | Cause |
|---|---|
| `Aucun index.html trouvé dans /share/www` | Le dossier du site est vide ou mal nommé. |
| `Register tunnel error ... Failed to get tunnel` | Jeton Cloudflare incorrect ou tunnel supprimé. |
| `Registered tunnel connection` | Tout va bien : le tunnel est connecté. |
| Erreur 502 sur le domaine | Dans Cloudflare, l'URL du service n'est pas `localhost:8080`. |

## 6. Sécurité

Ce que fait l'app :

- Le dossier `share` est monté en **lecture seule** : le serveur web ne
  peut rien modifier.
- Caddy et cloudflared tournent avec des utilisateurs **sans privilèges**.
- L'app n'a **aucun accès** à l'API de Home Assistant ni au réseau de l'hôte.
- Les fichiers cachés (`.git`, `.env`...) ne sont jamais servis et les
  dossiers ne sont jamais listés.
- En-têtes de sécurité envoyés avec chaque page : CSP, HSTS,
  `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`.
- Le binaire cloudflared est vérifié par sa somme SHA-256 à la construction.

Ce que tu peux ajouter côté Cloudflare :

- **Cloudflare Access** (Zero Trust → Access → Applications) pour réserver
  le site à certaines adresses e-mail (code envoyé par e-mail).
- Une règle de **limitation de débit** (Security → WAF → Rate limiting rules).
- Le mode **Always Use HTTPS** (SSL/TLS → Edge Certificates).
