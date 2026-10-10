"""Measure committed Taskora TS/JS/CSS/HTML source with cloc, preserving the baseline policy."""
import argparse
import hashlib
import io
import json
import pathlib
import subprocess
import tarfile
import tempfile


def measure(repo, revision, cloc_command):
    sha = subprocess.check_output(["git", "rev-parse", "--verify", revision + "^{commit}"], cwd=repo, text=True).strip()
    archive_bytes = subprocess.check_output(["git", "archive", sha], cwd=repo)
    with tempfile.TemporaryDirectory(prefix="taskora-source-count-") as directory:
        root = pathlib.Path(directory).resolve()
        files = []
        with tarfile.open(fileobj=io.BytesIO(archive_bytes)) as archive:
            for member in archive.getmembers():
                if not member.isfile():
                    continue
                path = pathlib.PurePosixPath(member.name)
                if path.is_absolute() or ".." in path.parts:
                    raise ValueError("Unsafe archive path")
                if path.suffix not in (".ts", ".tsx", ".js", ".mjs", ".css", ".html") or member.name.startswith("docs/"):
                    continue
                target = root.joinpath(*path.parts)
                if not target.resolve().is_relative_to(root):
                    raise ValueError("Archive path escapes the temporary directory")
                target.parent.mkdir(parents=True, exist_ok=True)
                stream = archive.extractfile(member)
                if stream is None:
                    raise ValueError("Missing archived file")
                target.write_bytes(stream.read())
                files.append(member.name)
        (root / "source-files.txt").write_text("\n".join(sorted(files)) + "\n", encoding="utf-8")
        command = [*cloc_command, "--list-file=source-files.txt", "--json", "--by-file", "--skip-uniqueness", "--out=cloc.json", "--quiet"]
        subprocess.run(command, cwd=root, check=True)
        result = json.loads((root / "cloc.json").read_text(encoding="utf-8"))
        groups = {}
        inventory = []
        for name, row in result.items():
            if name in ("header", "SUM"):
                continue
            path = name.replace("\\", "/").removeprefix("./")
            if ".test." in path or ".spec." in path or path.startswith(("e2e/", "src/test/")):
                group = "tests"
            elif path.endswith((".css", ".html")):
                group = "styles_html"
            elif path.startswith("src/domain/"):
                group = "domain_core"
            elif path.startswith("src/data/"):
                group = "data_gateway"
            elif path.startswith("src/"):
                group = "frontend"
            else:
                group = "tooling"
            excluded = 5 if path == "vite.config.ts" else 6 if path == "index.html" else 0
            lines = row["code"] - excluded
            if lines < 0:
                raise ValueError("Scaffold exclusion exceeds the measured file")
            groups[group] = groups.get(group, 0) + lines
            inventory.append({"path": path, "raw_code": row["code"], "scaffold_excluded": excluded,
                              "first_party_candidate": lines, "group": group,
                              "sha256": hashlib.sha256((root / path).read_bytes()).hexdigest()})
        total = sum(groups.values())
        return {"revision": sha, "cloc_version": result["header"]["cloc_version"],
                "raw_code": result["SUM"]["code"], "scaffold_excluded": sum(item["scaffold_excluded"] for item in inventory),
                "inclusive": total, "excluding_tests": total - groups.get("tests", 0),
                "excluding_css_html": total - groups.get("styles_html", 0),
                "application_implementation": sum(groups.get(key, 0) for key in ("domain_core", "data_gateway", "frontend")),
                "groups": groups, "files": sorted(inventory, key=lambda item: item["path"]), "counter_command": command}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("revision", nargs="?", default="HEAD")
    parser.add_argument("--cloc", default="cloc", help="cloc executable or absolute cloc.pl path")
    parser.add_argument("--perl", help="Perl executable when --cloc names a Perl script")
    parser.add_argument("--output", required=True, type=pathlib.Path, help="JSON ledger destination, preferably outside the repository")
    args = parser.parse_args()
    repo = pathlib.Path(__file__).resolve().parent.parent
    command = [args.perl, args.cloc] if args.perl else [args.cloc]
    result = measure(repo, args.revision, command)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in result.items() if key not in ("files", "counter_command")}, indent=2))


if __name__ == "__main__":
    main()
