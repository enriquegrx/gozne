#!/bin/sh
set -eu
umask 077
tls_directory="${1:-examples/compose/tls}"
mkdir -p "$tls_directory"
chmod 700 "$tls_directory"
if [ -e "$tls_directory/cert.pem" ] || [ -e "$tls_directory/key.pem" ]; then
  echo 'Certificate files already exist; keeping them.'
  exit 0
fi
openssl req -x509 -newkey rsa:2048 -nodes -days 7 \
  -subj /CN=localhost -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' \
  -keyout "$tls_directory/key.pem" -out "$tls_directory/cert.pem" 2>/dev/null
# Files are individually mounted for the unprivileged proxy. The host directory stays owner-only.
chmod 644 "$tls_directory/cert.pem" "$tls_directory/key.pem"
echo 'Local demonstration certificate created (7 days).'
