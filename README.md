# HA Web Deployer

Dépôt d'app Home Assistant qui héberge un site web sur Home Assistant et le
publie sur Internet via Cloudflare Tunnel, sans ouvrir de port et sans
exposer Home Assistant. Le site peut avoir du code côté serveur
(`_worker.js`, format Cloudflare Worker) qui appelle des services
Home Assistant choisis.

```
Visiteur ──HTTPS──► Cloudflare ◄──tunnel sortant── App HA Web Deployer
                                                    ├─ Caddy :8080 → /share/www (lecture seule)
                                                    └─ _worker.js → filtre → services HA autorisés
```

## Installation

Il faut Home Assistant OS ou Home Assistant Supervised.

### Depuis GitHub

1. **Paramètres → Modules complémentaires → Boutique**, menu ⋮ →
   **Dépôts**.
2. Ajoute `https://github.com/Nailaky/HAwebDeployer`.
3. Installe **HA Web Deployer**.

### En local, sans GitHub

1. Copie le dossier `hawebdeployer` dans le dossier `addons` de Home
   Assistant (via l'app Samba).
2. Dans la boutique, menu ⋮ → **Rechercher des mises à jour** : l'app
   apparaît dans **Local add-ons**.

La configuration (dépôt du site, Cloudflare Tunnel, sécurité) est décrite
dans [hawebdeployer/DOCS.md](hawebdeployer/DOCS.md).

## Publier une nouvelle version

1. Modifie l'app, puis augmente `version` dans `hawebdeployer/config.yaml`.
2. Pousse sur `main` : le workflow **Build** construit les images amd64 et
   aarch64 et les publie sur `ghcr.io/nailaky/{arch}-hawebdeployer`.
3. Home Assistant propose la mise à jour une fois le workflow terminé.

## Structure

```
.github/workflows/       Construction et publication des images
repository.yaml          Déclaration du dépôt pour Home Assistant
hawebdeployer/
├── config.yaml          Manifeste de l'app (options, droits, port)
├── build.yaml           Images de base par architecture
├── Dockerfile           Caddy + cloudflared (vérifié par SHA-256)
├── DOCS.md              Documentation affichée dans Home Assistant
├── translations/        Libellés des options (fr, en)
└── rootfs/
    ├── etc/caddy/Caddyfile
    ├── etc/s6-overlay/  Services caddy, cloudflared et worker
    ├── opt/hawebdeployer/runtime.mjs   Exécution de _worker.js (Node.js)
    └── var/www/placeholder/index.html
```
