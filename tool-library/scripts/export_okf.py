#!/usr/bin/env python3
"""Export the Research Vault wiki as a conformant OKF v0.1 bundle."""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import sys
from typing import Any
from urllib.parse import quote

try:
    import yaml
except ImportError as error:  # pragma: no cover - environment guard
    raise SystemExit(
        "PyYAML is required for OKF conformance validation. "
        "Use the configured D:\\python\\python.exe environment."
    ) from error


OKF_VERSION = "0.1"
RESERVED_FILENAMES = {"index.md", "log.md"}
WIKILINK_PATTERN = re.compile(r"(!)?\[\[([^\]]+)\]\]")
INLINE_CODE_PATTERN = re.compile(r"(`+[^`\n]*`+)")


def configure_utf8_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


@dataclass
class Issue:
    severity: str
    code: str
    path: str
    message: str


@dataclass
class SourceDocument:
    source_path: Path
    relative_path: PurePosixPath
    text: str
    frontmatter_raw: str
    frontmatter: dict[str, Any]
    body: str
    reserved: bool
    mtime: datetime


@dataclass
class LinkRewrite:
    source: str
    target: str
    resolved: str
    status: str


def parse_args() -> argparse.Namespace:
    project_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(
        description="Export knowledge-base/wiki as an Open Knowledge Format v0.1 bundle."
    )
    parser.add_argument(
        "--source-root",
        type=Path,
        default=project_root / "knowledge-base" / "wiki",
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=project_root / "tool-library" / "output" / "okf",
    )
    parser.add_argument("--preflight-only", action="store_true")
    parser.add_argument("--json", action="store_true")
    return parser.parse_args()


def split_frontmatter(text: str) -> tuple[str, str, bool]:
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        return "", text, False
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            return "".join(lines[1:index]).rstrip("\r\n"), "".join(lines[index + 1 :]), True
    return "", text, False


def load_frontmatter(raw: str, path: str, issues: list[Issue]) -> dict[str, Any]:
    if not raw.strip():
        return {}
    try:
        value = yaml.safe_load(raw)
    except yaml.YAMLError as error:
        issues.append(Issue("error", "invalid-frontmatter", path, str(error)))
        return {}
    if value is None:
        return {}
    if not isinstance(value, dict):
        issues.append(
            Issue(
                "error",
                "frontmatter-not-mapping",
                path,
                "Frontmatter must parse to a YAML mapping.",
            )
        )
        return {}
    return value


def read_source_documents(source_root: Path) -> tuple[list[SourceDocument], list[Issue]]:
    issues: list[Issue] = []
    documents: list[SourceDocument] = []
    for source_path in sorted(source_root.rglob("*.md")):
        relative = PurePosixPath(source_path.relative_to(source_root).as_posix())
        path_label = relative.as_posix()
        try:
            raw_bytes = source_path.read_bytes()
            text = raw_bytes.decode("utf-8-sig")
        except UnicodeDecodeError as error:
            issues.append(Issue("error", "invalid-utf8", path_label, str(error)))
            continue
        frontmatter_raw, body, has_frontmatter = split_frontmatter(text)
        frontmatter = load_frontmatter(frontmatter_raw, path_label, issues) if has_frontmatter else {}
        reserved = relative.name.lower() in RESERVED_FILENAMES
        if not reserved and not has_frontmatter:
            issues.append(
                Issue(
                    "warning",
                    "frontmatter-will-be-created",
                    path_label,
                    "The OKF copy will receive deterministic frontmatter.",
                )
            )
        if not reserved and not str(frontmatter.get("type") or "").strip():
            issues.append(
                Issue(
                    "warning",
                    "type-will-be-inferred",
                    path_label,
                    "The required OKF type will be inferred from the directory.",
                )
            )
        documents.append(
            SourceDocument(
                source_path=source_path,
                relative_path=relative,
                text=text,
                frontmatter_raw=frontmatter_raw,
                frontmatter=frontmatter,
                body=body,
                reserved=reserved,
                mtime=datetime.fromtimestamp(source_path.stat().st_mtime, timezone.utc),
            )
        )
    return documents, issues


def build_path_maps(
    documents: list[SourceDocument],
) -> tuple[dict[str, PurePosixPath], dict[str, list[PurePosixPath]]]:
    exact: dict[str, PurePosixPath] = {}
    basenames: dict[str, list[PurePosixPath]] = {}
    for document in documents:
        relative = document.relative_path
        key = relative.with_suffix("").as_posix()
        exact[key.casefold()] = relative
        exact[f"wiki/{key}".casefold()] = relative
        basenames.setdefault(relative.stem.casefold(), []).append(relative)
    return exact, basenames


def normalize_target(target: str, current: PurePosixPath) -> str:
    normalized = target.strip().replace("\\", "/")
    if normalized.startswith("/"):
        normalized = normalized[1:]
    if normalized.casefold().startswith("wiki/"):
        normalized = normalized[5:]
    if normalized.lower().endswith(".md"):
        normalized = normalized[:-3]
    if normalized.startswith("./") or normalized.startswith("../"):
        normalized = posixpath.normpath(posixpath.join(current.parent.as_posix(), normalized))
    return normalized.strip("/")


def bundle_link(relative: PurePosixPath, heading: str) -> str:
    encoded = quote(f"/{relative.as_posix()}", safe="/:._~-%")
    if heading:
        encoded_heading = quote(heading.strip(), safe="-._~%")
        return f"{encoded}#{encoded_heading}"
    return encoded


def resolve_wikilink(
    raw_target: str,
    current: PurePosixPath,
    exact: dict[str, PurePosixPath],
    basenames: dict[str, list[PurePosixPath]],
) -> tuple[str, str]:
    target_part, separator, heading = raw_target.partition("#")
    if not target_part.strip() and separator:
        return bundle_link(current, heading), "resolved"
    if re.match(r"^[a-z][a-z0-9+.-]*://", target_part.strip(), re.IGNORECASE):
        return target_part.strip(), "external"
    normalized = normalize_target(target_part, current)
    placeholder_names = {"page-name", "source-name", "link"}
    if (
        current.parts
        and current.parts[0].casefold() == "schema"
        and ("..." in normalized or PurePosixPath(normalized).name.casefold() in placeholder_names)
    ):
        fallback = normalized or "placeholder"
        if not fallback.lower().endswith(".md"):
            fallback = f"{fallback}.md"
        return bundle_link(PurePosixPath(fallback), heading), "placeholder"
    resolved = exact.get(normalized.casefold())
    if resolved is None:
        basename = PurePosixPath(normalized).name.casefold()
        matches = basenames.get(basename, [])
        if len(matches) == 1:
            resolved = matches[0]
    if resolved is not None:
        return bundle_link(resolved, heading), "resolved"

    fallback = normalized or current.with_suffix("").as_posix()
    if not fallback.lower().endswith(".md"):
        fallback = f"{fallback}.md"
    fallback_path = PurePosixPath(fallback)
    return bundle_link(fallback_path, heading), "unresolved"


def rewrite_wikilinks(
    text: str,
    current: PurePosixPath,
    exact: dict[str, PurePosixPath],
    basenames: dict[str, list[PurePosixPath]],
    rewrites: list[LinkRewrite],
) -> str:
    def replace_segment(segment: str) -> str:
        def replace(match: re.Match[str]) -> str:
            embedded = bool(match.group(1))
            inner = match.group(2).strip()
            target, alias_separator, alias = inner.partition("|")
            destination, status = resolve_wikilink(target, current, exact, basenames)
            label_source = alias.strip() if alias_separator and alias.strip() else target.partition("#")[0]
            label = PurePosixPath(label_source.replace("\\", "/")).name or label_source or "当前文档"
            rewrites.append(
                LinkRewrite(
                    source=current.as_posix(),
                    target=target,
                    resolved=destination,
                    status=status,
                )
            )
            prefix = "附件：" if embedded else ""
            return f"[{prefix}{label}]({destination})"

        return WIKILINK_PATTERN.sub(replace, segment)

    output: list[str] = []
    fence_character = ""
    fence_length = 0
    for line in text.splitlines(keepends=True):
        fence = re.match(r"^\s*(`{3,}|~{3,})", line)
        if fence:
            marker = fence.group(1)
            if not fence_character:
                fence_character = marker[0]
                fence_length = len(marker)
                output.append(line)
                continue
            if marker[0] == fence_character and len(marker) >= fence_length:
                fence_character = ""
                fence_length = 0
                output.append(line)
                continue
        if fence_character:
            output.append(line)
            continue
        segments = INLINE_CODE_PATTERN.split(line)
        for index in range(0, len(segments), 2):
            segments[index] = replace_segment(segments[index])
        output.append("".join(segments))
    return "".join(output)


def count_wikilinks_outside_code(text: str) -> int:
    count = 0
    fence_character = ""
    fence_length = 0
    for line in text.splitlines(keepends=True):
        fence = re.match(r"^\s*(`{3,}|~{3,})", line)
        if fence:
            marker = fence.group(1)
            if not fence_character:
                fence_character = marker[0]
                fence_length = len(marker)
                continue
            if marker[0] == fence_character and len(marker) >= fence_length:
                fence_character = ""
                fence_length = 0
                continue
        if fence_character:
            continue
        segments = INLINE_CODE_PATTERN.split(line)
        count += sum(len(WIKILINK_PATTERN.findall(segments[index])) for index in range(0, len(segments), 2))
    return count


def infer_type(relative: PurePosixPath) -> str:
    parts = [part.casefold() for part in relative.parts[:-1]]
    if parts[:2] == ["code", "projects"]:
        return "code-project"
    if parts[:2] == ["code", "scripts"]:
        return "code-script"
    mapping = {
        "sources": "source",
        "concepts": "concept",
        "methods": "method",
        "datasets": "dataset",
        "entities": "entity",
        "projects": "project",
        "mocs": "moc",
        "synthesis": "synthesis",
        "schema": "schema",
        "code": "code-documentation",
    }
    return mapping.get(parts[0] if parts else "", "note")


def derive_title(document: SourceDocument) -> str:
    value = str(document.frontmatter.get("title") or "").strip()
    if value:
        return value
    heading = re.search(r"^#\s+(.+?)\s*$", document.body, re.MULTILINE)
    if heading:
        return heading.group(1).strip()
    return document.relative_path.stem.replace("-", " ")


def yaml_scalar(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def set_frontmatter_scalar(raw: str, key: str, value: str) -> str:
    replacement = f"{key}: {yaml_scalar(value)}"
    pattern = re.compile(rf"^{re.escape(key)}:\s*(?:#.*)?$", re.MULTILINE)
    if pattern.search(raw):
        return pattern.sub(replacement, raw, count=1)
    if re.search(rf"^{re.escape(key)}:", raw, re.MULTILINE):
        return raw
    return f"{raw.rstrip()}\n{replacement}".lstrip("\n")


def build_concept_text(
    document: SourceDocument,
    exact: dict[str, PurePosixPath],
    basenames: dict[str, list[PurePosixPath]],
    rewrites: list[LinkRewrite],
) -> tuple[str, dict[str, str]]:
    concept_type = str(document.frontmatter.get("type") or "").strip() or infer_type(
        document.relative_path
    )
    title = derive_title(document)
    timestamp = document.mtime.isoformat().replace("+00:00", "Z")
    frontmatter_raw = document.frontmatter_raw
    frontmatter_raw = set_frontmatter_scalar(frontmatter_raw, "type", concept_type)
    frontmatter_raw = set_frontmatter_scalar(frontmatter_raw, "title", title)
    if not str(document.frontmatter.get("timestamp") or "").strip():
        frontmatter_raw = set_frontmatter_scalar(frontmatter_raw, "timestamp", timestamp)
    frontmatter_raw = rewrite_wikilinks(
        frontmatter_raw,
        document.relative_path,
        exact,
        basenames,
        rewrites,
    )
    body = rewrite_wikilinks(
        document.body,
        document.relative_path,
        exact,
        basenames,
        rewrites,
    )
    normalized = f"---\n{frontmatter_raw.rstrip()}\n---\n{body.lstrip(chr(13) + chr(10))}"
    if not normalized.endswith("\n"):
        normalized += "\n"
    description = str(document.frontmatter.get("description") or "").strip()
    return normalized, {
        "type": concept_type,
        "title": title,
        "description": description,
    }


def render_directory_listing(
    directory: PurePosixPath,
    metadata: dict[PurePosixPath, dict[str, str]],
    directories: set[PurePosixPath],
) -> str:
    entries: list[str] = []
    for relative, values in sorted(metadata.items(), key=lambda item: item[0].as_posix()):
        if relative.parent != directory:
            continue
        link = quote(relative.name, safe="-._~%")
        description = f" - {values['description']}" if values["description"] else ""
        entries.append(f"* [{values['title']}]({link}){description}")
    child_directories = sorted(
        child for child in directories if child.parent == directory and child != directory
    )
    for child in child_directories:
        link = quote(f"{child.name}/index.md", safe="/-._~%")
        entries.append(f"* [{child.name}]({link})")
    return "\n".join(entries) if entries else "* 当前目录没有概念文档。"


def build_indexes(
    documents: list[SourceDocument],
    metadata: dict[PurePosixPath, dict[str, str]],
    exact: dict[str, PurePosixPath],
    basenames: dict[str, list[PurePosixPath]],
    rewrites: list[LinkRewrite],
    generated_at: str,
) -> dict[PurePosixPath, str]:
    directories: set[PurePosixPath] = {PurePosixPath(".")}
    source_indexes: dict[PurePosixPath, SourceDocument] = {}
    for document in documents:
        directory = document.relative_path.parent
        while True:
            directories.add(directory)
            if directory == PurePosixPath("."):
                break
            directory = directory.parent
        if document.relative_path.name.casefold() == "index.md":
            source_indexes[document.relative_path.parent] = document

    indexes: dict[PurePosixPath, str] = {}
    for directory in sorted(directories, key=lambda value: value.as_posix()):
        source_index = source_indexes.get(directory)
        preserved = ""
        if source_index:
            preserved = rewrite_wikilinks(
                source_index.body,
                source_index.relative_path,
                exact,
                basenames,
                rewrites,
            ).strip()
        title = "Research Vault OKF Bundle" if directory == PurePosixPath(".") else directory.name
        if not preserved:
            preserved = f"# {title}"
        listing = render_directory_listing(directory, metadata, directories)
        body = f"{preserved}\n\n## OKF Bundle Contents\n\n{listing}\n"
        if directory == PurePosixPath("."):
            body = f"---\nokf_version: {yaml_scalar(OKF_VERSION)}\ntimestamp: {yaml_scalar(generated_at)}\n---\n{body}"
        indexes[directory / "index.md"] = body
    return indexes


def build_export_log(generated_at: str, concept_count: int) -> str:
    date = generated_at[:10]
    return (
        "# Bundle Update Log\n\n"
        f"## {date}\n\n"
        f"* **Export**: Generated an OKF v{OKF_VERSION} bundle from the Research Vault "
        f"with {concept_count} concept documents.\n"
    )


def source_fingerprint(documents: list[SourceDocument]) -> str:
    digest = hashlib.sha256()
    for document in sorted(documents, key=lambda item: item.relative_path.as_posix()):
        digest.update(document.relative_path.as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(document.text.encode("utf-8"))
        digest.update(b"\0")
    return digest.hexdigest()


def validate_bundle(bundle_root: Path) -> dict[str, Any]:
    errors: list[dict[str, str]] = []
    concept_count = 0
    index_count = 0
    log_count = 0
    remaining_wikilinks = 0
    for path in sorted(bundle_root.rglob("*.md")):
        relative = path.relative_to(bundle_root).as_posix()
        text = path.read_text(encoding="utf-8")
        remaining_wikilinks += count_wikilinks_outside_code(text)
        raw, body, has_frontmatter = split_frontmatter(text)
        filename = path.name.casefold()
        if filename == "index.md":
            index_count += 1
            if path.parent != bundle_root and has_frontmatter:
                errors.append(
                    {
                        "path": relative,
                        "code": "subdirectory-index-frontmatter",
                        "message": "Only the bundle-root index may declare frontmatter.",
                    }
                )
            continue
        if filename == "log.md":
            log_count += 1
            if has_frontmatter:
                errors.append(
                    {
                        "path": relative,
                        "code": "log-frontmatter",
                        "message": "Reserved log files must not contain frontmatter.",
                    }
                )
            invalid_headings = [
                heading
                for heading in re.findall(r"^##\s+(.+?)\s*$", body, re.MULTILINE)
                if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", heading)
            ]
            if invalid_headings:
                errors.append(
                    {
                        "path": relative,
                        "code": "invalid-log-date-heading",
                        "message": ", ".join(invalid_headings),
                    }
                )
            continue
        concept_count += 1
        if not has_frontmatter:
            errors.append(
                {
                    "path": relative,
                    "code": "missing-frontmatter",
                    "message": "Concept document has no frontmatter.",
                }
            )
            continue
        try:
            data = yaml.safe_load(raw)
        except yaml.YAMLError as error:
            errors.append(
                {
                    "path": relative,
                    "code": "invalid-frontmatter",
                    "message": str(error),
                }
            )
            continue
        if not isinstance(data, dict) or not str(data.get("type") or "").strip():
            errors.append(
                {
                    "path": relative,
                    "code": "missing-type",
                    "message": "Concept document has no non-empty type.",
                }
            )
    if remaining_wikilinks:
        errors.append(
            {
                "path": ".",
                "code": "remaining-wikilinks",
                "message": f"{remaining_wikilinks} Obsidian wikilinks remain.",
            }
        )
    return {
        "conformant": len(errors) == 0,
        "okf_version": OKF_VERSION,
        "concept_count": concept_count,
        "index_count": index_count,
        "log_count": log_count,
        "remaining_wikilinks": remaining_wikilinks,
        "errors": errors,
    }


def unique_export_directory(output_root: Path, generated_at: datetime) -> Path:
    stem = generated_at.strftime("%Y%m%dT%H%M%SZ")
    candidate = output_root / stem
    counter = 1
    while candidate.exists():
        candidate = output_root / f"{stem}-{counter:02d}"
        counter += 1
    return candidate


def relative_to_project(path: Path, project_root: Path) -> str:
    try:
        return path.relative_to(project_root).as_posix()
    except ValueError:
        return str(path)


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, path)


def preflight_payload(
    source_root: Path,
    documents: list[SourceDocument],
    issues: list[Issue],
) -> dict[str, Any]:
    concepts = [document for document in documents if not document.reserved]
    reserved = [document for document in documents if document.reserved]
    return {
        "okf_version": OKF_VERSION,
        "source_root": str(source_root),
        "source_markdown_count": len(documents),
        "concept_count": len(concepts),
        "reserved_file_count": len(reserved),
        "error_count": sum(issue.severity == "error" for issue in issues),
        "warning_count": sum(issue.severity == "warning" for issue in issues),
        "issues": [asdict(issue) for issue in issues],
    }


def export_bundle(
    source_root: Path,
    output_root: Path,
    documents: list[SourceDocument],
    preflight: dict[str, Any],
) -> dict[str, Any]:
    generated_datetime = datetime.now(timezone.utc)
    generated_at = generated_datetime.isoformat().replace("+00:00", "Z")
    export_root = unique_export_directory(output_root, generated_datetime)
    bundle_root = export_root / "bundle"
    exact, basenames = build_path_maps(documents)
    rewrites: list[LinkRewrite] = []
    concept_texts: dict[PurePosixPath, str] = {}
    metadata: dict[PurePosixPath, dict[str, str]] = {}

    for document in documents:
        if document.reserved:
            continue
        text, values = build_concept_text(document, exact, basenames, rewrites)
        concept_texts[document.relative_path] = text
        metadata[document.relative_path] = values

    indexes = build_indexes(
        documents,
        metadata,
        exact,
        basenames,
        rewrites,
        generated_at,
    )
    bundle_root.mkdir(parents=True, exist_ok=False)
    for relative, text in {**concept_texts, **indexes}.items():
        destination = bundle_root / Path(relative.as_posix())
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(text, encoding="utf-8", newline="\n")
    (bundle_root / "log.md").write_text(
        build_export_log(generated_at, len(concept_texts)),
        encoding="utf-8",
        newline="\n",
    )

    conformance = validate_bundle(bundle_root)
    unresolved = [rewrite for rewrite in rewrites if rewrite.status == "unresolved"]
    placeholders = [rewrite for rewrite in rewrites if rewrite.status == "placeholder"]
    project_root = Path(__file__).resolve().parents[2]
    report: dict[str, Any] = {
        "okf_version": OKF_VERSION,
        "generated_at": generated_at,
        "source_root": str(source_root),
        "source_fingerprint_sha256": source_fingerprint(documents),
        "bundle_path": relative_to_project(bundle_root, project_root),
        "preflight": preflight,
        "link_rewrites": {
            "total": len(rewrites),
            "resolved": sum(rewrite.status == "resolved" for rewrite in rewrites),
            "external": sum(rewrite.status == "external" for rewrite in rewrites),
            "placeholder": len(placeholders),
            "unresolved": len(unresolved),
            "unresolved_items": [asdict(rewrite) for rewrite in unresolved],
        },
        "conformance": conformance,
    }
    report_path = export_root / "report.json"
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    latest = {
        "okf_version": OKF_VERSION,
        "generated_at": generated_at,
        "bundle_path": relative_to_project(bundle_root, project_root),
        "report_path": relative_to_project(report_path, project_root),
        "concept_count": conformance["concept_count"],
        "index_count": conformance["index_count"],
        "conformant": conformance["conformant"],
        "warning_count": preflight["warning_count"] + len(unresolved),
        "unresolved_link_count": len(unresolved),
    }
    write_json_atomic(output_root / "latest.json", latest)
    report["latest"] = latest
    return report


def print_summary(payload: dict[str, Any], preflight_only: bool) -> None:
    if preflight_only:
        print(
            "OKF preflight: "
            f"{payload['concept_count']} concept(s), "
            f"{payload['error_count']} error(s), "
            f"{payload['warning_count']} warning(s)"
        )
        for issue in payload["issues"]:
            print(
                f"{issue['severity'].upper()}: {issue['path']}: "
                f"{issue['code']} - {issue['message']}"
            )
        return
    conformance = payload["conformance"]
    links = payload["link_rewrites"]
    print(
        "OKF export: "
        f"{conformance['concept_count']} concept(s), "
        f"{conformance['index_count']} index file(s), "
        f"{links['total']} wikilink(s) converted"
    )
    print(f"Bundle: {payload['latest']['bundle_path']}")
    print(f"Conformant OKF v{OKF_VERSION}: {str(conformance['conformant']).lower()}")
    print(f"Unresolved links: {links['unresolved']}")


def main() -> int:
    configure_utf8_stdio()
    args = parse_args()
    source_root = args.source_root.expanduser().resolve()
    output_root = args.output_root.expanduser().resolve()
    if not source_root.is_dir():
        print(f"Source wiki directory not found: {source_root}", file=sys.stderr)
        return 2
    documents, issues = read_source_documents(source_root)
    preflight = preflight_payload(source_root, documents, issues)
    if args.preflight_only:
        if args.json:
            print(json.dumps(preflight, ensure_ascii=False, indent=2))
        else:
            print_summary(preflight, True)
        return 2 if preflight["error_count"] else 0
    if preflight["error_count"]:
        print_summary(preflight, True)
        print("Export stopped because preflight found blocking errors.", file=sys.stderr)
        return 2
    report = export_bundle(source_root, output_root, documents, preflight)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print_summary(report, False)
    return 0 if report["conformance"]["conformant"] else 3


if __name__ == "__main__":
    raise SystemExit(main())
