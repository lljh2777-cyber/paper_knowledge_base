# AGENTS.md

## Purpose

This workspace is a scientific-paper research workspace split into a tool library and an Obsidian knowledge vault. Keep raw sources, converted Markdown, workflows, templates, scripts, AI-maintained wiki pages, research projects, MOCs, and synthesis notes separate.

Use the global Codex skill `research-vault` for concrete paper ingest, PDF-to-Markdown conversion, Zotero/BibTeX handling, paper X-Ray analysis, evidence-grounded retrieval, synthesis, and lint workflows.

Skill location:

```text
%USERPROFILE%\.codex\skills\research-vault\SKILL.md
```

## Hard Rules

- Use `D:\python\python.exe` for Python commands in this vault.
- Read and write Markdown as UTF-8. In PowerShell, prefer `Get-Content -Encoding UTF8`.
- Markdown 正文默认使用简体中文；frontmatter 键名、文件名、BibTeX/Zotero key、代码、路径、数据集编号、英文标题和必要原文术语保持原样。
- 英文标题必须明确大小写：按可靠来源逐字保留原始 capitalization，不自动改成全小写、全大写或自行 Title Case；来源不一致时优先 DOI/出版社页面/论文首页，并在元数据缺口中记录不确定性。
- Do not bulk-delete files or directories.
- Do not use `del /s`, `rd /s`, `rmdir /s`, `Remove-Item -Recurse`, or `rm -rf`.
- Delete only one explicitly named file at a time when deletion is truly required.
- Treat `工具库/raw/` as source-of-truth input. Do not modify files under `工具库/raw/` unless the user explicitly asks.
- Do not invent paper claims, methods, metrics, datasets, author intent, or citations.
- If vault evidence is insufficient, write `Vault 中未找到足够依据`.
- Ask before high-impact changes: merging pages, renaming many notes, deleting notes, installing packages, or changing schema rules.

## Directory Map

```text
AGENTS.md               # workspace-level Codex rules; keep at project root
工具库/                  # workflows, tools, source material, and intermediate artifacts
  raw/                  # immutable source inbox
    papers/             # PDFs and source packages
    preprints/          # bioRxiv/medRxiv/arXiv tracking material
    web/                # web clips and HTML captures
    imports/            # RIS, BibTeX, Zotero exports
    assets/             # source images and attachments
  converted/markdown/   # conversion output before AI analysis
  templates/            # note templates
  metadata/             # processing records such as papers.csv
  scripts/              # workspace-local helpers and validation
  output/               # generated reports
  docs/                 # workflow/tool explanations
  references.bib        # Zotero/BibTeX export
知识库/                  # Obsidian vault root; open this folder in Obsidian
  .obsidian/            # Obsidian configuration
  文献索引.md
  研究主题索引.md
  研究方法索引.md
  字段补全检查.md
  wiki/
    sources/            # one note per paper/source
    concepts/           # theories, mechanisms, constructs
    methods/            # methods, models, protocols, statistics
    datasets/           # datasets, cohorts, benchmarks, corpora
    entities/           # people, labs, tools, genes, diseases, places
    projects/           # atomic research ideas and tasks
    mocs/               # research-area maps
    synthesis/          # cross-paper comparisons and reviews
```

## Index Files

Read these first for retrieval and orientation:

1. `知识库/文献索引.md`
2. `知识库/研究主题索引.md`
3. `知识库/研究方法索引.md`
4. `知识库/字段补全检查.md`
5. `知识库/wiki/index.md`

Append important operations to `知识库/wiki/log.md`.

## Default Retrieval Contract

When the user asks what the vault knows, compare papers, define a concept, or assess evidence:

1. Read the index files above, skipping missing files.
2. Use `rg` in `知识库/` to locate candidate Markdown notes.
3. Read the most relevant evidence notes before answering.
4. Base conclusions only on vault evidence.
5. Default answer sections: `结论`, `支持文献`, `差异/争议`, `对我研究的启发`, and `证据缺口` when needed.

## Completion Standard

For ingest, synthesis, or maintenance tasks, finish only after stating:

- files created or updated
- indexes/logs updated or deliberately skipped
- evidence gaps or metadata gaps
- any action that still needs user confirmation
