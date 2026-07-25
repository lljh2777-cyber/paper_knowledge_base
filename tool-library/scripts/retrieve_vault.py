#!/usr/bin/env python3
"""Build a transparent, read-only retrieval cascade for the research vault.

The script discovers lexical seed notes, expands them with personalized
PageRank over Obsidian wikilinks, and falls back to orientation indexes when no
seed is reliable. Optional externally generated keywords can be supplied for a
second retrieval pass. It prints JSON to stdout and never writes vault files.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field
import json
import math
from pathlib import Path, PurePosixPath
import posixpath
import re
import sys
import unicodedata
from typing import Any


WIKILINK_RE = re.compile(r"(?<!!)\[\[([^\[\]]+?)\]\]")
MARKDOWN_LINK_RE = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)")
ENGLISH_TERM_RE = re.compile(r"[a-z0-9][a-z0-9_.+-]*", re.IGNORECASE)
CJK_SEQUENCE_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]+")

STOP_TERMS = {
    "已有",
    "什么",
    "介绍",
    "分析",
    "可以",
    "如何",
    "对比",
    "比较",
    "检索",
    "目前",
    "知识",
    "知识库",
    "解释",
    "说明",
    "请问",
    "这个",
    "这些",
    "那个",
    "那些",
    "是否",
    "有关",
    "关于",
    "根据",
    "中的",
    "and",
    "are",
    "compare",
    "explain",
    "for",
    "from",
    "how",
    "in",
    "of",
    "or",
    "the",
    "to",
    "vault",
    "what",
    "with",
}

FALLBACK_PATHS = (
    "文献索引.md",
    "研究主题索引.md",
    "研究方法索引.md",
    "代码项目索引.md",
    "R知识索引.md",
    "Linux与命令行索引.md",
    "字段补全检查.md",
    "wiki/index.md",
)

NAVIGATION_PATHS = {
    *FALLBACK_PATHS,
    "wiki/log.md",
}


@dataclass
class VaultDocument:
    path: str
    title: str
    title_zh: str
    aliases: list[str]
    body: str
    raw_links: list[str]
    searchable_fields: dict[str, str] = field(default_factory=dict)


def normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).lower()
    return " ".join(normalized.split())


def compact_text(value: str) -> str:
    return re.sub(r"[^\w\u3400-\u4dbf\u4e00-\u9fff]+", "", normalize_text(value))


def strip_markdown(text: str) -> str:
    text = WIKILINK_RE.sub(lambda match: match.group(1).split("|")[-1], text)
    text = MARKDOWN_LINK_RE.sub(" ", text)
    text = re.sub(r"```.*?```", " ", text, flags=re.DOTALL)
    text = re.sub(r"`[^`]*`", " ", text)
    return text


def parse_scalar(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        return value[1:-1]
    return value


def parse_aliases(value: str) -> list[str]:
    value = value.strip()
    if value.startswith("[") and value.endswith("]"):
        return [
            parse_scalar(item)
            for item in value[1:-1].split(",")
            if parse_scalar(item)
        ]
    scalar = parse_scalar(value)
    return [scalar] if scalar else []


def split_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    if not text.startswith("---"):
        return {}, text
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, text
    end = next(
        (index for index in range(1, len(lines)) if lines[index].strip() == "---"),
        None,
    )
    if end is None:
        return {}, text

    metadata: dict[str, Any] = {}
    active_list_key = ""
    for line in lines[1:end]:
        if active_list_key and re.match(r"^\s*-\s+", line):
            item = parse_scalar(re.sub(r"^\s*-\s+", "", line))
            if item:
                metadata.setdefault(active_list_key, []).append(item)
            continue
        active_list_key = ""
        if ":" not in line or line.lstrip().startswith("#"):
            continue
        key, raw_value = line.split(":", 1)
        key = key.strip()
        raw_value = raw_value.strip()
        if not key:
            continue
        if key == "aliases":
            if raw_value:
                metadata[key] = parse_aliases(raw_value)
            else:
                metadata[key] = []
                active_list_key = key
        else:
            metadata[key] = parse_scalar(raw_value)
    return metadata, "\n".join(lines[end + 1 :])


def first_heading(body: str) -> str:
    match = re.search(r"^#\s+(.+?)\s*$", body, flags=re.MULTILINE)
    return match.group(1).strip() if match else ""


def extract_wikilink_target(raw_link: str) -> str:
    target = raw_link.split("|", 1)[0].split("#", 1)[0].strip()
    return target.replace("\\", "/")


def discover_documents(vault_root: Path) -> list[VaultDocument]:
    documents: list[VaultDocument] = []
    for path in sorted(vault_root.rglob("*.md")):
        if any(part.startswith(".") for part in path.relative_to(vault_root).parts):
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        metadata, body = split_frontmatter(text)
        title = str(metadata.get("title") or first_heading(body) or path.stem)
        title_zh = str(metadata.get("title_zh") or "")
        aliases_value = metadata.get("aliases") or []
        aliases = (
            [str(item) for item in aliases_value]
            if isinstance(aliases_value, list)
            else parse_aliases(str(aliases_value))
        )
        raw_links = [
            target
            for target in (
                extract_wikilink_target(match.group(1))
                for match in WIKILINK_RE.finditer(body)
            )
            if target
        ]
        relative_path = path.relative_to(vault_root).as_posix()
        searchable_body = strip_markdown(body)
        documents.append(
            VaultDocument(
                path=relative_path,
                title=title,
                title_zh=title_zh,
                aliases=aliases,
                body=searchable_body,
                raw_links=raw_links,
                searchable_fields={
                    "title": normalize_text(title),
                    "title_zh": normalize_text(title_zh),
                    "aliases": normalize_text(" ".join(aliases)),
                    "path": normalize_text(relative_path),
                    "body": normalize_text(searchable_body),
                },
            )
        )
    return documents


def query_terms(query: str) -> list[str]:
    normalized = normalize_text(query)
    terms: set[str] = set()
    for term in ENGLISH_TERM_RE.findall(normalized):
        if len(term) >= 2 and term not in STOP_TERMS:
            terms.add(term)
    for sequence in CJK_SEQUENCE_RE.findall(normalized):
        if sequence in STOP_TERMS:
            continue
        if 2 <= len(sequence) <= 16:
            terms.add(sequence)
        for size in (2, 3):
            for index in range(0, len(sequence) - size + 1):
                term = sequence[index : index + size]
                if term not in STOP_TERMS:
                    terms.add(term)
    return sorted(terms, key=lambda item: (-len(item), item))


def document_frequency(documents: list[VaultDocument], terms: list[str]) -> dict[str, int]:
    frequency: dict[str, int] = {}
    for term in terms:
        frequency[term] = sum(
            1
            for document in documents
            if any(term in value for value in document.searchable_fields.values())
        )
    return frequency


def score_document(
    document: VaultDocument,
    terms: list[str],
    frequency: dict[str, int],
    document_count: int,
) -> tuple[float, list[str], list[str]]:
    weights = {
        "title": 12.0,
        "title_zh": 14.0,
        "aliases": 10.0,
        "path": 6.0,
        "body": 1.0,
    }
    score = 0.0
    matched_terms: list[str] = []
    matched_fields: set[str] = set()
    for term in terms:
        idf = math.log((document_count + 1) / (frequency.get(term, 0) + 1)) + 1
        term_score = 0.0
        for field_name, field_value in document.searchable_fields.items():
            count = field_value.count(term)
            if count == 0:
                continue
            matched_fields.add(field_name)
            capped_count = min(count, 3) if field_name == "body" else 1
            term_score += weights[field_name] * capped_count
        if term_score:
            length_bonus = 1 + min(max(len(term) - 2, 0), 6) * 0.12
            score += term_score * idf * length_bonus
            matched_terms.append(term)
    return score, matched_terms, sorted(matched_fields)


def lexical_seeds(
    documents: list[VaultDocument],
    query: str,
    seed_limit: int,
    expanded_terms: list[str] | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    terms = query_terms(query)
    for raw_term in expanded_terms or []:
        term = normalize_text(raw_term).strip()
        if 2 <= len(term) <= 80 and term not in STOP_TERMS:
            terms.append(term)
    terms = sorted(set(terms), key=lambda item: (-len(item), item))
    if not terms:
        return [], []
    frequency = document_frequency(documents, terms)
    ranked: list[dict[str, Any]] = []
    for document in documents:
        score, matched_terms, matched_fields = score_document(
            document,
            terms,
            frequency,
            len(documents),
        )
        identity_match = any(
            field in matched_fields
            for field in ("title", "title_zh", "aliases", "path")
        )
        minimum_score = 12.0 if identity_match else 35.0
        if score < minimum_score:
            continue
        ranked.append(
            {
                "path": document.path,
                "title": document.title,
                "title_zh": document.title_zh,
                "score": round(score, 2),
                "matched_terms": matched_terms[:8],
                "matched_in": matched_fields,
            }
        )
    ranked.sort(key=lambda item: (-item["score"], item["path"]))
    return ranked[:seed_limit], terms


def path_without_suffix(path: str) -> str:
    return str(PurePosixPath(path).with_suffix(""))


def build_resolution_index(documents: list[VaultDocument]) -> dict[str, list[str]]:
    index: dict[str, set[str]] = {}
    for document in documents:
        keys = {
            normalize_text(document.path),
            normalize_text(path_without_suffix(document.path)),
            normalize_text(PurePosixPath(document.path).stem),
            normalize_text(document.title),
            normalize_text(document.title_zh),
            *(normalize_text(alias) for alias in document.aliases),
        }
        for key in keys:
            if key:
                index.setdefault(key, set()).add(document.path)
    return {key: sorted(paths) for key, paths in index.items()}


def resolve_link(
    source_path: str,
    raw_target: str,
    resolution_index: dict[str, list[str]],
) -> str | None:
    target = raw_target.strip().removesuffix(".md")
    if not target:
        return None
    source_parent = PurePosixPath(source_path).parent
    relative_candidate = str(source_parent.joinpath(target))
    normalized_relative = posixpath.normpath(relative_candidate)
    candidates = (
        normalize_text(normalized_relative),
        normalize_text(target),
        normalize_text(f"wiki/{target}"),
        normalize_text(PurePosixPath(target).name),
    )
    for candidate in candidates:
        matches = resolution_index.get(candidate, [])
        if len(matches) == 1:
            return matches[0]
    suffix = normalize_text(target).strip("/")
    suffix_matches = sorted(
        {
            path
            for key, paths in resolution_index.items()
            if key.endswith(f"/{suffix}") or key == suffix
            for path in paths
        }
    )
    return suffix_matches[0] if len(suffix_matches) == 1 else None


def build_graph(documents: list[VaultDocument]) -> dict[str, set[str]]:
    resolution_index = build_resolution_index(documents)
    graph: dict[str, set[str]] = {document.path: set() for document in documents}
    for document in documents:
        for target in document.raw_links:
            resolved = resolve_link(document.path, target, resolution_index)
            if resolved and resolved != document.path:
                graph[document.path].add(resolved)
    return graph


def personalized_pagerank(
    graph: dict[str, set[str]],
    seed_weights: dict[str, float],
    damping: float = 0.85,
    iterations: int = 40,
) -> dict[str, float]:
    """Rank the wikilink graph around lexical seeds without external packages."""
    nodes = sorted(graph)
    if not nodes or not seed_weights:
        return {}

    undirected = {node: set(targets) for node, targets in graph.items()}
    for source, targets in graph.items():
        for target in targets:
            undirected.setdefault(target, set()).add(source)

    normalized_weights = {
        node: max(float(weight), 0.0)
        for node, weight in seed_weights.items()
        if node in undirected
    }
    weight_total = sum(normalized_weights.values())
    if weight_total <= 0:
        return {}
    personalization = {
        node: normalized_weights.get(node, 0.0) / weight_total
        for node in nodes
    }
    ranks = dict(personalization)

    for _ in range(max(iterations, 1)):
        next_ranks = {
            node: (1.0 - damping) * personalization[node]
            for node in nodes
        }
        dangling_mass = sum(
            ranks.get(node, 0.0)
            for node in nodes
            if not undirected.get(node)
        )
        for node in nodes:
            if personalization[node]:
                next_ranks[node] += damping * dangling_mass * personalization[node]
        for source in nodes:
            neighbors = undirected.get(source, set())
            if not neighbors:
                continue
            contribution = damping * ranks.get(source, 0.0) / len(neighbors)
            for target in neighbors:
                next_ranks[target] = next_ranks.get(target, 0.0) + contribution
        ranks = next_ranks
    return ranks


def expand_graph(
    documents: list[VaultDocument],
    seeds: list[dict[str, Any]],
    graph_limit: int,
) -> list[dict[str, Any]]:
    if not seeds:
        return []
    documents_by_path = {document.path: document for document in documents}
    graph = build_graph(documents)
    seed_paths = {seed["path"] for seed in seeds}
    ranks = personalized_pagerank(
        graph,
        {seed["path"]: float(seed["score"]) for seed in seeds},
    )
    expanded: list[dict[str, Any]] = []
    for candidate_path, rank in ranks.items():
        if (
            candidate_path in seed_paths
            or candidate_path in NAVIGATION_PATHS
            or rank <= 0
        ):
            continue
        linked_seeds = [
            seed["path"]
            for seed in seeds
            if (
                candidate_path in graph.get(seed["path"], set())
                or seed["path"] in graph.get(candidate_path, set())
            )
        ]
        expanded.append(
            {
                "path": candidate_path,
                "title": documents_by_path[candidate_path].title,
                "title_zh": documents_by_path[candidate_path].title_zh,
                "score": round(rank, 8),
                "via": linked_seeds[:4],
            }
        )
    expanded.sort(key=lambda item: (-item["score"], item["path"]))
    return expanded[:graph_limit]


def fallback_candidates(vault_root: Path) -> list[str]:
    return [path for path in FALLBACK_PATHS if (vault_root / path).is_file()]


def retrieve(
    project_root: Path,
    query: str,
    seed_limit: int = 8,
    graph_limit: int = 12,
    expanded_terms: list[str] | None = None,
) -> dict[str, Any]:
    vault_root = project_root / "knowledge-base"
    if not vault_root.is_dir():
        raise FileNotFoundError(f"Knowledge base not found: {vault_root}")
    documents = discover_documents(vault_root)
    normalized_expanded_terms = [
        normalize_text(term).strip()
        for term in expanded_terms or []
        if normalize_text(term).strip()
    ][:10]
    seeds, terms = lexical_seeds(
        documents,
        query,
        seed_limit,
        normalized_expanded_terms,
    )
    graph_candidates = expand_graph(documents, seeds, graph_limit)
    fallback = fallback_candidates(vault_root) if not seeds else []
    if seeds and normalized_expanded_terms:
        stage = "llm-keyword+ppr"
        retrieval_label = "LLM+PPR"
    elif seeds:
        stage = "lexical-seed+ppr"
        retrieval_label = "Lex+PPR"
    else:
        stage = "no-match-fallback"
        retrieval_label = "NoMatch+Index"
    return {
        "schema_version": 2,
        "query": query.strip(),
        "stage": stage,
        "retrieval_label": retrieval_label,
        "document_count": len(documents),
        "query_terms": terms[:20],
        "keyword_expansion": {
            "used": bool(normalized_expanded_terms),
            "terms": normalized_expanded_terms,
        },
        "lexical_seeds": seeds,
        "graph_expansion": graph_candidates,
        "fallback": {
            "used": not bool(seeds),
            "reason": (
                ""
                if seeds
                else "No reliable lexical seed was found; inspect orientation indexes before broader rg search."
            ),
            "paths": fallback,
        },
        "candidate_paths": [
            *(seed["path"] for seed in seeds),
            *(candidate["path"] for candidate in graph_candidates),
            *fallback,
        ],
        "evidence_notice": (
            "Candidates are routing hints only. Read the selected notes directly "
            "before making vault-backed claims."
        ),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=Path.cwd())
    parser.add_argument("--query", default="")
    parser.add_argument("--seed-limit", type=int, default=8)
    parser.add_argument("--graph-limit", type=int, default=12)
    parser.add_argument(
        "--expanded-term",
        action="append",
        default=[],
        help="Optional externally generated keyword; repeat for multiple terms.",
    )
    return parser.parse_args()


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    args = parse_args()
    query = args.query if args.query else sys.stdin.read()
    if not query.strip():
        raise ValueError("Retrieval query is empty")
    result = retrieve(
        args.project_root.expanduser().resolve(),
        query,
        seed_limit=max(args.seed_limit, 1),
        graph_limit=max(args.graph_limit, 0),
        expanded_terms=args.expanded_term,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (FileNotFoundError, ValueError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2) from error
