"use strict";

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");

const originalLoad = Module._load;
Module._load = function loadWithObsidianStub(request, parent, isMain) {
	if (request === "obsidian") {
		class Base {}
		return {
			Component: Base,
			FileSystemAdapter: Base,
			ItemView: Base,
			MarkdownRenderer: { render: async () => {} },
			Menu: class {
				addItem() { return this; }
				showAtMouseEvent() {}
			},
			Modal: Base,
			Notice: class {},
			Plugin: Base,
			PluginSettingTab: Base,
			SecretComponent: Base,
			Setting: Base,
			TFile: Base,
			normalizePath: (value) => value,
			requestUrl: async () => ({ status: 200, text: "", json: null, headers: {} }),
			setIcon: () => {},
		};
	}
	return originalLoad.call(this, request, parent, isMain);
};

const projectRoot = path.resolve(__dirname, "../..");
const pluginRoot = path.join(
	projectRoot,
	"knowledge-base/.obsidian/plugins/agent-Dashboard",
);
const AgentDashboardPlugin = require(path.join(pluginRoot, "main.js"));
Module._load = originalLoad;

const source = (relativePath) => fs.readFileSync(path.join(pluginRoot, relativePath), "utf8");
const pluginSource = source("src/plugin.ts");
const serviceSource = source("src/annotations/annotation-service.ts");
const popoverSource = source("src/annotations/annotation-popover.ts");
const settingsSource = source("src/settings/settings-tab.ts");
const runtimeSettingsSource = source("src/runtime/settings.ts");
const actionsSource = source("src/actions.ts");
const styles = source("styles.css");

assert.match(actionsSource, /id:\s*"annotation-explain"/);
assert.match(actionsSource, /showInRail:\s*false/);
assert.match(pluginSource, /id:\s*"annotate-selected-text"/);
assert.match(pluginSource, /modifiers:\s*\["Shift"\],\s*key:\s*"S"/);
assert.match(pluginSource, /event\.ctrlKey\s*\|\|\s*event\.metaKey/);
assert.match(pluginSource, /event\.shiftKey/);
assert.match(pluginSource, /"mouseover"/);
assert.match(
	pluginSource,
	/a\.internal-link\[data-href\^="wiki\/annotations\/"\]\[data-href\*="#\^ann-"\]/,
);
assert.match(serviceSource, /wiki\/annotations/);
assert.match(serviceSource, /#\^\$\{record\.id\}/);
assert.match(serviceSource, /isTableCell:\s*block\.matches\("td, th"\)/);
assert.ok(
	serviceSource.includes('selection.isTableCell ? "\\\\|" : "|"'),
	"table-cell annotations should escape the wikilink alias separator",
);
assert.match(serviceSource, /settings\.annotationBackendId/);
assert.match(serviceSource, /settings\.annotationMaxTokens/);
assert.match(serviceSource, /settings\.annotationCodexModel/);
assert.match(serviceSource, /settings\.annotationCodexReasoningEffort/);
assert.match(serviceSource, /settings\.annotationCodexServiceTier/);
assert.match(serviceSource, /settings\.annotationClaudeModel/);
assert.match(serviceSource, /settings\.annotationClaudeReasoningEffort/);
assert.match(serviceSource, /resolveCliActionExecutionConfig/);
assert.match(serviceSource, /getCliBackendLabel/);
assert.match(settingsSource, /title:\s*"批注 AI"/);
assert.match(settingsSource, /renderAnnotationSettings/);
assert.match(settingsSource, /Direct API · \$\{profile\.name\}/);
assert.match(settingsSource, /最大输出 Token/);
assert.match(runtimeSettingsSource, /annotationMaxTokens:\s*900/);
assert.match(pluginSource, /archiveStatus:\s*"pending"/);
assert.match(popoverSource, /保留并存档/);
assert.match(popoverSource, /手动批注/);
assert.match(popoverSource, /AI 解释/);
assert.match(popoverSource, /MarkdownRenderer\.render/);
assert.match(popoverSource, /cancel\.addEventListener\("click", \(\) => this\.renderChooser\(\)\)/);
assert.doesNotMatch(popoverSource, /text:\s*"关闭"/);
assert.match(styles, /a\.internal-link\[data-href\^="wiki\/annotations\/"\]/);
const repairedTableSource = fs.readFileSync(
	path.join(projectRoot, "knowledge-base/wiki/sources/cho_pan-cancer_2026.md"),
	"utf8",
);
assert.match(
	repairedTableSource,
	/\[\[wiki\/annotations\/cho_pan-cancer_2026#\^ann-6d4763cdfc\\\|CR2\/FCER2/,
);

const plugin = new AgentDashboardPlugin();
const targets = plugin.parseAnnotationArchiveTargets(
	'完成。\nANNOTATION_ARCHIVE_TARGETS: ["wiki/methods/hi-c", "knowledge-base/wiki/concepts/spatial-proximity.md"]',
);
assert.deepStrictEqual(targets, [
	"wiki/methods/hi-c",
	"wiki/concepts/spatial-proximity",
]);
assert.deepStrictEqual(
	plugin.parseAnnotationArchiveTargets(
		'ANNOTATION_ARCHIVE_TARGETS: ["wiki/sources/not-allowed", "../outside"]',
	),
	[],
);

console.log("DASHBOARD_ANNOTATIONS_TEST_OK");
