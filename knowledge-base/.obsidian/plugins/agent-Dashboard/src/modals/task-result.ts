import { App, Modal, Notice } from "obsidian";

interface TaskExecutionConfig {
	model: string;
	reasoningEffort: string;
	serviceTier: string;
}

interface TaskRun {
	label: string;
	agent: string;
	startedAt: string;
	status: string;
	actionId: string;
	exitCode?: number;
	output?: string;
	error?: string;
	summary?: string;
	executionConfig?: TaskExecutionConfig;
}

interface TaskResultHost {
	getModelLabel(model: string): string;
	getReasoningLabel(reasoningEffort: string): string;
	getTaskRunOutput(run: TaskRun): string;
	isActionRunning(actionId: string): boolean;
	getLintStatus(): {
		latest?: {
			summary?: {
				errors?: number;
				warnings?: number;
			};
		};
	};
}

export class TaskResultModal extends Modal {
	private readonly plugin: TaskResultHost;
	private readonly run: TaskRun;
	private readonly onRepair: (() => void) | null;

	constructor(
		app: App,
		plugin: TaskResultHost,
		run: TaskRun,
		onRepair: (() => void) | null,
	) {
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
		if (this.run.executionConfig) {
			const config = contentEl.createDiv({ cls: "agent-dashboard-result-config" });
			const items: Array<[string, string]> = [
				["模型", this.plugin.getModelLabel(this.run.executionConfig.model)],
				["推理强度", this.plugin.getReasoningLabel(this.run.executionConfig.reasoningEffort)],
				["速度", this.run.executionConfig.serviceTier === "fast" ? "快速" : "标准"],
			];
			items.forEach(([label, value]) => {
				const item = config.createDiv({ cls: "agent-dashboard-result-config-item" });
				item.createSpan({ text: label });
				item.createEl("strong", { text: value });
			});
		}
		if (this.run.summary) {
			contentEl.createEl("p", {
				cls: "agent-dashboard-result-summary",
				text: this.run.summary,
			});
		}
		const output = this.plugin.getTaskRunOutput(this.run)
			|| this.run.error
			|| "该任务尚未产生输出。";
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
					title: "AI 将逐项核验体检结果，处理确认属于低风险的结构问题，并在修改后重新体检",
				},
			});
			repair.type = "button";
			repair.addEventListener("click", () => {
				this.close();
				this.onRepair?.();
			});
		}
		const close = footer.createEl("button", { cls: "mod-cta", text: "关闭" });
		close.type = "button";
		close.addEventListener("click", () => this.close());
	}

	canRepair() {
		if (this.run.actionId !== "vault-lint" || typeof this.onRepair !== "function") {
			return false;
		}
		const completedWithReport = this.run.status === "done"
			|| (
				this.run.status === "failed"
				&& this.run.exitCode === 1
				&& String(this.run.output || "").includes("Vault lint: score")
			);
		if (!completedWithReport) return false;
		if (this.plugin.isActionRunning("vault-lint-fix")) return false;
		const lintStatus = this.plugin.getLintStatus();
		const summary = lintStatus.latest?.summary;
		return Boolean(summary && (Number(summary.errors || 0) + Number(summary.warnings || 0) > 0));
	}

	displayStatus(status: string): string {
		const statuses: Record<string, string> = {
			done: "已完成",
			failed: "失败",
			interrupted: "已中断",
			running: "运行中",
			queued: "排队中",
		};
		return statuses[status] || status;
	}

	onClose() {
		this.contentEl.empty();
	}
}

