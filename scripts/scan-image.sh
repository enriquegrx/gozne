#!/bin/sh
set -eu
scan_image="${1:-gozne:dev}"
mkdir -p reports
scan_reports="$(pwd)/reports"
rm -f "$scan_reports/image-scan.json" "$scan_reports/image.cdx.json"
scan_directory="$(mktemp -d "${TMPDIR:-/tmp}/gozne-image-scan.XXXXXX")"
trap 'rm -rf "$scan_directory"' EXIT HUP INT TERM
mkdir "$scan_directory/cache"
docker image save "$scan_image" -o "$scan_directory/image.tar"
# Scan an archive, without granting the scanner access to Docker's socket.
docker run --rm --read-only --cap-drop=ALL --security-opt=no-new-privileges:true \
  --user "$(id -u):$(id -g)" \
  --mount "type=bind,source=$scan_directory/cache,target=/tmp" \
  --mount "type=bind,source=$scan_directory,target=/input,readonly" \
  --mount "type=bind,source=$scan_reports,target=/reports" \
  --entrypoint /bin/sh \
  aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969 -c '
    scan_exit=0
    trivy image --no-progress --cache-dir /tmp/trivy --input /input/image.tar --scanners vuln \
      --list-all-pkgs --severity HIGH,CRITICAL --exit-code 1 \
      --format json --output /reports/image-scan.json || scan_exit=$?
    if [ -f /reports/image-scan.json ]; then
      trivy convert --format cyclonedx --output /reports/image.cdx.json /reports/image-scan.json || exit 1
    fi
    exit "$scan_exit"
  '
