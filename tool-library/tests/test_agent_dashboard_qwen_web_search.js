"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..", "..");
const pluginPath = path.join(
	projectRoot,
	"knowledge-base",
	".obsidian",
	"plugins",
	"agent-Dashboard",
	"main.js",
);
const source = fs.readFileSync(pluginPath, "utf8");

class ObsidianBase {}

const obsidianStub = {
	ItemView: ObsidianBase,
	MarkdownRenderer: {},
	Modal: ObsidianBase,
	Notice: class {},
	Plugin: ObsidianBase,
	PluginSettingTab: ObsidianBase,
	SecretComponent: ObsidianBase,
	Setting: ObsidianBase,
	normalizePath: (value) => value,
	requestUrl: async () => {
		throw new Error("requestUrl must not be called by the protocol test");
	},
	setIcon: () => {},
};

const sandbox = {
	Buffer,
	URL,
	clearTimeout,
	console,
	module: { exports: {} },
	process,
	setTimeout,
	window: { clearTimeout, setTimeout },
	require: (id) => (id === "obsidian" ? obsidianStub : require(id)),
};

vm.runInNewContext(
	`${source}
	globalThis.__qwenWebSearchTestHooks = {
		extractModelProvidedWebSources,
		normalizeProviderProfile,
		OpenAICompatibleProvider,
		profileSupportsDirectWebSearch,
	};`,
	sandbox,
	{ filename: pluginPath },
);

const hooks = sandbox.__qwenWebSearchTestHooks;
const profile = hooks.normalizeProviderProfile({
	id: "qwen-web",
	name: "Qwen Web",
	type: "openai-compatible",
	baseUrl: "https://example.invalid/compatible-mode/v1",
	model: "qwen3.7-plus",
	webSearch: {
		enabled: true,
		configured: true,
		protocol: "qwen-chat-completions",
		forcedSearch: true,
		searchStrategy: "turbo",
		assignedSites: ["https://help.aliyun.com/path", "nature.com", "nature.com"],
		timeoutSeconds: 75,
	},
	lastTest: {
		ok: true,
		webSearchVerified: true,
	},
});
const provider = new hooks.OpenAICompatibleProvider({}, profile);
const messages = [{ role: "user", content: "test" }];

const plainBody = provider.chatBody({ model: profile.model, messages });
assert.equal(plainBody.enable_search, undefined);
assert.equal(plainBody.search_options, undefined);

const searchBody = provider.chatBody({
	model: profile.model,
	messages,
	webSearch: true,
});
assert.equal(searchBody.enable_search, true);
assert.equal(searchBody.search_options.forced_search, true);
assert.equal(searchBody.search_options.search_strategy, "turbo");
assert.deepEqual(
	Array.from(searchBody.search_options.assigned_site_list),
	["help.aliyun.com", "nature.com"],
);
assert.equal(hooks.profileSupportsDirectWebSearch(profile), true);
assert.equal(profile.webSearch.timeoutSeconds, 75);

const links = hooks.extractModelProvidedWebSources(
	"参考 [阿里云联网搜索](https://help.aliyun.com/zh/model-studio/web-search)。",
);
assert.equal(links.length, 1);
assert.equal(links[0].verification, "model");

const unsupported = hooks.normalizeProviderProfile({
	id: "other",
	type: "openai-compatible",
	model: "deepseek-v4-pro",
	webSearch: { enabled: true, configured: true },
});
assert.throws(
	() => new hooks.OpenAICompatibleProvider({}, unsupported).chatBody({
		model: unsupported.model,
		messages,
		webSearch: true,
	}),
	/没有启用 Qwen3\.7-Plus/,
);

(async () => {
	let capturedOptions = null;
	provider.request = async (_route, options) => {
		capturedOptions = options;
		return {
			json: {
				choices: [{ message: { content: "OK" } }],
			},
		};
	};
	provider.headers = async () => ({ "Content-Type": "application/json" });
	await provider.complete({
		model: profile.model,
		messages,
		webSearch: true,
	});
	assert.equal(capturedOptions.timeoutMs, 75000);

	const DashboardPlugin = sandbox.module.exports;
	const plugin = Object.create(DashboardPlugin.prototype);
	plugin.querySessions = [
		{
			id: "empty-current",
			title: "新对话",
			messages: [],
			updatedAt: "2026-07-25T12:00:00.000Z",
		},
		{
			id: "kept-session",
			title: "已有问题",
			messages: [{ role: "user", content: "test" }],
			updatedAt: "2026-07-25T11:00:00.000Z",
		},
	];
	plugin.activeQuerySessionId = "empty-current";
	let saveCount = 0;
	plugin.saveSettings = async () => {
		saveCount += 1;
	};
	const nextSession = await plugin.deleteActiveQuerySession();
	assert.equal(nextSession.id, "kept-session");
	assert.equal(plugin.querySessions.length, 1);
	assert.equal(plugin.activeQuerySessionId, "kept-session");
	assert.equal(saveCount, 1);

	plugin.querySessions = [{
		id: "only-empty",
		title: "新对话",
		messages: [],
		updatedAt: "2026-07-25T12:00:00.000Z",
	}];
	plugin.activeQuerySessionId = "only-empty";
	const reusedSession = await plugin.createQuerySession();
	assert.equal(reusedSession.id, "only-empty");
	assert.equal(plugin.querySessions.length, 1);
	console.log("Qwen web-search protocol tests passed.");
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
