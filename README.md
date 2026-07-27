# Research Vault 与 Agent Dashboard

这是一个面向科研论文、代码项目和可复用技术知识的本地优先工作区。项目将 Obsidian 知识库、Codex 智能体工作流、确定性 Python 工具和自研 Agent Dashboard 插件组合在一起，用于完成文献入库、PDF 深读、代码分析、知识检索、跨文献综合、知识库体检和结构化导出。

项目并不把聊天记录当作知识库。可复用结论会被整理为带来源、处理深度、链接关系和索引的 Markdown 页面；原始 PDF、本地元数据、API 凭据和个人知识内容默认留在本机。

## 核心能力

- **文献工作流**：管理 DOI、URL、Zotero、BibTeX、RIS 和本地 PDF，执行去重、元数据规范化、全文转换和 source note 写作。
- **证据分层**：明确区分 `metadata-only`、`abstract-level` 和 `x-ray`，防止把摘要阅读包装成全文深读。
- **PDF 深读**：检查全文、方法、数据、图表、局限和证据链，并将关键图像嵌入对应的 source note。
- **代码知识化**：静态分析 R/Python 项目，以“关键代码片段 + 中文解释”的形式生成项目页和脚本页。
- **知识关联**：通过 source、method、concept、dataset、project、code、R 和 Linux 页面连接论文、方法与实现。
- **透明检索**：使用“词法种子 → 图扩展 → 无匹配回退”的只读检索级联，展示实际检查过的 Vault 页面。
- **质量控制**：检查 frontmatter、链接、孤立页、索引、证据深度、代码关系和 OKF 导出状态。
- **本地代码练习**：在 Obsidian 中使用 Python/R 单元格，逐格运行、查看输出、停止任务并保存练习笔记。
- **文中批注**：在阅读视图中选中文字后使用 `Shift+S` 添加手动批注或 AI 初步解释，并可继续归档为正式知识节点。
- **开放导出**：将 `knowledge-base/wiki/` 导出为 Open Knowledge Format v0.1 bundle。

## 系统组成

```text
Codex / 自定义智能体
        │
        ├── research-vault* skills
        ├── paper_xray / code_reader agents
        │
        ▼
Agent Dashboard（Obsidian 插件）
        │
        ├── CLI Backend Protocol
        │   └── Codex CLI 参考适配器
        ├── Direct API Provider
        ├── Python/R 本地执行器
        └── 检索、体检和 OKF 确定性脚本
        │
        ▼
Obsidian Research Vault
sources / methods / concepts / code / projects / synthesis
```

工作区分为两层：

- `tool-library/` 保存脚本、模板、流程和中间产物。
- `knowledge-base/` 是 Obsidian Vault，只承载最终知识页面和插件。

在 Obsidian 中应打开 `knowledge-base/`，而不是整个仓库根目录。

## Agent Dashboard

仓库包含桌面版 Obsidian 插件 [Agent Dashboard](knowledge-base/.obsidian/plugins/agent-Dashboard/)，当前版本为 `0.24.0`。

操作中心提供以下入口：

| 操作 | 执行方式 | 主要边界 |
|---|---|---|
| 文献入库 | Codex CLI | 更新入库元数据、索引和日志，不生成论文结论 |
| PDF 深读 | `paper_xray` 智能体 | 完成全文证据检查后才允许标记为 `x-ray` |
| 代码分析 | `code_reader` 智能体 | 默认只做静态阅读，不运行或修改项目代码 |
| 知识库检索 | Codex CLI 或 Direct API | 只读检索，支持连续对话、来源面板和图片输入 |
| 综合分析 | Codex CLI | 创建或更新 MOC、concept、method、dataset、project 和 synthesis 页面 |
| 知识库体检 | 本地 Python | 确定性审计，不调用模型 |
| 体检修复 | Codex CLI | AI 提出方案并执行低风险修复，高影响问题只报告 |
| OKF 导出 | 本地 Python | 生成独立 bundle，不修改源笔记 |
| 代码练习 | 本地 Python/R | 独立进程执行，显式保存时才写入练习笔记 |

阅读视图中的批注使用普通 Markdown wikilink 保存到 `wiki/annotations/`。左键打开批注小窗，`Ctrl+左键`打开已归档的正式知识节点，`Shift+左键`打开批注文档。

### 模型后端

插件支持三类查询后端：

1. **Codex CLI**：默认模式，复用本机 Codex 的认证、模型和沙箱配置。
2. **Claude Code**：查询与批注为只读模式；代码分析和综合分析支持受审计的阶段所有权写入，可沿用 CC Switch 管理的模型。
3. **Direct API**：通过统一 Provider 接口支持 OpenAI、Anthropic、OpenAI 兼容服务、Ollama 和 LM Studio。

Direct API 凭据通过 Obsidian SecretStorage 管理，插件设置只保存凭据名称，不把真实 Key 写入 `data.json`。已实现模型发现、连接测试、SSE/NDJSON 流式输出、请求取消、超时分类和响应大小限制。Qwen3.7-Plus 可在通过能力测试后使用供应商原生联网搜索。

CLI Agent 已建立版本化任务、能力和事件协议，命令构造与工具专有 JSONL 解析由独立适配器负责。当前注册 `codex-cli` 与 `claude-code`；切换查询后端时，Codex 通过 `app-server model/list` 自动获取真实模型目录，Claude 从 CC Switch/Claude 设置和初始化事件识别当前模型及候选。Claude 的知识库检索与批注解释保持只读；代码分析和综合分析可在阶段目录白名单内写入，并由宿主生成变更清单、审计路径、执行后置体检和失败回滚。完整写入任务仍使用 Codex CLI；OpenCode 尚未接入。

## Skills 与智能体

`research-vault` 仅负责路由，具体文件操作由对应阶段的子 skill 完成。

```text
research-vault-ingest       文献身份、元数据、去重和入库记录
research-vault-convert      PDF/HTML/TeX/OCR 转 Markdown
research-vault-source-note  source note 创建、规范化和修复
research-vault-xray         全文深读、证据链和图表核验
analyze-paper-figures       复杂多面板图像的专门分析
research-vault-retrieval    基于 Vault 证据回答
research-vault-synthesis    跨文献综合和知识枢纽页面
research-vault-code         R/Python 项目静态分析
research-vault-r            R 包、函数、概念和配方
research-vault-linux        Linux、Shell、软件和文件格式
research-vault-lint         结构、链接、证据和索引审计
```

项目级持久智能体位于：

```text
.codex/agents/paper_xray.toml
.codex/agents/code_reader.toml
```

仓库级 R/Linux skills 位于 `.agents/skills/`。当前核心 `research-vault*` skills 由本机 Codex 从 `%USERPROFILE%\.codex\skills\` 加载；完整路由、写入所有权和交接规则见 [AGENTS.md](AGENTS.md)。

## 知识模型

Obsidian 页面按职责分开：

```text
knowledge-base/
  文献索引.md
  研究主题索引.md
  研究方法索引.md
  代码项目索引.md
  R知识索引.md
  Linux与命令行索引.md
  wiki/
    sources/       单篇论文或来源
    methods/       方法、模型、协议和统计流程
    concepts/      理论、机制和概念
    datasets/      数据集、队列和基准
    entities/      软件、基因、疾病和其他实体
    projects/      原子研究任务与研究想法
    code/          代码项目页和脚本页
    r/             R 包、函数、概念和配方
    linux/         命令、Shell、软件和格式
    mocs/          主题导航图
    synthesis/     跨文献比较与综述
```

页面之间使用 Obsidian wikilink 建立关系。索引用于方向导航，图结构用于检索扩展；检索分数和链接本身不被视为科学证据，回答前仍需读取实际页面。

## 证据与处理深度

项目要求明确标注内容依据：

- **Vault Evidence**：来自已读取的 source note、转换全文、元数据或明确检查过的原始材料。
- **Model Knowledge**：稳定的一般背景知识，不能冒充已导入文献的结论。
- **Web Evidence**：近期信息、官方文档、标准、数据库和外部论文，需要与 Vault 证据分开。

论文处理深度：

- `metadata-only`：仅支持身份、元数据、索引、缺口和路径。
- `abstract-level`：支持基于摘要或有限文本的保守结论。
- `x-ray`：已检查全文、方法、图表、数据、局限和证据链，可支持强论文结论。

## 快速开始

### 1. 环境

推荐环境：

- Windows 10/11
- Obsidian Desktop `1.8.0` 或更高版本
- Codex App 或 Codex CLI
- Python 3
- R / `Rscript`，仅代码练习或 R 工作流需要
- Node.js 与 pnpm/npm，仅开发插件时需要

本工作区约定使用：

```text
D:\python\python.exe
```

Python、Rscript、Codex CLI 和项目根目录也可以在 Agent Dashboard 设置中调整。

### 2. 获取项目

```powershell
git clone https://github.com/lljh2777-cyber/paper_knowledge_base.git
cd paper_knowledge_base
```

### 3. 打开 Vault

在 Obsidian 中将以下目录作为 Vault 打开：

```text
<project-root>\knowledge-base
```

进入 Obsidian 的第三方插件设置，启用 `Agent Dashboard`。插件构建产物已经随仓库提供，普通使用不需要安装 Node.js 依赖。

### 4. 配置执行环境

在 Agent Dashboard 设置中依次检查：

1. 项目根目录。
2. Python、Rscript 和 Codex CLI 路径。
3. Codex CLI 连接状态。
4. 可选的 Direct API Provider、SecretStorage 凭据、模型列表和连接测试。

`.codex/config.toml` 是项目级 Codex 配置，只作用于本项目。开始处理真实文献前，请先阅读 [AGENTS.md](AGENTS.md) 中的安全、证据和写入边界。

## 常用命令

### 知识库体检

```powershell
D:\python\python.exe tool-library\scripts\lint_vault.py
```

输出完整 JSON 报告：

```powershell
D:\python\python.exe tool-library\scripts\lint_vault.py --json
```

### 只读检索预检

```powershell
D:\python\python.exe tool-library\scripts\retrieve_vault.py `
  --project-root . `
  --query "当前知识库关于 scRNA-seq 质控有哪些依据？"
```

该脚本只输出检索路由 JSON，不生成回答，也不写入 Vault。

### OKF 预检与导出

```powershell
D:\python\python.exe tool-library\scripts\export_okf.py --preflight-only
D:\python\python.exe tool-library\scripts\export_okf.py
```

### 插件开发与验证

```powershell
cd knowledge-base\.obsidian\plugins\agent-Dashboard
pnpm install
pnpm verify
```

也可以分别运行：

```powershell
pnpm typecheck
pnpm build
pnpm test
```

`src/` 是插件源码，`main.js` 是供 Obsidian 加载的生成文件。修改源码后必须重新构建并运行回归测试。

## 数据与隐私边界

Git 默认忽略：

- `knowledge-base/` 中的本地知识内容，但保留 Agent Dashboard 实现。
- `tool-library/raw/` 中的 PDF、网页剪藏和导入包。
- `tool-library/converted/` 中的全文转换结果。
- `tool-library/output/` 和 `tool-library/metadata/` 中的本地报告与记录。
- `tool-library/references.bib`。
- Agent Dashboard 的 `data.json`、`node_modules/` 和 SecretStorage 凭据。

`tool-library/raw/` 被视为只读来源。项目禁止递归批量删除，Zotero 默认只读，高影响修复、批量改名、页面合并、schema 变更和依赖安装需要人工确认。

## 项目状态与限制

- Agent Dashboard 当前为桌面端插件，不支持 Obsidian Mobile。
- 知识库检索不是向量数据库；当前核心是词法检索、wikilink 图扩展和可解释回退。
- Direct API 联网来源的可验证程度取决于供应商协议。Qwen OpenAI 兼容接口可能只在回答正文中返回链接，插件会将其标记为模型提供、尚未独立核验。
- 代码练习使用独立进程和累计重放模拟 notebook 单元格，不是持久 Jupyter/R 内核。
- 仓库不会公开提交个人论文库、PDF、API Key 或本地 Zotero 数据。

## 相关文档

- [AGENTS.md](AGENTS.md)：AI 路由、证据来源、处理深度、目录所有权和安全规则。
- [Agent Dashboard 源码说明](knowledge-base/.obsidian/plugins/agent-Dashboard/src/README.md)：插件模块结构与构建约束。
- [CLI 后端适配规范](tool-library/docs/CLI后端适配规范.md)：通用任务、能力、事件和新命令行工具接入要求。
