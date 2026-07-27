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
  registry.py       # 后端发现
  codex_cli.py      # Codex CLI 方言
  claude_code.py    # Claude Code 方言

tool-library/schemas/
  agent_backend_task.schema.json
  agent_backend_event.schema.json
  agent_backend_capabilities.schema.json
```

新增 CLI 时，应增加一个适配器文件并在 `registry.py` 注册。不要在 Dashboard 的视图、按钮或结果弹窗中增加工具名称判断。

## Claude Code 第一阶段

`claude-code` 当前只开放只读任务。适配器使用 `plan` 权限模式，仅开放
`Read`、`Glob`、`Grep`，并显式禁用 `Edit`、`Write`、`NotebookEdit`、
`Bash`。CC Switch 配置的模型由 Claude Code 自己选择；只有显式传入
`--backend-model` 时，runner 才覆盖该模型。

Claude Code 写入支持按 `restricted`、`stage-owned`、`full` 分层。访问
策略已经表达这些级别，但在变更清单、运行后路径审计、后置验证和失败恢复
完成之前，适配器必须拒绝全部写入操作。

若原生安装目录未加入 `PATH`，插件或 runner 应保存并传入 `claude.exe`
绝对路径，不应依赖交互式终端的临时环境。

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
