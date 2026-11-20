#!/command/with-contenv bashio
# shellcheck shell=bash
# ==============================================================================
# Lit les options une seule fois, avant tous les autres services.
#
# Quand plusieurs services les lisaient en même temps, bashio pouvait renvoyer
# une valeur vide (son cache partagé était en cours d'écriture). Un dossier des
# sites vide désignait alors tout /share. Une fois ce cache rempli ici, les
# services ne font plus que le lire.
# ==============================================================================

bashio::app.config > /dev/null

site_folder="$(bashio::config 'site_folder')"
if [[ ! "${site_folder}" =~ ^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*$ ]]; then
    bashio::exit.nok "Dossier des sites invalide : « ${site_folder} ». Arrêt pour ne rien modifier dans /share."
fi

# Dossier du site du port 8080, partagé avec tous les services (with-contenv)
printf '%s' "/share/${site_folder}" > /run/s6/container_environment/SITE_BASE
