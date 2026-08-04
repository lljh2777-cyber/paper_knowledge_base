# CLI 后端适配规范

## 目标

Agent Dashboard 核心只处理统一任务、统一事件、生命周期和权限边界，不直接理解 Codex CLI、Claude Code、OpenCode 或其他工具的专有参数。每种命令行工具通过独立适配器完成命令构造和事件解析。

所有 AI 写入任务共用宿主审计事务，不以 CLI 类型区分。runner 在模型进程启动
前按操作拥有的目录建立文件快照；手动停止、超时、进程失败、越界写入、删除
操作或后置体检失败时恢复被修改/删除的文件并移除本轮新建文件。回滚结果写入
`tool-library/output/dashboard-runs/changes/<run-id>.json`。若个别文件因体积、
权限或类型变化无法恢复，事件状态必须为 `rollback-incomplete`，界面不得显示
为完整回滚。

快照范围按操作确定，避免扫描整个项目：入库覆盖 metadata、BibTeX、MinerU
暂存目录、`knowledge-base/papers/` 原文包、source note、文献索引和日志；PDF 深读覆盖 source note、论文图像及相关索引；代码分析和综合分析
覆盖各自阶段目录；体检修复覆盖 wiki、顶层索引、metadata 和允许修复的
Obsidian 图谱配置。`tool-library/raw/` 只做不可变源检查，不作为正常写入范围。

文献入库弹窗通过版本化结构参数选择两个独立输出：MinerU 原文包和初步文章
Wiki。前者发布到 `knowledge-base/papers/<citekey>/`，后者写入
`knowledge-base/wiki/sources/<citekey>.md`；两个输出分别由转换和 source-note
阶段拥有。PDF 深读同样通过结构参数选择原始 PDF 或已有 `article.md`，runner
必须把该选择作为强约束传给智能体，不能静默回退到另一来源。

MinerU 参数分为常用和高级两层。常用层选择 VLM、Pipeline 或 Auto，设置文档
语言、OCR、公式、表格和是否附带原 PDF；高级层设置 1-based 页面范围与请求
超时。runner 必须按 allow-list 校验模型、语言、布尔开关、页码格式和 60–1800
秒超时，再把规范值交给 Agent。Agent 只能通过
`tool-library/scripts/run_mineru_extract.py` 执行 precision `extract`，输出固定为
`md,json`；单篇入库不开放 `flash-extract`、batch 或其他输出格式。helper 在
`tool-library/output/mineru-runs/` 暂存并验证后，才原子发布到最终目录。

当前协议版本为 `1.0`。内置实现是：

```text
tool-library/scripts/agent_backends/codex_cli.py
tool-library/scripts/agent_backends/claude_code.py
tool-library/scripts/agent_backends/opencode.py
```

## 文件边界

```text
tool-library/scripts/agent_backends/
  base.py           # 稳定接口、能力和数据结构
  access_policy.py  # 操作级权限和写入范围
  change_audit.py   # 变更清单、路径审计和失败回滚
  registry.py       # 后端发现
  codex_cli.py      # Codex CLI 方言
  claude_code.py    # Claude Code 方言
  opencode.py       # OpenCode 方言

tool-library/schemas/
  agent_backend_task.schema.json
  agent_backend_event.schema.json
  agent_backend_capabilities.schema.json
```

新增 CLI 时，应增加一个适配器文件并在 `registry.py` 注册。不要在 Dashboard 的视图、按钮或结果弹窗中增加工具名称判断。

## CLI 可执行文件检测

Codex CLI、Claude Code 和 OpenCode 共用统一检测器。自动检测顺序固定为：

```text
后端专用环境变量
→ 常见安装目录
→ 系统 PATH 扫描与 where.exe/which
→ 已保存的有效手动路径
```

环境变量分别为 `CODEX_CLI_PATH`、`CLAUDE_CODE_PATH` 和 `OPENCODE_PATH`。
常见目录覆盖 Codex App 托管 CLI、用户 `.local/bin`、npm 全局 shim、Scoop
shim 和 WinGet Links。检测结果必须返回路径、来源、来源标签和是否存在，不能
只返回一个无法解释的字符串。

Windows npm 安装通常返回 `.cmd` shim。Node 直连步骤和 Python runner 应优先
调用同目录的 npm `.ps1` shim，并继续使用参数数组和 `shell: false`；不得为了
兼容包管理器而拼接可注入的 Shell 命令字符串。

设置页显示当前路径的“自动检测来源”，并提供“重新检测”按钮。启动时保留用户
已填写的手动路径，即使路径暂时失效也不擅自替换；Codex App 托管路径可以在
启动时更新到最新版本。用户主动点击“重新检测”时才按完整顺序重新选择，全部
失败则保留当前手动值并明确提示未检测到。

默认配置不得包含开发者用户名或机器专用绝对路径。没有检测到 CLI 时使用空值，
由设置页引导用户重新检测或手动填写。

## Codex CLI 配置来源

`codex-cli` 支持 `official` 与 `cc-switch` 两种来源。官方模式在模型发现和
任务调用中显式传入 `model_provider="openai"`，并继续使用 Dashboard 的官方
模型、按钮级推理和运行时覆盖。CC Switch 模式不覆盖 provider、默认模型、
推理强度或默认 service tier，直接沿用 `~/.codex/config.toml` 中当前激活的
配置；只有用户在本次运行界面显式选择参数时才覆盖对应字段。

插件不改写 `config.toml`、`auth.json` 或 CC Switch 数据库。若要在第三方
provider 与官方 Codex 之间直接切换，CC Switch 应启用保留官方登录的选项；
否则官方 OAuth 状态被替换后，单纯覆盖 provider 不能恢复认证。

## Claude Code 当前边界

`claude-code` 的知识库检索使用 `plan` 权限模式。知识库模式仅开放
`Read`、`Glob`、`Grep`；联网搜索模式在相同只读边界上额外开放
`WebSearch`、`WebFetch`。批注解释使用 `dontAsk`，默认不开放工具；只有用户
启用批注的浅层联网选项时，才临时开放 `WebSearch`、`WebFetch`，不同时开放
Vault 读取工具。关键词扩展不开放任何工具。所有只读任务都显式禁用
`Edit`、`Write`、`NotebookEdit`、`Bash`；
非联网模式还显式禁用 `WebSearch`、`WebFetch`。
Claude Code 支持两种配置来源。`official` 只加载 `project,local` 设置，避免
用户级兼容 endpoint 覆盖官方认证与模型；`cc-switch` 加载
`user,project,local`，跟随 CC Switch 写入的模型和 endpoint。只有显式传入
`--backend-model` 时，runner 才覆盖所选来源的默认模型。
官方模式还会从子进程环境中移除第三方 endpoint 和模型映射变量，但保留官方
认证可使用的凭据环境变量。

知识库查询可携带 Vault 图片。插件只在会话中保存 Vault 相对路径；runner
重新检查路径穿越、符号链接逃逸、扩展名、实际大小、单轮数量和总大小，再将
验证后的绝对路径交给 Claude Code。Claude 必须通过只读 `Read` 工具打开图片，
不得把文件名、source note 文本或历史回答当作视觉观察。`image_input=true`
表示适配器能够传递本地图片，不代表当前模型一定支持视觉；界面和
连接状态必须将模型兼容性标记为运行时依赖。

Claude Code 写入支持按 `restricted`、`stage-owned`、`full` 分层。当前只
开放 `code-analysis` 和 `synthesis` 的 `stage-owned` 写入。CLI 仅获得阶段
目录对应的 `Edit(path/**)` 白名单，`Bash` 和 `tool-library/raw/` 始终禁用。
宿主在运行前建立文件指纹和可回滚快照，运行后生成变更清单、检查越界路径与
删除操作，并执行知识库体检；进程失败、越界、删除或验证器执行失败时回滚本轮
变更。`paper-ingest`、`pdf-xray` 和 `vault-lint-fix` 等完整写入操作仍拒绝
Claude Code。

若原生安装目录未加入 `PATH`，插件或 runner 应保存并传入 `claude.exe`
绝对路径，不应依赖交互式终端的临时环境。

插件设置为 Claude Code 提供独立二级页面，可选择官方 Claude Code 或
CC Switch，配置可选模型覆盖和默认推理强度；批注 AI 使用独立二级页面选择自动、Codex CLI、Claude Code
或已验证 Direct API，并保存批注专用模型和参数。普通批注解释可自由选择 Agent 或 Direct API，
浅层联网批注只使用 Agent。查询侧边栏的知识库模式可在 Codex CLI、Claude Code、OpenCode 和
已验证的 Direct API 配置之间选择；联网模式只显示或使用 Agent。选择 Claude Code 时可使用知识库或联网
搜索模式，并隐藏 Codex 专属的模型、速度和 service tier 控件；Claude
模型选择按配置来源显示官方 CLI 别名，或 CC Switch 用户设置与初始化事件中
识别出的候选。
代码分析和综合分析的运行弹窗可切换 Codex CLI 或 Claude Code；Claude 模式
必须显示阶段写入边界，且不得暴露 Fast/service tier 控件。`WebSearch` 和
`WebFetch` 不得出现在代码分析、综合分析或其他写入任务中；批注仅允许上述
受短时预算限制的浅层联网例外。

## OpenCode 当前边界

`opencode` 支持 `official` 与 `cc-switch` 两种配置来源。官方模式显式选择
`opencode/<model>`，优先通过 `opencode models opencode` 获取 OpenCode Zen
模型目录，并在目录请求失败时显示带“静态回退”标记的免费模型候选。CC Switch
模式通过 `opencode models` 读取当前配置可见的全部 provider/model；模型覆盖
留空时，任务跟随 `~/.config/opencode/opencode.json` 的当前默认模型。插件不
改写 OpenCode 配置、认证数据或 CC Switch 数据库。

每次任务通过 `OPENCODE_CONFIG_CONTENT` 注入最小权限，而不是依赖全局设置：

- 批注解释默认不开放文件、Shell 或联网工具；启用浅层联网时只增加
  `websearch`、`webfetch`。
- 知识库检索仅开放 `read`、`glob`、`grep`、`list`。
- 联网搜索在只读权限上额外开放 `websearch`、`webfetch`。
- 代码分析和综合分析仅开放 `edit`，实际写入仍受阶段所有权白名单、变更审计、
  后置体检和失败回滚保护。
- `bash`、外部目录访问、交互提问和子任务始终禁用。

OpenCode 使用 `opencode run --format json`，适配器将 `text`、`tool_use`、
`step_start`、`step_finish` 和错误事件归一化。第一版不传递图片，因此
`image_input=false`；模型自身支持视觉不等于 Dashboard 已实现图像传输。
文献入库、PDF 深读和体检修复等完整写入任务仍拒绝 OpenCode。

OpenCode 设置页独立保存可执行文件、配置来源、模型和推理 variant。批注页
可以保存独立的 OpenCode 模型和推理参数；查询侧边栏、代码分析与综合分析的
运行弹窗也可以选择 OpenCode。Direct API 的供应商、模型和凭据不受影响。

批注联网解释固定为浅层策略：最多围绕 2 个检索问题，采用不超过 3 个权威
来源，不追踪来源中的二级链接；总时间上限只能在 15–45 秒内设置，默认 30
秒。联网解释只使用 Agent CLI，由统一 runner 在超时后终止进程树。关闭开关
时，三种 CLI 都显式禁用联网工具；Direct API 始终不开放联网能力。

模型目录发现仍由插件直接运行 `opencode models`，因为该命令不发起模型推理，
在 Node 子进程中能够稳定退出。连接测试和实际模型任务都通过统一 Python
runner 执行，避免 Windows 下 OpenCode/Bun 在 Electron 的管道模式中不输出
JSONL 或不退出。连接测试使用 `--probe-backend opencode`，不发送 Vault 内容，
不开放文件、Skill、Shell 或联网工具，并只向 stdout 返回一个结构化 JSON
结果。runner 负责超时、JSONL 解析、进程树终止和错误分类；插件只保留一个比
runner 更长的安全看门狗。

OpenCode 连接测试依赖已配置的 Python。插件必须在启动 runner 前分别检查
Python、runner 和 OpenCode 可执行文件；缺失时返回 `configuration` 错误，
不得显示成 OpenCode 请求超时。runner 的稳定错误类型包括
`configuration`、`process-start`、`authentication`、`model-not-found`、
`rate-limit`、`network`、`timeout`、`protocol` 和 `process-exit`。

## CLI 模型发现

模型发现属于宿主与 CLI 的适配层，不属于 Direct API Provider：

- Codex CLI 通过 `app-server` 的 `initialize` 与 `model/list` 获取当前账号
  可用的动态模型目录、默认模型、推理档位和 service tier 能力。官方模式强制
  查询 OpenAI provider；CC Switch 模式读取当前 `config.toml` 的根级
  `model`/`model_provider` 并以 app-server 结果校验。
- Claude Code 没有完整模型目录接口。官方模式展示 CLI 支持的模型别名，并用
  `stream-json` 初始化事件校验实际模型；CC Switch 模式读取
  `%USERPROFILE%\.claude\settings.json` 中的当前模型和 Fable、Haiku、Opus、
  Sonnet 映射。
- OpenCode 官方模式执行 `opencode models opencode`，CC Switch 模式执行
  `opencode models` 并读取当前 OpenCode 配置中的默认模型。官方 Zen 目录
  检测失败时可回退到带明确标记的免费模型静态列表。
- Codex 目录检测失败时回退到插件内置模型表；Claude 无法读取配置时回退到
  Claude Code 自身默认模型。任何回退都必须在界面明确标记，不能伪装成完整
  目录。
- Codex、Claude 与 OpenCode 的运行时模型覆盖必须分别保存。切换后端不得把
  一种 CLI 的模型 ID 传给另一种 CLI。

## 适配器职责

适配器必须实现：

```python
class AgentCliBackend(Protocol):
    backend_id: str
    label: str
    capabilities: BackendCapabilities

    def effective_service_tier(self, model, requested): ...
    def build_command(self, executable, request): ...
    def parse_event(self, payload): ...
    def describe(self): ...
```

其中：

- `build_command()` 返回参数数组，不拼接 Shell 字符串。
- Prompt 应通过标准输入发送，避免命令行长度、转义和敏感内容问题。
- `parse_event()` 把工具专有 JSON 转为 `ParsedBackendEvent`。
- 诊断内容写入 `stderr`；结构化事件不得混入普通文本。
- 后端不拥有超时和进程树清理；这些由统一 runner 管理。

## 能力声明

能力声明决定操作中心可以显示和使用哪些功能：

```text
structured_output
streaming
sessions
model_selection
reasoning_effort
service_tier
file_write
web_search
citations
image_input
```

不支持的能力必须声明为 `false`，不能通过提示词假装支持。调用方应隐藏对应选项或降级到纯文本结果。

## 统一事件

Dashboard 事件必须包含：

```json
{
  "schema_version": "1.0",
  "type": "status"
}
```

现有兼容事件包括：

```text
status
assistant-reset
assistant-delta
retrieval-preflight
retrieval-result
```

新增事件应保持向后兼容。调用方遇到未知事件时应忽略并记录，而不是终止任务。

## 权限规则

- `read-only` 任务不得启用文件编辑能力。
- `workspace-write` 仅表示任务被授权在项目允许范围内写入，不代表可以跳过后端权限配置。
- 适配器不得默认开启“跳过全部权限”或等价选项。
- 完成后仍应由宿主核对实际文件变化，不能只相信模型报告。

## 新后端接入步骤

1. 阅读目标 CLI 的本机 `--help` 和结构化输出。
2. 复制 `codex_cli.py` 的接口形状，但不要复制 Codex 参数。
3. 声明真实能力。
4. 实现参数数组和事件解析。
5. 在 `registry.py` 注册稳定 ID。
6. 增加命令构造、事件解析和能力声明测试。
7. 运行完整 Dashboard 测试。
8. 最后再将该后端开放到插件设置页。

适配完成前，不应让写入型按钮选择该后端。
