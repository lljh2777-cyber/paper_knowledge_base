"use strict";

const {
	ItemView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	normalizePath,
	setIcon,
} = require("obsidian");

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const VIEW_TYPE = "agent-dashboard-research-vault";
const CODE_PRACTICE_VIEW_TYPE = "agent-dashboard-code-practice";
const DEFAULT_SETTINGS = {
	projectRoot: "",
	codexExecutable: "C:\\Users\\Thomas Wade\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe",
	codexModel: "gpt-5.5",
	pythonExecutable: "D:\\python\\python.exe",
	rscriptExecutable: "C:\\Program Files\\R\\R-4.5.1\\bin\\Rscript.exe",
	codePracticeTimeoutSeconds: 30,
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
		id: "code-practice",
		label: "代码练习",
		agent: "local-runtime",
		description: "在独立视图中使用 Python/R 单元格。运行至当前单元格时会在新进程中累计重放前置代码，可逐格查看输出、停止任务并显式保存练习笔记。",
		placeholder: "",
		requiresInput: false,
		writes: true,
		enabled: true,
		localView: true,
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
		description: "执行分层只读审计：结构、属性、链接、孤立页、证据深度、source note 正文、代码关系、索引和 OKF 状态。完成后可在结果弹窗中选择由 AI 提出方案并修复。",
		placeholder: "",
		requiresInput: false,
		writes: false,
		enabled: true,
	},
	{
		id: "vault-lint-fix",
		label: "体检修复",
		agent: "research-vault-lint",
		description: "读取最新体检报告，由 AI 提出修复方案并执行低风险修复，随后重新体检。高影响项目只报告，不自动处理。",
		placeholder: "",
		requiresInput: false,
		writes: true,
		enabled: true,
		showInRail: false,
	},
	{
		id: "okf-export",
		label: "OKF 导出",
		agent: "okf-export",
		description: "预检 wiki 后生成 OKF v0.1 时间戳 bundle，转换 wikilink、补齐最低属性并保留旧导出。不会修改源笔记或复制附件。",
		placeholder: "",
		requiresInput: false,
		writes: true,
		enabled: true,
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
		const lintStatus = this.plugin.getLintStatus();
		const latestWikiMtime = records
			.filter((record) => record.path.startsWith("wiki/"))
			.reduce((latest, record) => Math.max(latest, record.mtime || 0), 0);
		const lintGeneratedAt = lintStatus.latest ? new Date(lintStatus.latest.generated_at).getTime() : 0;
		const lintFresh = Boolean(lintStatus.latest && Number.isFinite(lintGeneratedAt) && lintGeneratedAt >= latestWikiMtime);
		const lintSummary = lintFresh ? lintStatus.latest.summary : null;
		const healthScore = lintSummary
			? Number(lintSummary.score)
			: Math.max(0, Math.min(100, 100 - linkReport.broken.length * 2 - missingFrontmatter));
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
					detail: lintSummary
						? `${lintSummary.errors} 个错误，${lintSummary.warnings} 个警告，${lintSummary.fixable} 个修复候选`
						: `${linkReport.broken.length} 个断链，${missingFrontmatter} 个缺失属性区；体检报告待更新`,
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
		const okfStatus = this.plugin.getOkfExportStatus();
		if (!okfStatus.exporterAvailable) {
			gaps.push({ type: "okf", title: "OKF 导出器不可用", severity: "high" });
		} else if (okfStatus.error) {
			gaps.push({ type: "okf", title: "OKF 最近导出状态无法读取", severity: "high" });
		} else if (!okfStatus.latest) {
			gaps.push({ type: "okf", title: "尚未生成 OKF bundle", severity: "medium" });
		} else if (!okfStatus.latest.conformant) {
			gaps.push({ type: "okf", title: "最近的 OKF bundle 未通过 conformance", severity: "high" });
		} else if (Number(okfStatus.latest.unresolved_link_count || 0) > 0) {
			gaps.push({ type: "okf", title: `OKF 导出存在 ${okfStatus.latest.unresolved_link_count} 个未解析链接`, severity: "medium" });
		}
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
		const exportStatus = this.plugin.getOkfExportStatus();
		const latest = exportStatus.latest;
		return {
			readiness: [
				{
					label: `源 type 覆盖 ${typePercent}%${typePercent < 100 ? "，导出时补齐" : ""}`,
					state: exportStatus.exporterAvailable ? "ready" : "pending",
				},
				{
					label: hasWikiIndex && hasWikiLog ? "index/log 生成规则就绪" : "导出时生成 index/log",
					state: exportStatus.exporterAvailable ? "ready" : "pending",
				},
				{
					label: hasWikilinks ? "wikilink 转换已接入" : "无需转换 wikilink",
					state: exportStatus.exporterAvailable ? "ready" : "pending",
				},
				{
					label: latest ? `最近 bundle：${latest.concept_count || 0} 个概念` : "尚无导出 bundle",
					state: latest && latest.conformant ? "ready" : "pending",
				},
			],
			latestLabel: latest ? `最近导出 ${this.formatExportTime(latest.generated_at)}` : exportStatus.error ? "导出状态不可读" : "尚未导出",
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

	formatExportTime(value) {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return "时间未知";
		return new Intl.DateTimeFormat("zh-CN", {
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		}).format(date);
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
	constructor(app, plugin, run, onRepair) {
		super(app);
		this.plugin = plugin;
		this.run = run;
		this.onRepair = onRepair;
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
		if (this.canRepair()) {
			const repair = footer.createEl("button", {
				cls: "mod-warning",
				text: "提出方案并修复",
				attr: {
					title: "AI 将仅自动处理体检报告中的低风险修复候选，并在修改后重新体检",
				},
			});
			repair.type = "button";
			repair.addEventListener("click", () => {
				this.close();
				this.onRepair();
			});
		}
		const close = footer.createEl("button", { cls: "mod-cta", text: "关闭" });
		close.type = "button";
		close.addEventListener("click", () => this.close());
	}

	canRepair() {
		if (this.run.actionId !== "vault-lint" || this.run.status !== "done" || typeof this.onRepair !== "function") {
			return false;
		}
		if (this.plugin.isActionRunning("vault-lint-fix")) return false;
		const lintStatus = this.plugin.getLintStatus();
		return Boolean(lintStatus.latest?.summary?.fixable > 0);
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

class PracticeNoteModal extends Modal {
	constructor(app, defaultTitle, onSubmit) {
		super(app);
		this.defaultTitle = defaultTitle;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("agent-dashboard-modal", "code-practice-save-modal");
		this.setTitle("保存练习笔记");
		const title = this.createField(contentEl, "标题", "text", this.defaultTitle);
		const goal = this.createField(contentEl, "目标", "textarea", "");
		const notes = this.createField(contentEl, "补充说明", "textarea", "");
		const footer = contentEl.createDiv({ cls: "agent-dashboard-modal-actions" });
		const cancel = footer.createEl("button", { text: "取消" });
		const save = footer.createEl("button", { cls: "mod-cta", text: "保存" });
		cancel.type = "button";
		save.type = "button";
		const submit = () => {
			const value = title.value.trim();
			if (!value) {
				new Notice("请输入练习标题");
				return;
			}
			this.close();
			void this.onSubmit({ title: value, goal: goal.value.trim(), notes: notes.value.trim() });
		};
		cancel.addEventListener("click", () => this.close());
		save.addEventListener("click", submit);
		title.addEventListener("keydown", (event) => {
			if (event.key === "Enter") submit();
		});
		window.setTimeout(() => title.focus(), 0);
	}

	createField(parent, labelText, type, value) {
		const field = parent.createEl("label", { cls: "code-practice-modal-field" });
		field.createSpan({ text: labelText });
		if (type === "textarea") {
			const textarea = field.createEl("textarea", { attr: { rows: "4" } });
			textarea.value = value;
			return textarea;
		}
		const input = field.createEl("input", { attr: { type: "text" } });
		input.value = value;
		return input;
	}

	onClose() {
		this.contentEl.empty();
	}
}

class CodePracticeView extends ItemView {
	constructor(leaf, plugin) {
		super(leaf);
		this.plugin = plugin;
		this.language = "python";
		this.nextCellId = 1;
		this.cellsByLanguage = {
			python: this.createDefaultCells("python"),
			r: this.createDefaultCells("r"),
		};
		this.activeRunId = "";
		this.activeCellId = "";
		this.stopRequested = false;
		this.runningAll = false;
		this.executionCounter = 0;
		this.relatedNotePath = "";
		this.notebookControls = null;
	}

	createCell(code = "", placeholder = "") {
		return { id: `cell-${this.nextCellId++}`, code, placeholder, result: null, executionCount: null };
	}

	createDefaultCells(language) {
		return language === "r"
			? [this.createCell("", "values <- c(1, 2, 3, 4)"), this.createCell("", "mean(values)")]
			: [this.createCell("", "values = [1, 2, 3, 4]"), this.createCell("", "sum(values) / len(values)")];
	}

	get cells() {
		return this.cellsByLanguage[this.language];
	}

	getViewType() {
		return CODE_PRACTICE_VIEW_TYPE;
	}

	getDisplayText() {
		return "代码练习";
	}

	getIcon() {
		return "square-code";
	}

	async onOpen() {
		this.render();
	}

	async onClose() {
		if (this.activeRunId) this.plugin.stopCodePractice(this.activeRunId);
		this.contentEl.empty();
	}

	setRelatedNote(file) {
		this.relatedNotePath = file?.extension === "md" ? file.path : "";
		if (this.containerEl?.isConnected) this.render();
	}

	render() {
		this.contentEl.empty();
		this.contentEl.addClass("code-practice-view");
		const shell = this.contentEl.createDiv({ cls: "code-practice-shell" });
		this.renderHeader(shell);
		this.renderRuntime(shell);
		this.renderNotebook(shell);
	}

	renderHeader(parent) {
		const header = parent.createEl("header", { cls: "code-practice-header" });
		const title = header.createDiv({ cls: "code-practice-title" });
		title.createEl("p", { cls: "agent-dashboard-eyebrow", text: "本地运行" });
		title.createEl("h1", { text: "代码练习" });
		const context = header.createDiv({ cls: "code-practice-context" });
		context.createSpan({ cls: "code-practice-context-label", text: "关联笔记" });
		context.createSpan({
			cls: "code-practice-context-value",
			text: this.relatedNotePath ? this.relatedNotePath.replace(/\.md$/i, "") : "未关联",
			attr: { title: this.relatedNotePath || "打开练习视图前选中的 Markdown 笔记会显示在这里" },
		});
	}

	renderRuntime(parent) {
		const bar = parent.createDiv({ cls: "code-practice-runtime" });
		const languages = bar.createDiv({ cls: "code-practice-language-switch", attr: { "aria-label": "运行语言" } });
		[["python", "Python"], ["r", "R"]].forEach(([value, label]) => {
			const button = languages.createEl("button", {
				cls: value === this.language ? "is-active" : "",
				text: label,
				attr: { "aria-pressed": value === this.language ? "true" : "false" },
			});
			button.type = "button";
			button.disabled = Boolean(this.activeRunId);
			button.addEventListener("click", () => this.setLanguage(value));
		});
		const details = bar.createDiv({ cls: "code-practice-runtime-details" });
		this.createRuntimeDetail(details, "解释器", this.currentInterpreter());
		this.createRuntimeDetail(details, "工作目录", "tool-library/output/code-practice/figures/<run-id>");
	}

	createRuntimeDetail(parent, label, value) {
		const detail = parent.createDiv({ cls: "code-practice-runtime-detail" });
		detail.createSpan({ text: label });
		detail.createEl("code", { text: value || "未配置", attr: { title: value || "未配置" } });
	}

	renderNotebook(parent) {
		const section = parent.createEl("section", { cls: "code-practice-notebook" });
		const toolbar = section.createDiv({ cls: "code-practice-toolbar" });
		const heading = toolbar.createDiv({ cls: "code-practice-notebook-heading" });
		heading.createEl("h2", { text: "练习单元格" });
		heading.createSpan({ text: "运行至当前单元格时，会在新进程中静默重放前置单元格。" });
		const commands = toolbar.createDiv({ cls: "code-practice-commands" });
		const add = this.createCommandButton(commands, "plus", "新增单元格");
		const run = this.createCommandButton(commands, "list-start", "全部运行", "mod-cta");
		const stop = this.createCommandButton(commands, "square", "停止", "mod-warning");
		const clear = this.createCommandButton(commands, "eraser", "清空输出");
		const clearCode = this.createCommandButton(commands, "file-x-2", "清空代码");
		const resetCells = this.createCommandButton(commands, "rows-2", "重置为两格");
		const save = this.createCommandButton(commands, "save", "保存练习");
		add.addEventListener("click", () => this.addCell(this.cells.length - 1));
		run.addEventListener("click", () => void this.runAllCells());
		stop.addEventListener("click", () => this.stopCode());
		clear.addEventListener("click", () => {
			this.cells.forEach((cell) => {
				cell.result = null;
				cell.executionCount = null;
			});
			this.render();
		});
		clearCode.addEventListener("click", () => this.clearAllCellCode());
		resetCells.addEventListener("click", () => this.resetCellsToTwo());
		save.addEventListener("click", () => this.openSaveModal());

		const list = section.createDiv({ cls: "code-practice-cell-list" });
		this.cells.forEach((cell, index) => this.renderCell(list, cell, index));
		const addFooter = section.createEl("button", {
			cls: "code-practice-add-cell",
			attr: { title: "在末尾新增单元格", "aria-label": "在末尾新增单元格" },
		});
		addFooter.type = "button";
		addFooter.disabled = Boolean(this.activeRunId);
		setIcon(addFooter, "plus");
		addFooter.createSpan({ text: "新增单元格" });
		addFooter.addEventListener("click", () => this.addCell(this.cells.length - 1));
		this.notebookControls = { add, run, stop, clear, clearCode, resetCells, save, addFooter };
		this.updateNotebookControls();
	}

	updateNotebookControls() {
		if (!this.notebookControls) return;
		const busy = Boolean(this.activeRunId);
		const { add, run, stop, clear, clearCode, resetCells, save, addFooter } = this.notebookControls;
		add.disabled = busy;
		addFooter.disabled = busy;
		run.disabled = busy || !this.cells.some((cell) => cell.code.trim());
		stop.disabled = !busy || this.stopRequested;
		clear.disabled = busy || !this.cells.some((cell) => cell.result);
		clearCode.disabled = busy || !this.cells.some((cell) => cell.code.trim());
		resetCells.disabled = busy || (this.cells.length === 2 && !this.cells.some((cell) => cell.code.trim() || cell.result));
		save.disabled = busy || !this.cells.some((cell) => cell.result && cell.result.status !== "running");
	}

	createCommandButton(parent, icon, label, className = "") {
		const button = parent.createEl("button", {
			cls: `code-practice-command ${className}`.trim(),
			attr: { title: label, "aria-label": label },
		});
		button.type = "button";
		setIcon(button, icon);
		button.createSpan({ text: label });
		return button;
	}

	renderCell(parent, cell, index) {
		const article = parent.createEl("article", { cls: "code-practice-cell", attr: { "data-cell-id": cell.id } });
		if (cell.id === this.activeCellId) article.addClass("is-running");
		const inputRow = article.createDiv({ cls: "code-practice-cell-input-row" });
		const prompt = inputRow.createDiv({ cls: "code-practice-cell-prompt" });
		prompt.createSpan({ text: cell.id === this.activeCellId ? "In [*]:" : `In [${cell.executionCount ?? " "}]:` });
		const run = this.createIconButton(prompt, "play", "运行至此（Ctrl+Enter）");
		run.setAttribute("aria-keyshortcuts", "Control+Enter Meta+Enter");
		run.disabled = Boolean(this.activeRunId) || !cell.code.trim();
		run.addEventListener("click", () => void this.runCell(cell.id));

		const body = inputRow.createDiv({ cls: "code-practice-cell-body" });
		const controls = body.createDiv({ cls: "code-practice-cell-controls" });
		const up = this.createIconButton(controls, "arrow-up", "上移单元格");
		const down = this.createIconButton(controls, "arrow-down", "下移单元格");
		const add = this.createIconButton(controls, "plus", "在下方新增单元格");
		const remove = this.createIconButton(controls, "trash-2", "删除单元格");
		up.disabled = Boolean(this.activeRunId) || index === 0;
		down.disabled = Boolean(this.activeRunId) || index === this.cells.length - 1;
		add.disabled = Boolean(this.activeRunId);
		remove.disabled = Boolean(this.activeRunId) || this.cells.length === 1;
		up.addEventListener("click", () => this.moveCell(index, index - 1));
		down.addEventListener("click", () => this.moveCell(index, index + 1));
		add.addEventListener("click", () => this.addCell(index));
		remove.addEventListener("click", () => this.removeCell(index));

		const editor = body.createEl("textarea", {
			cls: "code-practice-cell-editor",
			attr: {
				rows: "4",
				spellcheck: "false",
				placeholder: cell.placeholder || (this.language === "r" ? "# 在此输入 R 代码" : "# 在此输入 Python 代码"),
				"aria-label": `${this.language === "python" ? "Python" : "R"} 单元格 ${index + 1}`,
			},
		});
		editor.value = cell.code;
		editor.disabled = Boolean(this.activeRunId);
		editor.addEventListener("input", () => {
			cell.code = editor.value;
			this.invalidateCellsFrom(index);
			run.disabled = Boolean(this.activeRunId) || !cell.code.trim();
			this.updateNotebookControls();
		});
		editor.addEventListener("keydown", (event) => {
			if (event.key === "Tab") {
				event.preventDefault();
				const start = editor.selectionStart;
				const end = editor.selectionEnd;
				editor.setRangeText("\t", start, end, "end");
				cell.code = editor.value;
				this.invalidateCellsFrom(index);
				run.disabled = Boolean(this.activeRunId) || !cell.code.trim();
				this.updateNotebookControls();
				return;
			}
			if (event.key !== "Enter" || this.activeRunId) return;
			if (event.ctrlKey || event.metaKey) {
				event.preventDefault();
				event.stopPropagation();
				void this.runCell(cell.id);
			} else if (event.shiftKey) {
				event.preventDefault();
				event.stopPropagation();
				void this.runCell(cell.id, true);
			}
		});

		const output = article.createDiv({ cls: "code-practice-cell-output" });
		this.renderCellOutput(output, cell);
	}

	createIconButton(parent, icon, label) {
		const button = parent.createEl("button", {
			cls: "code-practice-icon-button",
			attr: { title: label, "aria-label": label },
		});
		button.type = "button";
		setIcon(button, icon);
		return button;
	}

	renderCellOutput(parent, cell) {
		if (!cell.result) return;
		const row = parent.createDiv({ cls: "code-practice-cell-output-row" });
		const prompt = row.createDiv({ cls: "code-practice-cell-prompt is-output" });
		prompt.createSpan({ text: `Out [${cell.executionCount ?? " "}]:` });
		const content = row.createDiv({ cls: "code-practice-cell-result" });
		const heading = content.createDiv({ cls: "code-practice-output-heading" });
		const status = cell.result.status || "idle";
		heading.createSpan({ cls: `code-practice-status code-practice-status-${status}`, text: this.displayStatus(status) });
		const summary = heading.createSpan({ cls: "code-practice-cell-summary" });
		summary.setText(`${this.formatDuration(cell.result.duration_ms)} · 退出码 ${cell.result.exit_code ?? "-"}`);
		if (cell.result.stdout) this.renderStream(content, "标准输出", cell.result.stdout);
		if (cell.result.stderr) {
			const stderr = this.stderrPresentation(status);
			this.renderStream(content, stderr.title, cell.result.stderr, stderr.tone);
		}
		this.renderFigures(content, cell.result.figures || []);
	}

	stderrPresentation(status) {
		if (["failed", "timeout"].includes(status)) return { title: "错误与诊断（stderr）", tone: "error" };
		if (status === "stopped") return { title: "运行消息（stderr）", tone: "message" };
		return { title: "消息与警告（stderr）", tone: "message" };
	}

	renderStream(parent, title, value, tone = "output") {
		const block = parent.createDiv({ cls: `code-practice-stream is-${tone}` });
		block.createEl("h3", { text: title });
		block.createEl("pre", { text: value || "（无）" });
	}

	renderFigures(parent, figures) {
		if (!figures.length) return;
		const block = parent.createDiv({ cls: "code-practice-figures" });
		block.createEl("h3", { text: "生成图片" });
		const grid = block.createDiv({ cls: "code-practice-figure-grid" });
		figures.forEach((figurePath) => {
			const item = grid.createEl("figure");
			const dataUrl = this.plugin.readPracticeFigure(figurePath);
			if (dataUrl) item.createEl("img", { attr: { src: dataUrl, alt: path.basename(figurePath) } });
			item.createEl("figcaption", { text: figurePath, attr: { title: figurePath } });
		});
	}

	setLanguage(language) {
		if (this.activeRunId || language === this.language) return;
		this.language = language;
		this.render();
	}

	currentInterpreter() {
		return this.language === "python" ? this.plugin.settings.pythonExecutable : this.plugin.settings.rscriptExecutable;
	}

	invalidateCellsFrom(index) {
		this.cells.slice(index).forEach((candidate) => {
			candidate.result = null;
			candidate.executionCount = null;
			const output = this.contentEl.querySelector(`[data-cell-id="${candidate.id}"] .code-practice-cell-output`);
			if (output) output.empty();
		});
	}

	clearAllCellCode() {
		if (this.activeRunId) return;
		this.cells.forEach((cell) => {
			cell.code = "";
			cell.result = null;
			cell.executionCount = null;
		});
		this.render();
		new Notice("已清空当前语言的代码和输出");
	}

	resetCellsToTwo() {
		if (this.activeRunId) return;
		this.cellsByLanguage[this.language] = this.createDefaultCells(this.language);
		this.render();
		new Notice("已重置为两个空单元格");
	}

	addCell(afterIndex) {
		if (this.activeRunId) return;
		const cell = this.createCell("", this.language === "r" ? "# 在此输入 R 代码" : "# 在此输入 Python 代码");
		this.cells.splice(afterIndex + 1, 0, cell);
		this.render();
		this.focusCell(cell.id);
	}

	removeCell(index) {
		if (this.activeRunId || this.cells.length === 1) return;
		this.cells.splice(index, 1);
		this.invalidateCellsFrom(index);
		this.render();
		this.focusCell(this.cells[Math.min(index, this.cells.length - 1)].id);
	}

	moveCell(from, to) {
		if (this.activeRunId || to < 0 || to >= this.cells.length) return;
		const [cell] = this.cells.splice(from, 1);
		this.cells.splice(to, 0, cell);
		this.invalidateCellsFrom(Math.min(from, to));
		this.render();
		this.focusCell(cell.id);
	}

	focusCell(cellId) {
		window.setTimeout(() => {
			this.contentEl.querySelector(`[data-cell-id="${cellId}"] .code-practice-cell-editor`)?.focus();
		}, 0);
	}

	async runCell(cellId, focusNext = false) {
		if (this.activeRunId) return null;
		const index = this.cells.findIndex((cell) => cell.id === cellId);
		if (index < 0) return null;
		const cell = this.cells[index];
		const code = cell.code.trimEnd();
		if (!code.trim()) {
			new Notice("请输入代码");
			return null;
		}
		const contextCode = this.cells
			.slice(0, index)
			.filter((candidate) => candidate.code.trim())
			.map((candidate, contextIndex) => `# --- replayed cell ${contextIndex + 1} ---\n${candidate.code.trimEnd()}`)
			.join("\n\n");
		this.activeRunId = this.plugin.createPracticeRunId();
		this.activeCellId = cell.id;
		this.stopRequested = false;
		cell.result = {
			run_id: this.activeRunId,
			status: "running",
			language: this.language,
			exit_code: null,
			duration_ms: 0,
			stdout: "",
			stderr: "",
			figures: [],
		};
		this.render();
		try {
			cell.result = await this.plugin.runCodePractice({
				run_id: this.activeRunId,
				language: this.language,
				context_code: contextCode,
				code,
				working_directory: "tool-library/output/code-practice",
				timeout_seconds: this.plugin.settings.codePracticeTimeoutSeconds,
			});
		} catch (error) {
			cell.result = {
				run_id: this.activeRunId,
				status: "failed",
				language: this.language,
				exit_code: null,
				duration_ms: 0,
				stdout: "",
				stderr: error instanceof Error ? error.message : String(error),
				figures: [],
			};
		} finally {
			this.executionCounter += 1;
			cell.executionCount = this.executionCounter;
			this.activeRunId = "";
			this.activeCellId = "";
			this.stopRequested = false;
			this.render();
			if (focusNext) {
				if (index === this.cells.length - 1) this.addCell(index);
				else this.focusCell(this.cells[index + 1].id);
			}
		}
		return cell.result;
	}

	async runAllCells() {
		if (this.activeRunId || this.runningAll) return;
		this.runningAll = true;
		try {
			for (const cell of [...this.cells]) {
				if (!cell.code.trim()) continue;
				const result = await this.runCell(cell.id);
				if (!result || result.status !== "success") break;
			}
		} finally {
			this.runningAll = false;
			this.render();
		}
	}

	stopCode() {
		if (!this.activeRunId || this.stopRequested) return;
		this.stopRequested = true;
		this.plugin.stopCodePractice(this.activeRunId);
		new Notice("正在停止代码练习");
		this.render();
	}

	openSaveModal() {
		if (this.activeRunId || !this.cells.some((cell) => cell.result)) return;
		const defaultTitle = `${this.language === "python" ? "Python" : "R"} 练习 ${new Date().toLocaleDateString("zh-CN")}`;
		new PracticeNoteModal(this.app, defaultTitle, async (form) => {
			try {
				const file = await this.plugin.savePracticeNote({
					...form,
					language: this.language,
					cells: this.cells.map((cell) => ({
						code: cell.code,
						result: cell.result,
						executionCount: cell.executionCount,
					})),
					relatedNotePath: this.relatedNotePath,
				});
				new Notice(`已保存：${file.path}`);
				await this.app.workspace.getLeaf(true).openFile(file);
			} catch (error) {
				new Notice(`保存失败：${error instanceof Error ? error.message : String(error)}`, 8000);
			}
		}).open();
	}

	displayStatus(status) {
		return {
			idle: "未运行",
			running: this.stopRequested ? "正在停止" : "运行中",
			success: "成功",
			failed: "失败",
			timeout: "已超时",
			stopped: "已停止",
		}[status] || status;
	}

	formatDuration(durationMs) {
		if (!Number.isFinite(Number(durationMs))) return "-";
		return Number(durationMs) < 1000 ? `${durationMs} ms` : `${(Number(durationMs) / 1000).toFixed(2)} s`;
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
		this.data.actions.filter((action) => action.showInRail !== false).forEach((action) => {
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
		const panel = this.createPanel(parent, "agent-dashboard-tri-panel", "可移植输出", "OKF 就绪度", this.data.okf.latestLabel);
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
					if (taskRun) this.openTaskResult(taskRun);
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
		if (action.localView) {
			void this.plugin.activateCodePracticeView();
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
			this.openTaskResult(completedRun);
		}
	}

	openTaskResult(run) {
		const onRepair = run.actionId === "vault-lint"
			? () => {
				const repairAction = ACTION_BY_ID.get("vault-lint-fix");
				if (repairAction) void this.executeAction(repairAction, "");
			}
			: null;
		new TaskResultModal(this.app, this.plugin, run, onRepair).open();
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
			.setDesc("用于统一 runner、知识库体检和 Python 代码练习。")
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
			.setName("Rscript 可执行文件")
			.setDesc("用于无状态 R 代码练习；不会自动安装 R 或 R 包。")
			.addText((text) =>
				text
					.setPlaceholder("C:\\Program Files\\R\\R-4.5.1\\bin\\Rscript.exe")
					.setValue(this.plugin.settings.rscriptExecutable)
					.onChange(async (value) => {
						this.plugin.settings.rscriptExecutable = value.trim();
						await this.plugin.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName("代码练习超时（秒）")
			.setDesc("每次 Python/R 练习的最长运行时间，范围 1-120 秒。")
			.addText((text) =>
				text
					.setPlaceholder("30")
					.setValue(String(this.plugin.settings.codePracticeTimeoutSeconds))
					.onChange(async (value) => {
						const parsed = Number.parseInt(value, 10);
						if (Number.isFinite(parsed)) {
							this.plugin.settings.codePracticeTimeoutSeconds = Math.max(1, Math.min(120, parsed));
							await this.plugin.saveSettings();
						}
					})
			);
		new Setting(containerEl)
			.setName("Codex 模型")
			.setDesc("仅用于 Dashboard 启动的 AI 任务；默认使用当前 CLI 支持的 gpt-5.5。")
			.addText((text) =>
				text
					.setPlaceholder("gpt-5.5")
					.setValue(this.plugin.settings.codexModel)
					.onChange(async (value) => {
						this.plugin.settings.codexModel = value.trim() || "gpt-5.5";
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
		this.activePracticeRuns = new Map();
		this.lastContextFile = this.app.workspace.getActiveFile();
		await this.loadSettings();
		this.recoverInterruptedPracticeRuns();
		this.registerView(VIEW_TYPE, (leaf) => new DashboardView(leaf, this));
		this.registerView(CODE_PRACTICE_VIEW_TYPE, (leaf) => new CodePracticeView(leaf, this));
		this.registerEvent(this.app.workspace.on("file-open", (file) => {
			if (file?.extension === "md") this.lastContextFile = file;
		}));
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
		this.addCommand({
			id: "open-code-practice",
			name: "打开代码练习",
			callback: () => {
				this.activateCodePracticeView();
			},
		});
		this.addSettingTab(new AgentDashboardSettingTab(this.app, this));
	}

	onunload() {
		for (const runId of this.activePracticeRuns.keys()) {
			this.stopCodePractice(runId);
		}
		for (const child of this.activeProcesses.values()) {
			if (!child.killed) child.kill();
		}
		this.activeProcesses.clear();
	}

	createPracticeRunId() {
		const now = new Date();
		const pad = (value) => String(value).padStart(2, "0");
		const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
		return `${stamp}-${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}`;
	}

	recoverInterruptedPracticeRuns() {
		const runsDirectory = path.join(this.settings.projectRoot, "tool-library", "output", "code-practice", "runs");
		if (!fs.existsSync(runsDirectory)) return;
		for (const name of fs.readdirSync(runsDirectory)) {
			if (!name.endsWith(".json")) continue;
			const recordPath = path.join(runsDirectory, name);
			try {
				const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
				if (!["queued", "running"].includes(record.status)) continue;
				record.status = "stopped";
				record.finished_at = new Date().toISOString();
				record.stderr = `${record.stderr || ""}\nExecution interrupted before the plugin restarted.`.trim();
				fs.writeFileSync(recordPath, JSON.stringify(record, null, 2), "utf8");
			} catch (error) {
				console.warn(`Could not recover code-practice record: ${recordPath}`, error);
			}
		}
	}

	runCodePractice(request) {
		const projectRoot = this.settings.projectRoot;
		const runner = path.join(projectRoot, "tool-library", "scripts", "run_code_practice.py");
		if (!fs.existsSync(runner)) return Promise.reject(new Error(`代码练习 runner 不存在：${runner}`));
		const interpreter = request.language === "python" ? this.settings.pythonExecutable : this.settings.rscriptExecutable;
		if (!interpreter || !fs.existsSync(interpreter)) return Promise.reject(new Error(`${request.language === "python" ? "Python" : "Rscript"} 解释器不可用：${interpreter || "未配置"}`));
		const stopPath = path.join(projectRoot, "tool-library", "output", "code-practice", "stop", `${request.run_id}.stop`);
		const args = [
			runner,
			"--project-root",
			projectRoot,
			"--python",
			this.settings.pythonExecutable,
			"--rscript",
			this.settings.rscriptExecutable,
		];

		return new Promise((resolve, reject) => {
			let stdout = "";
			let stderr = "";
			let settled = false;
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
			this.activePracticeRuns.set(request.run_id, { child, stopPath });
			const append = (current, chunk) => `${current}${chunk.toString("utf8")}`.slice(-400000);
			child.stdout.on("data", (chunk) => {
				stdout = append(stdout, chunk);
			});
			child.stderr.on("data", (chunk) => {
				stderr = append(stderr, chunk);
			});
			child.once("error", (error) => {
				if (settled) return;
				settled = true;
				this.activePracticeRuns.delete(request.run_id);
				reject(error);
			});
			child.once("close", () => {
				if (settled) return;
				settled = true;
				this.activePracticeRuns.delete(request.run_id);
				try {
					const result = JSON.parse(stdout.trim());
					if (stderr.trim()) result.runner_stderr = stderr.trim();
					resolve(result);
				} catch (error) {
					reject(new Error(`无法读取代码练习结果：${stderr.trim() || stdout.trim() || error.message}`));
				}
			});
			child.stdin.end(JSON.stringify(request), "utf8");
		});
	}

	stopCodePractice(runId) {
		const active = this.activePracticeRuns.get(runId);
		if (!active) return false;
		try {
			fs.mkdirSync(path.dirname(active.stopPath), { recursive: true });
			fs.writeFileSync(active.stopPath, "stop\n", "utf8");
			return true;
		} catch (error) {
			console.error("Could not request code-practice stop", error);
			return false;
		}
	}

	readPracticeFigure(relativePath) {
		const root = path.resolve(this.settings.projectRoot);
		const outputRoot = path.join(root, "tool-library", "output", "code-practice", "figures");
		const candidate = path.resolve(root, relativePath);
		const relative = path.relative(outputRoot, candidate);
		if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(candidate)) return "";
		const stat = fs.statSync(candidate);
		if (!stat.isFile() || stat.size > 10 * 1024 * 1024) return "";
		const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml" }[path.extname(candidate).toLowerCase()];
		if (!mime) return "";
		return `data:${mime};base64,${fs.readFileSync(candidate).toString("base64")}`;
	}

	async savePracticeNote(payload) {
		const folder = normalizePath("wiki/code/practice");
		await this.ensureVaultFolder(folder);
		const cells = Array.isArray(payload.cells) ? payload.cells.filter((cell) => String(cell.code || "").trim() || cell.result) : [];
		if (!cells.length) throw new Error("没有可保存的练习单元格");
		const lastResult = [...cells].reverse().find((cell) => cell.result)?.result || {};
		const now = new Date();
		const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
		const slugBase = payload.title.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72);
		const fallback = `practice-${date.replaceAll("-", "")}-${lastResult.run_id?.slice(-6) || Date.now()}`;
		let notePath = normalizePath(`${folder}/${slugBase || fallback}.md`);
		if (this.app.vault.getAbstractFileByPath(notePath)) {
			notePath = normalizePath(`${folder}/${slugBase || "practice"}-${lastResult.run_id?.slice(-6) || Date.now()}.md`);
		}
		if (this.app.vault.getAbstractFileByPath(notePath)) throw new Error(`目标笔记已存在：${notePath}`);

		const languageLabel = payload.language === "r" ? "R" : "Python";
		const relatedTarget = payload.relatedNotePath ? payload.relatedNotePath.replace(/\.md$/i, "") : "";
		const relatedLink = relatedTarget ? `[[${relatedTarget}]]` : "";
		const fence = (value) => String(value || "").includes("```") ? "````" : "```";
		const cellSections = cells.flatMap((cell, index) => {
			const result = cell.result;
			const codeFence = fence(cell.code);
			const outputFence = fence(result?.stdout);
			const errorFence = fence(result?.stderr);
			const lines = [
				`### 单元格 ${index + 1}`,
				"",
				`执行编号：${cell.executionCount ?? "未运行"}  `,
				`状态：${result?.status || "未运行"}`,
				"",
				`${codeFence}${payload.language === "r" ? "r" : "python"}`,
				String(cell.code || ""),
				codeFence,
			];
			if (!result) return [...lines, ""];
			lines.push(
				"",
				`运行编号：${result.run_id || "-"}  `,
				`耗时：${Number(result.duration_ms || 0) / 1000} 秒  `,
				`退出码：${result.exit_code ?? "-"}`,
				"",
				"#### 标准输出",
				"",
				`${outputFence}text`,
				result.stdout || "（无）",
				outputFence,
			);
			if (result.stderr) {
				const stderrTitle = ["failed", "timeout"].includes(result.status)
					? "错误与诊断（stderr）"
					: result.status === "stopped"
						? "运行消息（stderr）"
						: "消息与警告（stderr）";
				lines.push("", `#### ${stderrTitle}`, "", `${errorFence}text`, result.stderr, errorFence);
			}
			if (result.figures?.length) {
				lines.push("", "#### 生成图片", "", ...result.figures.map((value) => `- \`${value}\``));
			}
			return [...lines, ""];
		});
		const body = [
			"---",
			"type: code-practice",
			`title: ${JSON.stringify(payload.title)}`,
			`language: ${languageLabel}`,
			`related_note: ${JSON.stringify(relatedLink)}`,
			"execution_mode: stateless-replay",
			`cell_count: ${cells.length}`,
			`last_run_id: ${lastResult.run_id || ""}`,
			`status: ${lastResult.status || "not-run"}`,
			`created: ${date}`,
			`updated: ${date}`,
			"tags:",
			"  - code-practice",
			`  - ${languageLabel}`,
			"---",
			"",
			"## 目标",
			"",
			payload.goal || "记录并验证本次代码练习。",
			"",
			"## 单元格",
			"",
			...cellSections,
			"## 说明",
			"",
			payload.notes || "本页使用无状态累计重放：每次运行都会启动新进程，并在执行目标单元格前重放其前置单元格。",
			"",
			"## 关联",
			"",
			relatedLink ? `- 相关笔记：${relatedLink}` : "- 相关笔记：未关联",
			"",
		].join("\n");
		return this.app.vault.create(notePath, body);
	}

	async ensureVaultFolder(folderPath) {
		let current = "";
		for (const segment of normalizePath(folderPath).split("/")) {
			current = current ? `${current}/${segment}` : segment;
			if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
		}
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
		const actionIds = ["vault-lint", "vault-lint-fix"].includes(actionId)
			? new Set(["vault-lint", "vault-lint-fix"])
			: new Set([actionId]);
		return this.taskRuns.some((run) => actionIds.has(run.actionId) && (run.status === "running" || run.status === "queued"));
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

	getOkfExportStatus() {
		const projectRoot = this.settings.projectRoot;
		const exporter = path.join(projectRoot, "tool-library", "scripts", "export_okf.py");
		const latestPath = path.join(projectRoot, "tool-library", "output", "okf", "latest.json");
		let latest = null;
		let error = "";
		if (fs.existsSync(latestPath)) {
			try {
				latest = JSON.parse(fs.readFileSync(latestPath, "utf8"));
			} catch (readError) {
				error = readError instanceof Error ? readError.message : String(readError);
			}
		}
		return {
			exporterAvailable: fs.existsSync(exporter),
			latest,
			error,
		};
	}

	getLintStatus() {
		const projectRoot = this.settings.projectRoot;
		const latestPath = path.join(projectRoot, "tool-library", "output", "lint", "latest.json");
		let latest = null;
		let error = "";
		if (fs.existsSync(latestPath)) {
			try {
				latest = JSON.parse(fs.readFileSync(latestPath, "utf8"));
			} catch (readError) {
				error = readError instanceof Error ? readError.message : String(readError);
			}
		}
		return { latest, error };
	}

	checkRuntime(action = null) {
		const projectRoot = this.settings.projectRoot;
		const runner = path.join(projectRoot, "tool-library", "scripts", "run_vault_action.py");
		const practiceRunner = path.join(projectRoot, "tool-library", "scripts", "run_code_practice.py");
		const exporter = path.join(projectRoot, "tool-library", "scripts", "export_okf.py");
		const lintScript = path.join(projectRoot, "tool-library", "scripts", "lint_vault.py");
		const checks = [
			["项目根目录", fs.existsSync(projectRoot)],
			["AGENTS.md", fs.existsSync(path.join(projectRoot, "AGENTS.md"))],
			["Dashboard runner", fs.existsSync(runner)],
			["Python", fs.existsSync(this.settings.pythonExecutable)],
		];
		if (!action) {
			checks.push(["Code practice runner", fs.existsSync(practiceRunner)]);
			checks.push(["Rscript", Boolean(this.settings.rscriptExecutable) && fs.existsSync(this.settings.rscriptExecutable)]);
		}
		if (!action || action.id === "okf-export") {
			checks.push(["OKF exporter", fs.existsSync(exporter)]);
		}
		if (!action || ["vault-lint", "vault-lint-fix"].includes(action.id)) {
			checks.push(["Vault lint", fs.existsSync(lintScript)]);
		}
		if (!action || !["vault-lint", "okf-export"].includes(action.id)) {
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
			"--model",
			this.settings.codexModel,
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

	async activateCodePracticeView() {
		const contextFile = this.app.workspace.getActiveFile() || this.lastContextFile;
		const existing = this.app.workspace.getLeavesOfType(CODE_PRACTICE_VIEW_TYPE)[0];
		const leaf = existing || this.app.workspace.getRightLeaf(false) || this.app.workspace.getLeaf(true);
		if (!existing) {
			await leaf.setViewState({ type: CODE_PRACTICE_VIEW_TYPE, active: true });
		}
		if (typeof leaf.view?.setRelatedNote === "function") leaf.view.setRelatedNote(contextFile);
		await this.app.workspace.revealLeaf(leaf);
	}
};
