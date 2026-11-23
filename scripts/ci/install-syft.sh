#!/usr/bin/env bash
# Instalacja syft (SBOM CycloneDX obrazów, scripts/release/build-images.sh) w CI: wersja i sha256
# jak w legatto-infra tools/install.sh, żeby SBOM z CI i z `release/build.sh` pochodził z tej samej binarki.
#   scripts/ci/install-syft.sh <katalog bin>
set -euo pipefail

VERSION=1.57.2
SHA256=ad92bd3ec1b94a3df01d4d0aec199afa9c42b72e86da436ff5f837914d32706b
URL="https://github.com/anchore/syft/releases/download/v${VERSION}/syft_${VERSION}_linux_amd64.tar.gz"

dest="${1:?użycie: install-syft.sh <katalog bin>}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL --proto '=https' --tlsv1.2 -o "$tmp/syft.tgz" "$URL"
echo "$SHA256  $tmp/syft.tgz" | sha256sum -c --quiet -
tar -xzf "$tmp/syft.tgz" -C "$tmp" syft
mkdir -p "$dest"
install -m 0755 "$tmp/syft" "$dest/syft"
"$dest/syft" version | grep -q "^Version: *${VERSION}$"
echo "syft ${VERSION} → $dest/syft"
