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

console.log("DASHBOARD_QUERY_VIEW_TEST_OK");
