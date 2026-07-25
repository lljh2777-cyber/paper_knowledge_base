"use strict";

const assert = require("assert");
const Module = require("module");
const path = require("path");

const originalLoad = Module._load;
Module._load = function loadWithObsidianStub(request, parent, isMain) {
	if (request === "obsidian") {
		class Base {}
		return {
			ItemView: Base,
			MarkdownRenderer: { render: async () => {} },
			Modal: Base,
			Notice: class {},
			Plugin: Base,
			PluginSettingTab: Base,
			Setting: class {},
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
const AgentDashboardPlugin = require(pluginPath);
Module._load = originalLoad;

const plugin = Object.create(AgentDashboardPlugin.prototype);
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
	plugin.directQueryRuns = new Map();
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
	assert.strictEqual(plugin.directQueryRuns.size, 0);

	await assert.rejects(
		() => plugin.runDirectVaultQuery(
			"run-web",
			profile.id,
			"联网搜索",
			[],
			"web",
		),
		(error) => /仅支持知识库证据/.test(error.message),
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
}

testDirectApiQuery()
	.then(() => console.log("DASHBOARD_QUERY_VIEW_TEST_OK"))
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
