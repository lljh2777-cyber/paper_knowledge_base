"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "../..");
const pluginRoot = path.join(
	projectRoot,
	"knowledge-base",
	".obsidian",
	"plugins",
	"agent-Dashboard",
);
const read = (relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
const readPlugin = (relativePath) => fs.readFileSync(path.join(pluginRoot, relativePath), "utf8");

const actions = readPlugin("src/actions.ts");
const modal = readPlugin("src/modals/action-input.ts");
const serializer = readPlugin("src/runtime/action-request.ts");
const settings = readPlugin("src/runtime/settings.ts");
const settingsTab = readPlugin("src/settings/settings-tab.ts");
const dashboard = readPlugin("src/views/dashboard.ts");
const dashboardData = readPlugin("src/services/dashboard-data.ts");
const accessPolicy = read("tool-library/scripts/agent_backends/access_policy.py");
const runner = read("tool-library/scripts/run_vault_action.py");
const mineruRunner = read("tool-library/scripts/run_mineru_extract.py");
const agents = read("AGENTS.md");
const paperIndex = read("knowledge-base/papers/index.md");

assert.match(actions, /id:\s*"paper-ingest"[\s\S]*agent:\s*"paper-intake-pipeline"/);
assert.match(actions, /id:\s*"pdf-xray"[\s\S]*已有 MinerU article\.md/);
assert.match(modal, /生成原文 Markdown/);
assert.match(modal, /创建初步文章 Wiki/);
assert.match(modal, /文章 Wiki 内容来源/);
assert.match(modal, /MinerU 高精度提取/);
assert.match(modal, /precision extract/);
assert.match(modal, /解析模型/);
assert.match(modal, /VLM · 推荐/);
assert.match(modal, /Pipeline · 保守提取/);
assert.match(modal, /文档语言/);
assert.match(modal, /扫描件 OCR/);
assert.match(modal, /识别公式/);
assert.match(modal, /识别表格/);
assert.match(modal, /页面范围与超时/);
assert.match(modal, /页面范围/);
assert.match(modal, /提取超时（秒）/);
assert.match(modal, /mineruModel:/);
assert.match(modal, /mineruPages:/);
assert.match(modal, /"原始 PDF", true/);
assert.match(modal, /"已有 article\.md", false/);
assert.match(modal, /describeCliExecutable\([\s\S]*"mineru"/);
assert.match(serializer, /kind:\s*"dashboard-action-request"/);
assert.match(serializer, /mineruExecutable:/);
assert.match(serializer, /mineruBaseUrl:/);
assert.match(settings, /MINERU_CLI_PATH/);
assert.match(settings, /mineru-open-api\.cmd/);
assert.match(settingsTab, /MinerU 可执行文件/);
assert.match(settingsTab, /MinerU 私有服务地址/);
assert.match(settingsTab, /MinerU 文献解析/);
assert.match(settingsTab, /每次确认远程上传/);
assert.match(settingsTab, /CLI 可用性检查/);
assert.match(settings, /mineruDefaultModel/);
assert.match(settings, /mineruDefaultLanguage/);
assert.match(settings, /mineruDefaultIncludeSourcePdf/);
assert.match(modal, /this\.plugin\.settings\.mineruDefaultModel/);
assert.match(modal, /this\.plugin\.settings\.mineruDefaultTimeoutSeconds/);
assert.match(modal, /uploadConfirmation/);
assert.match(dashboard, /serializeActionRequest\(/);
assert.match(actions, /知识库体检[\s\S]*排除 papers 原文包/);
assert.match(dashboardData, /isExcludedMaintenancePath/);
assert.match(dashboardData, /startsWith\("papers\/"\)/);
assert.match(accessPolicy, /"tool-library\/output\/mineru-runs"/);
assert.match(accessPolicy, /"knowledge-base\/papers"/);
assert.match(runner, /generate_original_markdown/);
assert.match(runner, /create_initial_article_wiki/);
assert.match(runner, /duplicate_scope: per-output-class/);
assert.match(runner, /identity_match_does_not_satisfy_missing_classes: yes/);
assert.match(runner, /knowledge-base\/Clippings\//);
assert.match(runner, /Before\s+running MinerU, check both roots/);
assert.match(runner, /Continue creating every missing requested class/);
assert.match(runner, /mineru_model/);
assert.match(runner, /mineru_language/);
assert.match(runner, /mineru_timeout_seconds/);
assert.match(runner, /run_mineru_extract\.py/);
assert.match(runner, /deep_read_source/);
assert.match(runner, /knowledge-base\/papers\/<citekey>\//);
assert.match(agents, /knowledge-base\/papers\/<citekey>\//);
assert.match(agents, /Check the two output classes independently/);
assert.match(agents, /knowledge-base\/Clippings\//);
assert.match(agents, /one shared uniqueness domain spanning/);
assert.match(agents, /Whole-action duplicate is valid only when all requested classes independently exist/);
assert.match(paperIndex, /article\.md/);
assert.match(paperIndex, /_extraction\//);
assert.match(mineruRunner, /"extract"/);
assert.match(mineruRunner, /"md,json"/);
assert.match(mineruRunner, /manifest\.json/);
assert.match(mineruRunner, /validation\.json/);
assert.doesNotMatch(mineruRunner, /flash-extract/);

console.log("Dashboard paper action tests passed.");
