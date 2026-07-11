"use strict";

const {
	ItemView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	normalizePath,
} = require("obsidian");

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const VIEW_TYPE = "agent-dashboard-research-vault";
const DEFAULT_SETTINGS = {
	projectRoot: "",
	codexExecutable: "C:\\Users\\Thomas Wade\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe",
	pythonExecutable: "D:\\python\\python.exe",
	taskTimeoutMinutes: 60,
};

const ACTIONS = [
	{
		id: "paper-ingest",
		label: "文献入库",
		agent: "research-vault-ingest",
		description: "输入 PDF、本地来源、DOI、URL、Zotero key 或 BibTeX/RIS 记录。该操作可更新入库阶段拥有的元数据、索引和日志，但不会生成论文结论。",
		placeholder: "例如：D:\\Downloads\\paper.pdf\n或 DOI / URL / Zotero key，以及你希望采用的处理范围",
		requiresInput: true,
		writes: true,
		enabled: true,
	},
	{
		id: "pdf-xray",
		label: "PDF 深读",
		agent: "paper_xray",
		description: "输入 PDF 或 source note 路径及深读目标。该操作会调用 paper_xray 子智能体，只有完整检查全文证据后才允许升级为 x-ray。",
		placeholder: "例如：knowledge-base/wiki/sources/example.md\n重点核验方法、图 2、数据来源与局限性",
		requiresInput: true,
		writes: true,
		enabled: true,
	},
	{
		id: "code-analysis",
		label: "代码分析",
		agent: "code_reader",
		description: "输入 R/Python 项目根目录和关注重点。该操作会调用 code_reader 子智能体，只做静态阅读并更新代码说明页。",
		placeholder: "例如：D:\\Desktop\\Code_down\n分析入口、脚本关系、数据流，并按关键代码 + 解释输出",
		requiresInput: true,
		writes: true,
		enabled: true,
	},
	{
		id: "vault-retrieval",
		label: "知识库检索",
		agent: "research-vault-retrieval",
		description: "输入需要由当前 vault 回答的问题。该操作强制使用只读沙箱，结果显示在任务详情中，不写入文件。",
		placeholder: "例如：当前知识库关于 scRNA-seq 质控阈值有哪些依据和分歧？",
		requiresInput: true,
		writes: false,
		enabled: true,
	},
	{
		id: "synthesis",
		label: "综合分析",
		agent: "research-vault-synthesis",
		description: "输入跨文献主题、比较问题或目标页面。该操作可更新 synthesis、MOC、concept、method、dataset 或 project 页面及其索引。",
		placeholder: "例如：综合已有单细胞文献与代码笔记，更新 Single-cell RNA-seq 方法页并列出证据缺口",
		requiresInput: true,
		writes: true,
		enabled: true,
	},
	{
		id: "vault-lint",
		label: "知识库体检",
		agent: "research-vault-lint",
		description: "运行现有 validate_vault.py，只读取并报告问题，不自动修复或删除文件。",
		placeholder: "",
		requiresInput: false,
		writes: false,
		enabled: true,
	},
	{
		id: "okf-export",
		label: "OKF 导出",
		agent: "okf-export",
		description: "确定性导出器尚未接入。当前按钮不会写文件。",
		placeholder: "",
		requiresInput: false,
		writes: true,
		enabled: false,
	},
];

const ACTION_BY_ID = new Map(ACTIONS.map((action) => [action.id, action]));

class DashboardDataService {
	constructor(app, plugin) {
		this.app = app;
		this.plugin = plugin;
	}

	async load() {
		const files = this.app.vault.getMarkdownFiles();
		const records = await Promise.all(files.map((file) => this.readRecord(file)));
		const recordByPath = new Map(records.map((record) => [record.path, record]));
		const sourceRecords = records.filter((record) => record.path.startsWith("wiki/sources/"));
		const methodRecords = records.filter((record) => record.path.startsWith("wiki/methods/"));
		const synthesisRecords = records.filter((record) => record.path.startsWith("wiki/synthesis/"));
		const codeProjectRecords = records.filter((record) => record.path.startsWith("wiki/code/projects/") || record.type === "code-project");
		const codeScriptRecords = records.filter((record) => record.path.startsWith("wiki/code/scripts/") || record.type === "code-script");
		const codeRecords = [...codeProjectRecords, ...codeScriptRecords];
		const linkReport = this.computeLinkReport(records);
		const missingFrontmatter = records.filter((record) => record.path.startsWith("wiki/") && !record.hasFrontmatter).length;
		const paperDepth = this.computePaperDepth(sourceRecords);
		const staticReadCount = codeRecords.filter((record) => record.frontmatter.analysis_depth === "static-read").length;
		const activity = this.computeActivity(records);
		const agentRuns = await this.computeAgentRuns(recordByPath);
		const knowledgeGaps = await this.computeKnowledgeGaps(records, sourceRecords);
		const coverage = this.computeCoverage(methodRecords, synthesisRecords, knowledgeGaps);
		const okf = this.computeOkfReadiness(records, linkReport, missingFrontmatter, coverage);
		const healthScore = Math.max(0, Math.min(100, 100 - linkReport.broken.length * 2 - missingFrontmatter));
		const now = new Date();

		return {
			header: {
				scope: "研究知识库",
				title: "文献知识库智能体控制台",
				status: "本地",
				vault: this.app.vault.getName(),
				lastScan: `上次扫描 ${this.formatTime(now)}`,
			},
			actions: ACTIONS,
			metrics: [
				{
					label: "知识库健康",
					value: String(healthScore),
					unit: "",
					tone: healthScore >= 90 ? "good" : healthScore >= 75 ? "warn" : "danger",
					detail: `${linkReport.broken.length} 个断链，${missingFrontmatter} 个缺失属性区`,
				},
				{
					label: "文献流程",
					value: String(sourceRecords.length),
					unit: "",
					tone: paperDepth.needXray > 0 ? "warn" : "good",
					detail: `${paperDepth.ingested} 个已入库，${paperDepth.abstractLevel} 个 abstract-level，${paperDepth.needXray} 个待 x-ray`,
				},
				{
					label: "代码笔记",
					value: String(codeProjectRecords.length + codeScriptRecords.length),
					unit: "",
					tone: "neutral",
					detail: `${codeProjectRecords.length} 个项目，${staticReadCount} 个 static-read 笔记`,
				},
				{
					label: "知识枢纽",
					value: String(methodRecords.length + synthesisRecords.length),
					unit: "",
					tone: coverage.missingMethodPages > 0 ? "warn" : "good",
					detail: `${methodRecords.length} 个方法页，${synthesisRecords.length} 个综合页`,
				},
			],
			activity,
			agentRuns,
			knowledgeGaps,
			processingDepth: this.computeProcessingDepth(paperDepth, staticReadCount),
			coverage,
			okf,
		};
	}

	async readRecord(file) {
		const text = await this.app.vault.cachedRead(file);
		const frontmatter = this.parseFrontmatter(text);
		return {
			file,
			path: normalizePath(file.path),
			name: file.basename,
			text,
			frontmatter,
			hasFrontmatter: text.startsWith("---") && Object.keys(frontmatter).length > 0,
			type: String(frontmatter.type || this.inferType(file.path)),
			tags: this.normalizeTags(frontmatter.tags),
			mtime: file.stat.mtime,
			ctime: file.stat.ctime,
		};
	}

	parseFrontmatter(text) {
		if (!text.startsWith("---")) {
			return {};
		}
		const end = text.indexOf("\n---", 3);
		if (end === -1) {
			return {};
		}
		const raw = text.slice(3, end).trim();
		const data = {};
		let currentKey = "";
		for (const line of raw.split(/\r?\n/)) {
			const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
			if (keyMatch) {
				currentKey = keyMatch[1];
				data[currentKey] = this.parseYamlValue(keyMatch[2]);
				continue;
			}
			const listMatch = line.match(/^\s*-\s+(.*)$/);
			if (listMatch && currentKey) {
				if (!Array.isArray(data[currentKey])) {
					data[currentKey] = data[currentKey] ? [data[currentKey]] : [];
				}
				data[currentKey].push(this.cleanYamlScalar(listMatch[1]));
			}
		}
		return data;
	}

	parseYamlValue(value) {
		const trimmed = value.trim();
		if (!trimmed) {
			return "";
		}
		if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
			return trimmed
				.slice(1, -1)
				.split(",")
				.map((item) => this.cleanYamlScalar(item))
				.filter(Boolean);
		}
		return this.cleanYamlScalar(trimmed);
	}

	cleanYamlScalar(value) {
		return String(value).trim().replace(/^['"]|['"]$/g, "");
	}

	normalizeTags(tags) {
		if (Array.isArray(tags)) {
			return tags.map((tag) => String(tag));
		}
		if (typeof tags === "string" && tags.length > 0) {
			return tags.split(/[,\s]+/).filter(Boolean);
		}
		return [];
	}

	inferType(path) {
		const normalized = normalizePath(path);
		if (normalized.startsWith("wiki/sources/")) return "source";
		if (normalized.startsWith("wiki/methods/")) return "method";
		if (normalized.startsWith("wiki/synthesis/")) return "synthesis";
		if (normalized.startsWith("wiki/concepts/")) return "concept";
		if (normalized.startsWith("wiki/datasets/")) return "dataset";
		if (normalized.startsWith("wiki/code/projects/")) return "code-project";
		if (normalized.startsWith("wiki/code/scripts/")) return "code-script";
		return "note";
	}

	computePaperDepth(sourceRecords) {
		const counts = {
			metadataOnly: 0,
			ingested: 0,
			abstractLevel: 0,
			xray: 0,
			needXray: 0,
		};
		for (const record of sourceRecords) {
			const status = String(record.frontmatter.status || "").toLowerCase();
			const depth = String(record.frontmatter.analysis_depth || "").toLowerCase();
			const tags = record.tags.map((tag) => tag.toLowerCase());
			const isXray = status === "x-ray" || status === "xray" || depth === "x-ray" || tags.includes("x-ray");
			const isAbstract = status === "abstract-level" || depth === "abstract-level";
			if (isXray) {
				counts.xray += 1;
			} else if (isAbstract) {
				counts.abstractLevel += 1;
				counts.needXray += 1;
			} else {
				counts.metadataOnly += 1;
				counts.needXray += 1;
				if (status === "ingested" || !status) {
					counts.ingested += 1;
				}
			}
		}
		return counts;
	}

	computeProcessingDepth(paperDepth, staticReadCount) {
		const rows = [
			{ label: "metadata-only", count: paperDepth.metadataOnly },
			{ label: "abstract-level", count: paperDepth.abstractLevel },
			{ label: "x-ray", count: paperDepth.xray },
			{ label: "static-read", count: staticReadCount },
		];
		const total = rows.reduce((sum, row) => sum + row.count, 0) || 1;
		return rows.map((row) => ({
			...row,
			percent: Math.round((row.count / total) * 100),
		}));
	}

	computeActivity(records) {
		const now = new Date();
		const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
		const start = new Date(2026, 6, 1);
		const counts = new Map();
		const tracks = new Map();

		for (const record of records) {
			if (!record.path.startsWith("wiki/")) {
				continue;
			}
			const date = new Date(record.mtime || record.ctime);
			if (date < start || date > end) {
				continue;
			}
			const key = this.toISODate(date);
			const track = this.trackForRecord(record);
			counts.set(key, (counts.get(key) || 0) + 1);
			tracks.set(key, track);
		}

		const days = [];
		const paddedStart = this.mondayStart(start);
		const paddedEnd = this.sundayEnd(end);
		for (let cursor = new Date(paddedStart); cursor <= paddedEnd; cursor = this.addDays(cursor, 1)) {
			const key = this.toISODate(cursor);
			const count = counts.get(key) || 0;
			const inRange = cursor >= start && cursor <= end;
			days.push({
				date: key,
				count,
				inRange,
				level: inRange ? this.countToLevel(count) : 0,
				track: tracks.get(key) || "note",
			});
		}

		return {
			title: "研究活动热力图",
			rangeLabel: `${Array.from(counts.values()).filter((count) => count > 0).length} 个活跃日，${this.formatMonthYear(start)}-${this.formatMonthYear(end)}`,
			tracks: ["文献", "方法", "综合", "代码"],
			days,
		};
	}

	trackForRecord(record) {
		if (record.path.startsWith("wiki/sources/")) return "文献";
		if (record.path.startsWith("wiki/methods/")) return "方法";
		if (record.path.startsWith("wiki/synthesis/")) return "综合";
		if (record.path.startsWith("wiki/code/")) return "代码";
		return "笔记";
	}

	countToLevel(count) {
		if (count >= 12) return 4;
		if (count >= 7) return 3;
		if (count >= 3) return 2;
		if (count >= 1) return 1;
		return 0;
	}

	async computeAgentRuns(recordByPath) {
		const logRecord = recordByPath.get("wiki/log.md");
		const persistedRuns = this.plugin.getTaskRuns().map((run) => ({
			agent: run.agent,
			task: run.summary || run.label,
			status: run.status,
			time: this.formatRunTime(run.startedAt),
			runId: run.id,
		}));
		const logRuns = [];
		if (logRecord) {
			const headingPattern = /^##\s+\[([^\]]+)\]\s+([^|\n]+)(?:\|\s*(.+))?$/gm;
			let match;
			while ((match = headingPattern.exec(logRecord.text)) !== null) {
				const date = match[1].trim();
				const category = match[2].trim();
				const title = (match[3] || category).trim();
				logRuns.push({
					agent: this.agentForCategory(category),
					task: title,
					status: "done",
					time: date,
				});
			}
		}
		const combined = [...persistedRuns, ...logRuns.reverse()].slice(0, 6);
		if (combined.length > 0) {
			return combined;
		}
		return [{ agent: "research-vault", task: "尚无智能体运行记录", status: "planned", time: "待处理" }];
	}

	formatRunTime(value) {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return "未知时间";
		return new Intl.DateTimeFormat("zh-CN", {
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		}).format(date);
	}

	agentForCategory(category) {
		const value = category.toLowerCase();
		if (value.includes("x-ray")) return "paper_xray";
		if (value.includes("code")) return "code_reader";
		if (value.includes("lint") || value.includes("maintenance")) return "research-vault-lint";
		if (value.includes("synthesis")) return "research-vault-synthesis";
		if (value.includes("source")) return "research-vault-source-note";
		if (value.includes("ingest")) return "research-vault-ingest";
		return "research-vault";
	}

	async computeKnowledgeGaps(records, sourceRecords) {
		const gaps = [];
		const methodCandidates = new Set();
		for (const record of records) {
			const matches = record.text.matchAll(/[-*]\s+([^。\n]+?)（待建方法页/g);
			for (const match of matches) {
				methodCandidates.add(match[1].replace(/\[\[[^\]]+\]\]/g, "").trim());
			}
		}
		for (const title of Array.from(methodCandidates).slice(0, 4)) {
			gaps.push({ type: "method", title: `待建方法页：${title}`, severity: "medium" });
		}
		const needXray = sourceRecords
			.filter((record) => {
				const status = String(record.frontmatter.status || "").toLowerCase();
				const tags = record.tags.map((tag) => tag.toLowerCase());
				return status !== "x-ray" && status !== "xray" && !tags.includes("x-ray");
			})
			.sort((a, b) => b.mtime - a.mtime)
			.slice(0, 3);
		for (const record of needXray) {
			gaps.push({ type: "paper", title: `待 x-ray 深读：${record.frontmatter.title || record.name}`, severity: "high" });
		}
		if (!records.some((record) => record.path.startsWith("wiki/methods/single-cell-rna-seq"))) {
			gaps.push({ type: "method", title: "缺少 Single-cell RNA-seq 方法枢纽", severity: "high" });
		}
		gaps.push({ type: "okf", title: "OKF 导出尚未实现 wikilink 转换", severity: "medium" });
		return gaps.slice(0, 6);
	}

	computeCoverage(methodRecords, synthesisRecords, knowledgeGaps) {
		const recentHubs = [...methodRecords, ...synthesisRecords]
			.sort((a, b) => b.mtime - a.mtime)
			.slice(0, 4)
			.map((record) => record.frontmatter.title || record.name);
		const missingMethodPages = knowledgeGaps.filter((gap) => gap.type === "method").length;
		return {
			methodNodes: methodRecords.length,
			synthesisNodes: synthesisRecords.length,
			missingMethodPages,
			recentHubs,
		};
	}

	computeOkfReadiness(records, linkReport, missingFrontmatter, coverage) {
		const wikiRecords = records.filter((record) => record.path.startsWith("wiki/") && !record.path.endsWith("index.md") && !record.path.endsWith("log.md"));
		const typedRecords = wikiRecords.filter((record) => Boolean(record.frontmatter.type));
		const typePercent = wikiRecords.length === 0 ? 100 : Math.round((typedRecords.length / wikiRecords.length) * 100);
		const hasWikiIndex = records.some((record) => record.path === "wiki/index.md");
		const hasWikiLog = records.some((record) => record.path === "wiki/log.md");
		const hasWikilinks = linkReport.total > 0;
		return {
			readiness: [
				{
					label: `属性区映射 ${typePercent}%`,
					state: typePercent >= 95 ? "ready" : "pending",
				},
				{
					label: "index/log 已存在",
					state: hasWikiIndex && hasWikiLog ? "ready" : "pending",
				},
				{
					label: "wikilink 转换待实现",
					state: hasWikilinks ? "pending" : "ready",
				},
				{
					label: "bundle 导出待规划",
					state: "planned",
				},
			],
			maintenanceRisk: {
				level: linkReport.broken.length > 0 || missingFrontmatter > 0 ? "watch" : "low",
				items: [
					`${linkReport.broken.length} 个内部断链`,
					`${coverage.missingMethodPages} 个方法枢纽候选`,
					`${missingFrontmatter} 个 wiki 笔记缺失属性区`,
				],
			},
		};
	}

	computeLinkReport(records) {
		const knownPaths = new Set();
		const knownBasenames = new Set();
		for (const record of records) {
			const withoutExt = record.path.replace(/\.md$/i, "");
			knownPaths.add(withoutExt);
			knownBasenames.add(record.name);
		}
		const broken = [];
		let total = 0;
		for (const record of records) {
			if (!record.path.startsWith("wiki/") && !record.path.includes("索引")) {
				continue;
			}
			const text = this.stripCode(record.text);
			for (const match of text.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
				total += 1;
				const link = match[1].trim();
				if (!link) continue;
				const target = link.endsWith(".md") ? link.slice(0, -3) : link;
				const candidates = [
					normalizePath(target),
					normalizePath(`wiki/${target}`),
				];
				if (!candidates.some((candidate) => knownPaths.has(candidate)) && !knownBasenames.has(target)) {
					broken.push({ source: record.path, target });
				}
			}
		}
		return { total, broken };
	}

	stripCode(text) {
		return text
			.replace(/^(```+|~~~+)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, "")
			.replace(/`[^`\n]*`/g, "");
	}

	formatTime(date) {
		return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
	}

	formatMonthYear(date) {
		return new Intl.DateTimeFormat("zh-CN", { month: "short", year: "numeric" }).format(date);
	}

	addDays(date, count) {
		const next = new Date(date);
		next.setDate(next.getDate() + count);
		return next;
	}

	mondayStart(date) {
		const next = new Date(date);
		const day = next.getDay();
		const offset = day === 0 ? -6 : 1 - day;
		next.setDate(next.getDate() + offset);
		return next;
	}

	sundayEnd(date) {
		const next = new Date(date);
		const day = next.getDay();
		const offset = day === 0 ? 0 : 7 - day;
		next.setDate(next.getDate() + offset);
		return next;
	}

	toISODate(date) {
		const year = String(date.getFullYear());
		const month = String(date.getMonth() + 1).padStart(2, "0");
		const day = String(date.getDate()).padStart(2, "0");
		return `${year}-${month}-${day}`;
	}
}

class ActionInputModal extends Modal {
	constructor(app, action, onSubmit) {
		super(app);
		this.action = action;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("agent-dashboard-modal");
		this.setTitle(this.action.label);
		contentEl.createEl("p", {
			cls: "agent-dashboard-modal-description",
			text: this.action.description,
		});
		if (this.action.writes) {
			contentEl.createEl("p", {
				cls: "agent-dashboard-modal-warning",
				text: "运行后，Codex 可在该 skill 拥有的范围内更新项目文件。提交此表单即确认本次写入授权。",
			});
		}
		const input = contentEl.createEl("textarea", {
			cls: "agent-dashboard-modal-input",
			attr: {
				placeholder: this.action.placeholder,
				rows: "8",
				"aria-label": `${this.action.label}任务说明`,
			},
		});
		const footer = contentEl.createDiv({ cls: "agent-dashboard-modal-actions" });
		const cancel = footer.createEl("button", { text: "取消" });
		cancel.type = "button";
		const submit = footer.createEl("button", {
			cls: "mod-cta",
			text: "开始执行",
		});
		submit.type = "button";
		submit.disabled = this.action.requiresInput;

		const syncSubmitState = () => {
			submit.disabled = this.action.requiresInput && input.value.trim().length === 0;
		};
		const submitAction = () => {
			const value = input.value.trim();
			if (this.action.requiresInput && !value) return;
			this.close();
			this.onSubmit(value);
		};
		input.addEventListener("input", syncSubmitState);
		input.addEventListener("keydown", (event) => {
			if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
				event.preventDefault();
				submitAction();
			}
		});
		cancel.addEventListener("click", () => this.close());
		submit.addEventListener("click", submitAction);
		window.setTimeout(() => input.focus(), 0);
	}

	onClose() {
		this.contentEl.empty();
	}
}

class TaskResultModal extends Modal {
	constructor(app, run) {
		super(app);
		this.run = run;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("agent-dashboard-modal", "agent-dashboard-result-modal");
		this.setTitle(`${this.run.label} · ${this.displayStatus(this.run.status)}`);
		contentEl.createEl("p", {
			cls: "agent-dashboard-modal-description",
			text: `${this.run.agent} · ${new Date(this.run.startedAt).toLocaleString("zh-CN")}`,
		});
		if (this.run.summary) {
			contentEl.createEl("p", {
				cls: "agent-dashboard-result-summary",
				text: this.run.summary,
			});
		}
		const output = this.run.output || this.run.error || "该任务尚未产生输出。";
		contentEl.createEl("pre", {
			cls: "agent-dashboard-result-output",
			text: output,
		});
		const footer = contentEl.createDiv({ cls: "agent-dashboard-modal-actions" });
		const copy = footer.createEl("button", { text: "复制结果" });
		copy.type = "button";
		copy.addEventListener("click", async () => {
			await navigator.clipboard.writeText(output);
			new Notice("任务结果已复制");
		});
		const close = footer.createEl("button", { cls: "mod-cta", text: "关闭" });
		close.type = "button";
		close.addEventListener("click", () => this.close());
	}

	displayStatus(status) {
		return {
			done: "已完成",
			failed: "失败",
			interrupted: "已中断",
			running: "运行中",
			queued: "排队中",
		}[status] || status;
	}

	onClose() {
		this.contentEl.empty();
	}
}

class DashboardView extends ItemView {
	constructor(leaf, plugin) {
		super(leaf);
		this.plugin = plugin;
		this.dataService = new DashboardDataService(plugin.app, plugin);
		this.data = null;
		this.runsFilter = "all";
		this.gapsFilter = "all";
		this.monthFormatter = new Intl.DateTimeFormat("zh-CN", { month: "short" });
		this.reloadTimer = null;
	}

	getViewType() {
		return VIEW_TYPE;
	}

	getDisplayText() {
		return "智能体控制台";
	}

	getIcon() {
		return "layout-dashboard";
	}

	async onOpen() {
		this.renderLoading();
		this.registerVaultRefreshEvents();
		await this.loadAndRender();
	}

	async onClose() {
		this.contentEl.empty();
	}

	registerVaultRefreshEvents() {
		const refresh = () => this.scheduleReload();
		this.registerEvent(this.app.vault.on("create", refresh));
		this.registerEvent(this.app.vault.on("modify", refresh));
		this.registerEvent(this.app.vault.on("delete", refresh));
		this.registerEvent(this.app.vault.on("rename", refresh));
	}

	scheduleReload() {
		if (this.reloadTimer) {
			window.clearTimeout(this.reloadTimer);
		}
		this.reloadTimer = window.setTimeout(() => {
			this.loadAndRender();
		}, 1200);
	}

	async loadAndRender() {
		try {
			this.data = await this.dataService.load();
			this.renderDashboard();
		} catch (error) {
			console.error("Agent Dashboard failed to load vault data", error);
			this.renderError(error);
		}
	}

	renderLoading() {
		this.contentEl.empty();
		this.contentEl.addClass("agent-dashboard-view");
		const shell = this.contentEl.createDiv({ cls: "agent-dashboard-shell" });
		const panel = shell.createDiv({ cls: "agent-dashboard-loading-panel" });
		panel.createEl("p", { cls: "agent-dashboard-eyebrow", text: "研究知识库" });
		panel.createEl("h1", { text: "正在扫描本地知识库..." });
		panel.createEl("p", { cls: "agent-dashboard-loading-copy", text: "正在读取 Markdown 文件、属性区、wikilink、日志记录和笔记活动。" });
	}

	renderError(error) {
		this.contentEl.empty();
		this.contentEl.addClass("agent-dashboard-view");
		const shell = this.contentEl.createDiv({ cls: "agent-dashboard-shell" });
		const panel = shell.createDiv({ cls: "agent-dashboard-error-panel" });
		panel.createEl("p", { cls: "agent-dashboard-eyebrow", text: "控制台错误" });
		panel.createEl("h1", { text: "无法读取知识库数据" });
		panel.createEl("p", { cls: "agent-dashboard-loading-copy", text: error instanceof Error ? error.message : String(error) });
	}

	renderDashboard() {
		if (!this.data) {
			this.renderLoading();
			return;
		}
		this.contentEl.empty();
		this.contentEl.addClass("agent-dashboard-view");
		const shell = this.contentEl.createDiv({ cls: "agent-dashboard-shell" });
		this.renderHeader(shell);
		this.renderActions(shell);
		const main = shell.createEl("main", {
			cls: "agent-dashboard-grid",
			attr: { "aria-label": "研究知识库控制台" },
		});
		this.renderStats(main);
		this.renderHeatmap(main);
		this.renderAgentRuns(main);
		this.renderKnowledgeGaps(main);
		this.renderProcessingDepth(main);
		this.renderCoverage(main);
		this.renderOkfReadiness(main);
	}

	renderHeader(parent) {
		const header = parent.createEl("header", { cls: "agent-dashboard-header" });
		const titleBlock = header.createDiv({ cls: "agent-dashboard-title-block" });
		titleBlock.createEl("p", { cls: "agent-dashboard-eyebrow", text: this.data.header.scope });
		titleBlock.createEl("h1", { text: this.data.header.title });
		const status = header.createDiv({ cls: "agent-dashboard-header-status", attr: { "aria-label": "知识库状态" } });
		const pill = status.createEl("button", {
			cls: "agent-dashboard-status-pill agent-dashboard-local-pill",
			text: this.data.header.status,
			attr: { "aria-pressed": "true" },
		});
		pill.type = "button";
		status.createSpan({ cls: "agent-dashboard-vault-chip", text: this.data.header.vault });
		status.createSpan({ cls: "agent-dashboard-scan-time", text: this.data.header.lastScan });
		const refresh = status.createEl("button", {
			cls: "agent-dashboard-refresh-button",
			text: "刷新",
			attr: { "aria-label": "刷新控制台状态" },
		});
		refresh.type = "button";
		this.registerDomEvent(refresh, "click", async () => {
			await this.runRefresh(refresh);
		});
	}

	renderActions(parent) {
		const rail = parent.createEl("nav", { cls: "agent-dashboard-action-rail", attr: { "aria-label": "研究知识库操作" } });
		this.data.actions.forEach((action) => {
			const isRunning = this.plugin.isActionRunning(action.id);
			const button = rail.createEl("button", {
				cls: "agent-dashboard-action-button",
				attr: {
					"aria-label": action.enabled ? action.label : `${action.label}，待接入`,
					title: action.description,
				},
			});
			button.type = "button";
			button.disabled = !action.enabled || isRunning;
			if (!action.enabled) button.addClass("is-unavailable");
			if (isRunning) button.addClass("is-running");
			button.createSpan({ cls: "agent-dashboard-action-label", text: action.label });
			button.createSpan({
				cls: "agent-dashboard-action-state",
				text: !action.enabled ? "待接入" : isRunning ? "运行中" : "空闲",
			});
			this.registerDomEvent(button, "click", () => {
				this.openAction(action);
			});
		});
	}

	renderStats(parent) {
		const grid = parent.createEl("section", { cls: "agent-dashboard-metric-grid", attr: { "aria-label": "知识库摘要指标" } });
		this.data.metrics.forEach((metric) => {
			const card = grid.createEl("article", { cls: `agent-dashboard-metric-card agent-dashboard-tone-${metric.tone}` });
			card.createDiv({ cls: "agent-dashboard-metric-label", text: metric.label });
			const value = card.createDiv({ cls: "agent-dashboard-metric-value" });
			value.createSpan({ text: metric.value });
			if (metric.unit.length > 0) {
				value.createEl("small", { text: metric.unit });
			}
			card.createEl("p", { cls: "agent-dashboard-metric-detail", text: metric.detail });
		});
	}

	renderHeatmap(parent) {
		const panel = this.createPanel(parent, "agent-dashboard-panel-wide agent-dashboard-heatmap-panel", "知识活动", this.data.activity.title, this.data.activity.rangeLabel);
		const stage = panel
			.createDiv({ cls: "agent-dashboard-heatmap-scroll", attr: { role: "img", "aria-label": "基于本地 Markdown 修改记录的每日知识库活动热力图" } })
			.createDiv({ cls: "agent-dashboard-heatmap-stage" });
		const monthRow = stage.createDiv({ cls: "agent-dashboard-month-row", attr: { "aria-hidden": "true" } });
		const graph = stage.createDiv({ cls: "agent-dashboard-heatmap-graph" });
		const weekdayLabels = graph.createDiv({ cls: "agent-dashboard-weekday-labels", attr: { "aria-hidden": "true" } });
		["一", "", "三", "", "五", "", "日"].forEach((label) => weekdayLabels.createSpan({ text: label }));
		const cells = graph.createDiv({ cls: "agent-dashboard-heatmap-cells" });
		this.renderMonthMarkers(monthRow, this.data.activity.days);
		this.data.activity.days.forEach((day) => {
			const label = day.inRange ? `${day.date}: ${day.count} 个${day.track}笔记更新` : `${day.date}: 不在统计范围内`;
			const cell = cells.createSpan({
				cls: `agent-dashboard-heat-cell agent-dashboard-heat-level-${day.inRange ? day.level : 0}`,
				attr: { "aria-label": label, title: label },
			});
			if (!day.inRange) {
				cell.addClass("agent-dashboard-heat-cell-outside");
			}
		});
		const footer = panel.createDiv({ cls: "agent-dashboard-heatmap-footer" });
		const tracks = footer.createDiv({ cls: "agent-dashboard-track-legend" });
		this.data.activity.tracks.forEach((track) => tracks.createSpan({ cls: "agent-dashboard-track-token", text: track }));
		const legend = footer.createDiv({ cls: "agent-dashboard-density-legend", attr: { "aria-label": "活动密度图例" } });
		legend.createSpan({ text: "少" });
		[0, 1, 2, 3, 4].forEach((level) => legend.createSpan({ cls: `agent-dashboard-density agent-dashboard-density-${level}` }));
		legend.createSpan({ text: "多" });
	}

	renderAgentRuns(parent) {
		const panel = this.createPanel(parent, "agent-dashboard-list-panel", "运行记录", "智能体运行");
		this.renderFilterGroup(panel, "runs");
		const list = panel.createDiv({ cls: "agent-dashboard-table-list" });
		this.renderAgentRunsList(list);
	}

	renderKnowledgeGaps(parent) {
		const panel = this.createPanel(parent, "agent-dashboard-list-panel", "知识缺口", "待处理问题");
		this.renderFilterGroup(panel, "gaps");
		const list = panel.createDiv({ cls: "agent-dashboard-table-list" });
		this.renderKnowledgeGapsList(list);
	}

	renderProcessingDepth(parent) {
		const panel = this.createPanel(parent, "agent-dashboard-tri-panel", "处理深度", "证据深度分布");
		const bar = panel.createDiv({ cls: "agent-dashboard-stacked-bar", attr: { "aria-label": "证据处理深度分布" } });
		this.data.processingDepth.forEach((row) => {
			const segment = bar.createSpan({
				cls: `agent-dashboard-bar-segment agent-dashboard-bar-${this.formatClassToken(row.label)}`,
				attr: { "aria-label": `${this.displayDepth(row.label)}: ${row.percent}%` },
			});
			segment.style.width = `${Math.max(row.percent, 2)}%`;
		});
		const list = panel.createDiv({ cls: "agent-dashboard-count-list" });
		this.data.processingDepth.forEach((row) => {
			const item = list.createDiv({ cls: "agent-dashboard-count-item" });
			item.createSpan({ cls: "agent-dashboard-count-name", text: this.displayDepth(row.label) });
			item.createSpan({ cls: "agent-dashboard-count-value", text: `${row.count} / ${row.percent}%` });
		});
	}

	renderCoverage(parent) {
		const panel = this.createPanel(parent, "agent-dashboard-tri-panel", "知识枢纽", "方法 / 综合覆盖");
		const stats = panel.createDiv({ cls: "agent-dashboard-coverage-stats" });
		[
			["方法", this.data.coverage.methodNodes],
			["综合", this.data.coverage.synthesisNodes],
			["待建", this.data.coverage.missingMethodPages],
		].forEach(([label, value]) => {
			const stat = stats.createDiv({ cls: "agent-dashboard-coverage-stat" });
			stat.createSpan({ cls: "agent-dashboard-coverage-number", text: String(value) });
			stat.createSpan({ cls: "agent-dashboard-coverage-label", text: String(label) });
		});
		const hubs = panel.createDiv({ cls: "agent-dashboard-hub-list" });
		this.data.coverage.recentHubs.forEach((hub) => hubs.createDiv({ cls: "agent-dashboard-hub-item" }).createSpan({ cls: "agent-dashboard-hub-name", text: hub }));
	}

	renderOkfReadiness(parent) {
		const panel = this.createPanel(parent, "agent-dashboard-tri-panel", "可移植输出", "OKF 就绪度");
		this.renderOkfList(panel, this.data.okf);
		this.renderRiskBox(panel, this.data.okf);
	}

	renderFilterGroup(panel, type) {
		const heading = panel.find(".agent-dashboard-panel-heading");
		if (!heading) return;
		heading.addClass("agent-dashboard-compact-heading");
		const group = heading.createDiv({ cls: "agent-dashboard-filter-group", attr: { "aria-label": type === "runs" ? "筛选智能体运行记录" : "筛选知识缺口" } });
		const filters = type === "runs" ? [["all", "全部"], ["done", "已完成"], ["open", "未完成"]] : [["all", "全部"], ["high", "高"], ["medium", "中"], ["low", "低"]];
		filters.forEach(([key, label]) => {
			const active = type === "runs" ? this.runsFilter === key : this.gapsFilter === key;
			const button = group.createEl("button", {
				cls: active ? "agent-dashboard-filter-button is-active" : "agent-dashboard-filter-button",
				text: label,
				attr: { "aria-pressed": active ? "true" : "false" },
			});
			button.type = "button";
			this.registerDomEvent(button, "click", () => {
				if (type === "runs") {
					this.runsFilter = key;
				} else {
					this.gapsFilter = key;
				}
				this.renderDashboard();
			});
		});
	}

	renderAgentRunsList(parent) {
		parent.empty();
		const visibleRuns = this.data.agentRuns.filter((run) => this.isVisibleAgentRun(run));
		if (visibleRuns.length === 0) {
			parent.createEl("p", { cls: "agent-dashboard-empty-state", text: "当前筛选条件下没有运行记录。" });
			return;
		}
		visibleRuns.forEach((run) => {
			const row = run.runId
				? parent.createEl("button", { cls: "agent-dashboard-data-row agent-dashboard-run-row" })
				: parent.createEl("article", { cls: "agent-dashboard-data-row" });
			if (run.runId) {
				row.type = "button";
				row.setAttr("title", "查看任务输出");
				this.registerDomEvent(row, "click", () => {
					const taskRun = this.plugin.getTaskRun(run.runId);
					if (taskRun) new TaskResultModal(this.app, taskRun).open();
				});
			}
			row.createSpan({ cls: "agent-dashboard-row-type", text: `${run.agent} / ${run.time}` });
			row.createSpan({ cls: "agent-dashboard-row-title", text: run.task });
			row.createSpan({ cls: `agent-dashboard-status-badge agent-dashboard-status-${run.status}`, text: this.displayStatus(run.status) });
		});
	}

	renderKnowledgeGapsList(parent) {
		parent.empty();
		this.data.knowledgeGaps.filter((gap) => this.isVisibleKnowledgeGap(gap)).forEach((gap) => {
			const row = parent.createEl("article", { cls: "agent-dashboard-data-row" });
			row.createSpan({ cls: "agent-dashboard-row-type", text: this.displayGapType(gap.type) });
			row.createSpan({ cls: "agent-dashboard-row-title", text: gap.title });
			row.createSpan({ cls: `agent-dashboard-severity-badge agent-dashboard-severity-${gap.severity}`, text: this.displaySeverity(gap.severity) });
		});
	}

	renderOkfList(parent, okf) {
		const list = parent.createDiv({ cls: "agent-dashboard-okf-list" });
		okf.readiness.forEach((item) => {
			const row = list.createDiv({ cls: "agent-dashboard-okf-item" });
			row.createSpan({ cls: "agent-dashboard-okf-label", text: item.label });
			row.createSpan({ cls: `agent-dashboard-okf-state agent-dashboard-okf-${item.state}`, text: this.displayOkfState(item.state) });
		});
	}

	renderRiskBox(parent, okf) {
		const box = parent.createDiv({ cls: "agent-dashboard-risk-box" });
		const head = box.createDiv({ cls: "agent-dashboard-risk-head" });
		head.createSpan({ text: "维护风险" });
		head.createSpan({ text: this.displayRisk(okf.maintenanceRisk.level) });
		const list = box.createEl("ul", { cls: "agent-dashboard-risk-list" });
		okf.maintenanceRisk.items.forEach((item) => list.createEl("li", { text: item }));
	}

	createPanel(parent, className, kicker, title, stat) {
		const panel = parent.createEl("section", { cls: `agent-dashboard-panel ${className}`, attr: { "aria-label": title } });
		const heading = panel.createDiv({ cls: "agent-dashboard-panel-heading" });
		const titleBlock = heading.createDiv();
		titleBlock.createEl("p", { cls: "agent-dashboard-panel-kicker", text: kicker });
		titleBlock.createEl("h2", { text: title });
		if (stat) {
			heading.createEl("p", { cls: "agent-dashboard-panel-stat", text: stat });
		}
		return panel;
	}

	async runRefresh(button) {
		const previous = button.getText();
		button.disabled = true;
		button.setText("扫描中");
		await this.loadAndRender();
		button.setText("完成");
		window.setTimeout(() => {
			button.setText(previous);
			button.disabled = false;
		}, 900);
	}

	openAction(action) {
		if (!action.enabled) {
			new Notice(`${action.label}将在后续阶段接入`);
			return;
		}
		if (this.plugin.isActionRunning(action.id)) {
			new Notice(`${action.label}正在运行`);
			return;
		}
		if (action.requiresInput) {
			new ActionInputModal(this.app, action, (value) => {
				void this.executeAction(action, value);
			}).open();
			return;
		}
		void this.executeAction(action, "");
	}

	async executeAction(action, input) {
		const summary = input.trim().split(/\r?\n/)[0].slice(0, 160) || action.description;
		const run = await this.plugin.startTaskRun(action, summary);
		await this.loadAndRender();
		let completedRun;
		try {
			const result = await this.plugin.runVaultAction(run.id, action, input);
			const output = this.formatProcessOutput(result);
			const status = result.exitCode === 0 ? "done" : "failed";
			completedRun = await this.plugin.finishTaskRun(run.id, {
				status,
				exitCode: result.exitCode,
				output,
				error: status === "failed" ? `进程退出码：${result.exitCode}` : "",
			});
			new Notice(status === "done" ? `${action.label}已完成` : `${action.label}执行失败`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			completedRun = await this.plugin.finishTaskRun(run.id, {
				status: "failed",
				exitCode: null,
				output: "",
				error: message,
			});
			new Notice(`${action.label}执行失败：${message}`);
		}
		await this.loadAndRender();
		if (completedRun) {
			new TaskResultModal(this.app, completedRun).open();
		}
	}

	formatProcessOutput(result) {
		const parts = [];
		if (result.stdout.trim()) {
			parts.push(result.stdout.trim());
		}
		if (result.stderr.trim()) {
			parts.push(`运行日志\n${result.stderr.trim()}`);
		}
		return parts.join("\n\n").slice(0, 120000) || "任务未返回文本输出。";
	}

	isVisibleAgentRun(run) {
		if (this.runsFilter === "all") return true;
		if (this.runsFilter === "open") return run.status !== "done";
		return run.status === this.runsFilter;
	}

	isVisibleKnowledgeGap(gap) {
		return this.gapsFilter === "all" || gap.severity === this.gapsFilter;
	}

	renderMonthMarkers(parent, days) {
		const weekCount = Math.ceil(days.length / 7);
		for (let week = 0; week < weekCount; week += 1) {
			const monthStart = days.slice(week * 7, week * 7 + 7).find((day) => {
				const date = new Date(`${day.date}T00:00:00`);
				return day.inRange && date.getDate() === 1;
			});
			parent.createSpan({ text: monthStart ? this.monthFormatter.format(new Date(`${monthStart.date}T00:00:00`)) : "" });
		}
	}

	displayStatus(status) {
		return {
			done: "已完成",
			failed: "失败",
			interrupted: "已中断",
			queued: "排队中",
			planned: "计划中",
			pending: "待处理",
			running: "运行中",
		}[status] || status;
	}

	displaySeverity(severity) {
		return {
			high: "高",
			medium: "中",
			low: "低",
		}[severity] || severity;
	}

	displayGapType(type) {
		return {
			method: "方法",
			paper: "文献",
			code: "代码",
			okf: "OKF",
		}[type] || type;
	}

	displayOkfState(state) {
		return {
			ready: "就绪",
			pending: "待处理",
			planned: "计划中",
		}[state] || state;
	}

	displayRisk(level) {
		return {
			watch: "关注",
			low: "低",
		}[level] || level;
	}

	displayDepth(label) {
		return {
			"metadata-only": "仅元数据",
			"abstract-level": "摘要级",
			"x-ray": "x-ray 深读",
			"static-read": "代码静态阅读",
		}[label] || label;
	}

	formatClassToken(value) {
		return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
	}
}

class AgentDashboardSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Agent Dashboard" });
		new Setting(containerEl)
			.setName("项目根目录")
			.setDesc("包含 AGENTS.md、.codex/ 和 tool-library/ 的项目目录。")
			.addText((text) =>
				text
					.setPlaceholder("D:\\Obsidian Vault\\paper-knowledge-base")
					.setValue(this.plugin.settings.projectRoot)
					.onChange(async (value) => {
						this.plugin.settings.projectRoot = value.trim();
						await this.plugin.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName("Codex 可执行文件")
			.setDesc("用于文献、代码、检索和综合任务。插件使用参数数组启动，不经过 shell。")
			.addText((text) =>
				text
					.setPlaceholder("codex.exe")
					.setValue(this.plugin.settings.codexExecutable)
					.onChange(async (value) => {
						this.plugin.settings.codexExecutable = value.trim();
						await this.plugin.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName("Python 可执行文件")
			.setDesc("用于统一 runner 和知识库体检脚本。")
			.addText((text) =>
				text
					.setPlaceholder("D:\\python\\python.exe")
					.setValue(this.plugin.settings.pythonExecutable)
					.onChange(async (value) => {
						this.plugin.settings.pythonExecutable = value.trim();
						await this.plugin.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName("任务超时（分钟）")
			.setDesc("单个本地脚本或 Codex 任务的最长运行时间，范围 1-240 分钟。")
			.addText((text) =>
				text
					.setPlaceholder("60")
					.setValue(String(this.plugin.settings.taskTimeoutMinutes))
					.onChange(async (value) => {
						const parsed = Number.parseInt(value, 10);
						if (Number.isFinite(parsed)) {
							this.plugin.settings.taskTimeoutMinutes = Math.max(1, Math.min(240, parsed));
							await this.plugin.saveSettings();
						}
					})
			);
		new Setting(containerEl)
			.setName("运行环境")
			.setDesc("检查项目根目录、Codex、Python 和 dashboard runner 是否可用。")
			.addButton((button) =>
				button.setButtonText("检查").onClick(() => {
					const result = this.plugin.checkRuntime();
					new Notice(result.message, 8000);
				})
			);
	}
}

module.exports = class AgentDashboardPlugin extends Plugin {
	async onload() {
		this.activeProcesses = new Map();
		await this.loadSettings();
		this.registerView(VIEW_TYPE, (leaf) => new DashboardView(leaf, this));
		this.addRibbonIcon("layout-dashboard", "打开研究知识库控制台", () => {
			this.activateDashboardView();
		});
		this.addStatusBarItem().setText("智能体控制台：本地");
		this.addCommand({
			id: "open-research-dashboard",
			name: "打开研究知识库控制台",
			callback: () => {
				this.activateDashboardView();
			},
		});
		this.addSettingTab(new AgentDashboardSettingTab(this.app, this));
	}

	onunload() {
		for (const child of this.activeProcesses.values()) {
			if (!child.killed) child.kill();
		}
		this.activeProcesses.clear();
	}

	async loadSettings() {
		const stored = (await this.loadData()) || {};
		const storedSettings = stored.settings && typeof stored.settings === "object" ? stored.settings : stored;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, storedSettings);
		this.taskRuns = Array.isArray(stored.taskRuns) ? stored.taskRuns.slice(0, 30) : [];
		if (!this.settings.projectRoot) {
			this.settings.projectRoot = this.inferProjectRoot();
		}
		let changed = false;
		this.taskRuns = this.taskRuns.map((run) => {
			if (run.status !== "running" && run.status !== "queued") return run;
			changed = true;
			return {
				...run,
				status: "interrupted",
				finishedAt: new Date().toISOString(),
				error: "Obsidian 或插件在任务完成前关闭，运行状态已标记为中断。",
			};
		});
		if (changed || !stored.settings) {
			await this.saveSettings();
		}
	}

	async saveSettings() {
		await this.saveData({
			settings: this.settings,
			taskRuns: this.taskRuns,
		});
	}

	inferProjectRoot() {
		const adapter = this.app.vault.adapter;
		if (typeof adapter.getBasePath !== "function") return "";
		const vaultRoot = adapter.getBasePath();
		const parent = path.dirname(vaultRoot);
		if (fs.existsSync(path.join(parent, "AGENTS.md"))) return parent;
		return vaultRoot;
	}

	getTaskRuns() {
		return [...this.taskRuns].sort((a, b) => {
			return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
		});
	}

	getTaskRun(runId) {
		return this.taskRuns.find((run) => run.id === runId) || null;
	}

	isActionRunning(actionId) {
		return this.taskRuns.some((run) => run.actionId === actionId && (run.status === "running" || run.status === "queued"));
	}

	async startTaskRun(action, summary) {
		const now = new Date().toISOString();
		const run = {
			id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
			actionId: action.id,
			label: action.label,
			agent: action.agent,
			summary,
			status: "running",
			startedAt: now,
			finishedAt: "",
			exitCode: null,
			output: "",
			error: "",
		};
		this.taskRuns = [run, ...this.taskRuns].slice(0, 30);
		await this.saveSettings();
		return run;
	}

	async finishTaskRun(runId, updates) {
		const index = this.taskRuns.findIndex((run) => run.id === runId);
		if (index === -1) return null;
		this.taskRuns[index] = {
			...this.taskRuns[index],
			...updates,
			finishedAt: new Date().toISOString(),
		};
		await this.saveSettings();
		return this.taskRuns[index];
	}

	checkRuntime(action = null) {
		const projectRoot = this.settings.projectRoot;
		const runner = path.join(projectRoot, "tool-library", "scripts", "run_vault_action.py");
		const checks = [
			["项目根目录", fs.existsSync(projectRoot)],
			["AGENTS.md", fs.existsSync(path.join(projectRoot, "AGENTS.md"))],
			["Dashboard runner", fs.existsSync(runner)],
			["Python", fs.existsSync(this.settings.pythonExecutable)],
		];
		if (!action || action.id !== "vault-lint") {
			checks.push(["Codex", fs.existsSync(this.settings.codexExecutable)]);
		}
		const missing = checks.filter(([, ready]) => !ready).map(([label]) => label);
		return {
			ready: missing.length === 0,
			message: missing.length === 0 ? "运行环境检查通过" : `以下项目不可用：${missing.join("、")}`,
		};
	}

	runVaultAction(runId, action, input) {
		const registered = ACTION_BY_ID.get(action.id);
		if (!registered || !registered.enabled) {
			return Promise.reject(new Error(`操作尚未启用：${action.label}`));
		}
		const runtime = this.checkRuntime(action);
		if (!runtime.ready) {
			return Promise.reject(new Error(runtime.message));
		}
		const projectRoot = this.settings.projectRoot;
		const runner = path.join(projectRoot, "tool-library", "scripts", "run_vault_action.py");
		const timeoutSeconds = Math.max(60, Math.min(14400, Number(this.settings.taskTimeoutMinutes) * 60 || 3600));
		const args = [
			runner,
			"--action",
			action.id,
			"--project-root",
			projectRoot,
			"--codex",
			this.settings.codexExecutable,
			"--python",
			this.settings.pythonExecutable,
			"--timeout-seconds",
			String(timeoutSeconds),
		];

		return new Promise((resolve, reject) => {
			let stdout = "";
			let stderr = "";
			let settled = false;
			let timedOut = false;
			const child = spawn(this.settings.pythonExecutable, args, {
				cwd: projectRoot,
				shell: false,
				windowsHide: true,
				env: {
					...process.env,
					PYTHONUTF8: "1",
					PYTHONIOENCODING: "utf-8",
				},
			});
			this.activeProcesses.set(runId, child);
			const append = (current, chunk) => `${current}${chunk.toString("utf8")}`.slice(-160000);
			child.stdout.on("data", (chunk) => {
				stdout = append(stdout, chunk);
			});
			child.stderr.on("data", (chunk) => {
				stderr = append(stderr, chunk);
			});
			child.once("error", (error) => {
				if (settled) return;
				settled = true;
				window.clearTimeout(timer);
				this.activeProcesses.delete(runId);
				reject(error);
			});
			child.once("close", (code, signal) => {
				if (settled) return;
				settled = true;
				window.clearTimeout(timer);
				this.activeProcesses.delete(runId);
				resolve({
					exitCode: timedOut ? 124 : typeof code === "number" ? code : 1,
					signal: signal || "",
					stdout,
					stderr: timedOut ? `${stderr}\n任务超过 ${timeoutSeconds} 秒，已请求终止。` : stderr,
				});
			});
			const timer = window.setTimeout(() => {
				timedOut = true;
				if (!child.killed) child.kill();
			}, (timeoutSeconds + 15) * 1000);
			child.stdin.end(input, "utf8");
		});
	}

	async activateDashboardView() {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
		const leaf = existing || this.app.workspace.getRightLeaf(false) || this.app.workspace.getLeaf(true);
		if (!existing) {
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
		await this.app.workspace.revealLeaf(leaf);
	}
};
