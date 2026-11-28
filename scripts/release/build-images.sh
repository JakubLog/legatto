#!/usr/bin/env bash
# Powtarzalny build obrazów wydania legatto-app: app, functions, migrator.
#
#   scripts/release/build-images.sh --version V --out DIR [--platform linux/amd64] [--allow-dirty]
#
# Wynik w DIR (musi nie istnieć albo być pusty):
#   <n>.oci.tar          obraz OCI (name=ghcr.io/jakublog/legatto/<n>:<V>), znaczniki czasu = commit
#   release.json         legatto-app-release/1: repo, commit, wersja, obrazy (digest), artefakty (sha256),
#                        migracje (wszystkie pliki z sha256), crony z vercel.json, funkcje Edge
#   digests.json         {"app": "sha256:…", "functions": "…", "migrator": "…"}
#   sbom/<n>.cdx.json    SBOM CycloneDX (syft) - poza `artifacts`, nie wpływa na release.json
#
# Konsument: legatto-infra release/lib/applock.py (przypięcie) i release/lib/build.py (przebudowa
# z commitu z app.lock; release.json musi wyjść bajtowo identyczny). Kontekst buildu to zatwierdzona
# treść HEAD (`git archive`), więc wynik nie zależy od plików nieśledzonych ani node_modules.
# --allow-dirty (tylko lokalnie): kontekst z drzewa roboczego, release.json dostaje "dirty": true.
#
# Wymaga: git, docker buildx (containerd image store albo driver z eksportem OCI), python3, syft.
set -euo pipefail

REGISTRY=ghcr.io/jakublog/legatto
REPO_ID=github.com/JakubLog/legatto
IMAGES=(app functions migrator)

die() { printf 'build-images: %s\n' "$*" >&2; exit 1; }

version="" out="" platform="linux/amd64" allow_dirty=0
while (($#)); do
  case "$1" in
    --version) version="${2:-}"; shift 2 ;;
    --out) out="${2:-}"; shift 2 ;;
    --platform) platform="${2:-}"; shift 2 ;;
    --allow-dirty) allow_dirty=1; shift ;;
    *) die "nieznany argument: $1" ;;
  esac
done
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || die "--version musi być semver (np. 1.2.3)"
[[ -n "$out" ]] || die "brak --out"
[[ "$platform" =~ ^linux/(amd64|arm64)$ ]] || die "--platform: linux/amd64 albo linux/arm64"
for tool in git docker python3 syft; do
  command -v "$tool" >/dev/null || die "brak narzędzia: $tool"
done

root="$(git rev-parse --show-toplevel)"
cd "$root"
commit="$(git rev-parse HEAD)"
epoch="$(git log -1 --format=%ct HEAD)"
dirty=0
if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  ((allow_dirty)) || die "drzewo ma niezatwierdzone zmiany (lokalnie: --allow-dirty)"
  dirty=1
fi

if [[ -e "$out" ]] && [[ -n "$(ls -A "$out")" ]]; then
  die "$out istnieje i nie jest pusty"
fi
mkdir -p "$out/sbom"
out="$(cd "$out" && pwd)"

ctx="$(mktemp -d)"
trap 'rm -rf "$ctx"' EXIT
if ((dirty)); then
  git ls-files -z --cached --others --exclude-standard \
    | while IFS= read -r -d '' f; do [[ -e "$f" ]] && printf '%s\0' "$f"; done \
    | tar --null -T - -cf - | tar -xf - -C "$ctx"
else
  git archive --format=tar HEAD | tar -xf - -C "$ctx"
fi

dockerfile_of() {
  case "$1" in
    app) printf 'Dockerfile' ;;
    functions) printf 'docker/functions/Dockerfile' ;;
    migrator) printf 'docker/migrator/Dockerfile' ;;
  esac
}

# Ten sam BuildKit lokalnie i w CI (scripts/release/buildkit-image): builder nazwany od digestu,
# więc zmiana przypięcia tworzy nowy builder zamiast użyć starego.
buildkit_image="$(grep -v '^#' "$root/scripts/release/buildkit-image" | grep -m1 .)"
[[ "$buildkit_image" =~ @sha256:([0-9a-f]{64})$ ]] || die "scripts/release/buildkit-image: obraz bez @sha256"
builder="legatto-release-${BASH_REMATCH[1]:0:12}"
if ! docker buildx inspect "$builder" >/dev/null 2>&1; then
  docker buildx create --name "$builder" --driver docker-container \
    --driver-opt "image=$buildkit_image" >/dev/null
fi

# --no-cache: warstwy z cache innego commitu niosą jego SOURCE_DATE_EPOCH (rewrite-timestamp tylko
# obniża czasy), więc ponowny build lokalny różniłby się od świeżego buildu w CI.
for n in "${IMAGES[@]}"; do
  printf 'build-images: %s (%s)\n' "$n" "$platform" >&2
  SOURCE_DATE_EPOCH="$epoch" docker buildx build --builder "$builder" --quiet --no-cache \
    --platform "$platform" --provenance=false --sbom=false --pull=false \
    --build-arg SOURCE_DATE_EPOCH="$epoch" \
    --build-arg LEGATTO_VERSION="$version" \
    --build-arg LEGATTO_REVISION="$commit" \
    --file "$ctx/$(dockerfile_of "$n")" \
    --output "type=oci,dest=$out/$n.oci.tar,name=$REGISTRY/$n:$version,rewrite-timestamp=true" \
    "$ctx" >/dev/null
  syft scan "oci-archive:$out/$n.oci.tar" -q --source-name "legatto-$n" --source-version "$version" \
    -o "cyclonedx-json=$out/sbom/$n.cdx.json"
done

# Migracje, crony i funkcje z kontekstu buildu (ta sama treść co w obrazach).
cd "$ctx"
python3 - "$out" "$version" "$commit" "$platform" "$REGISTRY" "$REPO_ID" "$dirty" <<'PY'
import hashlib, json, os, re, sys, tarfile

out, version, commit, platform, registry, repo_id, dirty = sys.argv[1:8]
NAME_RE = re.compile(r"^[0-9]{14}_[a-z0-9_]{1,100}\.sql$")
CRON_RE = re.compile(r"^/api/cron/([a-z0-9-]{1,60})$")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


images, artifacts = {}, []
for n in ("app", "functions", "migrator"):
    art = n + ".oci.tar"
    path = os.path.join(out, art)
    with tarfile.open(path) as t:
        manifests = json.load(t.extractfile("index.json"))["manifests"]
    if len(manifests) != 1:
        sys.exit("build-images: %s: oczekiwano jednego manifestu w index.json, jest %d" % (art, len(manifests)))
    images[n] = {"ref": "%s/%s:%s" % (registry, n, version), "digest": manifests[0]["digest"],
                 "platform": platform, "artifact": art}
    artifacts.append({"name": art, "kind": "oci-archive", "size": os.path.getsize(path), "sha256": sha256(path)})

mig_dir = os.path.join("supabase", "migrations")
names = sorted(f for f in os.listdir(mig_dir) if f.endswith(".sql"))
bad = [f for f in names if not NAME_RE.match(f)]
if bad or not names:
    sys.exit("build-images: niepoprawne nazwy migracji: %s" % ", ".join(bad or ["(brak migracji)"]))

with open("vercel.json", encoding="utf-8") as f:
    vercel = json.load(f)
crons = []
for c in vercel.get("crons", []):
    m = CRON_RE.match(c["path"])
    if not m:
        sys.exit("build-images: cron %s poza /api/cron/<nazwa>" % c["path"])
    crons.append({"name": m.group(1), "path": c["path"], "schedule": c["schedule"]})

fn_dir = os.path.join("supabase", "functions")
functions = sorted(d for d in os.listdir(fn_dir)
                   if not d.startswith(("_", ".")) and os.path.isfile(os.path.join(fn_dir, d, "index.ts")))

rel = {
    "schema": "legatto-app-release/1",
    "version": version,
    "commit": commit,
    "repo": repo_id,
    "images": images,
    "artifacts": artifacts,
    "migrations": {"from": None, "to": names[-1][:14], "count": len(names),
                   "files": [{"name": m, "sha256": sha256(os.path.join(mig_dir, m))} for m in names]},
    "crons": sorted(crons, key=lambda c: c["name"]),
    "functions": functions,
}
if dirty == "1":
    rel["dirty"] = True
with open(os.path.join(out, "release.json"), "w", encoding="utf-8") as f:
    f.write(json.dumps(rel, sort_keys=True, indent=2) + "\n")
with open(os.path.join(out, "digests.json"), "w", encoding="utf-8") as f:
    f.write(json.dumps({n: images[n]["digest"] for n in images}, sort_keys=True, indent=2) + "\n")
print("build-images: release.json sha256 %s" % sha256(os.path.join(out, "release.json")))
PY
