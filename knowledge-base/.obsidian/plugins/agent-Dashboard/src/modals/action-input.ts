import { App, Modal } from "obsidian";

import type { DashboardAction } from "../actions";
import { MODEL_OPTIONS, REASONING_OPTIONS } from "../config";

type ServiceTier = "default" | "fast";

export interface ExecutionOverrides {
	model: string;
	reasoningEffort: string;
	serviceTier: ServiceTier;
}

export interface ActionInputResult {
	input: string;
	overrides: ExecutionOverrides | Record<string, never>;
}

interface ExecutionConfig {
	model: string;
	reasoningEffort: string;
	serviceTier: ServiceTier;
}

interface ActionInputHost {
	settings: {
		codexModel: string;
	};
	resolveActionExecutionConfig(
		action: DashboardAction,
		overrides?: Partial<ExecutionOverrides>,
	): ExecutionConfig;
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
				text: "运行后，Codex 可在该 skill 拥有的范围内更新项目文件。提交此表单即确认本次写入授权。",
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
		const actionDefault = this.plugin.resolveActionExecutionConfig(this.action);
		const section = parent.createEl("section", {
			cls: "agent-dashboard-run-config",
			attr: { "aria-label": "本次运行配置" },
		});
		const heading = section.createDiv({ cls: "agent-dashboard-run-config-heading" });
		heading.createSpan({ text: "运行配置" });
		const summary = heading.createSpan({ cls: "agent-dashboard-run-config-summary" });

		const modelSelect = this.createSelectField(section, "模型", "运行模型");
		modelSelect.createEl("option", {
			text: `使用按钮默认 · ${this.plugin.getModelLabel(actionDefault.model)}`,
			attr: { value: "" },
		});
		const modelOptions: Array<{
			id: string;
			label: string;
			description?: string;
		}> = [...MODEL_OPTIONS];
		if (!modelOptions.some((option) => option.id === this.plugin.settings.codexModel)) {
			modelOptions.unshift({
				id: this.plugin.settings.codexModel,
				label: this.plugin.settings.codexModel,
			});
		}
		modelOptions.forEach((option) => {
			modelSelect.createEl("option", {
				text: option.description ? `${option.label} · ${option.description}` : option.label,
				attr: { value: option.id },
			});
		});

		const reasoningSelect = this.createSelectField(section, "推理强度", "运行推理强度");
		reasoningSelect.createEl("option", {
			text: `使用按钮默认 · ${this.plugin.getReasoningLabel(actionDefault.reasoningEffort)}`,
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

		const getOverrides = () => ({
			model: modelSelect.value,
			reasoningEffort: reasoningSelect.value,
			serviceTier,
		});
		const syncSpeedControl = () => {
			const selectedModel = modelSelect.value || actionDefault.model;
			const supportsFast = this.plugin.supportsFast(selectedModel);
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
		const updateSummary = () => {
			const effective = this.plugin.resolveActionExecutionConfig(this.action, getOverrides());
			summary.setText(`${this.plugin.getModelLabel(effective.model)} · ${this.plugin.getReasoningLabel(effective.reasoningEffort)} · ${effective.serviceTier === "fast" ? "快速" : "标准"}`);
		};
		modelSelect.addEventListener("change", () => {
			syncSpeedControl();
			updateSummary();
		});
		reasoningSelect.addEventListener("change", updateSummary);
		syncSpeedControl();
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

