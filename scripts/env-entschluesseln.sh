#!/usr/bin/env bash
# Stellt .env aus .env.gpg wieder her (z. B. nach git clone). Fragt nach dem Passwort.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env.gpg ] || { echo "Keine .env.gpg gefunden."; exit 1; }
if [ -f .env ]; then
  read -rp ".env existiert schon. Überschreiben? [j/N] " a
  [ "$a" = "j" ] || exit 0
fi
gpg --decrypt --quiet .env.gpg > .env
chmod 600 .env
echo ".env wiederhergestellt."
