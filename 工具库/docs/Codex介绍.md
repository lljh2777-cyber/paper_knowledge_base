# Codex 介绍

> 更新日期：2026-06-30
> 说明：本文介绍的是 OpenAI Codex，即面向软件开发工作的 AI 编程代理。

## 什么是 Codex

Codex 是 OpenAI 的编程代理，能够在代码库中读取、理解、修改并运行代码。它的目标不是只生成一段代码片段，而是参与完整的软件工程工作流：理解需求、查看项目结构、制定实现方案、编辑文件、运行命令、验证结果，并把关键修改清楚地反馈给开发者。

在实际使用中，Codex 更接近一个可以操作开发环境的工程助手。你可以让它实现功能、修复 bug、解释陌生代码、补充测试、做代码审查、整理文档，或者把较大的任务拆给云端代理并行处理。

## 核心能力

### 1. 编写和修改代码

你可以用自然语言描述目标，例如“给登录接口加限流”“修复这个测试失败”“把这个页面改成响应式布局”。Codex 会根据当前项目的文件结构、依赖、约定和上下文进行修改，而不是脱离项目单独生成示例代码。

### 2. 理解代码库

Codex 可以阅读项目文件、搜索调用关系、解释模块职责，并帮助你快速理解陌生或历史代码。对于大型项目，它适合用来回答“这个功能从哪里入口”“这个配置在哪里生效”“某个错误可能由哪些路径触发”等问题。

### 3. 调试和验证

Codex 可以运行测试、构建命令、类型检查、lint、脚本或本地开发服务，并根据输出继续定位问题。它通常会把验证结果和剩余风险一起说明，便于开发者判断修改是否可以合入。

### 4. 代码审查

在 review 场景中，Codex 可以检查逻辑错误、边界条件、回归风险、缺失测试和实现与需求不一致的地方。它适合做第一轮问题发现，但最终判断仍应由人类开发者结合业务背景完成。

### 5. 文档和知识整理

Codex 也可以写 README、接口说明、迁移文档、技术方案、变更说明和排障记录。因为它可以直接读取项目文件，生成的文档通常能贴近真实代码状态。

## 常见使用方式

### Codex CLI

Codex CLI 是运行在终端里的 Codex。它可以在当前目录中读取、编辑和运行代码，适合本地仓库开发、脚本修复、测试验证和命令行工作流。

### Codex IDE Extension

Codex IDE 扩展让 Codex 在编辑器中工作。它可以结合打开的文件、选区和当前上下文来回答问题或修改代码，也可以把任务委托给 Codex Cloud 后再回到本地继续处理。

### Codex Cloud / Web

Codex Cloud 适合把较大或可并行的任务交给云端环境执行。每个任务通常在独立环境中运行，可以用于实现功能、修复问题、提出变更，之后再由开发者审查和合并。

### Codex App

Codex App 更像一个面向多代理工作的控制台，适合管理多个任务、工作区和代理执行结果。对于需要同时推进多个方向的工程任务，它可以提供更集中的调度和审查体验。

## Codex 如何工作

Codex 的核心是“代理循环”：接收用户目标，读取上下文，制定下一步行动，调用工具执行操作，观察结果，再继续修正计划，直到给出最终结果。与普通聊天模型相比，Codex 的关键区别在于它能连接真实工具，例如文件系统、终端、浏览器、MCP 工具或外部服务。

一个典型流程如下：

1. 用户提出任务。
2. Codex 阅读相关文件和项目说明。
3. Codex 制定实现或排查计划。
4. Codex 修改代码或运行命令。
5. Codex 根据测试、构建或日志输出继续调整。
6. Codex 汇总修改、验证结果和注意事项。

## 项目约定：AGENTS.md

`AGENTS.md` 是给 Codex 的项目级说明文件。Codex 在开始工作前会读取相关的 `AGENTS.md`，以了解项目约定，例如：

- 如何安装依赖和运行测试。
- 哪些命令可以执行，哪些命令禁止执行。
- 代码风格、命名规则和目录约定。
- 审查标准、验证步骤和安全要求。

在团队项目中，`AGENTS.md` 很适合记录长期有效的开发规则。一次性的任务限制则更适合直接写在当前对话中。

## 扩展能力

### Skills

Skills 是给 Codex 增加专项能力的机制。一个 skill 可以包含任务说明、参考资料、脚本和资源文件，让 Codex 在处理特定类型任务时遵循稳定流程。例如，处理 PDF、构建前端应用、生成报告或对接某类专业数据源。

### MCP

MCP（Model Context Protocol）可以把 Codex 连接到外部工具和上下文，例如 GitHub、Figma、浏览器、内部知识库或其他开发工具。当任务需要访问本地仓库之外的信息或执行外部操作时，MCP 通常比单纯依赖模型记忆更可靠。

### Subagents

Subagents 允许 Codex 生成多个专门代理并行工作，然后汇总结果。它适合用于大型代码库探索、复杂功能拆解、多方向方案比较或需要同时检查多个模块的任务。

## 适合使用 Codex 的场景

- 新功能开发：根据需求实现代码、补测试、更新文档。
- Bug 修复：复现问题、定位原因、修改实现并验证。
- 代码库熟悉：解释架构、调用链、模块职责和关键配置。
- 重构：在保持行为不变的前提下改善结构和可维护性。
- 测试补全：根据风险点添加单元测试、集成测试或回归测试。
- 代码审查：发现潜在缺陷、遗漏边界和测试空白。
- 工程文档：生成使用说明、迁移指南、排障手册或设计记录。

## 使用建议

1. 给出清晰目标，而不是只说“优化一下”。
2. 说明约束条件，例如兼容性、性能、禁止修改的模块或必须保留的行为。
3. 让 Codex 先读取项目上下文，再进行较大改动。
4. 对高风险任务要求它运行测试、构建或其他验证命令。
5. 对复杂任务先要求计划，再允许实施。
6. 使用 `AGENTS.md` 固化团队长期规则。
7. 使用 MCP、Skills 和 Subagents 扩展 Codex 能力，而不是把所有上下文都塞进提示词。

## 注意事项

Codex 可以显著提高软件工程效率，但它不应替代工程判断。涉及生产变更、安全、权限、数据迁移、计费、合规或大规模删除操作时，仍需要开发者审查方案、确认风险并验证结果。

另外，Codex 的效果高度依赖上下文质量。清晰的需求、可运行的测试、准确的项目说明和良好的代码结构，都会直接提升它的工作质量。

## 参考资料

- [Codex - OpenAI Developers](https://developers.openai.com/codex)
- [Codex CLI - OpenAI Developers](https://developers.openai.com/codex/cli)
- [Codex IDE extension - OpenAI Developers](https://developers.openai.com/codex/ide)
- [Codex web - OpenAI Developers](https://developers.openai.com/codex/cloud)
- [Custom instructions with AGENTS.md - OpenAI Developers](https://developers.openai.com/codex/guides/agents-md)
- [Agent Skills - Codex](https://developers.openai.com/codex/skills)
- [Model Context Protocol - Codex](https://developers.openai.com/codex/mcp)
- [Subagents - Codex](https://developers.openai.com/codex/subagents)
- [Best practices - Codex](https://developers.openai.com/codex/learn/best-practices)
