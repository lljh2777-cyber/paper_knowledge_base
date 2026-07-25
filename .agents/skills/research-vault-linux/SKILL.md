---
name: research-vault-linux
description: Create, revise, organize, and maintain the Linux and command-line learning section of the scientific-paper Obsidian vault. Use for Unix command notes, Shell language and execution concepts, task-oriented CLI recipes, bioinformatics software notes, operational file-format notes, Linux knowledge indexes, and links to code projects or scientific method pages. Write beginner-readable Chinese notes with fully shown example inputs and outputs. Do not use for whole-project code analysis, scientific-method explanations, or general Linux answers that do not require vault files.
---

# Research Vault Linux

Maintain the vault's “Linux and Command Line” learning section. Keep reusable command-line knowledge separate from scientific-method explanations and project-specific code while connecting them with wikilinks.

## Owned files

```text
knowledge-base/Linux与命令行索引.md
knowledge-base/wiki/linux/index.md
knowledge-base/wiki/linux/commands/
knowledge-base/wiki/linux/shell/
knowledge-base/wiki/linux/recipes/
knowledge-base/wiki/linux/software/
knowledge-base/wiki/linux/formats/
```

## Routing boundaries

- Use this skill for reusable Unix commands, Shell behavior, CLI tasks, bioinformatics software interfaces, and operational file-format knowledge.
- Use `research-vault-code` for real project entry points, script relationships, parameters, dependencies, and data flow. Link those pages instead of duplicating them.
- Keep algorithmic principles, experimental design, statistical assumptions, and scientific applicability in `wiki/methods/`.
- Use `research-vault-r` for R packages, functions, objects, and R-specific recipes.
- Do not install software, modify real projects, run large data workflows, or execute destructive commands without explicit user authorization.

## Page types and granularity

| Type | Directory | Use when | Granularity |
|---|---|---|---|
| `linux-command` | `commands/` | Explain one Unix command, small language, or tightly related command family | One command or family per page |
| `shell-concept` | `shell/` | Explain Shell syntax, expansion, or execution behavior | One stable mechanism per page |
| `cli-recipe` | `recipes/` | Answer how to complete one concrete CLI task safely | One task per page; prefer this for task-shaped requests |
| `bio-software` | `software/` | Explain one bioinformatics or upstream/downstream CLI tool | One software package per page |
| `bio-format` | `formats/` | Explain fields, coordinates, sorting, compression, or indexing contracts | One stable format or tight format family per page |

Do not create one page per trivial flag or subcommand. Keep common flags on the command or software page. Create a recipe when a task needs its own input contract, complete command, output, and checks.

Use lowercase ASCII kebab-case filenames:

- `commands/grep.md`
- `shell/quoting-and-expansion.md`
- `recipes/filter-tsv-by-column.md`
- `software/samtools.md`
- `formats/bam.md`

## Mandatory reader-first writing rules

User-facing note bodies must be in Simplified Chinese. Technical names, commands, flags, field names, errors, and official software names remain unchanged.

### Explain before naming

- Start with `一句话定位`, then show one small complete example before introducing a terminology table or option catalog.
- Introduce each technical term as `plain-language meaning（technical term）` and tie it to a value from the example.
- Never use terms such as “record”, “field”, “pattern space”, “exit status”, “standard input”, or “file contract” without immediately explaining what they mean in the current example.
- Prefer “当前这一行的第 1 列” before “字段 `$1`”, and “从文件开头连续数到当前行” before “全局记录号”.
- Keep advanced implementation details after the beginner explanation and examples.

### Every command example needs an input-output contract

For every substantive command example, include all applicable items in this order:

1. A meaningful filename and the exact small input content.
2. The task in one plain sentence.
3. The complete copyable command.
4. The exact expected or actual output.
5. A short explanation of each important command part.

Do not write only `input.tsv`, `file.txt`, or `output.txt` without showing what those files contain. Syntax-only placeholders are allowed only in a clearly labeled syntax section, not as teaching examples.

Use this output label when documentation was checked but the command was not run:

```text
预期输出（根据文档推导，未在本地 Linux 环境运行）：
```

Use `实际输出` only after successful execution in the recorded target environment. Never present a hand-derived output as observed output.

If output is binary, extremely large, or environment-dependent, show a safe inspection command and a representative structure, then state exactly what is omitted or variable.

### Make whitespace and file structure visible

- State whether columns are separated by Tab, spaces, commas, or another delimiter.
- When invisible characters matter, say how they are represented in the note, for example “`·` represents a space in the display”.
- For copyable tabular input, put real Tab characters in the code block and state that explicitly. If visible symbols such as `·`, `→`, or `⇥` are used, label the block as a visualization only and also provide either a copyable block with real delimiters or a command that creates the file.
- For directory-recursion examples, show the relevant directory tree or the contents of each small input file.
- Use scientifically meaningful but tiny examples such as sample IDs, genes, logs, BAM paths, and configuration files.

### Optimize for learning, not manual completeness

- Teach the mental model and the safest common path before listing flags.
- Explain why a command produced the shown output.
- Keep option tables selective; route uncommon or advanced behavior to later sections.
- Prefer concrete wording over compressed jargon. A technically accurate sentence is still inadequate if a beginner cannot identify its referent in the example.

## Workflow

1. Read `knowledge-base/Linux与命令行索引.md`, `knowledge-base/wiki/linux/index.md`, and relevant existing notes.
2. Use `rg` to check for duplicates and existing code, method, R, software, or format pages worth linking.
3. Select the page type and granularity. Ask before bulk renaming, moving, or reclassifying pages.
4. Determine source, implementation, and verification level. For current flags, versions, deprecations, installation methods, or format rules, check official documentation, man pages, specifications, or official repositories.
5. Read only the relevant template in [note-templates.md](references/note-templates.md).
6. Draft the complete input-command-output example first, then write terminology and reference sections around it.
7. Connect command ↔ Shell ↔ recipe ↔ software ↔ format pages and link code, method, and R pages when relevant.
8. Update `Linux与命令行索引.md`, `wiki/linux/index.md`, the Linux section of `wiki/index.md`, and `wiki/log.md` after material changes.
9. Validate frontmatter, wikilinks, code fences, UTF-8, source labels, environment labels, example consistency, and destructive-risk warnings.

## Sources and verification

Use one or more `source_basis` values:

- `official-docs`: official software documentation, repository, or maintained manual.
- `man-page`: the target implementation's manual page or its official online equivalent.
- `format-specification`: an official format specification or maintainer documentation.
- `vault-code-static-read`: evidence from existing code notes or static source reading; this does not prove successful execution.
- `user-provided`: user-provided code, explanation, or confirmed experience.
- `model-knowledge`: stable background knowledge kept distinct from official or vault evidence.

Use one `verification` value:

- `untested`: no example was run and current behavior was not fully checked.
- `docs-checked`: syntax and behavior were checked against authoritative documentation, but examples were not run in the target environment.
- `locally-run`: a minimal example succeeded on isolated test data; record OS, Shell, implementation, and versions.
- `project-used`: the user confirmed successful use in a real project. Static code presence is insufficient.

Do not treat PowerShell-compatible behavior as Linux/GNU verification. Distinguish POSIX, Bash, Zsh, GNU, BSD, BusyBox, WSL, and container environments.

## Safety rules

- Default to non-destructive examples.
- For overwrite, deletion, movement, permissions, or bulk changes, show a preview or dry run first and label the risk clearly.
- State input path, output path, overwrite behavior, and result checks.
- Consider quoted paths, spaces, wildcards, newline-containing filenames, locale, encoding, exit status, and pipeline failure propagation.
- Do not invent console output, logs, performance, or successful execution.
- Do not copy long blocks from official documentation or real project source code.

## Cross-section model

```text
Method page: algorithm, experimental design, assumptions, scientific limits
Linux page: command behavior, software interface, file contract, reusable task
Code page: real project scripts, parameters, dependencies, and data flow
R page: R packages, functions, object behavior, and R recipes
```

## Completion checklist

Report:

- Linux notes created or updated;
- Linux indexes, global index, and log updated or deliberately skipped;
- `source_basis`, target implementation, and `verification`;
- whether commands were run and, if so, OS, Shell, implementation, and versions;
- unresolved platform, dependency, input-format, or resource gaps;
- steps skipped because of safety boundaries or missing authorization.
