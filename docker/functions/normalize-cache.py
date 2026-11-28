#!/usr/bin/env python3
"""Make the Deno module cache of the `functions` image reproducible.

    normalize-cache.py DENO_DIR LOCK_FILE EPOCH

The warm-up (warm-cache.sh) leaves volatile data in DENO_DIR: SQLite analysis
caches, npm packuments with random key order and every version ever published,
and HTTP metadata of remote modules (Cloudflare cookies, cf-ray, date, age).
This script, run in its own build stage:

  * deletes the SQLite caches (*_cache_v2*; the runtime works without them),
  * reduces every npm packument to the versions present in the cache, with
    sorted keys and `latest` pointing at the highest of them,
  * rewrites the metadata of remote modules to the headers the loader needs
    (content-type, x-typescript-types, location) and `time` = EPOCH,
  * compares the resolved modules with LOCK_FILE and fails on any difference:
    an upstream release changed the dependency graph, so the image would differ
    from the one CI built. Update LOCK_FILE deliberately (printed below).
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

META_MARK = b"\n// denoCacheMetadata="
KEEP_HEADERS = ("content-type", "location", "x-typescript-types")
SEMVER = re.compile(r"^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$")
JSR_FILE = re.compile(r"^https://jsr\.io/(@[^/]+/[^/]+)/(\d+\.\d+\.\d+[^/_]*)/")
JSR_META = re.compile(r"^https://jsr\.io/(@[^/]+/[^/]+)/meta\.json$")


def semver_key(v: str):
    m = SEMVER.match(v)
    if not m:
        return (0, 0, 0, 0, v)
    major, minor, patch, pre = m.groups()
    return (int(major), int(minor), int(patch), 0 if pre else 1, pre or "")


def dump(obj) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def npm(root: Path, resolved: list) -> None:
    for packument in sorted(root.glob("npm/*/**/registry.json")):
        pkg_dir = packument.parent
        present = sorted((d.name for d in pkg_dir.iterdir() if d.is_dir()), key=semver_key)
        doc = json.loads(packument.read_bytes())
        doc["versions"] = {v: doc["versions"][v] for v in present if v in doc.get("versions", {})}
        tags = {k: v for k, v in doc.get("dist-tags", {}).items() if v in doc["versions"]}
        if present:
            tags["latest"] = present[-1]
        doc["dist-tags"] = tags
        doc.pop("time", None)
        packument.write_bytes(dump(doc))
        name = str(pkg_dir.relative_to(root / "npm").as_posix()).split("/", 1)[1]
        resolved += ["npm:%s@%s" % (name, v) for v in present]


def remote(root: Path, resolved: list, epoch: int) -> None:
    entries = []
    for path in sorted((root / "remote").rglob("*")):
        if not path.is_file():
            continue
        data = path.read_bytes()
        cut = data.rfind(META_MARK)
        if cut < 0:
            continue
        entries.append((path, data[:cut], json.loads(data[cut + len(META_MARK):])))
    # JSR package versions in the cache: https://jsr.io/@scope/name/<version>/...
    jsr_versions: dict = {}
    for _, _, meta in entries:
        m = JSR_FILE.match(meta["url"])
        if m:
            jsr_versions.setdefault(m.group(1), set()).add(m.group(2))
    for path, body, meta in entries:
        m = JSR_META.match(meta["url"])
        if m:
            # meta.json lists every published version: keep the cached ones only.
            doc = json.loads(body)
            keep = sorted(jsr_versions.get(m.group(1), ()), key=semver_key)
            doc["versions"] = {v: doc["versions"][v] for v in keep if v in doc.get("versions", {})}
            if keep:
                doc["latest"] = keep[-1]
            body = dump(doc)
        headers = {k: v for k, v in meta.get("headers", {}).items() if k.lower() in KEEP_HEADERS}
        meta = {"headers": headers, "time": epoch, "url": meta["url"]}
        path.write_bytes(body + META_MARK + dump(meta))
        resolved.append(meta["url"])


def main(argv) -> int:
    root, lock, epoch = Path(argv[1]), Path(argv[2]), int(argv[3])
    for p in list(root.iterdir()):
        if "_cache_v" in p.name:
            p.unlink()
    resolved: list = []
    npm(root, resolved)
    remote(root, resolved, epoch)
    resolved = sorted(set(resolved))
    expected = [ln.strip() for ln in lock.read_text(encoding="utf-8").splitlines()
                if ln.strip() and not ln.startswith("#")]
    if resolved != expected:
        added = sorted(set(resolved) - set(expected))
        removed = sorted(set(expected) - set(resolved))
        print("normalize-cache: modules differ from %s" % lock.name, file=sys.stderr)
        for line in added:
            print("  + %s" % line, file=sys.stderr)
        for line in removed:
            print("  - %s" % line, file=sys.stderr)
        print("normalize-cache: full list for %s:\n%s" % (lock.name, "\n".join(resolved)), file=sys.stderr)
        return 1
    print("normalize-cache: %d modules match %s" % (len(resolved), lock.name))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
