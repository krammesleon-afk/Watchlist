#!/usr/bin/env bash
# Verschlüsselt .env zu .env.gpg (darf ins Repo). Fragt nach einem Passwort.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Keine .env gefunden."; exit 1; }
gpg --symmetric --cipher-algo AES256 --armor --yes -o .env.gpg .env
echo ".env.gpg erstellt. Jetzt committen: git add .env.gpg && git commit -m 'Keys aktualisiert' && git push"
