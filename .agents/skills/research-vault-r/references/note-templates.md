# R 笔记模板

只读取和使用当前任务对应的模板。删除空占位符和不适用章节，不要为了填满模板而编造内容。

## 包笔记：`r-package`

```markdown
---
title: <package>
type: r-package
package: <package>
ecosystem: <CRAN|Bioconductor|GitHub|base-R>
version_checked:
source_basis: [official-docs]
verification: docs-checked
related_functions:
related_recipes:
related_methods:
related_code:
tags: [r, r-package]
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# <package>

## 一句话定位

说明这个包解决什么问题，以及它不负责什么。

## 适用场景

-

## 安装与加载

仅记录当前官方支持的安装方式。不要在未获确认时实际安装。

```r
library(<package>)
```

## 核心对象与数据结构

| 对象 / 类 | 作用 | 关键结构或约束 |
|---|---|---|

## 核心函数

| 函数 | 作用 | 输入 → 输出 | 详细笔记 |
|---|---|---|---|

## 典型工作流

1.

## 常见陷阱与版本差异

-

## 在知识库中的实战

- [[wiki/r/recipes/<recipe>|<实战>]]
- [[wiki/code/<path>|<代码节点>]]

## 来源与验证

- 来源：
- 验证等级：
- 核对版本/日期：
```

包页是导航枢纽。保持核心函数表简洁，把复杂 API 和任务流程下沉到函数页或实战页。

## 函数或函数族笔记：`r-function`

```markdown
---
title: '<package>::<function>()'
type: r-function
package: <package>
function_name: <function>
version_checked:
source_basis: [official-docs]
verification: docs-checked
related_package: '[[wiki/r/packages/<package>|<package>]]'
related_functions:
related_recipes:
related_code:
tags: [r, r-function]
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# <package>::<function>()

## 一句话用法

说明函数的主要动作和返回结果。

## 基本形式

```r
<package>::<function>(<key_arguments>)
```

## 输入与返回值

| 项目 | 类型 / 类 | 说明 |
|---|---|---|
| 输入 | | |
| 返回值 | | |

## 关键参数

| 参数 | 含义 | 默认值 | 注意事项 |
|---|---|---|---|

## 最小示例

```r
# 使用小型、可重建数据
```

## 实战示例

链接任务型页面；只有短小且有独立价值时才在本页重复代码。

## 常见陷阱

-

## 相关函数

-

## 来源与验证

- 来源：
- 验证等级：
- 运行环境（仅 `locally-run`）：
```

同一组简单函数共享相同对象、参数语义或用途时，可建函数族页面；标题和文件名要明确其范围。

## 实战笔记：`r-recipe`

```markdown
---
title: <任务型中文标题>
type: r-recipe
packages: [<package>]
topics: [<topic>]
source_basis: [official-docs]
verification: <untested|docs-checked|locally-run|project-used>
r_version:
package_versions:
related_packages:
related_functions:
related_concepts:
related_code:
tags: [r, r-recipe]
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# <任务型中文标题>

## 要解决的问题

说明输入、目标结果和使用场景。

## 前置条件

| 项目 | 要求 |
|---|---|
| 输入 | |
| 对象结构 | |
| 依赖 | |

## 可直接使用的代码

```r
# 最小完整示例；避免依赖未声明的交互环境对象
```

## 预期输出

说明返回对象、列、维度或文件。未实际运行时不要伪造具体数值。

## 分步解释

1.

## 结果检查

```r
# 使用 stopifnot()、dim()、class() 或适当检查
```

## 常见错误

| 症状 / 错误 | 原因 | 处理方式 |
|---|---|---|

## 常用变体

-

## 相关笔记

- [[wiki/r/packages/<package>|<package>]]
- [[wiki/r/functions/<function>|<package>::<function>()]]

## 来源与验证

- 来源：
- 验证等级：
- 运行环境（仅 `locally-run`）：
- 尚未验证：
```

实战页优先回答一个具体任务。代码应可复制，但必须先说明对象结构、依赖和适用边界。

## 概念笔记：`r-concept`

```markdown
---
title: <概念名>
type: r-concept
concept: <stable-concept-slug>
source_basis: [official-docs]
verification: docs-checked
related_packages:
related_functions:
related_recipes:
tags: [r, r-concept]
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# <概念名>

## 定义

## 为什么重要

## 心智模型 / 工作机制

## 最小示例

```r
```

## 对实际代码的影响

## 常见误解

## 相关笔记

## 来源与验证

- 来源：
- 验证等级：
```

概念页解释 R 语言行为，例如因子、环境、惰性求值、数据遮蔽、向量回收、列表列或 S3/S4 对象系统；不要把科研方法原理混入该目录。

## 索引条目

在 `R知识索引.md` 和 `wiki/r/index.md` 中使用简短表格，不复制正文：

```markdown
| 页面 | 类型 | 解决的问题 | 来源 / 验证 |
|---|---|---|---|
| [[wiki/r/recipes/<slug>|<标题>]] | 实战 | <一句话> | `official-docs` / `docs-checked` |
```

按包、函数、实战和概念分区；页面数量较多后，可在包页中维护详细函数清单，顶层索引只保留高价值入口。
