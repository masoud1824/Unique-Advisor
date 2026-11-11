#!/usr/bin/env python3
"""Join transfer-parts, verify them, then write the original file.

Destinations must stay inside the project root. Nothing is written until
the decoded byte length and SHA-256 match the manifest.
"""
import argparse
import base64
import hashlib
import json
import sys
from pathlib import Path


def project_root_from_script() -> Path:
    here = Path(__file__).resolve()
    if here.parent.name != "transfer-parts":
        raise SystemExit("reconstruct.py must live in transfer-parts/")
    return here.parent.parent


def inside_project(root: Path, dest: Path) -> None:
    root_r = root.resolve()
    dest_r = dest.resolve()
    if dest_r != root_r and root_r not in dest_r.parents:
        raise SystemExit(f"refusing destination outside the project: {dest}")


def safe_destination(root: Path, relative: str) -> Path:
    if not relative or relative.startswith(("/", "\\")):
        raise SystemExit(f"refusing destination: {relative!r}")
    rel = Path(relative)
    if rel.is_absolute() or ".." in rel.parts:
        raise SystemExit(f"refusing destination: {relative!r}")
    dest = root / rel
    inside_project(root, dest)
    return dest


def load_manifest(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    for key in ("destination", "byte_length", "sha256", "encoding", "parts"):
        if key not in data:
            raise SystemExit(f"manifest missing {key}")
    if data["encoding"] != "base64":
        raise SystemExit(f"unsupported encoding: {data['encoding']!r}")
    parts = data["parts"]
    orders = [part["order"] for part in parts]
    if orders != list(range(1, len(parts) + 1)):
        raise SystemExit("part order must be 1..n with no gaps")
    return data


def decode_parts(manifest: dict, parts_dir: Path) -> bytes:
    payload = []
    for part in manifest["parts"]:
        name = part["name"]
        if Path(name).name != name or "/" in name or "\\" in name:
            raise SystemExit(f"refusing part name: {name!r}")
        file_path = parts_dir / name
        raw = file_path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != part["file_sha256"]:
            raise SystemExit(f"part hash mismatch: {name}")
        text = raw.decode("ascii")
        if len(text) != part["file_chars"] or len(text) > 16000:
            raise SystemExit(f"part size mismatch: {name}")
        piece = "".join(text.split())
        if len(piece) != part["payload_chars"]:
            raise SystemExit(f"payload size mismatch: {name}")
        if hashlib.sha256(piece.encode("ascii")).hexdigest() != part["payload_sha256"]:
            raise SystemExit(f"payload hash mismatch: {name}")
        payload.append(piece)
    try:
        decoded = base64.b64decode("".join(payload), validate=True)
    except Exception as exc:
        raise SystemExit(f"base64 decode failed: {exc}") from exc
    if len(decoded) != manifest["byte_length"]:
        raise SystemExit(
            f"byte length {len(decoded)} != manifest {manifest['byte_length']}"
        )
    digest = hashlib.sha256(decoded).hexdigest()
    if digest != manifest["sha256"]:
        raise SystemExit("sha256 mismatch; destination not written")
    return decoded


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, help="Project root. Default: parent of transfer-parts/")
    parser.add_argument("--manifest", type=Path, required=True, help="Path to manifest.json")
    parser.add_argument("--check", action="store_true", help="Verify only; do not write")
    args = parser.parse_args()
    root = (args.root or project_root_from_script()).resolve()
    manifest_path = args.manifest.resolve()
    manifest = load_manifest(manifest_path)
    parts_dir = manifest_path.parent
    decoded = decode_parts(manifest, parts_dir)
    dest = safe_destination(root, manifest["destination"])
    print(f"verified {manifest['destination']} bytes={len(decoded)} sha256={manifest['sha256']}")
    if args.check:
        return 0
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(decoded)
    if dest.read_bytes() != decoded:
        raise SystemExit("write verification failed")
    print(f"wrote {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
