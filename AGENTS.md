# AGENTS.md

## Purpose

This workspace is a scientific-paper research workspace split into a tool library and an Obsidian knowledge vault. Keep raw sources, converted Markdown, workflows, templates, scripts, AI-maintained wiki pages, research projects, MOCs, and synthesis notes separate.

This file is written for AI agents. User-facing Markdown content in the vault should still be written in Simplified Chinese unless the user asks otherwise.

## Skill Architecture

Use `research-vault` as the router only when the request is broad or ambiguous. For concrete execution, use the focused child skill that matches the current workflow stage.

Skill locations:

```text
%USERPROFILE%\.codex\skills\research-vault\SKILL.md              # router
%USERPROFILE%\.codex\skills\research-vault-ingest\SKILL.md       # intake, metadata, Zotero/BibTeX, duplicate checks
%USERPROFILE%\.codex\skills\research-vault-convert\SKILL.md      # PDF/HTML/TeX/OCR to Markdown
%USERPROFILE%\.codex\skills\research-vault-source-note\SKILL.md  # source note writing and repair
%USERPROFILE%\.codex\skills\research-vault-xray\SKILL.md         # full-text paper deep reading
%USERPROFILE%\.codex\skills\research-vault-retrieval\SKILL.md    # answer from vault evidence
%USERPROFILE%\.codex\skills\research-vault-synthesis\SKILL.md    # synthesis, MOC, concept/project pages
%USERPROFILE%\.codex\skills\research-vault-code\SKILL.md         # R/Python code project analysis and code notes
%USERPROFILE%\.codex\skills\research-vault-lint\SKILL.md         # vault quality audit and repair
```

## Skill Routing Policy

Use a skill when the task touches the vault workflow, files, metadata, source notes, or evidence maintenance.

- Use `research-vault-ingest` for new Zotero items, local PDFs, DOI/arXiv/URL inputs, BibTeX/RIS records, duplicate checks, metadata normalization, attachment path discovery, `papers.csv`, `references.bib`, and intake depth decisions.
- Use `research-vault-convert` for PDF/HTML/TeX/OCR conversion, MarkItDown/PyMuPDF extraction, converted Markdown creation, and conversion quality checks.
- Use `research-vault-source-note` for creating, rewriting, normalizing, or repairing `knowledge-base/wiki/sources/*.md` source notes.
- Use `research-vault-xray` for full-text paper reading, figure/table/method/data extraction, evidence strength assessment, and upgrading abstract-level notes into deep-read notes.
- Use `research-vault-retrieval` when the user asks what the vault knows, asks for vault-backed definitions, compares imported papers, checks existing evidence, or asks for conclusions grounded only in `knowledge-base/`.
- Use `research-vault-synthesis` for cross-paper comparisons, literature maps, MOCs, research projects, concept/method/dataset synthesis pages, and saved gap analyses.
- Use `research-vault-code` for static analysis of R/Python code projects, script explanation, entrypoint/dependency/input-output mapping, and linked Markdown notes under `knowledge-base/wiki/code/`.
- Use `research-vault-lint` for broken links, duplicate pages, orphan notes, metadata gaps, index consistency, unsupported claims, workflow boilerplate, encoding damage, and graph/index cleanup.

Do not force a vault skill for a normal explanatory answer that does not depend on vault files. For example, a general explanation of a concept, method, disease, tool, statistical model, or experimental technique can use the model's general knowledge and, when useful or required, web search.

## Skill Execution Boundaries

Keep skill use lightweight and stage-owned. Use the router only to select the right stage, then let the focused child skill own concrete execution.

- `research-vault` only routes broad or ambiguous requests and clarifies intent. It should not perform concrete file writes once a child skill clearly owns the task.
- `research-vault-ingest` owns source identity, metadata, duplicate checks, evidence consistency, and metadata/index/log updates. It must not write paper conclusions.
- `research-vault-convert` owns conversion to Markdown and conversion quality checks. It must not infer scientific conclusions beyond what the extracted text exposes.
- `research-vault-source-note` owns `knowledge-base/wiki/sources/*.md` structure, body prose, frontmatter normalization, and source-note repair. It must not pretend abstract-level evidence is full-text deep reading.
- `research-vault-xray` owns full-text deep reading, evidence chains, figure/table/method/data inspection, and upgrading source notes to `x-ray`.
- `research-vault-retrieval` owns vault-grounded answers. It does not write files unless the user explicitly asks to save, update, or maintain results.
- `research-vault-synthesis` owns cross-paper synthesis, MOCs, concept/method/dataset pages, and project pages. It must not do first-pass intake or conversion.
- `research-vault-code` owns static R/Python code project analysis and `knowledge-base/wiki/code/` pages. Project pages own relationships and data flow; script pages should primarily use selected code snippets followed by explanation. It must not modify source code, run project code, install dependencies, or turn static reading into runtime claims unless the user explicitly asks for execution.
- `research-vault-lint` owns audits and consistency repairs. It must report before high-impact fixes and must not bulk-delete files.

Lightweight handoff rules:

- `metadata-only` supports metadata, indexes, gaps, and source paths only; do not generate paper conclusions.
- `abstract-level` supports conservative source-note claims only; do not write it as `x-ray`.
- Mark or upgrade to `x-ray` only after full-text evidence, methods, figures/tables, data/materials, limitations, and evidence chain have been inspected.
- File writes should be performed by the skill that owns that file type or workflow stage.
- Normal background explanations do not require a vault skill unless the user asks for vault evidence or file updates.

## Evidence Source Policy

Always distinguish the evidence source behind an answer or saved note.

### Vault Evidence

Use vault evidence when the user says or implies:

- "in this vault"
- "our papers"
- "based on the imported literature"
- "compare these source notes"
- "what have we collected"
- "update/save this into Obsidian"

Vault evidence includes `knowledge-base/`, `tool-library/converted/markdown/`, tracked metadata files, and raw/source files when explicitly inspected. If vault evidence is insufficient, write `Vault 中未找到足够依据`.

### Model Knowledge

Use model knowledge for stable, general background explanations when the user is not asking for vault-backed evidence or file updates. This is often appropriate for first-pass explanations of concepts and methods.

When using model knowledge, do not present it as a conclusion from the vault. If saving it into the vault, label it as general background or external knowledge, and keep it separate from paper-backed claims.

### Web Evidence

Use web search when the user asks to search, verify, find latest/current information, provide links, or when the topic is likely to have changed. Also use web search for current software/tool behavior, current database documentation, recent papers, publisher/DOI verification, standards, guidelines, and recommendations.

For scientific concepts or methods pages, web search can be better than vault retrieval when the user wants a general, up-to-date reference note rather than "what our imported papers say." Prefer primary or authoritative sources such as papers, official documentation, database documentation, publisher pages, or standards bodies. Clearly mark web-derived content as external evidence, not vault evidence.

If a concept/method page mixes evidence types, separate them explicitly:

- vault-backed claims from imported papers
- general background from model knowledge
- web-verified external references
- unresolved gaps or conflicts

## Hard Rules

- Use `D:\python\python.exe` for Python commands in this vault.
- Read and write Markdown as UTF-8. In PowerShell, prefer `Get-Content -Encoding UTF8`.
- Do not bulk-delete files or directories.
- Do not use `del /s`, `rd /s`, `rmdir /s`, `Remove-Item -Recurse`, or `rm -rf`.
- Delete only one explicitly named file at a time when deletion is truly required.
- Treat `tool-library/raw/` as source-of-truth input. Do not modify files under `tool-library/raw/` unless the user explicitly asks.
- Zotero is read-only by default. Unless the user explicitly asks to import or modify Zotero, only read Zotero metadata, BibTeX, full-text indexes, and attachment paths.
- Do not invent paper claims, methods, metrics, datasets, author intent, or citations.
- Ask before high-impact changes: merging pages, renaming many notes, deleting notes, installing packages, changing schema rules, or replacing a page taxonomy.
- For Chinese-heavy scripts or batch rewrites, save a UTF-8 script file and run it. Avoid large Chinese PowerShell here-strings because they can corrupt text encoding.

## Language And Writing Rules

- User-facing Markdown body prose should default to Simplified Chinese.
- Frontmatter keys, filenames, BibTeX/Zotero keys, code, paths, dataset accessions, English paper titles, stable identifiers, URLs, and necessary original terms should remain unchanged.
- Avoid unnecessary Chinese-English mixing in body prose. Translate English phrases when Chinese is natural and precision is not lost.
- For necessary English technical terms, prefer `中文（English）` on first appearance, then use Chinese or a stable abbreviation by context.
- Exceptions: original paper titles, official method/software names, gene names, dataset IDs, stable abbreviations, code, paths, URLs, citation keys, and direct quotations.
- Preserve exact capitalization for English titles. Use reliable sources such as DOI/publisher pages or the paper title page. Do not auto-normalize titles to lowercase, uppercase, or inferred Title Case.

## Processing Depth

Use explicit depth labels in reasoning and outputs:

- `metadata-only`: only metadata, BibTeX, CSV, indexes, gaps, and source paths are reliable. Do not write paper conclusions.
- `abstract-level`: abstract, title page, highlights, or converted text support conservative source-note conclusions. Do not write figure-level or mechanism-heavy conclusions.
- `x-ray`: full text, methods, figures/tables, data/materials, limitations, and evidence chain have been inspected. Only this level supports strong paper-specific conclusions and cross-paper judgments.

## Source Note Rules

- Source note bodies must describe the paper itself.
- Do not use workflow status as research content. Phrases such as "imported", "not written to Zotero", "batch processed", "converted by MarkItDown", "pending later review", and similar process notes belong in logs, reports, CSV files, field-gap pages, or frontmatter status fields.
- Source-note bibliographic metadata belongs in YAML frontmatter, `tool-library/metadata/papers.csv`, `tool-library/references.bib`, and index files.
- Do not create body `## 元数据` sections or field-value metadata tables that duplicate Obsidian properties.
- Keep the preferred source-note order: `研究问题`, `结论`, then methods/evidence/findings/limitations/links.
- If the note is only `abstract-level`, state that figure-level details remain unverified.

## Local PDF And Metadata Rules

- Local PDF ingest must verify evidence before generating claims.
- PDF title page or converted text must be consistent with DOI/Crossref/publisher metadata.
- Filename-derived clues must not contradict the selected metadata record.
- Zotero/vault existing records must not point to a different paper.
- If metadata conflicts with PDF evidence, stop before writing conclusions. Record the issue in `knowledge-base/字段补全检查.md`, a report, or `knowledge-base/wiki/log.md`.

## Directory Map

```text
AGENTS.md               # workspace-level Codex rules; keep at project root
tool-library/                  # workflows, tools, source material, and intermediate artifacts
  raw/                  # immutable source inbox
    papers/             # non-Zotero PDFs and source packages
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
knowledge-base/                  # Obsidian vault root; open this folder in Obsidian
  .obsidian/            # Obsidian configuration
  文献索引.md
  研究主题索引.md
  研究方法索引.md
  代码项目索引.md
  字段补全检查.md
  wiki/
    sources/            # one note per paper/source
    concepts/           # theories, mechanisms, constructs
    methods/            # methods, models, protocols, statistics
    datasets/           # datasets, cohorts, benchmarks, corpora
    entities/           # people, labs, tools, genes, diseases, places
    projects/           # atomic research ideas and tasks
    code/               # static code project and script notes
      projects/         # one page per code project
      scripts/          # script pages grouped by project slug
    mocs/               # research-area maps
    synthesis/          # cross-paper comparisons and reviews
```

## Retrieval Contract

When answering from vault evidence:

1. Read these first when relevant, skipping missing files:
   - `knowledge-base/文献索引.md`
   - `knowledge-base/研究主题索引.md`
   - `knowledge-base/研究方法索引.md`
   - `knowledge-base/字段补全检查.md`
   - `knowledge-base/wiki/index.md`
2. Use `rg` in `knowledge-base/` to locate candidate Markdown notes.
3. Read the most relevant evidence notes before answering.
4. Base vault-backed conclusions only on vault evidence.
5. Use answer sections such as `结论`, `支持文献`, `差异/争议`, `对我研究的启发`, and `证据缺口` when useful.

## Index And Log Rules

- Append important operations to `knowledge-base/wiki/log.md`.
- Update `knowledge-base/文献索引.md` when source notes change materially.
- Update `knowledge-base/研究主题索引.md` when concepts, projects, MOCs, or synthesis pages change materially.
- Update `knowledge-base/研究方法索引.md` when methods, datasets, metrics, or analysis workflows change materially.
- Update `knowledge-base/代码项目索引.md` and `knowledge-base/wiki/code/index.md` when code project or script pages change materially.
- Update `knowledge-base/字段补全检查.md` for missing or conflicting DOI, URL, PDF, title capitalization, Zotero keys, BibTeX keys, datasets, or source evidence.

## Completion Standard

For ingest, conversion, source-note, x-ray, synthesis, code analysis, or maintenance tasks, finish only after stating:

- files created or updated
- indexes/logs updated or deliberately skipped
- evidence source and processing depth
- evidence gaps or metadata gaps
- code files inspected and whether code was only statically read
- skipped steps and why
- any action that still needs user confirmation
