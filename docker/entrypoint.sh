#!/bin/sh
set -eu
if [ "${#BEES_API_KEY}" -lt 32 ]; then
  echo 'BEES_API_KEY precisa ter pelo menos 32 caracteres.' >&2
  exit 1
fi
# The same long secret is used by Bearer auth (API) and Basic auth (desktop).
# bcrypt in htpasswd truncates at 72 bytes; SHA-512 crypt supports longer keys.
printf '%s\n' "$BEES_API_KEY" | htpasswd -ci -5 /run/bees-desktop.htpasswd bees >/dev/null
chown root:www-data /run/bees-desktop.htpasswd
chmod 640 /run/bees-desktop.htpasswd
mkdir -p /app/data /app/session /home/node/.fluxbox
chown -R node:node /app/data /app/session /home/node/.fluxbox
# Single replica only. Clear Chromium's stale host-specific locks after container replacement.
rm -f /app/session/browser-profile/SingletonLock /app/session/browser-profile/SingletonCookie /app/session/browser-profile/SingletonSocket
exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf
