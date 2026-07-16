from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError as exc:
    raise SystemExit("PyYAML is required. Install with: D:\\python\\python.exe -m pip install PyYAML") from exc


PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOOL_ROOT = PROJECT_ROOT / "tool-library"
KNOWLEDGE_ROOT = PROJECT_ROOT / "knowledge-base"
IGNORED_KNOWLEDGE_DIRS = {".obsidian", ".verysync", ".trash", ".git"}

REQUIRED_PROJECT_FILES = [
    "AGENTS.md",
]

REQUIRED_TOOL_FILES = [
    "references.bib",
    "metadata/papers.csv",
]

REQUIRED_KNOWLEDGE_FILES = [
    "文献索引.md",
    "研究主题索引.md",
    "研究方法索引.md",
    "字段补全检查.md",
    "wiki/index.md",
    "wiki/log.md",
]

WIKI_CONTENT_DIRS = {
    "sources": "文献索引.md",
    "concepts": "研究主题索引.md",
    "methods": "研究方法索引.md",
    "datasets": "研究方法索引.md",
    "entities": "wiki/index.md",
    "projects": "研究主题索引.md",
    "mocs": "研究主题索引.md",
    "synthesis": "研究主题索引.md",
}

REQUIRED_FRONTMATTER = ["title", "type", "sources", "tags", "created", "updated"]
SOURCE_FRONTMATTER = [
    "doi",
    "url",
    "zotero_key",
    "bibtex_key",
    "source_path",
    "converted_path",
    "status",
]

OLD_ENGLISH_HEADINGS = {
    "## TL;DR",
    "## Metadata",
    "## Research Question",
    "## Problem And Motivation",
    "## Method / Theory",
    "## Data / Materials",
    "## Experiments / Evidence",
    "## Key Findings",
    "## Limitations",
    "## Open Questions",
    "## Field Positioning",
    "## Reusable Ideas",
    "## Reviewer Assessment",
    "## Summary",
    "## Evidence In Vault",
    "## Use In This Vault",
    "## Related",
    "## Status",
    "## Protocol Logic",
    "## Boundaries",
}

FENCED_CODE_BLOCK_RE = re.compile(r"(?ms)^(```+|~~~+)[^\n]*\n.*?^\1[ \t]*$")
INLINE_CODE_RE = re.compile(r"`[^`\n]*`")


def rel(path: Path) -> str:
    return str(path.relative_to(PROJECT_ROOT)).replace("\\", "/")


def knowledge_rel(path: Path) -> str:
    return str(path.relative_to(KNOWLEDGE_ROOT)).replace("\\", "/")


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def iter_knowledge_markdown() -> list[Path]:
    return [
        path
        for path in KNOWLEDGE_ROOT.rglob("*.md")
        if not any(part in IGNORED_KNOWLEDGE_DIRS for part in path.relative_to(KNOWLEDGE_ROOT).parts)
    ]


def strip_code_for_link_check(text: str) -> str:
    """Remove Markdown code spans/blocks before scanning Obsidian wikilinks."""
    text = FENCED_CODE_BLOCK_RE.sub("", text)
    return INLINE_CODE_RE.sub("", text)


def parse_frontmatter(path: Path, errors: list[str]) -> dict | None:
    text = read_text(path)
    if not text.startswith("---"):
        return None
    parts = text.split("---", 2)
    if len(parts) < 3:
        errors.append(f"{rel(path)}: frontmatter is not closed")
        return None
    try:
        data = yaml.safe_load(parts[1]) or {}
    except Exception as exc:  # noqa: BLE001
        errors.append(f"{rel(path)}: invalid YAML frontmatter: {exc}")
        return None
    if not isinstance(data, dict):
        errors.append(f"{rel(path)}: frontmatter must be a mapping")
        return None
    return data


def first_h1(path: Path) -> str | None:
    for line in read_text(path).splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return None


def check_required_paths(errors: list[str]) -> None:
    for item in REQUIRED_PROJECT_FILES:
        if not (PROJECT_ROOT / item).exists():
            errors.append(f"missing required file: {item}")
    for item in REQUIRED_TOOL_FILES:
        if not (TOOL_ROOT / item).exists():
            errors.append(f"missing required tool file: tool-library/{item}")
    for item in REQUIRED_KNOWLEDGE_FILES:
        if not (KNOWLEDGE_ROOT / item).exists():
            errors.append(f"missing required knowledge file: knowledge-base/{item}")
    for item in ["raw", "converted/markdown", "templates", "metadata", "scripts"]:
        if not (TOOL_ROOT / item).exists():
            errors.append(f"missing required tool directory: tool-library/{item}")
    for item in [".obsidian", "wiki/sources"]:
        if not (KNOWLEDGE_ROOT / item).exists():
            errors.append(f"missing required knowledge directory: knowledge-base/{item}")


def check_graph(errors: list[str], warnings: list[str]) -> None:
    path = KNOWLEDGE_ROOT / ".obsidian" / "graph.json"
    if not path.exists():
        warnings.append(".obsidian/graph.json is missing")
        return
    try:
        data = json.loads(read_text(path))
    except Exception as exc:  # noqa: BLE001
        errors.append(f"{rel(path)}: invalid JSON: {exc}")
        return
    if "path:wiki" not in str(data.get("search", "")):
        warnings.append(".obsidian/graph.json does not limit graph search to wiki/")
    if data.get("showOrphans") is not False:
        warnings.append(".obsidian/graph.json should hide orphan nodes")


def check_markdown(errors: list[str], warnings: list[str]) -> dict[str, dict]:
    frontmatters: dict[str, dict] = {}
    md_paths = iter_knowledge_markdown()
    if (TOOL_ROOT / "templates").exists():
        md_paths.extend((TOOL_ROOT / "templates").glob("*.md"))
    if (TOOL_ROOT / "docs").exists():
        md_paths.extend((TOOL_ROOT / "docs").glob("*.md"))

    for path in md_paths:
        text = read_text(path)
        fm = parse_frontmatter(path, errors)
        in_knowledge = path.is_relative_to(KNOWLEDGE_ROOT)
        if fm is not None and in_knowledge:
            frontmatters[knowledge_rel(path)] = fm

        if in_knowledge and knowledge_rel(path).startswith(("wiki/sources/", "wiki/concepts/", "wiki/methods/", "wiki/datasets/")):
            for heading in OLD_ENGLISH_HEADINGS:
                if heading in text:
                    warnings.append(f"{rel(path)}: old English heading remains: {heading}")
        if in_knowledge and "??" in text:
            errors.append(f"{rel(path)}: contains consecutive question marks, possible encoding or localization corruption")

    for dir_name in WIKI_CONTENT_DIRS:
        content_dir = KNOWLEDGE_ROOT / "wiki" / dir_name
        if not content_dir.exists():
            continue
        for path in content_dir.glob("*.md"):
            if path.name.upper() == "README.MD":
                continue
            key = knowledge_rel(path)
            fm = frontmatters.get(key)
            if fm is None:
                errors.append(f"{key}: missing YAML frontmatter")
                continue
            for field in REQUIRED_FRONTMATTER:
                if field not in fm:
                    errors.append(f"{key}: missing frontmatter field `{field}`")
            if dir_name == "sources":
                for field in SOURCE_FRONTMATTER:
                    if field not in fm:
                        errors.append(f"{key}: missing source frontmatter field `{field}`")
                h1 = first_h1(path)
                if h1 and fm.get("title") and h1 != fm["title"]:
                    errors.append(f"{key}: H1 title does not match frontmatter title")
    return frontmatters


def check_wikilinks(errors: list[str]) -> None:
    links: list[tuple[Path, str]] = []
    for path in iter_knowledge_markdown():
        if path.is_relative_to(KNOWLEDGE_ROOT / "wiki" / "schema"):
            continue
        text = strip_code_for_link_check(read_text(path))
        for match in re.findall(r"\[\[([^\]|#]+)", text):
            links.append((path, match))

    for path, link in links:
        link = link.strip()
        if not link:
            continue
        if link.startswith("wiki/"):
            target = KNOWLEDGE_ROOT / f"{link}.md"
        elif link.split("/", 1)[0] in WIKI_CONTENT_DIRS:
            target = KNOWLEDGE_ROOT / "wiki" / f"{link}.md"
        else:
            target = KNOWLEDGE_ROOT / f"{link}.md"
        if not target.exists():
            errors.append(f"{rel(path)}: missing wikilink target `{link}`")


def bibtex_keys() -> set[str]:
    path = TOOL_ROOT / "references.bib"
    if not path.exists():
        return set()
    return set(re.findall(r"@\w+\{([^,\s]+)", read_text(path)))


def check_metadata(frontmatters: dict[str, dict], errors: list[str], warnings: list[str]) -> None:
    csv_path = TOOL_ROOT / "metadata" / "papers.csv"
    if not csv_path.exists():
        return
    rows = list(csv.DictReader(csv_path.open(encoding="utf-8")))
    keys = bibtex_keys()
    seen_citekeys: set[str] = set()
    seen_dois: set[str] = set()

    for row in rows:
        citekey = row.get("citekey", "").strip()
        if not citekey:
            errors.append("tool-library/metadata/papers.csv: row missing citekey")
            continue
        if citekey in seen_citekeys:
            errors.append(f"tool-library/metadata/papers.csv: duplicate citekey `{citekey}`")
        seen_citekeys.add(citekey)

        doi = row.get("doi", "").strip().lower()
        if doi:
            if doi in seen_dois:
                errors.append(f"tool-library/metadata/papers.csv: duplicate DOI `{doi}`")
            seen_dois.add(doi)

        source_path = row.get("source_path", "").strip()
        converted_path = row.get("converted_path", "").strip()
        if source_path and not Path(source_path).exists():
            errors.append(f"{citekey}: source_path does not exist: {source_path}")
        converted_full = Path(converted_path)
        if converted_path and not converted_full.is_absolute():
            converted_full = PROJECT_ROOT / converted_path
        if converted_path and not converted_full.exists():
            errors.append(f"{citekey}: converted_path does not exist: {converted_path}")

        bibtex_key = row.get("bibtex_key", "").strip()
        if bibtex_key and bibtex_key not in keys:
            errors.append(f"{citekey}: BibTeX key `{bibtex_key}` missing from tool-library/references.bib")

        note_path = f"wiki/sources/{citekey}.md"
        note = KNOWLEDGE_ROOT / note_path
        if not note.exists():
            errors.append(f"{citekey}: missing source note {note_path}")
            continue

        fm = frontmatters.get(note_path, {})
        if row.get("title") and fm.get("title") and row["title"] != fm["title"]:
            errors.append(f"{citekey}: metadata title does not match source-note title")
        if row.get("status") and fm.get("status") and row["status"] != fm["status"]:
            warnings.append(f"{citekey}: CSV status differs from source-note status")


def check_index_coverage(errors: list[str]) -> None:
    index_text = {
        "文献索引.md": read_text(KNOWLEDGE_ROOT / "文献索引.md") if (KNOWLEDGE_ROOT / "文献索引.md").exists() else "",
        "研究主题索引.md": read_text(KNOWLEDGE_ROOT / "研究主题索引.md") if (KNOWLEDGE_ROOT / "研究主题索引.md").exists() else "",
        "研究方法索引.md": read_text(KNOWLEDGE_ROOT / "研究方法索引.md") if (KNOWLEDGE_ROOT / "研究方法索引.md").exists() else "",
        "wiki/index.md": read_text(KNOWLEDGE_ROOT / "wiki" / "index.md") if (KNOWLEDGE_ROOT / "wiki" / "index.md").exists() else "",
    }
    for dir_name, root_index in WIKI_CONTENT_DIRS.items():
        content_dir = KNOWLEDGE_ROOT / "wiki" / dir_name
        if not content_dir.exists():
            continue
        for path in content_dir.glob("*.md"):
            if path.name.upper() == "README.MD":
                continue
            link = knowledge_rel(path).removesuffix(".md")
            if link not in index_text.get("wiki/index.md", ""):
                errors.append(f"{rel(path)}: missing from wiki/index.md")
            if root_index != "wiki/index.md" and link not in index_text.get(root_index, ""):
                errors.append(f"{rel(path)}: missing from {root_index}")


def main() -> int:
    errors: list[str] = []
    warnings: list[str] = []

    check_required_paths(errors)
    check_graph(errors, warnings)
    frontmatters = check_markdown(errors, warnings)
    check_wikilinks(errors)
    check_metadata(frontmatters, errors, warnings)
    check_index_coverage(errors)

    print(f"Vault validation: {len(errors)} error(s), {len(warnings)} warning(s)")
    for item in errors:
        print(f"ERROR: {item}")
    for item in warnings:
        print(f"WARNING: {item}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
