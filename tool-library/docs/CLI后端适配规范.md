# CLI 后端适配规范

## 目标

Agent Dashboard 核心只处理统一任务、统一事件、生命周期和权限边界，不直接理解 Codex CLI、Claude Code、OpenCode 或其他工具的专有参数。每种命令行工具通过独立适配器完成命令构造和事件解析。

当前协议版本为 `1.0`。内置实现是：

```text
tool-library/scripts/agent_backends/codex_cli.py
tool-library/scripts/agent_backends/claude_code.py
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

tool-library/schemas/
  agent_backend_task.schema.json
  agent_backend_event.schema.json
  agent_backend_capabilities.schema.json
```

新增 CLI 时，应增加一个适配器文件并在 `registry.py` 注册。不要在 Dashboard 的视图、按钮或结果弹窗中增加工具名称判断。

## Claude Code 当前边界

`claude-code` 的知识库检索使用 `plan` 权限模式，仅开放
`Read`、`Glob`、`Grep`；批注解释和关键词扩展使用 `dontAsk` 且不开放任何
工具。两类任务都显式禁用 `Edit`、`Write`、`NotebookEdit`、`Bash`。
CC Switch 配置的模型由 Claude Code 自己选择；只有显式传入
`--backend-model` 时，runner 才覆盖该模型。

Claude Code 写入支持按 `restricted`、`stage-owned`、`full` 分层。当前只
开放 `code-analysis` 和 `synthesis` 的 `stage-owned` 写入。CLI 仅获得阶段
目录对应的 `Edit(path/**)` 白名单，`Bash` 和 `tool-library/raw/` 始终禁用。
宿主在运行前建立文件指纹和可回滚快照，运行后生成变更清单、检查越界路径与
删除操作，并执行知识库体检；进程失败、越界、删除或验证器执行失败时回滚本轮
变更。`paper-ingest`、`pdf-xray` 和 `vault-lint-fix` 等完整写入操作仍拒绝
Claude Code。

若原生安装目录未加入 `PATH`，插件或 runner 应保存并传入 `claude.exe`
绝对路径，不应依赖交互式终端的临时环境。

插件设置为 Claude Code 提供独立二级页面，可配置可执行文件、可选模型覆盖、
默认推理强度和批注解释后端。查询侧边栏可在 Codex CLI、Claude Code 和
已验证的 Direct API 配置之间选择。选择 Claude Code 时必须自动限制为
知识库模式，并隐藏 Codex 专属的模型、速度和 service tier 控件；Claude
模型选择只显示从 CC Switch/Claude 设置或初始化事件中识别出的候选。
代码分析和综合分析的运行弹窗可切换 Codex CLI 或 Claude Code；Claude 模式
必须显示阶段写入边界，且不得暴露 Fast/service tier 控件。

## CLI 模型发现

模型发现属于宿主与 CLI 的适配层，不属于 Direct API Provider：

- Codex CLI 通过 `app-server` 的 `initialize` 与 `model/list` 获取当前账号
  可用的动态模型目录、默认模型、推理档位和 service tier 能力。
- Claude Code 没有完整模型目录接口。插件读取
  `%USERPROFILE%\.claude\settings.json` 中 CC Switch/Claude 写入的当前模型
  和 Fable、Haiku、Opus、Sonnet 映射，并用 `stream-json` 初始化事件校验
  实际模型。
- Codex 目录检测失败时回退到插件内置模型表；Claude 无法读取配置时回退到
  Claude Code 自身默认模型。回退必须在界面明确标记，不能伪装成完整目录。
- Codex 与 Claude 的运行时模型覆盖必须分别保存。切换后端不得把一种 CLI
  的模型 ID 传给另一种 CLI。

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
