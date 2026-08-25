# Research Vault 与 Agent Dashboard

这是一个面向科研论文、代码项目和可复用技术知识的本地优先工作区。项目将 Obsidian 知识库、Codex 智能体工作流、确定性 Python 工具和自研 Agent Dashboard 插件组合在一起，用于完成文献入库、PDF 深读、代码分析、知识检索、跨文献综合、知识库体检和结构化导出。

项目并不把聊天记录当作知识库。可复用结论会被整理为带来源、处理深度、链接关系和索引的 Markdown 页面；本地元数据、API 凭据和个人知识内容默认留在本机。使用 MinerU 转换时，所选文档会发送到配置的 MinerU 服务端处理。

## 核心能力

- **文献工作流**：管理 DOI、URL、Zotero、BibTeX、RIS 和本地 PDF；“文献入库”可独立生成经过验证的 MinerU 原文包、创建初步文章 Wiki，或同时执行。
- **证据分层**：明确区分 `metadata-only`、`abstract-level` 和 `x-ray`，防止把摘要阅读包装成全文深读。
- **PDF 深读**：可选择原始 PDF 或已有 `article.md`，检查全文、方法、数据、图表、局限和证据链，并将关键图像嵌入对应的 source note。
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
        │   ├── Codex CLI
        │   ├── Claude Code
        │   └── OpenCode
        ├── Direct API Provider
        ├── MinerU precision 文档提取
        ├── Python/R 本地执行器
        └── 检索、体检和 OKF 确定性脚本
        │
        ▼
Obsidian Research Vault
papers / sources / methods / concepts / code / projects / synthesis
```

工作区分为两层：

- `tool-library/` 保存脚本、模板、流程和中间产物。
- `knowledge-base/` 是 Obsidian Vault，只承载最终知识页面和插件。

在 Obsidian 中应打开 `knowledge-base/`，而不是整个仓库根目录。

## Agent Dashboard

仓库包含桌面版 Obsidian 插件 [Agent Dashboard](knowledge-base/.obsidian/plugins/agent-Dashboard/)，当前版本为 `0.26.0`。

操作中心提供以下入口：

| 操作 | 执行方式 | 主要边界 |
|---|---|---|
| 文献入库 | Codex CLI + MinerU | 始终核验身份和去重；可选生成 `papers/<citekey>/article.md` 原文包、创建 `abstract-level` 初步 Wiki，或同时执行 |
| PDF 深读 | `paper_xray` 智能体 | 严格使用所选的原始 PDF 或已有 `article.md`；完成全文证据检查后才允许标记为 `x-ray` |
| 代码分析 | Codex CLI、Claude Code 或 OpenCode | 默认静态阅读；Claude/OpenCode 仅能在阶段目录白名单内写入知识页面 |
| 知识库检索 | Codex CLI、Claude Code、OpenCode 或 Direct API | 知识库模式可自由选择 Agent 或 Direct API；联网模式仅使用 Agent，所有查询均保持只读 |
| 综合分析 | Codex CLI、Claude Code 或 OpenCode | 创建或更新 MOC、concept、method、dataset、project 和 synthesis 页面；所有 CLI 后端均执行变更审计 |
| 知识库体检 | 本地 Python | 确定性审计，不调用模型 |
| 体检修复 | Codex CLI | AI 提出方案并执行低风险修复，高影响问题只报告 |
| OKF 导出 | 本地 Python | 生成独立 bundle，不修改源笔记 |
| 代码练习 | 本地 Python/R | 独立进程执行，显式保存时才写入练习笔记 |

“文献入库”固定使用 MinerU precision `extract` 并输出 `md,json`，不使用会将图表替换为占位符的 `flash-extract`。常用层可选择 VLM、Pipeline 或 Auto 模型，并配置语言、OCR、公式、表格和是否附带原 PDF；高级层可限制 1-based 页码范围与请求超时。提取先进入 `tool-library/output/mineru-runs/`，通过 Markdown、JSON、页码和资产检查后才发布。

文献入库按以下阶段执行：

```text
PDF / DOI / Zotero 条目
  → 身份与元数据核验、重复检查
  → 可选：MinerU 生成并验证原文阅读包
  → 可选：基于原始 PDF 或已验证 article.md 创建初步 Wiki
  → 更新文献元数据、索引和处理日志
```

两个输出彼此独立：`papers/` 原文阅读包与 `wiki/` 知识笔记之间不创建 Obsidian wikilink 或 Markdown 链接，需要标记来源位置时仅记录不可点击的代码路径；知识库体检也不扫描 `papers/`。只生成原文阅读包不会自动产生论文结论；只创建初步 Wiki 也不会被标记为全文深读。已有同名 `papers/<citekey>/` 包不会被原地覆盖，冲突会停止并交由用户确认。MinerU 处理涉及向所配置的服务上传文档，首次使用前应确认文档允许发送到该服务。

阅读视图中的批注使用普通 Markdown wikilink 保存到 `wiki/annotations/`。左键打开批注小窗，`Ctrl+左键`打开已归档的正式知识节点，`Shift+左键`打开批注文档。插件设置中的“批注 AI”二级页面可单独选择 Codex CLI、Claude Code、OpenCode 或已验证 Direct API，并配置批注专用模型、推理强度和输出长度。普通解释可自由选择 Agent 或 Direct API；启用浅层联网后仅使用 Agent，最多围绕 2 个检索问题、采用不超过 3 个权威来源，单次总时间限制为 15–45 秒。

### 模型后端

插件支持三类查询后端：

1. **Codex CLI**：可在设置中选择官方 Codex 或 CC Switch。官方模式显式使用 OpenAI provider 和 Dashboard 的官方模型策略；CC Switch 模式沿用当前 `~/.codex/config.toml`，插件不改写供应商或凭据文件。
2. **Claude Code**：可在设置中选择官方 Claude Code 或 CC Switch 配置来源。查询与批注为只读模式；查询可通过 `Read` 分析经过路径校验的 Vault 图片，并且只在“联网搜索”模式额外开放 `WebSearch`/`WebFetch`；代码分析和综合分析支持受审计的阶段所有权写入。
3. **OpenCode**：可选择官方 OpenCode Zen 或 CC Switch。官方模式默认提供当前内置的免费 Zen 模型候选并动态运行 `opencode models opencode` 校验；CC Switch 模式读取当前 OpenCode 全局配置和模型。查询与批注保持只读，代码分析和综合分析支持受审计的阶段所有权写入。第一版不传递图片。
4. **Direct API**：通过统一 Provider 接口支持 OpenAI、Anthropic、OpenAI 兼容服务、Ollama 和 LM Studio，定位为只读知识库助手。

Direct API 凭据通过 Obsidian SecretStorage 管理，插件设置只保存凭据名称，不把真实 Key 写入 `data.json`。已实现模型发现、连接测试、SSE/NDJSON 流式输出、请求取消、超时分类和响应大小限制。插件只向 Direct API 发送确定性检索筛选出的 Vault 页面和用户明确附加的图片；Direct API 不联网、不执行 Skill、不调用工具、不写入文件。知识库模式允许用户在 Direct API 与 Agent 之间自由选择，联网搜索、运行工具和文件修改则由 Agent 承担。

CLI Agent 已建立版本化任务、能力和事件协议，命令构造与工具专有 JSONL 解析由独立适配器负责。当前注册 `codex-cli`、`claude-code` 与 `opencode`。三者分别保存模型覆盖，切换后端不会串用模型 ID。Claude Code 和 OpenCode 的知识库检索与批注解释保持只读；代码分析和综合分析可在阶段目录白名单内写入。所有 AI 写入任务都由宿主在运行前建立操作级快照，完成后生成变更清单并执行知识库体检；手动停止、进程失败、越界写入或验证失败时自动回滚。文献入库、PDF 深读和体检修复等完整写入任务仍只使用 Codex CLI。

OpenCode 的模型目录由插件直接运行 `opencode models` 获取；连接测试和实际任务统一通过 Python runner 执行。这样可以统一处理 JSONL、超时、Windows 进程树终止和错误分类。若 Python 或 runner 路径无效，设置页会显示明确的配置错误，而不会误报为 OpenCode 超时。

### 任务状态与失败恢复

Dashboard 将任务区分为完成、完成但有待处理项、失败和已停止。知识库体检默认使用退出码 `0` 表示没有 error（仍可能包含 warning 或 info），退出码 `1` 表示检查正常完成但发现 error；启用 `--strict` 时 warning 也会令命令返回 `1`。这些情况都不代表 runner 故障，结果弹窗仍会显示完整报告和可用的“提出方案并修复”入口。启动脚本、权限检查或报告生成异常才会标记为失败。

AI 写入任务开始前会记录操作范围内的文件状态，结束后生成变更清单并执行后置检查。手动停止、Agent 异常退出、越界写入或后置验证失败时，runner 会尝试恢复本轮修改；结果弹窗会明确显示是否已回滚以及是否仍需人工检查。确定性体检和 OKF 导出不经过模型。

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
  papers/         MinerU 生成并由项目验证的原文阅读包
    <citekey>/
      article.md
      images/
      mineru-result.json      阅读顺序、版面元素与资源路径
      _extraction/
        manifest.json         来源哈希、MinerU 版本与提取参数
        validation.json       Markdown、JSON、页码和资产检查
        source.pdf            可选的原始 PDF 副本
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
- Codex App / Codex CLI；可选安装 Claude Code 或 OpenCode
- Python 3
- R / `Rscript`，仅代码练习或 R 工作流需要
- Node.js 与 pnpm/npm，仅开发插件时需要
- `mineru-open-api` CLI，仅在“文献入库”生成原文 Markdown 时需要

本工作区约定使用：

```text
D:\python\python.exe
```

Python、Rscript、各 CLI 可执行文件、MinerU 服务地址和项目根目录都可以在 Agent Dashboard 设置中调整。设置首页还提供独立的 MinerU 文献解析、MinerU 阅读器、任务默认策略和数据与诊断模块：MinerU 入库参数可保存为默认值并在单次任务中覆盖；阅读器可配置新视图的模式、跟随开关、缩放和双栏比例；常用 AI 操作可设置默认后端、模型与推理强度；历史数量、Direct API 超时和脱敏诊断也由用户管理。MinerU CLI 可通过 `MINERU_CLI_PATH`、常见安装目录、系统 PATH/`where.exe` 或手动路径检测；Token 由 `mineru-open-api auth` 或 `MINERU_TOKEN` 管理，不写入插件配置。Codex CLI、Claude Code 和 OpenCode 使用同样的分层路径检测策略。

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
2. Python、Rscript、MinerU 和计划使用的 Agent CLI 路径。
3. Codex CLI、Claude Code 或 OpenCode 的配置来源、模型与连接状态。
4. 可选的 Direct API Provider、SecretStorage 凭据、模型列表和连接测试。

建议首次启用后依次执行：

1. 在“运行环境”中重新检测 Python 与计划使用的 CLI，确认检测来源和路径正确。
2. 对每个启用的 Agent 或 Direct API 配置运行一次不包含 Vault 内容的连接测试。
3. 运行“知识库体检”，确认完整报告能够显示；发现待处理项不会阻止其他只读功能。
4. 需要生成论文原文包时，先执行 `mineru-open-api auth`，再在设置中确认 MinerU CLI 可用。
5. 使用一篇可公开上传的短 PDF 验证入库流程，再处理受版权、伦理或数据协议约束的材料。

`.codex/config.toml` 是项目级 Codex 配置，只作用于本项目。开始处理真实文献前，请先阅读 [AGENTS.md](AGENTS.md) 中的安全、证据和写入边界。

## 常用命令

### 知识库体检

```powershell
D:\python\python.exe tool-library\scripts\lint_vault.py
```

该命令返回 `1` 时通常表示体检完成但存在 error；请根据终端中的 `Vault lint: score` 判断结果，不要只按非零退出码认定脚本故障。Dashboard 还会通过 `--report tool-library/output/lint/latest.json` 保存结构化报告。

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
- Direct API 固定为知识库内只读推理；需要联网、运行工具或写入知识页面时必须切换到 Agent。
- 代码练习使用独立进程和累计重放模拟 notebook 单元格，不是持久 Jupyter/R 内核。
- 仓库不会公开提交个人论文库、PDF、API Key 或本地 Zotero 数据。

## 相关文档

- [AGENTS.md](AGENTS.md)：AI 路由、证据来源、处理深度、目录所有权和安全规则。
- [Agent Dashboard 源码说明](knowledge-base/.obsidian/plugins/agent-Dashboard/src/README.md)：插件模块结构与构建约束。
- [CLI 后端适配规范](tool-library/docs/CLI后端适配规范.md)：通用任务、能力、事件和新命令行工具接入要求。
