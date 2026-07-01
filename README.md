# Paper Knowledge Base

这是一个面向科研论文处理的 Obsidian 知识库工作流仓库。仓库只保存适合复用和版本管理的部分：项目级 AI 规则、工具脚本、模板和流程说明；原始论文、转换全文、个人 Obsidian 知识库和本机文献元数据默认不提交。

## Workspace Layout

本地工作区采用“tool-library + knowledge-base”的双目录结构：

```text
AGENTS.md               # 项目级 AI 操作规则
README.md
tool-library/                  # 可复用工具、模板、脚本和说明
knowledge-base/                  # Obsidian vault，本地知识内容，默认不提交
```

推荐在 Obsidian 中只打开：

```text
D:\Obsidian Vault\paper-knowledge-base\knowledge-base
```

这样 Obsidian 图谱主要展示处理后的知识文件，而不是工具、脚本、流程说明和中间产物。

## Repository Scope

提交到 Git 的内容包括：

- `AGENTS.md`：当前工作区的 AI 操作约束、skill 路由、证据来源策略和目录规则。
- `README.md`：仓库说明。
- `tool-library/docs/`：流程、工具和说明文档。
- `tool-library/scripts/`：适合公开复用的通用验证和维护脚本。
- `tool-library/templates/`：source note、研究项目和综合分析模板。

默认不提交：

- `knowledge-base/`：Obsidian vault、知识笔记、本地插件配置。
- `tool-library/raw/`：PDF、网页剪藏、导入包等原始材料。
- `tool-library/converted/`：PDF/HTML/TeX 转换得到的全文 Markdown。
- `tool-library/output/`：生成报告和临时输出。
- `tool-library/metadata/`：`papers.csv`、导入报告等本机处理记录。
- `tool-library/references.bib`：可能包含本机 Zotero key、PDF 路径或个人文献库信息。

## Skill Architecture

本工作区使用一个总控 skill 和多个子 skill。`research-vault` 只做路由；具体任务由 focused child skill 执行。

```text
research-vault                  # 总控路由
research-vault-ingest           # 入库、元数据、Zotero/BibTeX、去重
research-vault-convert          # PDF/HTML/TeX/OCR 转 Markdown
research-vault-source-note      # source note 生成、结构修复、中文正文
research-vault-xray             # 全文深读、图表/方法/数据级分析
research-vault-retrieval        # 只基于 vault 证据回答问题
research-vault-synthesis        # 综述、MOC、项目、概念/方法页
research-vault-lint             # 链接、重复、元数据、流程话术、unsupported claims 检查
```

本地 skill 默认位于：

```text
%USERPROFILE%\.codex\skills\
```

## Evidence Policy

`AGENTS.md` 明确区分三种证据来源：

- `Vault Evidence`：来自 `knowledge-base/`、`tool-library/converted/markdown/`、元数据记录和明确检查过的原始来源。
- `Model Knowledge`：适合稳定的通用概念、方法、技术背景说明。
- `Web Evidence`：适合当前信息、权威链接、数据库/工具文档、近期论文、标准和指南。

如果用户询问的是通用 concept、method、tool 或背景知识，不必强行从已导入文献中找说明；可以使用模型知识，必要时联网核验。若把这些内容保存进 vault，需要明确标注为外部知识或通用背景，不能冒充 vault 文献证据。

## Processing Depth

论文处理必须区分深度：

- `metadata-only`：只记录元数据、BibTeX、CSV、索引和缺口，不写论文结论。
- `abstract-level`：基于摘要、标题页、highlights 或转换稿写保守结论。
- `x-ray`：读全文、方法、图表、数据、局限和证据链后，才能写强结论和跨文献判断。

当前批量导入笔记通常是 `abstract-level`，不能等同于全文深读。

## Important Rules

- Python 命令使用 `D:\python\python.exe`。
- Markdown 读写使用 UTF-8。
- 最终写入 Obsidian/vault 的 Markdown 正文默认使用简体中文。
- 英文论文标题、路径、DOI、BibTeX/Zotero key、数据集编号、代码和 URL 保持原样。
- Zotero 默认只读；除非明确要求，不向 Zotero 写入 PDF 或新条目。
- `tool-library/raw/` 视为原始输入，不主动修改。
- 禁止批量删除文件或目录。

## Scripts

当前提交到仓库的通用脚本包括：

```text
tool-library/scripts/validate_vault.py
```

本地工作区可能还有一次性批处理脚本，例如 Zotero 批量导入、本地 PDF 导入、旧笔记修复或结论重排脚本。这些脚本可能包含本机路径、个人文献库信息或一次性改写内容，默认不作为公开仓库内容提交。

本地验证：

```powershell
D:\python\python.exe tool-library\scripts\validate_vault.py
```

验证脚本会检查目录结构、source note 结构、frontmatter、索引覆盖、BibTeX/CSV 关系、Obsidian 图谱配置和常见流程污染。

## Typical Workflow

1. Zotero 或本地 PDF 进入 `research-vault-ingest` 做查重、元数据和路径记录。
2. 需要全文文本时，用 `research-vault-convert` 生成 `tool-library/converted/markdown/`。
3. 生成或修复 source note 时，用 `research-vault-source-note`。
4. 高价值论文需要真正用于研究判断时，用 `research-vault-xray` 做全文深读。
5. 回答“我们的库里怎么看”时，用 `research-vault-retrieval`。
6. 写综述、MOC、项目页或概念页时，用 `research-vault-synthesis`。
7. 批量导入或大改后，用 `research-vault-lint` 和 `validate_vault.py` 审查。
