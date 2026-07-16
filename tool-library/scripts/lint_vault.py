#!/usr/bin/env python3
"""Run a layered, read-only audit of the Research Vault."""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from typing import Any

import yaml

import validate_vault as baseline


PROJECT_ROOT = Path(__file__).resolve().parents[2]
KNOWLEDGE_ROOT = PROJECT_ROOT / "knowledge-base"
WIKI_ROOT = KNOWLEDGE_ROOT / "wiki"
OUTPUT_ROOT = PROJECT_ROOT / "tool-library" / "output" / "lint"
SEVERITY_ORDER = {"error": 0, "warning": 1, "info": 2}
RESERVED_NAMES = {"index.md", "log.md", "readme.md"}
WORKFLOW_PHRASES = {
    "全库批量处理",
    "未逐页人工复核",
    "未写入 Zotero",
    "批量导入",
    "converted by MarkItDown",
    "待后续处理",
}
ALLOWED_SOURCE_STATUS = {"metadata-only", "ingested", "abstract-level", "x-ray", "xray"}


def configure_utf8_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


@dataclass(frozen=True)
class Finding:
    severity: str
    category: str
    code: str
    path: str
    message: str
    fixable: bool = False


@dataclass
class Note:
    path: Path
    relative: str
    text: str
    body: str
    frontmatter: dict[str, Any]
    note_type: str


class Audit:
    def __init__(self) -> None:
        self.findings: list[Finding] = []
        self.stats: dict[str, Any] = {}
        self._keys: set[tuple[str, str, str, str]] = set()

    def add(
        self,
        severity: str,
        category: str,
        code: str,
        path: str,
        message: str,
        fixable: bool = False,
    ) -> None:
        key = (severity, code, path, message)
        if key in self._keys:
            return
        self._keys.add(key)
        self.findings.append(Finding(severity, category, code, path, message, fixable))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a layered Research Vault audit.")
    parser.add_argument("--json", action="store_true", help="Print the full report as JSON.")
    parser.add_argument("--report", type=Path, help="Also write the JSON report to this path.")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Return non-zero when warnings are present as well as errors.",
    )
    return parser.parse_args()


def split_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        return {}, text
    for index in range(1, len(lines)):
        if lines[index].strip() != "---":
            continue
        raw = "".join(lines[1:index])
        try:
            value = yaml.safe_load(raw) or {}
        except yaml.YAMLError:
            return {}, "".join(lines[index + 1 :])
        return value if isinstance(value, dict) else {}, "".join(lines[index + 1 :])
    return {}, text


def load_notes(audit: Audit) -> dict[str, Note]:
    notes: dict[str, Note] = {}
    for path in sorted(baseline.iter_knowledge_markdown()):
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError as error:
            relative = path.relative_to(KNOWLEDGE_ROOT).as_posix()
            audit.add("error", "encoding", "invalid-utf8", relative, str(error))
            continue
        relative = path.relative_to(KNOWLEDGE_ROOT).as_posix()
        frontmatter, body = split_frontmatter(text)
        note_type = str(frontmatter.get("type") or "").strip()
        notes[relative] = Note(path, relative, text, body, frontmatter, note_type)
        if "\ufffd" in text:
            audit.add(
                "error",
                "encoding",
                "replacement-character",
                relative,
                "Contains the Unicode replacement character.",
            )
    audit.stats["markdown_count"] = len(notes)
    audit.stats["wiki_concept_count"] = sum(
        relative.startswith("wiki/")
        and Path(relative).name.casefold() not in RESERVED_NAMES
        for relative in notes
    )
    audit.stats["note_types"] = dict(
        sorted(Counter(note.note_type or "untyped" for note in notes.values()).items())
    )
    return notes


def baseline_category(message: str) -> str:
    lowered = message.casefold()
    if ".obsidian/graph" in lowered:
        return "graph"
    if "wikilink" in lowered:
        return "links"
    if "frontmatter" in lowered or "yaml" in lowered:
        return "frontmatter"
    if "missing from" in lowered or "index.md" in lowered or "索引" in lowered:
        return "indexes"
    if any(term in lowered for term in ("bibtex", "citekey", "doi", "papers.csv", "metadata")):
        return "metadata"
    if "encoding" in lowered or "question marks" in lowered:
        return "encoding"
    return "structure"


def baseline_path(message: str) -> str:
    prefix = message.split(":", 1)[0]
    if prefix.startswith(("knowledge-base/", "tool-library/", "wiki/")):
        return prefix
    return ""


def run_baseline(audit: Audit) -> None:
    errors: list[str] = []
    warnings: list[str] = []
    baseline.check_required_paths(errors)
    baseline.check_graph(errors, warnings)
    frontmatters = baseline.check_markdown(errors, warnings)
    baseline.check_wikilinks(errors)
    baseline.check_metadata(frontmatters, errors, warnings)
    baseline.check_index_coverage(errors)
    for message in errors:
        audit.add(
            "error",
            baseline_category(message),
            "baseline-validation",
            baseline_path(message),
            message,
        )
    for message in warnings:
        audit.add(
            "warning",
            baseline_category(message),
            "baseline-validation",
            baseline_path(message),
            message,
        )


def extract_wikilinks(text: str) -> list[str]:
    stripped = baseline.strip_code_for_link_check(text)
    return [match.strip() for match in re.findall(r"\[\[([^\]|#]+)", stripped) if match.strip()]


def build_note_maps(notes: dict[str, Note]) -> tuple[dict[str, str], dict[str, list[str]]]:
    exact: dict[str, str] = {}
    basenames: dict[str, list[str]] = defaultdict(list)
    for relative in notes:
        if not relative.lower().endswith(".md"):
            continue
        key = relative[:-3]
        exact[key.casefold()] = relative
        basenames[Path(relative).stem.casefold()].append(relative)
    return exact, basenames


def resolve_link(
    link: str,
    exact: dict[str, str],
    basenames: dict[str, list[str]],
) -> tuple[str | None, bool]:
    normalized = link.replace("\\", "/").strip().removesuffix(".md").strip("/")
    candidates = [normalized]
    if normalized.startswith("wiki/"):
        candidates.append(normalized[5:])
    elif normalized.split("/", 1)[0] in baseline.WIKI_CONTENT_DIRS or normalized.startswith("code/"):
        candidates.append(f"wiki/{normalized}")
    else:
        candidates.append(f"wiki/{normalized}")
    for candidate in candidates:
        resolved = exact.get(candidate.casefold())
        if resolved:
            return resolved, False
    matches = basenames.get(Path(normalized).name.casefold(), [])
    if len(matches) == 1:
        return matches[0], False
    return None, len(matches) > 1


def check_graph_and_duplicates(notes: dict[str, Note], audit: Audit) -> dict[str, set[str]]:
    exact, basenames = build_note_maps(notes)
    incoming: Counter[str] = Counter()
    edges: dict[str, set[str]] = defaultdict(set)
    for source, note in notes.items():
        for link in extract_wikilinks(note.text):
            target, ambiguous = resolve_link(link, exact, basenames)
            if ambiguous:
                audit.add(
                    "warning",
                    "links",
                    "ambiguous-wikilink",
                    source,
                    f"Wikilink `{link}` matches more than one basename.",
                )
            if target and target != source:
                incoming[target] += 1
                edges[source].add(target)

    for basename, paths in sorted(basenames.items()):
        concept_paths = [
            path for path in paths if Path(path).name.casefold() not in RESERVED_NAMES
        ]
        if len(concept_paths) > 1:
            audit.add(
                "warning",
                "duplicates",
                "duplicate-basename",
                "",
                f"Basename `{basename}` is shared by: {', '.join(concept_paths)}",
            )

    titles: dict[tuple[str, str], list[str]] = defaultdict(list)
    for relative, note in notes.items():
        title = str(note.frontmatter.get("title") or "").strip()
        if title and note.note_type:
            titles[(note.note_type.casefold(), title.casefold())].append(relative)
    for (note_type, title), paths in sorted(titles.items()):
        if len(paths) > 1:
            audit.add(
                "warning",
                "duplicates",
                "duplicate-title",
                "",
                f"Type `{note_type}` has duplicate title `{title}` in: {', '.join(paths)}",
            )

    orphan_types = {
        "source",
        "concept",
        "method",
        "dataset",
        "project",
        "moc",
        "synthesis",
        "code-project",
        "code-script",
    }
    orphans = []
    for relative, note in notes.items():
        if not relative.startswith("wiki/") or note.note_type not in orphan_types:
            continue
        if Path(relative).name.casefold() in RESERVED_NAMES:
            continue
        if incoming[relative] == 0:
            orphans.append(relative)
            audit.add(
                "warning",
                "orphans",
                "orphan-note",
                relative,
                "No incoming wikilink was found from the knowledge-base.",
                True,
            )
    audit.stats["orphan_count"] = len(orphans)
    audit.stats["wikilink_edge_count"] = sum(len(targets) for targets in edges.values())
    return edges


def source_headings(body: str) -> list[str]:
    return [heading.strip() for heading in re.findall(r"^##\s+(.+?)\s*$", body, re.MULTILINE)]


def check_source_notes(notes: dict[str, Note], audit: Audit) -> None:
    source_notes = [
        note for relative, note in notes.items() if relative.startswith("wiki/sources/")
    ]
    status_counts: Counter[str] = Counter()
    metadata_gaps: Counter[str] = Counter()
    for note in source_notes:
        fm = note.frontmatter
        status = str(fm.get("status") or "").strip().casefold()
        status_counts[status or "missing"] += 1
        for field in baseline.SOURCE_FRONTMATTER:
            if not fm.get(field):
                metadata_gaps[field] += 1
        headings = source_headings(note.body)
        if "元数据" in headings:
            audit.add(
                "warning",
                "source-notes",
                "body-metadata-section",
                note.relative,
                "Body contains `## 元数据`; bibliographic fields belong in frontmatter/indexes.",
                True,
            )
        if "简要结论" in headings:
            audit.add(
                "warning",
                "source-notes",
                "legacy-conclusion-heading",
                note.relative,
                "Replace `## 简要结论` with the preferred `## 结论` heading.",
                True,
            )
        if "研究问题" not in headings:
            audit.add(
                "warning",
                "source-notes",
                "missing-research-question",
                note.relative,
                "Source note is missing `## 研究问题`.",
            )
        if "结论" not in headings:
            audit.add(
                "warning",
                "source-notes",
                "missing-conclusion",
                note.relative,
                "Source note is missing `## 结论`.",
            )
        if "研究问题" in headings and "结论" in headings:
            if headings.index("研究问题") > headings.index("结论"):
                audit.add(
                    "warning",
                    "source-notes",
                    "source-heading-order",
                    note.relative,
                    "`研究问题` should appear before `结论`.",
                    True,
                )
        matched_phrases = sorted(phrase for phrase in WORKFLOW_PHRASES if phrase.casefold() in note.body.casefold())
        if matched_phrases:
            audit.add(
                "warning",
                "source-notes",
                "workflow-boilerplate",
                note.relative,
                f"Workflow prose appears in research content: {', '.join(matched_phrases)}",
                True,
            )
        if status not in ALLOWED_SOURCE_STATUS:
            audit.add(
                "warning",
                "evidence-depth",
                "unknown-source-status",
                note.relative,
                f"Unrecognized processing status: `{status or 'missing'}`.",
            )
        if status in {"x-ray", "xray"}:
            for field in ("xray_tier", "xray_score", "xray_score_reason"):
                if not fm.get(field):
                    audit.add(
                        "warning",
                        "evidence-depth",
                        "incomplete-xray-frontmatter",
                        note.relative,
                        f"X-Ray note is missing `{field}`.",
                    )
            score = fm.get("xray_score")
            if score is not None:
                try:
                    numeric_score = float(score)
                except (TypeError, ValueError):
                    numeric_score = -1
                if not 1 <= numeric_score <= 10:
                    audit.add(
                        "warning",
                        "evidence-depth",
                        "invalid-xray-score",
                        note.relative,
                        "`xray_score` should be numeric and between 1 and 10.",
                    )
            required_signals = {
                "methods": any("方法" in heading for heading in headings),
                "evidence": any(
                    term in heading for heading in headings for term in ("证据", "实验", "关键发现")
                ),
                "limitations": any(term in heading for heading in headings for term in ("局限", "限制")),
            }
            for signal, present in required_signals.items():
                if not present:
                    audit.add(
                        "warning",
                        "evidence-depth",
                        "incomplete-xray-body",
                        note.relative,
                        f"X-Ray body has no heading signal for `{signal}`.",
                    )
        elif any(fm.get(field) for field in ("xray_tier", "xray_score", "xray_score_reason")):
            audit.add(
                "warning",
                "evidence-depth",
                "xray-fields-without-xray-status",
                note.relative,
                "X-Ray scoring fields exist but status is not `x-ray`.",
            )

    audit.stats["source_count"] = len(source_notes)
    audit.stats["source_status"] = dict(sorted(status_counts.items()))
    audit.stats["source_metadata_gaps"] = dict(sorted(metadata_gaps.items()))
    for field, count in sorted(metadata_gaps.items()):
        if count:
            audit.add(
                "info",
                "metadata",
                "empty-source-metadata",
                "wiki/sources",
                f"{count} source note(s) have an empty `{field}` value.",
            )


def wikilink_target(value: Any) -> str:
    match = re.search(r"\[\[([^\]|#]+)", str(value or ""))
    return match.group(1).strip() if match else ""


def existing_path(value: Any) -> bool:
    raw = str(value or "").strip()
    if not raw:
        return False
    path = Path(raw)
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    return path.exists()


def check_code_notes(notes: dict[str, Note], edges: dict[str, set[str]], audit: Audit) -> None:
    projects = {
        relative: note for relative, note in notes.items() if note.note_type == "code-project"
    }
    scripts = {
        relative: note for relative, note in notes.items() if note.note_type == "code-script"
    }
    scripts_by_project: dict[str, list[Note]] = defaultdict(list)
    for relative, project in projects.items():
        if str(project.frontmatter.get("analysis_depth") or "") != "static-read":
            audit.add(
                "warning",
                "code",
                "code-project-depth",
                relative,
                "Code project analysis depth should be `static-read` by default.",
            )
        if not existing_path(project.frontmatter.get("source_root")):
            audit.add(
                "warning",
                "code",
                "missing-code-source-root",
                relative,
                f"source_root does not exist: {project.frontmatter.get('source_root')}",
            )

    for relative, script in scripts.items():
        if str(script.frontmatter.get("analysis_depth") or "") != "static-read":
            audit.add(
                "warning",
                "code",
                "code-script-depth",
                relative,
                "Code script analysis depth should be `static-read` by default.",
            )
        if not existing_path(script.frontmatter.get("source_path")):
            audit.add(
                "warning",
                "code",
                "missing-code-source-path",
                relative,
                f"source_path does not exist: {script.frontmatter.get('source_path')}",
            )
        project_target = wikilink_target(script.frontmatter.get("project"))
        if project_target and not project_target.startswith("wiki/"):
            project_target = f"wiki/{project_target}"
        project_relative = f"{project_target}.md" if project_target else ""
        project = projects.get(project_relative)
        if not project:
            audit.add(
                "warning",
                "code",
                "missing-code-project-link",
                relative,
                "Script page does not resolve to an existing code-project page.",
            )
            continue
        scripts_by_project[project_relative].append(script)
        script_link = relative.removesuffix(".md")
        if script_link not in project.text:
            audit.add(
                "warning",
                "code",
                "missing-project-script-backlink",
                relative,
                f"Project page `{project_relative}` does not link this script page.",
                True,
            )

    for project_relative, project in projects.items():
        declared = {
            str(item).replace("\\", "/")
            for item in (project.frontmatter.get("scripts") or [])
            if str(item).strip()
        }
        documented = {
            str(script.frontmatter.get("relative_path") or "").replace("\\", "/")
            for script in scripts_by_project.get(project_relative, [])
            if str(script.frontmatter.get("relative_path") or "").strip()
        }
        for missing in sorted(declared - documented):
            audit.add(
                "warning",
                "code",
                "declared-script-note-missing",
                project_relative,
                f"Declared source script has no code-script page: `{missing}`.",
            )
        for extra in sorted(documented - declared):
            audit.add(
                "warning",
                "code",
                "script-missing-from-project-frontmatter",
                project_relative,
                f"Code-script page is absent from project `scripts`: `{extra}`.",
                True,
            )

    code_index = notes.get("wiki/code/index.md")
    root_index = notes.get("代码项目索引.md")
    for relative in [*projects, *scripts]:
        link = relative.removesuffix(".md")
        if not code_index or link not in code_index.text:
            audit.add(
                "warning",
                "indexes",
                "missing-code-index-entry",
                relative,
                "Code note is missing from `wiki/code/index.md`.",
                True,
            )
        if relative in projects and (not root_index or link not in root_index.text):
            audit.add(
                "warning",
                "indexes",
                "missing-code-project-index-entry",
                relative,
                "Code project is missing from `代码项目索引.md`.",
                True,
            )

    methods = {
        relative: note for relative, note in notes.items() if note.note_type == "method"
    }
    for project_relative, project in projects.items():
        linked_methods = {
            target for target in edges.get(project_relative, set()) if target in methods
        }
        for method_relative, method in methods.items():
            title = str(method.frontmatter.get("title") or "").strip()
            if len(title) < 4 or title.casefold() not in baseline.strip_code_for_link_check(project.body).casefold():
                continue
            if method_relative not in linked_methods:
                audit.add(
                    "warning",
                    "code",
                    "plain-method-reference",
                    project_relative,
                    f"Mentions canonical method `{title}` without linking `{method_relative.removesuffix('.md')}`.",
                    True,
                )
        for method_relative in linked_methods:
            if project_relative.removesuffix(".md") not in methods[method_relative].text:
                audit.add(
                    "warning",
                    "code",
                    "missing-method-code-backlink",
                    method_relative,
                    f"Method page does not link back to `{project_relative.removesuffix('.md')}`.",
                    True,
                )

    audit.stats["code_projects"] = len(projects)
    audit.stats["code_scripts"] = len(scripts)


def wiki_fingerprint() -> str:
    digest = hashlib.sha256()
    for path in sorted(WIKI_ROOT.rglob("*.md")):
        relative = path.relative_to(WIKI_ROOT).as_posix()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_text(encoding="utf-8-sig").encode("utf-8"))
        digest.update(b"\0")
    return digest.hexdigest()


def resolve_project_path(value: Any) -> Path:
    path = Path(str(value or ""))
    return path if path.is_absolute() else PROJECT_ROOT / path


def check_okf(audit: Audit) -> None:
    latest_path = PROJECT_ROOT / "tool-library" / "output" / "okf" / "latest.json"
    if not latest_path.exists():
        audit.add(
            "warning",
            "okf",
            "missing-okf-export",
            "tool-library/output/okf/latest.json",
            "No OKF export status exists yet.",
        )
        return
    try:
        latest = json.loads(latest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        audit.add("error", "okf", "invalid-okf-status", str(latest_path), str(error))
        return
    bundle_path = resolve_project_path(latest.get("bundle_path"))
    report_path = resolve_project_path(latest.get("report_path"))
    if not bundle_path.is_dir():
        audit.add(
            "error",
            "okf",
            "missing-okf-bundle",
            str(latest.get("bundle_path") or ""),
            "Latest OKF bundle directory does not exist.",
        )
    if not report_path.is_file():
        audit.add(
            "error",
            "okf",
            "missing-okf-report",
            str(latest.get("report_path") or ""),
            "Latest OKF report does not exist.",
        )
        return
    try:
        report = json.loads(report_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        audit.add("error", "okf", "invalid-okf-report", str(report_path), str(error))
        return
    if not latest.get("conformant") or not report.get("conformance", {}).get("conformant"):
        audit.add(
            "warning",
            "okf",
            "nonconformant-okf-bundle",
            str(latest.get("bundle_path") or ""),
            "Latest bundle did not pass OKF conformance validation.",
        )
    unresolved = int(latest.get("unresolved_link_count") or 0)
    if unresolved:
        audit.add(
            "warning",
            "okf",
            "unresolved-okf-links",
            str(latest.get("report_path") or ""),
            f"Latest bundle contains {unresolved} unresolved link(s).",
        )
    fingerprint = str(report.get("source_fingerprint_sha256") or "")
    if fingerprint and fingerprint != wiki_fingerprint():
        audit.add(
            "warning",
            "okf",
            "stale-okf-export",
            str(latest.get("bundle_path") or ""),
            "The wiki changed after the latest OKF bundle was generated.",
        )
    audit.stats["okf"] = {
        "generated_at": latest.get("generated_at"),
        "conformant": bool(latest.get("conformant")),
        "concept_count": int(latest.get("concept_count") or 0),
        "unresolved_links": unresolved,
    }


def semantic_review_notice(audit: Audit) -> None:
    audit.add(
        "info",
        "evidence",
        "semantic-review-required",
        "wiki/sources",
        "Unsupported or stale scientific claims require an evidence-aware agent review; deterministic lint only checks structural evidence-depth signals.",
    )


def build_report(audit: Audit) -> dict[str, Any]:
    findings = sorted(
        audit.findings,
        key=lambda item: (
            SEVERITY_ORDER[item.severity],
            item.category,
            item.path,
            item.code,
            item.message,
        ),
    )
    severity = Counter(finding.severity for finding in findings)
    categories: dict[str, dict[str, int]] = defaultdict(lambda: {"error": 0, "warning": 0, "info": 0})
    for finding in findings:
        categories[finding.category][finding.severity] += 1
    score = max(0, round(100 - severity["error"] * 8 - severity["warning"] * 1.5))
    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "project_root": str(PROJECT_ROOT),
        "summary": {
            "score": score,
            "errors": severity["error"],
            "warnings": severity["warning"],
            "info": severity["info"],
            "fixable": sum(finding.fixable for finding in findings),
        },
        "categories": dict(sorted(categories.items())),
        "stats": audit.stats,
        "findings": [asdict(finding) for finding in findings],
    }


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path = path.expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, path)


def print_human(report: dict[str, Any]) -> None:
    summary = report["summary"]
    print(
        "Vault lint: "
        f"score {summary['score']}/100, "
        f"{summary['errors']} error(s), "
        f"{summary['warnings']} warning(s), "
        f"{summary['info']} info"
    )
    print("Category summary:")
    for category, counts in report["categories"].items():
        print(
            f"  {category}: {counts['error']} error(s), "
            f"{counts['warning']} warning(s), {counts['info']} info"
        )
    for finding in report["findings"]:
        location = f" {finding['path']}:" if finding["path"] else ""
        fixable = " [low-risk fix candidate]" if finding["fixable"] else ""
        print(
            f"{finding['severity'].upper()} [{finding['category']}/{finding['code']}]"
            f"{location} {finding['message']}{fixable}"
        )


def main() -> int:
    configure_utf8_stdio()
    args = parse_args()
    audit = Audit()
    run_baseline(audit)
    notes = load_notes(audit)
    edges = check_graph_and_duplicates(notes, audit)
    check_source_notes(notes, audit)
    check_code_notes(notes, edges, audit)
    check_okf(audit)
    semantic_review_notice(audit)
    report = build_report(audit)
    if args.report:
        write_json_atomic(args.report, report)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print_human(report)
    if report["summary"]["errors"]:
        return 1
    if args.strict and report["summary"]["warnings"]:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
