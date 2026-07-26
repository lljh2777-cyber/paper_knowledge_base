"use strict";

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");

const originalLoad = Module._load;
let TFileStub;
Module._load = function loadWithObsidianStub(request, parent, isMain) {
	if (request === "obsidian") {
		class Base {}
		class TFile extends Base {
			constructor(values = {}) {
				super();
				Object.assign(this, values);
			}
		}
		TFileStub = TFile;
		class FileSystemAdapter extends Base {}
		return {
			FileSystemAdapter,
			ItemView: Base,
			MarkdownRenderer: { render: async () => {} },
			Modal: Base,
			Notice: class {},
			Plugin: Base,
			PluginSettingTab: Base,
			Setting: class {},
			TFile,
			normalizePath: (value) => value,
			setIcon: () => {},
		};
	}
	return originalLoad.call(this, request, parent, isMain);
};

const pluginPath = path.resolve(
	__dirname,
	"../../knowledge-base/.obsidian/plugins/agent-Dashboard/main.js",
);
const pluginSourceRoot = path.resolve(
	__dirname,
	"../../knowledge-base/.obsidian/plugins/agent-Dashboard/src",
);
const AgentDashboardPlugin = require(pluginPath);
Module._load = originalLoad;
const pluginSource = fs.readdirSync(pluginSourceRoot, { recursive: true })
	.filter((file) => String(file).endsWith(".ts"))
	.sort()
	.map((file) => fs.readFileSync(path.join(pluginSourceRoot, file), "utf8"))
	.join("\n");
const entrySource = fs.readFileSync(path.join(pluginSourceRoot, "main.ts"), "utf8").trim();
assert.strictEqual(
	entrySource,
	'export { default } from "./plugin";',
	"TypeScript entry point should remain a minimal strict re-export",
);
for (const modalSource of [
	"modals/action-input.ts",
	"modals/practice-note.ts",
	"modals/task-result.ts",
	"modals/vault-image-picker.ts",
]) {
	assert.ok(fs.existsSync(path.join(pluginSourceRoot, modalSource)));
	assert.ok(
		!fs.readFileSync(path.join(pluginSourceRoot, modalSource), "utf8").includes("@ts-nocheck"),
		`${modalSource} should remain under strict TypeScript checking`,
	);
}
for (const strictSource of [
	"plugin.ts",
	"providers/adapters.ts",
	"providers/http-transport.ts",
	"query/direct-query-service.ts",
	"runtime/lifecycle-state.ts",
	"runtime/persistence.ts",
	"runtime/process-execution.ts",
	"services/dashboard-data.ts",
	"settings/settings-tab.ts",
	"views/code-practice.ts",
	"views/dashboard.ts",
	"views/query-wiki.ts",
	"types/contracts.ts",
]) {
	assert.ok(fs.existsSync(path.join(pluginSourceRoot, strictSource)));
	assert.ok(
		!fs.readFileSync(path.join(pluginSourceRoot, strictSource), "utf8").includes("@ts-nocheck"),
		`${strictSource} should remain under strict TypeScript checking`,
	);
}
assert.ok(
	fs.readFileSync(path.join(pluginSourceRoot, "types/contracts.ts"), "utf8")
		.includes("export interface PluginHost"),
	"shared runtime contracts should expose the PluginHost boundary",
);

const plugin = new AgentDashboardPlugin();
plugin.taskRuns = [
	{
		id: "run-complete",
		actionId: "synthesis",
		status: "done",
		startedAt: "2026-07-26T00:00:00Z",
	},
	{
		id: "run-active",
		actionId: "synthesis",
		status: "running",
		startedAt: "2026-07-26T01:00:00Z",
	},
];
assert.strictEqual(plugin.getRunningTaskRun("synthesis").id, "run-active");
assert.strictEqual(plugin.getRunningTaskRun("vault-lint"), null);
plugin.taskRuns = [];

assert.ok(
	pluginSource.includes('value: healthScore === null ? "—" : String(healthScore)'),
	"health metric should use the latest lint report or show no result",
);
assert.ok(
	!pluginSource.includes("100 - linkReport.broken.length * 2 - missingFrontmatter"),
	"health metric must not fall back to an estimated default score",
);
assert.ok(
	pluginSource.includes("const scrollTop = this.contentEl.scrollTop;"),
	"code-practice rendering should preserve the current scroll position",
);
assert.ok(
	pluginSource.includes('this.language === "r"')
		&& pluginSource.includes('editor.setRangeText("<-", editor.selectionStart, editor.selectionEnd, "end")'),
	"R code-practice cells should support Alt+- for the assignment operator",
);
assert.ok(
	pluginSource.includes('isRunning ? "点击停止" : "空闲"'),
	"running Dashboard actions should expose a manual stop control",
);

const priorMessages = Array.from({ length: 12 }, (_, index) => ({
	role: index % 2 === 0 ? "user" : "assistant",
	status: "done",
	content: `${index % 2 === 0 ? "问题" : "回答"} ${index}`,
}));
const payload = JSON.parse(
	plugin.buildQueryActionInput("详细讲讲这个方法", priorMessages),
);

assert.strictEqual(payload.kind, "query-session");
assert.strictEqual(payload.question, "详细讲讲这个方法");
assert.strictEqual(payload.mode, "web");
assert.strictEqual(payload.recent_turns.length, 8);
assert.strictEqual(payload.recent_turns[0].content, "问题 4");
assert.ok(payload.conversation_summary.includes("对话起点：问题 0"));
assert.ok(!payload.question.includes("回答"));

const vaultPayload = JSON.parse(
	plugin.buildQueryActionInput("仅检查已有证据", priorMessages, "vault"),
);
assert.strictEqual(vaultPayload.mode, "vault");

const session = plugin.makeQuerySession();
assert.strictEqual(session.retrievalMode, "web");
assert.strictEqual(session.queryBackendId, "codex-cli");

async function testDirectApiQuery() {
	const profile = {
		id: "provider-deepseek",
		name: "ds-v4-pro",
		type: "openai-compatible",
		baseUrl: "https://api.example.test",
		model: "deepseek-v4-pro",
		secretId: "deepseek-main",
		timeoutSeconds: 20,
		capabilities: { streaming: true, pdf: false, vision: false },
		lastTest: { ok: true },
	};
	plugin.settings = {
		projectRoot: path.resolve(__dirname, "../.."),
		providerProfiles: [profile],
	};
	assert.deepStrictEqual(plugin.getVerifiedProviderProfiles().map((item) => item.id), [profile.id]);
	assert.strictEqual(plugin.resolveQueryBackendId(profile.id), profile.id);
	assert.strictEqual(plugin.resolveQueryBackendId("missing-provider"), "codex-cli");
	const safeEvidence = plugin.readVaultEvidencePacket({
		candidate_paths: ["wiki/index.md", "../AGENTS.md"],
	});
	assert.strictEqual(safeEvidence.length, 1);
	assert.strictEqual(safeEvidence[0].path, "wiki/index.md");

	const evidence = [{
		path: "wiki/methods/example.md",
		wikilink: "[[wiki/methods/example]]",
		content: "# Example\nVault evidence",
	}];
	const trace = {
		stage: "lexical-seed+graph-expansion",
		lexical_seeds: [{ path: "wiki/methods/example.md" }],
		graph_expansion: [],
		fallback: { used: false, paths: [] },
		candidate_paths: ["wiki/methods/example.md"],
	};
	const events = [];
	let directRequest = null;
	plugin.runVaultRetrievalPreflight = async () => trace;
	plugin.readVaultEvidencePacket = () => evidence;
	plugin.createLLMProvider = () => ({
		complete: async (request) => {
			directRequest = request;
			return { text: "基于 [[wiki/methods/example]] 的回答。" };
		},
	});
	const result = await plugin.runDirectVaultQuery(
		"run-direct",
		profile.id,
		"这个方法是什么？",
		priorMessages,
		"vault",
		{ onEvent: (event) => events.push(event) },
	);
	assert.strictEqual(result.exitCode, 0);
	assert.ok(result.stdout.includes("[[wiki/methods/example]]"));
	assert.strictEqual(result.events[0].type, "retrieval-preflight");
	assert.ok(events.some((event) => event.type === "retrieval-preflight"));
	assert.strictEqual(directRequest.model, "deepseek-v4-pro");
	assert.ok(directRequest.messages[0].content.includes("只能依据本次提供的 Vault 证据"));
	assert.ok(directRequest.messages.at(-1).content.includes("wiki/methods/example.md"));
	assert.strictEqual(plugin.isQueryExecutionActive("run-direct", profile.id), false);

	profile.name = "Qwen3.7-Plus";
	profile.model = "qwen3.7-plus";
	profile.capabilities.vision = true;
	profile.lastTest.streamingVerified = false;
	let visionRequest = null;
	plugin.createLLMProvider = () => ({
		complete: async (request) => {
			visionRequest = request;
			return { text: "图像回答" };
		},
	});
	const imagePath = "wiki/assets/figures/li_cellular_2026/figure-1.png";
	const secondImagePath = "wiki/assets/figures/li_cellular_2026/figure-2.png";
	const visionResult = await plugin.runDirectVaultQuery(
		"run-vision",
		profile.id,
		"联合分析这两张图",
		[],
		"vault",
		{},
		[
			{
				path: imagePath,
				name: "figure-1.png",
				sourceNotePath: "wiki/sources/li_cellular_2026.md",
			},
			{
				path: secondImagePath,
				name: "figure-2.png",
				sourceNotePath: "wiki/sources/li_cellular_2026.md",
			},
		],
	);
	assert.strictEqual(visionResult.stdout, "图像回答");
	assert.deepStrictEqual(
		visionResult.events[0].payload.linked_note_paths,
		["wiki/sources/li_cellular_2026.md"],
	);
	const visionContent = visionRequest.messages.at(-1).content;
	assert.ok(Array.isArray(visionContent));
	assert.strictEqual(visionContent[0].type, "image_url");
	assert.ok(visionContent[0].image_url.url.startsWith("data:image/png;base64,"));
	assert.strictEqual(visionContent[1].type, "image_url");
	assert.ok(visionContent[1].image_url.url.startsWith("data:image/png;base64,"));
	assert.strictEqual(visionContent.at(-1).type, "text");
	assert.ok(visionContent.at(-1).text.includes("实际检查图片像素"));
	assert.ok(visionContent.at(-1).text.includes("图片 2"));
	assert.ok(visionContent.at(-1).text.includes("wiki/sources/li_cellular_2026.md"));
	const normalizedVisionSession = plugin.normalizeQuerySession({
		messages: [{
			role: "user",
			content: "联合分析这两张图",
			attachments: [
				{ path: imagePath, name: "figure-1.png" },
				{ path: secondImagePath, name: "figure-2.png" },
			],
		}],
	});
	assert.strictEqual(normalizedVisionSession.messages[0].attachments[0].path, imagePath);
	assert.strictEqual(normalizedVisionSession.messages[0].attachments[1].path, secondImagePath);
	assert.ok(!JSON.stringify(normalizedVisionSession).includes("base64"));
	assert.throws(
		() => plugin.readVaultImageData({ path: "../outside.png" }),
		(error) => /超出当前 Vault/.test(error.message),
	);

	profile.webSearch = {
		enabled: true,
		configured: true,
		protocol: "qwen-chat-completions",
		forcedSearch: true,
		searchStrategy: "turbo",
		assignedSites: [],
		timeoutSeconds: 60,
	};
	profile.lastTest.webSearchVerified = true;
	let webRequest = null;
	plugin.createLLMProvider = () => ({
		complete: async (request) => {
			webRequest = request;
			return { text: "联网补充回答：https://example.test/source" };
		},
	});
	const webResult = await plugin.runDirectVaultQuery(
		"run-web",
		profile.id,
		"联网搜索",
		[],
		"web",
	);
	assert.strictEqual(webResult.exitCode, 0);
	assert.strictEqual(webRequest.webSearch, true);
	assert.strictEqual(
		webResult.events.at(-1).payload.provider_search.protocol,
		"qwen-chat-completions",
	);

	const expansionCalls = [];
	plugin.runVaultRetrievalPreflight = async (_runId, _question, expandedTerms = []) => {
		expansionCalls.push(expandedTerms);
		return expandedTerms.length
			? {
				...trace,
				stage: "llm-keyword+ppr",
				retrieval_label: "LLM+PPR",
				keyword_expansion: { used: true, terms: expandedTerms },
			}
			: {
				stage: "no-match-fallback",
				retrieval_label: "NoMatch+Index",
				lexical_seeds: [],
				graph_expansion: [],
				fallback: { used: true, paths: [] },
				candidate_paths: [],
			};
	};
	let expansionCompletion = 0;
	plugin.createLLMProvider = () => ({
		complete: async () => {
			expansionCompletion += 1;
			return expansionCompletion === 1
				? { text: "{\"keywords\":[\"SingleR annotation\",\"cell type annotation\"]}" }
				: { text: "扩展检索回答" };
		},
	});
	const expanded = await plugin.runDirectVaultQuery(
		"run-expansion",
		profile.id,
		"细胞身份判定",
		[],
		"vault",
	);
	assert.strictEqual(expanded.stdout, "扩展检索回答");
	assert.deepStrictEqual(expansionCalls[1], ["SingleR annotation", "cell type annotation"]);
	assert.strictEqual(expanded.events[0].payload.retrieval_label, "LLM+PPR");

	plugin.runVaultRetrievalPreflight = async () => trace;
	profile.lastTest.streamingVerified = true;
	const streamEvents = [];
	plugin.createLLMProvider = () => ({
		stream: async (_request, onDelta) => {
			onDelta("流式");
			onDelta("回答");
			return { text: "流式回答" };
		},
		complete: async () => {
			throw new Error("streaming should avoid non-streaming completion");
		},
	});
	const streamed = await plugin.runDirectVaultQuery(
		"run-stream",
		profile.id,
		"流式测试",
		[],
		"vault",
		{ onEvent: (event) => streamEvents.push(event) },
	);
	assert.strictEqual(streamed.stdout, "流式回答");
	assert.deepStrictEqual(
		streamEvents.filter((event) => event.type === "assistant-delta").map((event) => event.delta),
		["流式", "回答"],
	);

	plugin.createLLMProvider = () => ({
		stream: async (_request, onDelta) => {
			onDelta("不完整");
			throw new Error("stream disconnected");
		},
		complete: async () => ({ text: "回退回答" }),
	});
	const fallbackEvents = [];
	const fallbackResult = await plugin.runDirectVaultQuery(
		"run-stream-fallback",
		profile.id,
		"回退测试",
		[],
		"vault",
		{ onEvent: (event) => fallbackEvents.push(event) },
	);
	assert.strictEqual(fallbackResult.stdout, "回退回答");
	assert.ok(fallbackEvents.some((event) => event.type === "assistant-reset"));
	assert.ok(fallbackEvents.some(
		(event) => event.type === "status" && event.stage === "stream-fallback",
	));

	const figurePath = "wiki/assets/figures/example/figure-1.png";
	const unreferencedPath = "wiki/assets/figures/example/figure-2.png";
	const autoFigurePath = "wiki/assets/figures/example/figure-3.png";
	const sourceNote = new TFileStub({
		path: "wiki/sources/example.md",
		basename: "example",
	});
	const methodNote = new TFileStub({
		path: "wiki/methods/example-method.md",
		basename: "example-method",
	});
	const figureFile = new TFileStub({
		path: figurePath,
		name: "figure-1.png",
		stat: { size: 1024 },
	});
	const autoFigureFile = new TFileStub({
		path: autoFigurePath,
		name: "figure-3.png",
		stat: { size: 2048 },
	});
	const filesByPath = new Map([
		[sourceNote.path, sourceNote],
		[methodNote.path, methodNote],
		[figurePath, figureFile],
		[autoFigurePath, autoFigureFile],
	]);
	plugin.app = {
		vault: {
			getAbstractFileByPath: (value) => filesByPath.get(value) || null,
			getMarkdownFiles: () => [sourceNote, methodNote],
		},
		metadataCache: {
			resolvedLinks: {
				[sourceNote.path]: { [figurePath]: 2 },
			},
			getFileCache: (file) => {
				if (file.path === sourceNote.path) {
					return {
						frontmatter: { title_zh: "示例论文" },
						embeds: [
							{ link: figurePath },
							{ link: figurePath },
							{ link: autoFigurePath },
						],
					};
				}
				return {
					frontmatter: { title: "Example method" },
					embeds: [{ link: figurePath }],
				};
			},
			getFirstLinkpathDest: (link) => filesByPath.get(link) || null,
		},
	};
	const referenceIndex = plugin.buildVaultImageReferenceIndex([
		{ path: figurePath },
		{ path: unreferencedPath },
	]);
	assert.deepStrictEqual(referenceIndex.get(figurePath), [
		{ path: sourceNote.path, title: "示例论文", count: 2 },
		{ path: methodNote.path, title: "Example method", count: 1 },
	]);
	assert.deepStrictEqual(referenceIndex.get(unreferencedPath), []);

	const linkedNotes = plugin.extractQuestionNoteFiles(
		"请分析 obsidian://open?vault=knowledge-base&file=wiki%2Fsources%2Fexample中的图片，并联系 [[wiki/methods/example-method|方法页]]。",
	);
	assert.deepStrictEqual(
		linkedNotes.map((file) => file.path),
		[sourceNote.path, methodNote.path],
	);
	const discovered = await plugin.resolveQuestionImageAttachments(
		"请分析 obsidian://open?vault=knowledge-base&file=wiki%2Fsources%2Fexample中的图片",
	);
	assert.strictEqual(discovered.discoveredCount, 2);
	assert.deepStrictEqual(
		discovered.attachments.map((attachment) => attachment.path),
		[figurePath, autoFigurePath],
	);
	assert.ok(discovered.attachments.every(
		(attachment) => attachment.sourceNotePath === sourceNote.path,
	));
}

async function testSerializedSettingsSnapshots() {
	const persistencePlugin = new AgentDashboardPlugin();
	persistencePlugin.settings = {
		projectRoot: "first-root",
		providerProfiles: [],
		activeProviderId: "",
	};
	persistencePlugin.taskRuns = [{
		id: "run-1",
		output: "x".repeat(50000),
		error: "",
	}];
	persistencePlugin.querySessions = [{
		id: "session-1",
		messages: Array.from({ length: 40 }, (_, index) => ({
			id: `message-${index}`,
			content: "y".repeat(10000),
			error: "",
		})),
	}];
	persistencePlugin.activeQuerySessionId = "session-1";
	const snapshots = [];
	persistencePlugin.saveData = async (snapshot) => {
		await new Promise((resolve) => setTimeout(resolve, 5));
		snapshots.push(snapshot);
	};
	const first = persistencePlugin.saveSettings();
	persistencePlugin.settings.projectRoot = "second-root";
	const second = persistencePlugin.saveSettings();
	await Promise.all([first, second]);
	assert.deepStrictEqual(
		snapshots.map((snapshot) => snapshot.settings.projectRoot),
		["first-root", "second-root"],
	);
	assert.strictEqual(snapshots[0].taskRuns[0].output.length, 12000);
	assert.strictEqual(snapshots[0].querySessions[0].messages.length, 30);
	assert.strictEqual(
		snapshots[0].querySessions[0].messages[0].content.length,
		8000,
	);
}

Promise.all([testDirectApiQuery(), testSerializedSettingsSnapshots()])
	.then(() => console.log("DASHBOARD_QUERY_VIEW_TEST_OK"))
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
