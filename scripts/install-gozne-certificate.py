#!/usr/bin/env python3
"""Install a renewed gozne.quique.es certificate received over restricted SSH."""

from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


HOSTNAME = "gozne.quique.es"
TARGET = Path("/srv/apps/app.quique.es/shared/tls/gozne.quique.es")
COMPOSE_DIRECTORY = Path(
    "/srv/apps/app.quique.es/current/examples/quique-app"
)
COMPOSE = [
    "docker",
    "compose",
    "-p",
    "quique-workspace-server",
    "-f",
    "compose.server.yaml",
]
MAX_INPUT = 64 * 1024


def run(*args: str, capture: bool = False) -> bytes:
    return subprocess.run(
        args,
        check=True,
        cwd=COMPOSE_DIRECTORY,
        stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    ).stdout


def public_key_digest(path: Path, *, certificate: bool) -> bytes:
    command = ["openssl", "x509" if certificate else "pkey", "-in", str(path)]
    command.extend(
        ["-pubkey", "-noout"]
        if certificate
        else ["-pubout", "-outform", "DER"]
    )
    first = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    assert first.stdout is not None
    if certificate:
        second = subprocess.run(
            ["openssl", "pkey", "-pubin", "-outform", "DER"],
            stdin=first.stdout,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=True,
        )
        first.stdout.close()
        if first.wait() != 0:
            raise RuntimeError("certificate public key is invalid")
        material = second.stdout
    else:
        material = first.stdout.read()
        first.stdout.close()
        if first.wait() != 0:
            raise RuntimeError("private key is invalid")
    return hashlib.sha256(material).digest()


def main() -> None:
    raw = sys.stdin.buffer.read(MAX_INPUT + 1)
    if len(raw) > MAX_INPUT:
        raise RuntimeError("certificate payload is too large")
    payload = json.loads(raw)
    if set(payload) != {"fullchain", "privkey"}:
        raise RuntimeError("certificate payload has unexpected fields")
    files = {
        name: base64.b64decode(payload[name], validate=True)
        for name in ("fullchain", "privkey")
    }
    if not files["fullchain"].startswith(b"-----BEGIN CERTIFICATE-----"):
        raise RuntimeError("full chain is not PEM")
    if b"PRIVATE KEY-----" not in files["privkey"][:80]:
        raise RuntimeError("private key is not PEM")

    TARGET.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=".incoming-", dir=TARGET))
    previous: dict[str, bytes | None] = {}
    try:
        for name, content in files.items():
            path = temporary / f"{name}.pem"
            path.write_bytes(content)
            path.chmod(0o640)

        certificate = temporary / "fullchain.pem"
        private_key = temporary / "privkey.pem"
        run(
            "openssl",
            "x509",
            "-in",
            str(certificate),
            "-noout",
            "-checkhost",
            HOSTNAME,
            "-checkend",
            "172800",
        )
        if public_key_digest(certificate, certificate=True) != public_key_digest(
            private_key, certificate=False
        ):
            raise RuntimeError("certificate and private key do not match")

        for name in files:
            destination = TARGET / f"{name}.pem"
            previous[name] = destination.read_bytes() if destination.exists() else None
            os.replace(temporary / f"{name}.pem", destination)
            destination.chmod(0o640)

        container_id = run(
            *COMPOSE, "ps", "-q", "admin-panel", capture=True
        ).strip()
        if container_id:
            try:
                run(*COMPOSE, "exec", "-T", "admin-panel", "nginx", "-t")
                run(*COMPOSE, "kill", "-s", "HUP", "admin-panel")
            except Exception:
                for name, content in previous.items():
                    destination = TARGET / f"{name}.pem"
                    if content is None:
                        destination.unlink(missing_ok=True)
                    else:
                        destination.write_bytes(content)
                        destination.chmod(0o640)
                raise
    finally:
        shutil.rmtree(temporary, ignore_errors=True)
    print(f"Installed and reloaded certificate for {HOSTNAME}")


if __name__ == "__main__":
    main()
