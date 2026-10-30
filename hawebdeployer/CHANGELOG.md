# Changelog

## 0.4.0

- Plusieurs sites : jusqu'à 10, un par port (8080 à 8089), chacun avec son
  dossier et son `_worker.js`. Le panneau a un onglet par site et un bouton
  « + Nouveau site ». Les ports autres que 8080 s'activent dans « Réseau ».
- Un Cloudflare Worker fonctionne tel quel : la CSP des options ne
  s'applique plus aux réponses des workers, qui gèrent la leur.
- Le panneau propose de publier un `worker.js` sous le nom `_worker.js`, et
  signale un `worker.js` mal nommé déjà en ligne.

## 0.3.0

- Panneau de publication : « Ouvrir l'interface web » permet de glisser le
  dossier du site pour le publier d'un coup, de lister et supprimer les
  fichiers, et affiche l'état du tunnel Cloudflare.
- Plus besoin de redémarrer l'app pour un premier site ou un nouveau
  `_worker.js`.
- Le site est accessible sur le réseau local (port 8080 par défaut).
- Nouvelle option « Variables du worker » : variables et secrets disponibles
  dans `_worker.js` via `env.NOM`.
- Le dossier `share` est désormais monté en écriture, pour le panneau
  uniquement.

## 0.2.0

- Code côté serveur : un `_worker.js` au format Cloudflare Worker, à la
  racine du site, reçoit les requêtes qui ne correspondent à aucun fichier.
  Il est rechargé automatiquement quand il change.
- Le worker peut appeler les services Home Assistant listés dans la nouvelle
  option « Services Home Assistant autorisés », via un filtre qui ajoute le
  jeton lui-même. Le worker ne voit aucun jeton.

## 0.1.2

- Le bouton « Ouvrir l'interface web » affiche maintenant un aperçu du site
  dans Home Assistant (Ingress), au lieu d'un lien bloqué quand le port
  local est désactivé.

## 0.1.1

- L'image est désormais construite par GitHub Actions et téléchargée par
  Home Assistant, au lieu d'être construite sur la machine.

## 0.1.0

- Première version : hébergement d'un site statique depuis `/share` avec
  Caddy et publication via Cloudflare Tunnel.
