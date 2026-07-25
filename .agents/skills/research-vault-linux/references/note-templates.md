# Linux and command-line note templates

Read and use only the template needed for the current task. Delete empty placeholders and irrelevant sections. Do not invent content to fill the template.

## Contents

- [Rules shared by every template](#rules-shared-by-every-template)
- [Command or command family](#command-or-command-family-linux-command)
- [Shell mechanism](#shell-mechanism-shell-concept)
- [Task recipe](#task-recipe-cli-recipe)
- [Bioinformatics software](#bioinformatics-software-bio-software)
- [File format](#file-format-bio-format)
- [Index entry](#index-entry)

## Rules shared by every template

- Write the user-facing body in Simplified Chinese.
- Put one complete, small example before dense terminology or option tables.
- Define each technical term in plain Chinese and connect it to a concrete value from the example.
- Every substantive command example must show the named input file or explicit stdin, the command, the expected or actual output, and a short explanation.
- Never mention only `input.tsv`, `file.txt`, or `output.txt` without showing its relevant contents.
- For `docs-checked`, label hand-derived output as `预期输出（根据文档推导，未在本地 Linux 环境运行）`.
- Use `实际输出` only for a command that was actually run successfully in the recorded environment.
- State delimiters and make invisible whitespace visible when it affects understanding.
- A copyable TSV block must contain real Tab characters and say so. If `·`, `→`, `⇥`, or another visible marker is used, label it as a visualization only and also provide a copyable block or file-creation command with the real delimiter.
- Introduce the safe common path before destructive, advanced, or implementation-specific variants.

## Command or command family: `linux-command`

```markdown
---
title: <command>
type: linux-command
command: <command>
implementations: [<GNU|BSD|BusyBox|POSIX>]
version_checked:
source_basis: [official-docs]
verification: docs-checked
related_shell:
related_recipes:
related_software:
related_formats:
related_code:
tags: [linux, command-line, linux-command]
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# <command>

## 一句话定位

Explain the command in everyday Chinese and state when to choose a different tool.

## 先看一个完整例子

Name the input file and show its exact relevant content:

```text
<small complete input>
```

State the task in one sentence.

```bash
<complete copyable command>
```

预期输出（根据文档推导，未在本地 Linux 环境运行）：

```text
<exact expected output>
```

Explain each important command part in plain Chinese.

## 用这个例子理解术语

| 术语 / 写法 | 白话解释 | 在上面例子中的值或作用 |
|---|---|---|

## 基本形式

Use placeholders only here, because this is explicitly syntax rather than a teaching example.

```bash
<command> <options> <arguments>
```

## 高频选项

| 选项 | 白话解释 | 例子或注意事项 |
|---|---|---|

## 更多完整例子

For each example repeat: input → task → command → expected/actual output → explanation.

## 输入、输出与退出状态

| 项目 | 白话解释 |
|---|---|
| 标准输入（stdin） | Explain where input comes from in ordinary usage. |
| 标准输出（stdout） | Explain what appears in the terminal or redirected file. |
| 标准错误（stderr） | Explain what diagnostic messages are. |
| 退出状态 | Explain each important status in task language. |

## 常见陷阱

Use concrete bad/good examples where useful.

## 实现与版本差异

Distinguish POSIX, GNU, BSD, BusyBox, or other relevant implementations.

## 相关笔记

## 来源与验证

- 来源：
- 验证等级：
- 核对日期：
- 示例输出性质：
- 运行环境（仅 `locally-run`）：
- 尚未验证：
```

Do not turn a command page into a full manual. Teach the mental model, common safe path, and representative examples; move complex tasks into recipe pages.

## Shell mechanism: `shell-concept`

```markdown
---
title: <Shell 机制中文标题>
type: shell-concept
shells: [<POSIX-sh|bash|zsh>]
version_checked:
source_basis: [official-docs]
verification: docs-checked
related_commands:
related_recipes:
related_code:
tags: [linux, shell, shell-concept]
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# <Shell 机制中文标题>

## 一句话说明

## 先看一个完整例子

Show any required files, variables, or directory state.

```bash
<complete command or script>
```

预期输出（根据文档推导，未在本地 Linux 环境运行）：

```text
<expected output>
```

## 用这个例子理解术语

| 术语 | 白话解释 | 在例子中的表现 |
|---|---|---|

## Shell 实际按什么顺序处理

Explain parsing, expansion, redirection, execution, or status propagation step by step.

## 对实际脚本的影响

## 常见错误

## 可移植性与 Shell 差异

## 相关笔记

## 来源与验证

- 来源：
- 验证等级：
- 示例输出性质：
- 运行环境（仅 `locally-run`）：
```

Use this type for quoting, expansion, pipelines, redirection, exit status, arrays, functions, signals, and job control. Do not write it as an unexplained command list.

## Task recipe: `cli-recipe`

```markdown
---
title: <任务型中文标题>
type: cli-recipe
shells: [<bash>]
commands: [<command>]
software:
platforms: [<Linux|WSL|container>]
source_basis: [official-docs]
verification: <untested|docs-checked|locally-run|project-used>
tested_environment:
destructive_risk: <none|low|medium|high>
related_commands:
related_shell:
related_software:
related_formats:
related_methods:
related_code:
tags: [linux, command-line, cli-recipe]
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# <任务型中文标题>

## 要解决的问题

Describe the input, desired result, and when this recipe applies.

## 示例输入

Show the exact small files, directory tree, or stdin. State delimiters and encoding assumptions.

```text
<input>
```

## 前置条件

| 项目 | 要求 |
|---|---|
| 输入 | |
| 文件结构或格式 | |
| 环境与依赖 | |
| 输出位置 | |

## 风险与试运行

State overwrite, deletion, movement, permission, and resource risks. Show a preview or dry run first when applicable.

## 可直接使用的命令或脚本

```bash
<complete command or script>
```

## 预期输出

```text
<exact small output, or a clearly described variable structure>
```

Label whether this is expected or actual output.

## 分步解释

1.

## 结果检查

```bash
<validation command>
```

Show what a passing check looks like.

## 常见错误

| 症状 / 错误 | 原因 | 处理方式 |
|---|---|---|

## 性能与资源

## 常用变体

## 相关笔记

## 来源与验证

- 来源：
- 验证等级：
- 示例输出性质：
- 运行环境（仅 `locally-run`）：
- 尚未验证：
```

A recipe must be copyable and self-contained. It must declare the input contract, output, dependencies, safety boundary, and result checks.

## Bioinformatics software: `bio-software`

```markdown
---
title: <software>
type: bio-software
software: <software>
category: <QC|alignment|quantification|format-processing|workflow|other>
version_checked:
platforms_checked:
source_basis: [official-docs]
verification: docs-checked
related_commands:
related_recipes:
related_formats:
related_methods:
related_code:
tags: [linux, bioinformatics, bio-software]
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# <software>

## 一句话定位

Explain what the software does and does not do in plain Chinese.

## 先看一个最小工作例子

Show a tiny valid input or its exact structure. For binary inputs, show a safe inspection view and state that it is not the raw binary content.

```bash
<complete command>
```

预期输出（根据文档推导，未在本地 Linux 环境运行）：

```text
<output files, log lines, or report structure>
```

## 用这个例子理解术语

| 术语 | 白话解释 | 在例子中的值或文件 |
|---|---|---|

## 安装入口与版本检查

Record only currently supported official installation methods. Do not install without confirmation.

```bash
<software> --version
```

## 输入、输出与文件要求

| 输入 / 输出 | 格式 | 白话说明与关键约束 |
|---|---|---|

## 核心模块或子命令

| 模块 / 子命令 | 作用 | 输入 → 输出 | 详细实战 |
|---|---|---|---|

## 典型工作流

1.

## 线程、内存与临时文件

## 日志、QC 与结果检查

## 常见陷阱与版本差异

## 在知识库中的实战

## 相关科研方法与代码项目

## 来源与验证

- 来源：
- 验证等级：
- 核对版本/日期：
- 示例输出性质：
- 运行环境（仅 `locally-run`）：
```

The software page is a navigation hub. Link algorithmic principles to method pages, real parameters to code pages, and complete reusable tasks to recipes.

## File format: `bio-format`

```markdown
---
title: <format>
type: bio-format
format: <format>
specification_checked:
source_basis: [format-specification]
verification: docs-checked
related_formats:
related_software:
related_recipes:
related_methods:
related_code:
tags: [linux, bioinformatics, bio-format]
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# <format>

## 一句话定位

## 先看一个最小文件

Show exact text content when the format is textual. For binary formats, show a safe textual inspection and say what produced it.

```text
<small input or inspection output>
```

## 逐列或逐部分解释

| 位置 / 字段 | 在例子中的值 | 白话含义 | 必需性与约束 |
|---|---|---|---|

## 坐标与方向约定

Use a numeric worked example, not only abstract terms.

## 排序、压缩与索引要求

## 验证与转换

Show input, command, and expected/actual output for each substantive example.

```bash
<validation or conversion command>
```

## 常见变体与兼容性

## 常见陷阱

## 相关软件与实战

## 来源与验证

- 规范或维护方文档：
- 核对版本/日期：
- 示例输出性质：
- 尚未验证：
```

The format page documents the cross-tool file contract. Do not duplicate a software manual or turn it into a dataset page.

## Index entry

Keep index entries short and do not duplicate note bodies:

```markdown
| 页面 | 类型 | 解决的问题 | 来源 / 验证 |
|---|---|---|---|
| [[wiki/linux/recipes/<slug>|<标题>]] | 实战 | <一句话> | `official-docs` / `docs-checked` |
```

Group entries by commands, Shell, recipes, software, and formats. Keep the top-level index selective and the complete inventory in `wiki/linux/index.md`.
