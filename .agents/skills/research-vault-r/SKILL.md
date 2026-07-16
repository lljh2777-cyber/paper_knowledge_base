---
name: research-vault-r
description: Create, update, organize, and maintain the R learning and practice section of the scientific-paper Obsidian vault. Use for R package notes, important function or function-family notes, task-oriented R recipes, R language concept notes, R knowledge indexes, reusable knowledge extracted from existing code notes, and links between R notes, code projects, and scientific method pages. Do not use for whole-project static R/Python code analysis, which belongs to research-vault-code, or for general R answers that do not require vault files.
---

# Research Vault R

在研究知识库中维护独立的“R 学习与实战”板块。把可复用的 R 知识与论文结论、科研方法说明和具体代码项目分析分开，同时通过 wikilink 连接它们。

## 文件所有权

维护以下文件与目录：

```text
knowledge-base/R知识索引.md
knowledge-base/wiki/r/index.md
knowledge-base/wiki/r/packages/
knowledge-base/wiki/r/functions/
knowledge-base/wiki/r/recipes/
knowledge-base/wiki/r/concepts/
```

按下列边界路由任务：

- 用本技能记录 R 包、函数、函数族、语言机制和可复用实战方案。
- 用 `research-vault-code` 分析完整 R/Python 项目、脚本关系、入口、依赖和数据流。本技能只链接其已有代码页，或从用户明确提供的短代码片段提炼可复用知识。
- 把统计假设、科研方法原理和证据边界留在 `wiki/methods/`；R 包页聚焦 API、对象、工作流和实际用法。
- 不把论文结论写成 R 笔记。需要论文证据时链接 source note，并保留其原有证据深度。
- 不修改原始项目源代码，不执行整个外部代码项目，除非用户明确提出相应请求。

## 页面类型与粒度

| 类型 | 路径 | 使用条件 | 粒度 |
|---|---|---|---|
| `r-package` | `packages/` | 介绍一个包的定位、对象、核心 API 和工作流 | 一个包一页 |
| `r-function` | `functions/` | 高频、复杂、容易误用或值得单独复用的函数 | 单函数或紧密函数族一页 |
| `r-recipe` | `recipes/` | 回答“怎样完成某个任务” | 一个明确任务一页，优先创建 |
| `r-concept` | `concepts/` | 解释影响理解和调试的 R 语言机制 | 一个稳定概念一页 |

不要为每个简单函数建页。简单 API 留在包页；只有需要参数解释、返回对象说明、常见陷阱或多场景示例时才建函数页。用户以任务描述提问时，优先写 `r-recipe`，再链接所用包和函数。

使用小写 ASCII kebab-case 文件名：

- 包：`packages/dplyr.md`
- 函数：`functions/dplyr-filter.md`
- 函数族：`functions/dplyr-join-family.md`
- 实战：`recipes/batch-read-csv.md`
- 概念：`concepts/data-masking.md`

函数页标题使用完整命名空间，如 `dplyr::filter()`；避免因同名函数产生歧义。

## 工作流

1. 读取 `knowledge-base/R知识索引.md`、`knowledge-base/wiki/r/index.md` 和相关已有笔记，跳过缺失文件。
2. 用 `rg` 搜索包名、函数名、任务关键词及现有代码页，先检查重复页面和可链接材料。
3. 按页面类型和粒度规则选择目标。若需要大规模重分类、改名或移动页面，先征得用户确认。
4. 确定来源和验证等级。涉及当前包 API、版本、弃用状态或安装方法时，查阅官方 CRAN、Bioconductor、包站点或官方仓库文档；不要仅凭记忆写当前软件行为。
5. 创建或更新笔记。写入前读取 [note-templates.md](references/note-templates.md)，只采用目标页面类型对应的模板。
6. 建立双向语义连接：包 ↔ 函数 ↔ 实战 ↔ 概念，并在适用时链接代码项目、脚本页和科研方法页。
7. 更新 `R知识索引.md`、`wiki/r/index.md` 和 `wiki/log.md`。未产生实质文件变化时不要写日志。
8. 检查 frontmatter、wikilink、代码块、来源说明、验证等级和 UTF-8 编码。

## 来源与验证

在 frontmatter 中分别记录知识来源和运行验证，不能把二者混为一谈。

`source_basis` 使用一个或多个值：

- `official-docs`：已核对官方文档、vignette、CRAN、Bioconductor 或官方仓库。
- `vault-code-static-read`：来自已有代码页或只读代码证据，未证明能够运行。
- `user-provided`：来自用户提供的说明、片段或实际经验。
- `model-knowledge`：稳定通用背景；不得伪装成官方或 vault 证据。

`verification` 使用一个值：

- `untested`：没有运行示例。
- `docs-checked`：语法和行为已对照官方文档，但没有在本地运行。
- `locally-run`：最小示例已在隔离数据上成功运行，并记录 R/包版本和测试条件。
- `project-used`：用户确认已用于真实项目；不能仅因代码中出现过就使用此等级。

只有实际执行成功后才能写 `locally-run`。运行示例时使用小型、非敏感、可重建数据；不得自动安装 R 包，安装依赖前先询问用户。

## 写作与代码规则

- 正文默认使用简体中文；保留包名、函数名、参数、对象类、错误消息和官方术语的准确形式。
- 给出命名空间，如 `dplyr::filter()`、`Seurat::FindMarkers()`，尤其是在存在名称冲突时。
- 实战页提供可独立理解的最小完整代码，并明确输入、输出、对象类型和前置条件。
- 把预期输出、实际运行结果和推测性说明分开；不得伪造控制台输出、图形或运行成功状态。
- 说明常见错误、版本差异、对象结构假设、隐式类型转换和非标准求值等关键风险。
- 避免复制大段官方文档或现有项目源码。优先使用短代码、解释和链接。
- 不在正文重复 YAML 字段，也不把“已导入”“待整理”等工作流状态当作知识内容。

## 跨板块连接

保持三层分工：

```text
科研方法页：原理、统计假设、适用边界
R 笔记：包、API、对象、可复用任务方案
代码页：具体项目中脚本、对象和数据流的实现
```

例如：`edgeR` 包页解释 `DGEList`、核心函数和典型 API 流程；差异表达方法页解释模型与研究设计；某个代码脚本页解释该项目如何调用 edgeR。用链接连接三者，不复制整页内容。

## 完成标准

结束写入任务前说明：

- 创建或更新的 R 笔记；
- 更新的 R 索引和日志；
- `source_basis` 与 `verification`；
- 是否运行代码，以及使用的 R/包版本；
- 未解决的版本、依赖、对象或数据缺口；
- 因边界或用户确认而跳过的步骤。
