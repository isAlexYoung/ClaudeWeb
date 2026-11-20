#!/usr/bin/env python3
"""Maintains releases.json, the signed list of ClaudeWeb releases that
install.sh and `claudeweb update` trust.

  release-list.py add --list DIR --package FILE --url URL --channel test|stable [--notes TEXT]
  release-list.py promote --list DIR --version X.Y.Z      (test -> stable, nothing rebuilt)
  release-list.py sign --list DIR --key FILE              (writes releases.json.minisig)

DIR holds releases.json and its signature. Only the list is signed: it pins
each package's size and SHA-256, so a package is trusted through the list.
"""
import argparse
import datetime
import hashlib
import json
import pathlib
import re
import subprocess
import sys

VERSION = re.compile(r"(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})")
LIST = "releases.json"


def now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load(directory: pathlib.Path) -> dict:
    path = directory / LIST
    if not path.exists():
        return {"schema": 1, "releases": []}
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schema") != 1 or not isinstance(data.get("releases"), list):
        sys.exit(f"{path} is not a release list")
    return data


def save(directory: pathlib.Path, data: dict) -> None:
    data["generated_at"] = now()
    data["releases"].sort(key=lambda r: tuple(int(p) for p in r["version"].split(".")), reverse=True)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / LIST).write_text(json.dumps(data, indent=1) + "\n", encoding="utf-8")
    # A changed list is unsigned until `sign` runs again.
    (directory / (LIST + ".minisig")).unlink(missing_ok=True)


def digest(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def add(args) -> None:
    package = pathlib.Path(args.package)
    match = re.fullmatch(r"claudeweb-(.+)-linux-x64\.tar\.xz", package.name)
    if not match or not VERSION.fullmatch(match.group(1)):
        sys.exit("the package name must be claudeweb-X.Y.Z-linux-x64.tar.xz")
    version = match.group(1)
    data = load(pathlib.Path(args.list))
    if any(r["version"] == version for r in data["releases"]):
        sys.exit(f"{version} is already in the list; versions are never replaced")
    data["releases"].append({
        "version": version,
        "channel": args.channel,
        "published_at": now(),
        "notes": args.notes,
        "package": {"name": package.name, "url": args.url, "bytes": package.stat().st_size, "sha256": digest(package)},
    })
    save(pathlib.Path(args.list), data)
    print(f"added {version} ({args.channel})")


def promote(args) -> None:
    data = load(pathlib.Path(args.list))
    for release in data["releases"]:
        if release["version"] == args.version:
            release["channel"] = "stable"
            save(pathlib.Path(args.list), data)
            print(f"{args.version} is now stable")
            return
    sys.exit(f"{args.version} is not in the list")


def sign(args) -> None:
    directory = pathlib.Path(args.list)
    load(directory)  # refuse to sign something that is not a list
    comment = f"ClaudeWeb releases {now()}"
    subprocess.run(["minisign", "-S", "-s", args.key, "-m", str(directory / LIST), "-t", comment], check=True)
    print(f"signed {directory / LIST}")


def main() -> None:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    a = commands.add_parser("add")
    a.add_argument("--list", required=True)
    a.add_argument("--package", required=True)
    a.add_argument("--url", required=True)
    a.add_argument("--channel", choices=["test", "stable"], required=True)
    a.add_argument("--notes", default="")
    p = commands.add_parser("promote")
    p.add_argument("--list", required=True)
    p.add_argument("--version", required=True)
    s = commands.add_parser("sign")
    s.add_argument("--list", required=True)
    s.add_argument("--key", required=True)
    args = parser.parse_args()
    {"add": add, "promote": promote, "sign": sign}[args.command](args)


if __name__ == "__main__":
    main()
