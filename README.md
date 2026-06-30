# Paper Knowledge Base

这是一个科研知识库工作流仓库，用于保存可复用的流程说明、模板、脚本和项目级 Codex 约束。

当前本地工作区采用双目录结构：

```text
AGENTS.md
工具库/
知识库/
```

## 仓库收录范围

提交到 Git 的内容只包含适合公开复用的部分：

- `AGENTS.md`：当前工作区的 Codex 操作约束和目录规则。
- `工具库/docs/`：流程、工具和说明文档。
- `工具库/scripts/`：本地验证和维护脚本。
- `工具库/templates/`：文献、项目和综合分析笔记模板。

## 本地保留内容

以下内容默认不提交：

- `知识库/`：Obsidian vault、知识笔记和本地插件配置。
- `工具库/raw/`：PDF、网页剪藏、导入包等原始材料。
- `工具库/converted/`：PDF 转换得到的全文 Markdown。
- `工具库/output/`：生成报告和临时输出。
- `工具库/metadata/` 与 `工具库/references.bib`：可能包含本机 Zotero key、PDF 路径或个人文献库信息。

## 本地验证

在本地工作区根目录运行：

```powershell
D:\python\python.exe 工具库\scripts\validate_vault.py
```

该脚本检查目录结构、知识库 frontmatter、索引覆盖、BibTeX/CSV 同步关系和 Obsidian 图谱配置。
