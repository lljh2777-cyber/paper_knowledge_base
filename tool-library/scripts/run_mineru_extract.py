#!/usr/bin/env python3
"""Run one validated MinerU PDF extraction and publish an immutable paper package."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import uuid
from typing import Any
from urllib.parse import unquote


MARKDOWN_IMAGE_RE = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")
HTML_IMAGE_RE = re.compile(r"<img\b[^>]*\bsrc=[\"']([^\"']+)[\"']", re.IGNORECASE)
CITEKEY_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,119}")
SUPPORTED_LANGUAGES = {
    "ch",
    "ch_server",
    "en",
    "japan",
    "korean",
    "chinese_cht",
    "ta",
    "te",
    "ka",
    "el",
    "th",
    "latin",
    "arabic",
    "cyrillic",
    "east_slavic",
    "devanagari",
}


def configure_utf8_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors="replace")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract one PDF with MinerU precision extract and publish it safely."
    )
    parser.add_argument("--project-root", type=Path, default=Path.cwd())
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--citekey", required=True)
    parser.add_argument("--mineru", required=True)
    parser.add_argument("--base-url", default="")
    parser.add_argument("--model", choices=("vlm", "pipeline", "auto", "html"), default="vlm")
    parser.add_argument("--language", choices=sorted(SUPPORTED_LANGUAGES), default="en")
    parser.add_argument("--pages", default="")
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("--ocr", action="store_true")
    parser.add_argument(
        "--formula",
        action=argparse.BooleanOptionalAction,
        default=True,
    )
    parser.add_argument(
        "--table",
        action=argparse.BooleanOptionalAction,
        default=True,
    )
    parser.add_argument("--include-source-pdf", action="store_true")
    parser.add_argument("--run-id", default="")
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_pages(value: str) -> str:
    raw = value.strip().replace("，", ",")
    if not raw:
        return ""
    tokens = [token for token in re.split(r"[,\s]+", raw) if token]
    for token in tokens:
        match = re.fullmatch(r"(\d+)(?:-(\d+))?", token)
        if not match:
            raise ValueError("MinerU pages must use 1-based ranges such as 1-10,15")
        start = int(match.group(1))
        end = int(match.group(2) or match.group(1))
        if start < 1 or end < start:
            raise ValueError("MinerU page numbers start at 1 and ranges cannot descend")
    return ",".join(tokens)


def resolve_existing_file(value: str, label: str) -> Path:
    candidate = Path(value).expanduser()
    if candidate.is_file():
        return candidate.resolve()
    located = shutil.which(value)
    if located:
        return Path(located).resolve()
    raise FileNotFoundError(f"{label} is unavailable: {value}")


def resolve_source(value: Path) -> Path:
    source = value.expanduser().resolve(strict=True)
    if not source.is_file() or source.suffix.lower() != ".pdf":
        raise ValueError(f"MinerU source must be one PDF file: {source}")
    return source


def resolve_project_root(value: Path) -> Path:
    root = value.expanduser().resolve(strict=True)
    if not root.is_dir() or not (root / "AGENTS.md").is_file():
        raise ValueError(f"Invalid Research Vault project root: {root}")
    return root


def validate_base_url(value: str) -> str:
    normalized = value.strip()
    if normalized and not re.match(r"^https?://", normalized):
        raise ValueError("MinerU base URL must use http:// or https://")
    if any(character in normalized for character in "\r\n"):
        raise ValueError("MinerU base URL cannot contain newlines")
    return normalized.rstrip("/")


def command_for_executable(executable: Path, arguments: list[str]) -> list[str]:
    return [str(executable), *arguments]


def run_command(
    executable: Path,
    arguments: list[str],
    cwd: Path,
    timeout: int,
) -> subprocess.CompletedProcess[str]:
    command = command_for_executable(executable, arguments)
    result = subprocess.run(
        command,
        cwd=cwd,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        timeout=timeout,
        check=False,
    )
    if result.stderr:
        print(result.stderr.rstrip(), file=sys.stderr)
    if result.returncode != 0:
        detail = result.stdout.strip() or result.stderr.strip() or "no error detail"
        raise RuntimeError(f"MinerU exited with {result.returncode}: {detail}")
    return result


def detect_version(executable: Path, project_root: Path) -> str:
    try:
        result = run_command(executable, ["version"], project_root, 15)
    except (OSError, RuntimeError, subprocess.TimeoutExpired):
        return "unknown"
    first_line = result.stdout.strip().splitlines()
    return first_line[0] if first_line else "unknown"


def safe_asset_path(package_root: Path, raw_path: str) -> Path:
    normalized = unquote(raw_path.strip().strip("<>"))
    if not normalized or re.match(r"^[a-z]+://", normalized, re.IGNORECASE):
        raise ValueError(f"Unsupported external asset reference: {raw_path}")
    candidate = (package_root / normalized).resolve()
    try:
        candidate.relative_to(package_root.resolve())
    except ValueError as exc:
        raise ValueError(f"Asset reference escapes the package: {raw_path}") from exc
    return candidate


def find_single_output(extract_root: Path, suffix: str) -> Path:
    matches = [path for path in extract_root.rglob(f"*{suffix}") if path.is_file()]
    if len(matches) != 1:
        raise ValueError(
            f"Expected one MinerU {suffix} output, found {len(matches)} in {extract_root}"
        )
    return matches[0]


def copy_extraction_outputs(extract_root: Path, package_root: Path) -> tuple[Path, Path]:
    markdown_source = find_single_output(extract_root, ".md")
    json_source = find_single_output(extract_root, ".json")
    package_root.mkdir(parents=True, exist_ok=False)
    markdown_target = package_root / "article.md"
    json_target = package_root / "mineru-result.json"
    shutil.copy2(markdown_source, markdown_target)
    shutil.copy2(json_source, json_target)
    images_source = markdown_source.parent / "images"
    if images_source.is_dir():
        shutil.copytree(images_source, package_root / "images")
    return markdown_target, json_target


def validate_package(package_root: Path) -> dict[str, Any]:
    markdown_path = package_root / "article.md"
    json_path = package_root / "mineru-result.json"
    markdown = markdown_path.read_text(encoding="utf-8")
    if len(markdown.strip()) < 100:
        raise ValueError("MinerU article.md is empty or implausibly short")
    if not re.search(r"^#\s+\S", markdown, re.MULTILINE):
        raise ValueError("MinerU article.md has no document title heading")
    payload = json.loads(json_path.read_text(encoding="utf-8"))
    if not isinstance(payload, list) or not payload:
        raise ValueError("MinerU JSON must be a non-empty element array")

    page_indexes: list[int] = []
    json_assets: set[str] = set()
    for index, item in enumerate(payload):
        if not isinstance(item, dict):
            raise ValueError(f"MinerU JSON item {index} is not an object")
        page_index = item.get("page_idx")
        if not isinstance(page_index, int) or page_index < 0:
            raise ValueError(f"MinerU JSON item {index} has an invalid page_idx")
        page_indexes.append(page_index)
        raw_asset = item.get("img_path")
        if raw_asset:
            asset = str(raw_asset)
            target = safe_asset_path(package_root, asset)
            if not target.is_file() or target.stat().st_size == 0:
                raise ValueError(f"Missing or empty MinerU JSON asset: {asset}")
            json_assets.add(asset)

    markdown_assets = {
        match.group(1).split(maxsplit=1)[0]
        for match in MARKDOWN_IMAGE_RE.finditer(markdown)
    }
    markdown_assets.update(match.group(1) for match in HTML_IMAGE_RE.finditer(markdown))
    for asset in markdown_assets:
        target = safe_asset_path(package_root, asset)
        if not target.is_file() or target.stat().st_size == 0:
            raise ValueError(f"Missing or empty Markdown asset: {asset}")

    return {
        "status": "passed",
        "checks": {
            "markdown_nonempty": True,
            "title_heading_present": True,
            "json_array_valid": True,
            "json_assets_exist": True,
            "markdown_assets_exist": True,
        },
        "page_count": max(page_indexes) + 1,
        "json_element_count": len(payload),
        "json_asset_count": len(json_assets),
        "markdown_asset_count": len(markdown_assets),
        "unreferenced_json_assets": sorted(json_assets - markdown_assets),
    }


def file_record(path: Path, package_root: Path) -> dict[str, Any]:
    return {
        "path": path.relative_to(package_root).as_posix(),
        "size": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def write_contract(
    package_root: Path,
    source: Path,
    executable: Path,
    version: str,
    options: dict[str, Any],
    validation: dict[str, Any],
    include_source_pdf: bool,
) -> None:
    contract_root = package_root / "_extraction"
    contract_root.mkdir()
    if include_source_pdf:
        shutil.copy2(source, contract_root / "source.pdf")

    generated_files = [
        path
        for path in package_root.rglob("*")
        if path.is_file() and contract_root not in path.parents
    ]
    manifest = {
        "schema_version": 1,
        "extractor": "mineru-open-api",
        "extractor_version": version,
        "extractor_executable": str(executable),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "processing_depth": "conversion-only",
        "source": {
            "path": str(source),
            "size": source.stat().st_size,
            "sha256": sha256_file(source),
        },
        "privacy": {
            "remote_processing": True,
            "notice": "Document content was transmitted to the configured MinerU service.",
        },
        "options": options,
        "outputs": [
            file_record(path, package_root)
            for path in sorted(generated_files, key=lambda value: value.as_posix())
        ],
    }
    (contract_root / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (contract_root / "validation.json").write_text(
        json.dumps(validation, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    configure_utf8_stdio()
    args = parse_args()
    project_root = resolve_project_root(args.project_root)
    source = resolve_source(args.source)
    executable = resolve_existing_file(args.mineru, "MinerU CLI")
    base_url = validate_base_url(args.base_url)
    pages = normalize_pages(args.pages)
    if not CITEKEY_RE.fullmatch(args.citekey):
        raise ValueError("citekey may contain only letters, numbers, dot, underscore, and hyphen")
    if not 60 <= args.timeout <= 1800:
        raise ValueError("MinerU timeout must be between 60 and 1800 seconds")

    papers_root = (project_root / "knowledge-base" / "papers").resolve()
    papers_root.mkdir(parents=True, exist_ok=True)
    final_package = (papers_root / args.citekey).resolve()
    if final_package.parent != papers_root:
        raise ValueError("citekey resolves outside knowledge-base/papers")
    if final_package.exists():
        raise FileExistsError(
            f"Paper package already exists and will not be overwritten in place: {final_package}"
        )

    run_token = re.sub(r"[^A-Za-z0-9._-]+", "-", args.run_id.strip()).strip("-")
    if not run_token:
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        run_token = f"{timestamp}-{args.citekey}-{uuid.uuid4().hex[:8]}"
    run_root = project_root / "tool-library" / "output" / "mineru-runs" / run_token
    extract_root = run_root / "extract"
    package_stage = run_root / "package"
    if run_root.exists():
        raise FileExistsError(f"MinerU run directory already exists: {run_root}")
    extract_root.mkdir(parents=True)

    arguments: list[str] = []
    if base_url:
        arguments.extend(["--base-url", base_url])
    arguments.extend(["extract", str(source)])
    if args.model != "auto":
        arguments.extend(["--model", args.model])
    arguments.extend(
        [
            "--language",
            args.language,
            "--format",
            "md,json",
            "--timeout",
            str(args.timeout),
            "--output",
            str(extract_root),
            "--formula" if args.formula else "--formula=false",
            "--table" if args.table else "--table=false",
        ]
    )
    if args.ocr:
        arguments.append("--ocr")
    if pages:
        arguments.extend(["--pages", pages])

    print(f"MinerU staging directory: {run_root}", file=sys.stderr)
    run_command(executable, arguments, project_root, args.timeout + 30)
    copy_extraction_outputs(extract_root, package_stage)
    validation = validate_package(package_stage)
    version = detect_version(executable, project_root)
    options = {
        "mode": "precision-extract",
        "formats": ["md", "json"],
        "model": args.model,
        "language": args.language,
        "ocr": args.ocr,
        "formula": args.formula,
        "table": args.table,
        "pages": pages or None,
        "timeout_seconds": args.timeout,
        "base_url": base_url or None,
        "include_source_pdf": args.include_source_pdf,
    }
    write_contract(
        package_stage,
        source,
        executable,
        version,
        options,
        validation,
        args.include_source_pdf,
    )
    package_stage.replace(final_package)
    print(
        json.dumps(
            {
                "status": "published",
                "package": str(final_package),
                "staging": str(run_root),
                "validation": validation,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (
        FileExistsError,
        FileNotFoundError,
        OSError,
        RuntimeError,
        ValueError,
        json.JSONDecodeError,
        subprocess.TimeoutExpired,
    ) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2) from error
