import { App, Modal } from "obsidian";

import type { DashboardAction } from "../actions";
import {
	getCliBackendLabel,
	MODEL_OPTIONS,
	REASONING_OPTIONS,
	type CliBackendId,
} from "../config";
import {
	getClaudeDefaultModelLabel,
	type ClaudeConfigSource,
	getCodexDefaultModelLabel,
	type CodexConfigSource,
	getOpenCodeDefaultModelLabel,
	type OpenCodeConfigSource,
} from "../runtime/settings";
import type {
	CliModelDiscoveryResult,
	CodexExecutionConfig,
	ExecutionOverrides,
	ServiceTier,
} from "../types/contracts";

export type { ExecutionOverrides } from "../types/contracts";

export interface ActionInputResult {
	input: string;
	overrides: ExecutionOverrides | Record<string, never>;
}

interface ActionInputHost {
	settings: {
		codexConfigSource: CodexConfigSource;
		codexModel: string;
		claudeConfigSource: ClaudeConfigSource;
		claudeModel: string;
		openCodeConfigSource: OpenCodeConfigSource;
		openCodeModel: string;
	};
	resolveActionExecutionConfig(
		action: DashboardAction,
		overrides?: Partial<ExecutionOverrides>,
	): CodexExecutionConfig;
	resolveCliActionExecutionConfig(
		action: DashboardAction,
		backendId: CliBackendId,
		overrides?: Partial<ExecutionOverrides>,
	): CodexExecutionConfig;
	isCliBackendAvailable(backendId: CliBackendId): boolean;
	getCliModelDiscovery(backendId: CliBackendId): CliModelDiscoveryResult | null;
	discoverCliModels(
		backendId: CliBackendId,
		force?: boolean,
	): Promise<CliModelDiscoveryResult>;
	getModelLabel(model: string): string;
	getReasoningLabel(reasoningEffort: string): string;
	supportsFast(model: string): boolean;
}

interface ActionInputOptions {
	initialInput?: string;
}

export class ActionInputModal extends Modal {
	private readonly plugin: ActionInputHost;
	private readonly action: DashboardAction;
	private readonly onSubmit: (result: ActionInputResult) => void;
	private readonly initialInput: string;

	constructor(
		app: App,
		plugin: ActionInputHost,
		action: DashboardAction,
		onSubmit: (result: ActionInputResult) => void,
		options: ActionInputOptions = {},
	) {
		super(app);
		this.plugin = plugin;
		this.action = action;
		this.onSubmit = onSubmit;
		this.initialInput = typeof options.initialInput === "string" ? options.initialInput : "";
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
				text: "运行后，所选执行后端可在该 skill 拥有的范围内更新项目文件。提交此表单即确认本次写入授权。",
			});
		}
		let input: HTMLTextAreaElement | null = null;
		if (this.action.requiresInput) {
			input = contentEl.createEl("textarea", {
				cls: "agent-dashboard-modal-input",
				attr: {
					placeholder: this.action.placeholder,
					rows: "8",
					"aria-label": `${this.action.label}任务说明`,
				},
			});
			input.value = this.initialInput;
		}

		const controls = this.action.ai ? this.renderExecutionControls(contentEl) : null;
		const footer = contentEl.createDiv({ cls: "agent-dashboard-modal-actions" });
		const cancel = footer.createEl("button", { text: "取消" });
		cancel.type = "button";
		const submit = footer.createEl("button", {
			cls: "mod-cta",
			text: "开始执行",
		});
		submit.type = "button";
		submit.disabled = this.action.requiresInput && !this.initialInput.trim();

		const syncSubmitState = () => {
			submit.disabled = this.action.requiresInput && (!input || input.value.trim().length === 0);
		};
		const submitAction = () => {
			const value = input ? input.value.trim() : "";
			if (this.action.requiresInput && !value) return;
			this.close();
			this.onSubmit({
				input: value,
				overrides: controls ? controls.getOverrides() : {},
			});
		};
		if (input) {
			input.addEventListener("input", syncSubmitState);
			input.addEventListener("keydown", (event) => {
				if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
					event.preventDefault();
					submitAction();
				}
			});
		}
		cancel.addEventListener("click", () => this.close());
		submit.addEventListener("click", submitAction);
		window.setTimeout(() => (input || submit).focus(), 0);
	}

	renderExecutionControls(parent: HTMLElement): { getOverrides: () => ExecutionOverrides } {
		const supportsStageWriteBackends = ["code-analysis", "synthesis"].includes(
			this.action.id,
		);
		let backendId: CliBackendId = "codex-cli";
		const resolveEffective = (overrides: ExecutionOverrides = {}) => {
			return this.plugin.resolveCliActionExecutionConfig(
				this.action,
				backendId,
				overrides,
			);
		};
		const section = parent.createEl("section", {
			cls: "agent-dashboard-run-config",
			attr: { "aria-label": "本次运行配置" },
		});
		const heading = section.createDiv({ cls: "agent-dashboard-run-config-heading" });
		heading.createSpan({ text: "运行配置" });
		const summary = heading.createSpan({ cls: "agent-dashboard-run-config-summary" });

		let backendSelect: HTMLSelectElement | null = null;
		if (supportsStageWriteBackends) {
			backendSelect = this.createSelectField(section, "执行后端", "运行执行后端");
			backendSelect.createEl("option", {
				text: "Codex CLI",
				attr: { value: "codex-cli" },
			});
			const claudeOption = backendSelect.createEl("option", {
				text: this.plugin.isCliBackendAvailable("claude-code")
					? "Claude Code · 阶段写入"
					: "Claude Code · 未配置",
				attr: { value: "claude-code" },
			});
			claudeOption.disabled = !this.plugin.isCliBackendAvailable("claude-code");
			const openCodeOption = backendSelect.createEl("option", {
				text: this.plugin.isCliBackendAvailable("opencode")
					? "OpenCode · 阶段写入"
					: "OpenCode · 未配置",
				attr: { value: "opencode" },
			});
			openCodeOption.disabled = !this.plugin.isCliBackendAvailable("opencode");
		}

		const modelSelect = this.createSelectField(section, "模型", "运行模型");
		const reasoningSelect = this.createSelectField(section, "推理强度", "运行推理强度");
		const reasoningDefaultOption = reasoningSelect.createEl("option", {
			text: "",
			attr: { value: "" },
		});
		REASONING_OPTIONS.forEach((option) => {
			reasoningSelect.createEl("option", { text: option.label, attr: { value: option.id } });
		});

		const speedField = section.createDiv({ cls: "agent-dashboard-run-config-field" });
		speedField.createSpan({ cls: "agent-dashboard-run-config-label", text: "速度" });
		const speedControl = speedField.createDiv({
			cls: "agent-dashboard-speed-control",
			attr: { role: "group", "aria-label": "运行速度" },
		});
		let serviceTier: ServiceTier = "default";
		const speedOptions: Array<[ServiceTier, string, string]> = [
			["default", "标准", "默认速度"],
			["fast", "快速", "约 1.5 倍速度，用量更多"],
		];
		const speedButtons = speedOptions.map(([value, label, title]) => {
			const button = speedControl.createEl("button", {
				cls: value === serviceTier ? "agent-dashboard-speed-option is-active" : "agent-dashboard-speed-option",
				text: label,
				attr: { type: "button", title, "aria-pressed": value === serviceTier ? "true" : "false" },
			});
			button.addEventListener("click", () => {
				if (button.disabled) return;
				serviceTier = value;
				syncSpeedControl();
				updateSummary();
			});
			button.dataset.value = value;
			return button;
		});
		const boundaryNotice = section.createDiv({
			cls: "agent-dashboard-run-config-note",
		});

		const getOverrides = (): ExecutionOverrides => ({
			backend: backendId,
			model: modelSelect.value,
			reasoningEffort: reasoningSelect.value,
			serviceTier: backendId === "codex-cli" ? serviceTier : "default",
		});
		const populateModelOptions = () => {
			const previous = modelSelect.value;
			modelSelect.empty();
			const actionDefault = resolveEffective();
			modelSelect.createEl("option", {
				text: backendId === "claude-code"
					? `使用 Claude 默认 · ${actionDefault.model || getClaudeDefaultModelLabel(this.plugin.settings.claudeConfigSource)}`
					: backendId === "opencode"
						? `使用 OpenCode 默认 · ${actionDefault.model || getOpenCodeDefaultModelLabel(this.plugin.settings.openCodeConfigSource)}`
					: `使用 Codex 默认 · ${actionDefault.model
						? this.plugin.getModelLabel(actionDefault.model)
						: getCodexDefaultModelLabel(this.plugin.settings.codexConfigSource)}`,
				attr: { value: "" },
			});
			const options = backendId !== "codex-cli"
				? [
					...(this.plugin.getCliModelDiscovery(backendId)?.models || []),
					...((backendId === "claude-code"
						? this.plugin.settings.claudeModel
						: this.plugin.settings.openCodeModel)
						? [{
							id: backendId === "claude-code"
								? this.plugin.settings.claudeModel
								: this.plugin.settings.openCodeModel,
							label: backendId === "claude-code"
								? this.plugin.settings.claudeModel
								: this.plugin.settings.openCodeModel,
							supportsFast: false,
						}]
						: []),
				]
				: this.plugin.settings.codexConfigSource === "cc-switch"
					? this.plugin.getCliModelDiscovery("codex-cli")?.models || []
					: [
					...MODEL_OPTIONS,
					...(MODEL_OPTIONS.some(
						(option) => option.id === this.plugin.settings.codexModel,
					)
						? []
						: [{
							id: this.plugin.settings.codexModel,
							label: this.plugin.settings.codexModel,
							supportsFast: false,
						}]),
					];
			const seen = new Set<string>();
			options.forEach((option) => {
				if (!option.id || seen.has(option.id)) return;
				seen.add(option.id);
				const description = "description" in option
					? option.description
					: "";
				modelSelect.createEl("option", {
					text: description
						? `${option.label} · ${description}`
						: option.label,
					attr: { value: option.id },
				});
			});
			modelSelect.value = seen.has(previous) ? previous : "";
		};
		const syncReasoningDefault = () => {
			const actionDefault = resolveEffective();
			reasoningDefaultOption.setText(
				backendId !== "codex-cli"
					? `使用 ${getCliBackendLabel(backendId)} 默认 · ${this.plugin.getReasoningLabel(actionDefault.reasoningEffort)}`
					: actionDefault.reasoningEffort
						? `使用 Codex 默认 · ${this.plugin.getReasoningLabel(actionDefault.reasoningEffort)}`
						: "使用 CC Switch 当前推理强度",
			);
		};
		const syncSpeedControl = () => {
			speedField.style.display = backendId === "codex-cli" ? "" : "none";
			if (backendId !== "codex-cli") {
				serviceTier = "default";
				return;
			}
			const actionDefault = resolveEffective();
			const selectedModel = modelSelect.value || actionDefault.model;
			const supportsFast = this.plugin.supportsFast(selectedModel);
			const usesCodexSwitch = this.plugin.settings.codexConfigSource === "cc-switch";
			speedButtons[0].setText(usesCodexSwitch ? "当前配置" : "标准");
			speedButtons[0].setAttr(
				"title",
				usesCodexSwitch ? "沿用 CC Switch 当前 service tier" : "默认速度",
			);
			if (!supportsFast) serviceTier = "default";
			speedButtons.forEach((item) => {
				const isFast = item.dataset.value === "fast";
				const active = item.dataset.value === serviceTier;
				item.disabled = isFast && !supportsFast;
				item.toggleClass("is-active", active);
				item.setAttr("aria-pressed", active ? "true" : "false");
				if (isFast) {
					item.setAttr("title", supportsFast ? "约 1.5 倍速度，用量更多" : "当前模型不支持 Fast 速度");
				}
			});
		};
		const syncBoundaryNotice = () => {
			boundaryNotice.setText(
				backendId === "claude-code"
					? "Claude Code：仅允许当前阶段目录写入，Bash 已禁用；结束后生成变更清单并执行知识库体检，越界或失败时回滚。"
					: backendId === "opencode"
						? "OpenCode：仅允许当前阶段写入，Shell 与外部目录访问已禁用；结束后生成变更清单并执行知识库体检，越界或失败时回滚。"
					: "Codex CLI：按操作拥有的目录执行；运行前建立快照，停止、失败、越界或后置体检失败时自动回滚。",
			);
		};
		const updateSummary = () => {
			const effective = resolveEffective(getOverrides());
			const backendLabel = getCliBackendLabel(backendId);
			const modelLabel = effective.model
				? this.plugin.getModelLabel(effective.model)
				: backendId === "claude-code"
					? getClaudeDefaultModelLabel(this.plugin.settings.claudeConfigSource)
					: backendId === "opencode"
						? getOpenCodeDefaultModelLabel(this.plugin.settings.openCodeConfigSource)
						: getCodexDefaultModelLabel(this.plugin.settings.codexConfigSource);
			const reasoningLabel = effective.reasoningEffort
				? this.plugin.getReasoningLabel(effective.reasoningEffort)
				: "CLI 默认推理";
			summary.setText(
				backendId !== "codex-cli"
					? `${backendLabel} · ${modelLabel} · ${reasoningLabel}`
					: `${backendLabel} · ${modelLabel} · ${reasoningLabel} · ${
						effective.serviceTier === "fast"
							? "快速"
							: this.plugin.settings.codexConfigSource === "cc-switch"
								? "当前速度配置"
								: "标准"
					}`,
			);
		};
		modelSelect.addEventListener("change", () => {
			syncSpeedControl();
			updateSummary();
		});
		reasoningSelect.addEventListener("change", updateSummary);
		backendSelect?.addEventListener("change", () => {
			backendId = backendSelect?.value === "claude-code"
				? "claude-code"
				: backendSelect?.value === "opencode"
					? "opencode"
					: "codex-cli";
			serviceTier = "default";
			modelSelect.value = "";
			reasoningSelect.value = "";
			populateModelOptions();
			syncReasoningDefault();
			syncSpeedControl();
			syncBoundaryNotice();
			updateSummary();
			void this.plugin.discoverCliModels(backendId).then(() => {
				if (backendSelect?.value !== backendId) return;
				populateModelOptions();
				syncSpeedControl();
				updateSummary();
			}).catch(() => undefined);
		});
		populateModelOptions();
		syncReasoningDefault();
		syncSpeedControl();
		syncBoundaryNotice();
		updateSummary();
		return { getOverrides };
	}

	createSelectField(parent: HTMLElement, label: string, ariaLabel: string): HTMLSelectElement {
		const field = parent.createDiv({ cls: "agent-dashboard-run-config-field" });
		field.createSpan({ cls: "agent-dashboard-run-config-label", text: label });
		return field.createEl("select", {
			cls: "agent-dashboard-run-config-select",
			attr: { "aria-label": ariaLabel },
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}

