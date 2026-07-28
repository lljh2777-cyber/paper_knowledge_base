import {
	App,
	Notice,
	Plugin,
	PluginSettingTab,
	SecretComponent,
	Setting,
	setIcon,
} from "obsidian";

import {
	MAX_QUERY_IMAGE_ATTACHMENTS,
	PROVIDER_TYPES,
	PROVIDER_TYPE_BY_ID,
	REASONING_OPTIONS,
	type ProviderTypeId,
} from "../config";
import {
	makeProviderProfile,
	modelHasKnownVisionSupport,
	modelIsQwen37Plus,
	normalizeAssignedSites,
	profileHasConfiguredQwenWebSearch,
	type ProviderProfile,
} from "../providers/profile";
import type { ProviderModel } from "../providers/shared";
import type {
	PluginHost,
	ProviderConnectionTestResult,
	ProviderRuntimeEntry,
} from "../types/contracts";

interface SettingsPluginHost extends PluginHost {
	providerRuntimeState: Map<string, ProviderRuntimeEntry>;
	providerEditorProfileId: string;
	saveSettings(): Promise<void>;
	checkRuntime(): { ready: boolean; message: string };
	listProviderModels(profileId: string): Promise<ProviderModel[]>;
	testProviderConnection(profileId: string): Promise<ProviderConnectionTestResult>;
	getProviderErrorLabel(type: string): string;
}

type SettingsPage = "home" | "runtime" | "codex" | "claude" | "direct-api";

export class AgentDashboardSettingTab extends PluginSettingTab {
	declare plugin: Plugin & SettingsPluginHost;
	private activePage: SettingsPage = "home";

	constructor(app: App, plugin: Plugin & SettingsPluginHost) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("agent-dashboard-settings");
		switch (this.activePage) {
			case "runtime":
				this.renderRuntimeSettings(containerEl);
				break;
			case "codex":
				this.renderCodexSettings(containerEl);
				break;
			case "claude":
				this.renderClaudeSettings(containerEl);
				break;
			case "direct-api":
				this.renderDirectApiSettings(containerEl);
				break;
			default:
				this.renderSettingsHome(containerEl);
		}
	}

	private renderSettingsHome(containerEl: HTMLElement): void {
		this.createSettingsPageHeader(
			containerEl,
			"Agent Dashboard",
			"按模块管理运行环境、CLI 后端和 Direct API。进入对应模块后再修改详细设置。",
		);
		const navigation = containerEl.createDiv({ cls: "agent-dashboard-settings-navigation" });
		this.createSettingsNavigationItem(navigation, {
			page: "runtime",
			icon: "terminal",
			title: "运行环境",
			description: "项目目录、Codex/Claude/Python/R 可执行文件、任务超时和环境检查。",
			status: "本地执行",
		});
		const reasoningLabel = REASONING_OPTIONS.find(
			(option) => option.id === this.plugin.settings.codexReasoningEffort,
		)?.label || this.plugin.settings.codexReasoningEffort;
		this.createSettingsNavigationItem(navigation, {
			page: "codex",
			icon: "bot",
			title: "Codex 模型",
			description: "全局默认模型、推理强度，以及 Codex CLI 连接测试。",
			status: `${this.plugin.settings.codexModel} · ${reasoningLabel}`,
		});
		const claudeReasoningLabel = REASONING_OPTIONS.find(
			(option) => option.id === this.plugin.settings.claudeReasoningEffort,
		)?.label || this.plugin.settings.claudeReasoningEffort;
		this.createSettingsNavigationItem(navigation, {
			page: "claude",
			icon: "sparkles",
			title: "Claude Code",
			description: "只读检索与批注解释、CC Switch 模型覆盖和连接测试。",
			status: `${this.plugin.settings.claudeModel || "CC Switch 默认"} · ${claudeReasoningLabel}`,
		});
		const profiles = this.plugin.settings.providerProfiles;
		const activeProfile = profiles.find(
			(profile) => profile.id === this.plugin.settings.activeProviderId,
		);
		this.createSettingsNavigationItem(navigation, {
			page: "direct-api",
			icon: "plug-zap",
			title: "Direct API",
			description: "供应商、SecretStorage 凭据、模型能力、联网搜索和连接测试。",
			status: activeProfile
				? `${activeProfile.name} · 已启用`
				: profiles.length
					? `${profiles.length} 个配置`
					: "未配置",
		});
	}

	private renderRuntimeSettings(containerEl: HTMLElement): void {
		this.createSettingsPageHeader(
			containerEl,
			"运行环境",
			"管理 Dashboard 本地任务使用的项目路径、运行时和超时限制。",
			true,
		);
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
			.setDesc("用于文献、代码、检索和综合任务。默认自动选择当前 Codex 应用携带的最新 CLI；手动填写的外部路径会保留。")
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
			.setName("Claude Code 可执行文件")
			.setDesc("用于只读知识库检索与批注解释。原生安装通常位于用户目录的 .local\\bin\\claude.exe。")
			.addText((text) =>
				text
					.setPlaceholder("C:\\Users\\<user>\\.local\\bin\\claude.exe")
					.setValue(this.plugin.settings.claudeExecutable)
					.onChange(async (value) => {
						this.plugin.settings.claudeExecutable = value.trim();
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

	private renderCodexSettings(containerEl: HTMLElement): void {
		this.createSettingsPageHeader(
			containerEl,
			"Codex 模型",
			"配置 Dashboard AI 任务的全局回退模型，并检查 Codex CLI 是否可用。",
			true,
		);
		new Setting(containerEl)
			.setName("全局默认模型")
			.setDesc("没有按钮级模型配置的 Dashboard AI 任务使用该模型。")
			.addText((text) =>
				text
					.setPlaceholder("gpt-5.6-terra")
					.setValue(this.plugin.settings.codexModel)
					.onChange(async (value) => {
						this.plugin.settings.codexModel = value.trim() || "gpt-5.6-terra";
						await this.plugin.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName("全局默认推理强度")
			.setDesc("仅在按钮没有指定推理强度时使用；按钮默认值和本次运行覆盖优先。")
			.addDropdown((dropdown) => {
				REASONING_OPTIONS.forEach((option) => dropdown.addOption(option.id, option.label));
				dropdown
					.setValue(this.plugin.settings.codexReasoningEffort)
					.onChange(async (value) => {
						this.plugin.settings.codexReasoningEffort = value;
						await this.plugin.saveSettings();
					});
			});
		this.createProviderSectionHeader(
			containerEl,
			"模型调用",
			"写入型 Dashboard 任务使用 Codex CLI；认证、模型调用、沙箱和权限继续由 Codex 管理。",
		);
		const codexResult = this.plugin.providerRuntimeState.get("codex-cli") || null;
		new Setting(containerEl)
			.setName("当前执行后端")
			.setDesc("Codex CLI：认证、模型调用、沙箱和权限继续由 Codex 管理。")
			.addButton((button) => {
				const testing = codexResult?.status === "testing";
				button
					.setButtonText(testing ? "测试中…" : "测试连接")
					.setDisabled(testing)
					.onClick(async () => {
						this.plugin.providerRuntimeState.set("codex-cli", { status: "testing" });
						this.display();
						const result = await this.plugin.testProviderConnection("codex-cli");
						this.plugin.providerRuntimeState.set("codex-cli", { status: "done", result });
						this.display();
					});
			});
		if (codexResult?.result) this.renderConnectionResult(containerEl, codexResult.result);
	}

	private renderClaudeSettings(containerEl: HTMLElement): void {
		this.createSettingsPageHeader(
			containerEl,
			"Claude Code",
			"配置 Claude Code CLI。查询与批注保持只读；代码分析和综合分析可使用阶段所有权写入。",
			true,
		);
		new Setting(containerEl)
			.setName("模型覆盖")
			.setDesc("留空时沿用 CC Switch 当前模型；填写后仅覆盖 Dashboard 发起的 Claude Code 任务。")
			.addText((text) =>
				text
					.setPlaceholder("留空使用 CC Switch 默认模型")
					.setValue(this.plugin.settings.claudeModel)
					.onChange(async (value) => {
						this.plugin.settings.claudeModel = value.trim();
						await this.plugin.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName("默认推理强度")
			.setDesc("用于 Claude Code 的检索、批注解释、代码分析和综合分析。")
			.addDropdown((dropdown) => {
				REASONING_OPTIONS.forEach((option) => dropdown.addOption(option.id, option.label));
				dropdown
					.setValue(this.plugin.settings.claudeReasoningEffort)
					.onChange(async (value) => {
						this.plugin.settings.claudeReasoningEffort = value;
						await this.plugin.saveSettings();
					});
			});
		new Setting(containerEl)
			.setName("查询图片")
			.setDesc(
				`知识库查询可发送最多 ${MAX_QUERY_IMAGE_ATTACHMENTS} 张 Vault 图片。插件只传递经过校验的本地路径，Claude Code 使用只读 Read 工具打开图片；实际视觉能力取决于 CC Switch 当前模型。`,
			);
		new Setting(containerEl)
			.setName("批注解释后端")
			.setDesc("自动模式优先使用已启用的 Direct API，否则使用 Codex。也可固定为某个本地 CLI。")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("auto", "自动")
					.addOption("codex-cli", "Codex CLI")
					.addOption("claude-code", "Claude Code")
					.setValue(this.plugin.settings.annotationBackendId)
					.onChange(async (value) => {
						this.plugin.settings.annotationBackendId = value === "claude-code"
							? "claude-code"
							: value === "codex-cli"
								? "codex-cli"
								: "auto";
						await this.plugin.saveSettings();
					});
			});
		this.createProviderSectionHeader(
			containerEl,
			"只读执行边界",
			"连接测试不发送 Vault 内容。检索只开放 Read、Glob 和 Grep；批注解释不开放任何工具。",
		);
		const resultState = this.plugin.providerRuntimeState.get("claude-code") || null;
		new Setting(containerEl)
			.setName("Claude Code / CC Switch")
			.setDesc("验证 CLI、当前模型、JSONL 输出以及自定义 endpoint 是否可用。")
			.addButton((button) => {
				const testing = resultState?.status === "testing";
				button
					.setButtonText(testing ? "测试中…" : "测试连接")
					.setDisabled(testing)
					.onClick(async () => {
						this.plugin.providerRuntimeState.set("claude-code", { status: "testing" });
						this.display();
						const result = await this.plugin.testProviderConnection("claude-code");
						this.plugin.providerRuntimeState.set("claude-code", { status: "done", result });
						this.display();
					});
			});
		if (resultState?.result) {
			this.renderConnectionResult(containerEl, resultState.result);
		}
	}

	private renderDirectApiSettings(containerEl: HTMLElement): void {
		this.createSettingsPageHeader(
			containerEl,
			"Direct API",
			"管理知识库查询可用的独立模型服务。Direct API 不执行 skill 或文件写入。",
			true,
		);
		this.createProviderSectionHeader(
			containerEl,
			"Direct API 配置",
			"先选择已有配置或新建配置，再按页面顺序填写供应商、凭据、endpoint 和模型。",
		);
		const profiles = this.plugin.settings.providerProfiles;
		const selectedProfile = this.getEditorProviderProfile();
		const profileSetting = new Setting(containerEl)
			.setName("配置")
			.setDesc(profiles.length ? "切换当前编辑的供应商配置。" : "尚未创建 Direct API 配置。");
		profileSetting.addDropdown((dropdown) => {
			if (!profiles.length) dropdown.addOption("", "尚未创建");
			profiles.forEach((profile) => {
				const suffix = profile.lastTest?.ok ? " · 已验证" : "";
				dropdown.addOption(profile.id, `${profile.name}${suffix}`);
			});
			dropdown
				.setValue(selectedProfile?.id || "")
				.onChange((value) => {
					this.plugin.providerEditorProfileId = value;
					this.display();
				});
		});
		profileSetting.addButton((button) =>
			button
				.setButtonText("新增配置")
				.onClick(async () => {
					const profile = makeProviderProfile("openai");
					this.plugin.settings.providerProfiles.push(profile);
					this.plugin.providerEditorProfileId = profile.id;
					await this.plugin.saveSettings();
					this.display();
				})
		);
		if (selectedProfile) {
			profileSetting.addButton((button) =>
				button
					.setButtonText("移除当前")
					.setWarning()
					.onClick(async () => {
						if (!window.confirm(`移除 Direct API 配置“${selectedProfile.name}”？SecretStorage 中的凭据不会删除。`)) return;
						this.plugin.settings.providerProfiles = profiles.filter(
							(profile) => profile.id !== selectedProfile.id,
						);
						if (this.plugin.settings.activeProviderId === selectedProfile.id) {
							this.plugin.settings.activeProviderId = "";
						}
						this.plugin.providerRuntimeState.delete(selectedProfile.id);
						this.plugin.providerEditorProfileId = this.plugin.settings.providerProfiles[0]?.id || "";
						await this.plugin.saveSettings();
						this.display();
					})
			);
		}
		profileSetting.settingEl.addClass("agent-dashboard-provider-manager");

		if (!this.app.secretStorage || typeof SecretComponent !== "function") {
			const warning = containerEl.createDiv({ cls: "agent-dashboard-provider-warning" });
			warning.createEl("strong", { text: "SecretStorage 不可用" });
			warning.createEl("span", {
				text: "请升级 Obsidian。插件不会回退到 data.json 明文保存 API Key。",
			});
		}

		if (!selectedProfile) {
			const empty = containerEl.createDiv({ cls: "agent-dashboard-provider-empty" });
			const icon = empty.createSpan();
			setIcon(icon, "plug-zap");
			const copy = empty.createDiv();
			copy.createEl("strong", { text: "从新增配置开始" });
			copy.createEl("span", {
				text: "创建后依次填写供应商、SecretStorage 凭据和 endpoint，再获取模型并测试连接。",
			});
			return;
		}
		this.renderProviderProfile(containerEl, selectedProfile);
	}

	private createSettingsPageHeader(
		containerEl: HTMLElement,
		title: string,
		description: string,
		showBack = false,
	): void {
		const header = containerEl.createDiv({ cls: "agent-dashboard-settings-page-header" });
		if (showBack) {
			const backButton = header.createEl("button", {
				cls: "agent-dashboard-settings-back",
				attr: {
					type: "button",
					"aria-label": "返回设置首页",
				},
			});
			const icon = backButton.createSpan();
			setIcon(icon, "arrow-left");
			backButton.createSpan({ text: "设置" });
			backButton.addEventListener("click", () => {
				this.activePage = "home";
				this.display();
			});
		}
		header.createEl("h2", { text: title });
		header.createEl("p", { text: description });
	}

	private createSettingsNavigationItem(
		containerEl: HTMLElement,
		options: {
			page: Exclude<SettingsPage, "home">;
			icon: string;
			title: string;
			description: string;
			status: string;
		},
	): void {
		const button = containerEl.createEl("button", {
			cls: "agent-dashboard-settings-navigation-item",
			attr: {
				type: "button",
				"aria-label": `打开${options.title}设置`,
			},
		});
		const icon = button.createSpan({ cls: "agent-dashboard-settings-navigation-icon" });
		setIcon(icon, options.icon);
		const copy = button.createDiv({ cls: "agent-dashboard-settings-navigation-copy" });
		copy.createEl("strong", { text: options.title });
		copy.createSpan({ text: options.description });
		const trailing = button.createDiv({ cls: "agent-dashboard-settings-navigation-trailing" });
		trailing.createSpan({ text: options.status });
		const chevron = trailing.createSpan({ cls: "agent-dashboard-settings-navigation-chevron" });
		setIcon(chevron, "chevron-right");
		button.addEventListener("click", () => {
			this.activePage = options.page;
			this.display();
		});
	}

	getEditorProviderProfile(): ProviderProfile | null {
		const profiles = this.plugin.settings.providerProfiles;
		if (!profiles.length) {
			this.plugin.providerEditorProfileId = "";
			return null;
		}
		const preferredId = this.plugin.providerEditorProfileId
			|| this.plugin.settings.activeProviderId
			|| profiles[0].id;
		const profile = profiles.find((item) => item.id === preferredId) || profiles[0];
		this.plugin.providerEditorProfileId = profile.id;
		return profile;
	}

	createProviderSectionHeader(
		containerEl: HTMLElement,
		title: string,
		description = "",
		status = "",
	): HTMLElement {
		const header = containerEl.createDiv({ cls: "agent-dashboard-settings-section" });
		const heading = header.createDiv({ cls: "agent-dashboard-settings-section-heading" });
		heading.createEl("h3", { text: title });
		if (status) heading.createSpan({ cls: "agent-dashboard-provider-badge is-ready", text: status });
		if (description) header.createEl("p", { text: description });
		return header;
	}

	renderProviderProfile(containerEl: HTMLElement, profile: ProviderProfile): void {
		const metadata = PROVIDER_TYPE_BY_ID.get(profile.type) || PROVIDER_TYPES[0];
		const verificationStatus = profile.lastTest?.ok
			? this.plugin.settings.activeProviderId === profile.id
				? "已验证 · 默认"
				: "已验证"
			: "";
		this.createProviderSectionHeader(
			containerEl,
			"LLM 配置",
			"凭据通过 Obsidian SecretStorage 管理；插件配置只保存凭据名称。",
			verificationStatus,
		);
		const section = containerEl.createDiv({
			cls: "agent-dashboard-provider-form",
			attr: { "data-provider-id": profile.id },
		});

		new Setting(section)
			.setName("配置名称")
			.setDesc("用于区分多个供应商或不同账户。")
			.addText((text) => {
				const commitName = async () => {
					const normalizedName = text.getValue().trim().slice(0, 80) || metadata.label;
					profile.name = normalizedName;
					profile.updatedAt = new Date().toISOString();
					if (text.getValue() !== normalizedName) text.setValue(normalizedName);
					await this.plugin.saveSettings();
				};
				text
					.setPlaceholder(metadata.label)
					.setValue(profile.name)
					.onChange((value) => {
						profile.name = value.slice(0, 80);
					});
				text.inputEl.addEventListener("blur", () => {
					void commitName();
				});
				text.inputEl.addEventListener("keydown", (event) => {
					if (event.key !== "Enter" || event.isComposing) return;
					event.preventDefault();
					text.inputEl.blur();
				});
			});
		new Setting(section)
			.setName("LLM Provider")
			.setDesc("选择预定义供应商或 OpenAI 兼容服务。")
			.addDropdown((dropdown) => {
				PROVIDER_TYPES.forEach((provider) => dropdown.addOption(provider.id, provider.label));
				dropdown.setValue(profile.type).onChange(async (value) => {
					const previous = PROVIDER_TYPE_BY_ID.get(profile.type) || metadata;
					const next = PROVIDER_TYPE_BY_ID.get(value as ProviderTypeId) || PROVIDER_TYPES[0];
					if (!profile.baseUrl || profile.baseUrl === previous.defaultBaseUrl) {
						profile.baseUrl = next.defaultBaseUrl;
					}
					if (!profile.model || profile.model === previous.defaultModel) {
						profile.model = next.defaultModel;
					}
					profile.type = next.id;
					profile.capabilities = { ...next.capabilities, visionConfigured: false };
					profile.webSearch = {
						enabled: false,
						configured: false,
						protocol: "qwen-chat-completions",
						forcedSearch: true,
						searchStrategy: "turbo",
						assignedSites: [],
						timeoutSeconds: 60,
					};
					profile.name = profile.name === previous.label ? next.label : profile.name;
					this.invalidateProviderProfile(profile);
					await this.plugin.saveSettings();
					this.display();
				});
			});
		const secretSetting = new Setting(section)
			.setName("API Key / 凭据")
			.setDesc(
				metadata.requiresSecret
					? "必需。选择或创建 SecretStorage 凭据；真实 Key 不写入 data.json。"
					: "可选。本地服务通常不需要；远程兼容端点可选择 SecretStorage 凭据。",
			);
		if (this.app.secretStorage && typeof SecretComponent === "function") {
			secretSetting.addComponent((element) =>
				new SecretComponent(this.app, element)
					.setValue(profile.secretId)
					.onChange(async (value) => {
						profile.secretId = String(value || "").trim().slice(0, 160);
						this.invalidateProviderProfile(profile);
						await this.plugin.saveSettings();
					})
			);
		}
		new Setting(section)
			.setName("API Base URL")
			.setDesc(`服务根地址。${metadata.defaultBaseUrl ? `默认：${metadata.defaultBaseUrl}` : ""}`)
			.addText((text) =>
				text
					.setPlaceholder(metadata.defaultBaseUrl)
					.setValue(profile.baseUrl)
					.onChange(async (value) => {
						profile.baseUrl = value.trim().replace(/\/+$/g, "").slice(0, 500);
						this.invalidateProviderProfile(profile);
						await this.plugin.saveSettings();
					})
			);
		const timeoutSetting = new Setting(section)
			.setName("请求超时")
			.setDesc(`模型发现和连接测试的单次请求上限。当前：${profile.timeoutSeconds} 秒。`)
			.addSlider((slider) =>
				slider
					.setLimits(3, 120, 1)
					.setValue(profile.timeoutSeconds)
					.setDynamicTooltip()
					.onChange(async (value) => {
						profile.timeoutSeconds = value;
						this.invalidateProviderProfile(profile);
						timeoutSetting.setDesc(`模型发现和连接测试的单次请求上限。当前：${value} 秒。`);
						await this.plugin.saveSettings();
					})
			);
		timeoutSetting.settingEl.addClass("agent-dashboard-provider-setting-emphasis");

		this.createProviderSectionHeader(
			containerEl,
			"模型选择",
			"先从 Provider API 获取模型列表，再选择模型并执行最小连接测试。",
		);
		const modelForm = containerEl.createDiv({ cls: "agent-dashboard-provider-form" });
		const modelState = this.plugin.providerRuntimeState.get(profile.id);
		const discoveredModels = Array.isArray(modelState?.models) ? modelState.models : [];
		const runtime = this.plugin.providerRuntimeState.get(profile.id) || {};
		const discoverySetting = new Setting(modelForm)
			.setName("获取可用模型")
			.setDesc("从当前 endpoint 获取最新模型列表，不发送 Vault 内容。");
		discoverySetting.addButton((button) => {
			const loading = runtime.status === "models";
			button
				.setButtonText(loading ? "获取中…" : "获取模型列表")
				.setCta()
				.setDisabled(loading || runtime.status === "testing")
				.onClick(async () => {
					this.plugin.providerRuntimeState.set(profile.id, { ...runtime, status: "models" });
					this.display();
					try {
						const models = await this.plugin.listProviderModels(profile.id);
						this.plugin.providerRuntimeState.set(profile.id, { status: "idle", models });
						new Notice(`已获取 ${models.length} 个模型`, 5000);
					} catch (error) {
						const normalized = this.plugin.normalizeProviderError(error);
						this.plugin.providerRuntimeState.set(profile.id, {
							status: "idle",
							models: [],
							result: {
								ok: false,
								type: normalized.type,
								message: normalized.message,
								status: normalized.status,
								endpoint: normalized.endpoint || profile.baseUrl,
								model: profile.model,
								responseTimeMs: 0,
								testedAt: new Date().toISOString(),
							},
						});
					}
					this.display();
				});
		});
		discoverySetting.settingEl.addClass("agent-dashboard-provider-setting-emphasis");
		const modelSetting = new Setting(modelForm)
			.setName("选择模型")
			.setDesc(discoveredModels.length ? `从 ${discoveredModels.length} 个可用模型中选择，也可手动填写模型 ID。` : "尚未获取模型列表，可先手动填写模型 ID。")
			.addText((text) =>
				text
					.setPlaceholder(metadata.defaultModel || "模型 ID")
					.setValue(profile.model)
					.onChange(async (value) => {
						profile.model = value.trim().slice(0, 160);
						if (profile.capabilities.visionConfigured !== true) {
							profile.capabilities.vision = modelHasKnownVisionSupport(profile.model);
						}
						if (profile.webSearch.configured !== true) {
							profile.webSearch.enabled = modelIsQwen37Plus(profile.model);
						}
						this.invalidateProviderProfile(profile);
						await this.plugin.saveSettings();
					})
			);
		if (discoveredModels.length) {
			modelSetting.addDropdown((dropdown) => {
				dropdown.addOption("", "选择已发现模型");
				discoveredModels.forEach((model) => dropdown.addOption(model.id, model.name || model.id));
				dropdown.setValue(discoveredModels.some((model) => model.id === profile.model) ? profile.model : "");
				dropdown.onChange(async (value) => {
					if (!value) return;
					profile.model = value;
					if (profile.capabilities.visionConfigured !== true) {
						profile.capabilities.vision = modelHasKnownVisionSupport(profile.model);
					}
					if (profile.webSearch.configured !== true) {
						profile.webSearch.enabled = modelIsQwen37Plus(profile.model);
					}
					this.invalidateProviderProfile(profile);
					await this.plugin.saveSettings();
					this.display();
				});
			});
		}

		new Setting(modelForm)
			.setName("模型能力")
			.setDesc(
				`流式输出：${profile.capabilities.streaming ? "支持" : "不支持"}；PDF：${profile.capabilities.pdf ? "支持" : "不支持"}；视觉：${profile.capabilities.vision ? "支持" : "不支持"}；联网搜索：${profileHasConfiguredQwenWebSearch(profile) ? "已配置" : "未启用"}。连接测试会实际探测流式与已启用的联网请求。`,
			);
		new Setting(modelForm)
			.setName("视觉输入")
			.setDesc(
				profile.type === "openai-compatible"
							? `允许查询侧边栏发送最多 ${MAX_QUERY_IMAGE_ATTACHMENTS} 张 Vault 图片，并从问题中的 Obsidian/Wiki 笔记链接发现嵌入图片。`
							: "视觉输入目前仅由 OpenAI 兼容适配器处理。",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(profile.capabilities.vision === true)
					.setDisabled(profile.type !== "openai-compatible")
					.onChange(async (value) => {
						profile.capabilities.vision = value;
						profile.capabilities.visionConfigured = true;
						profile.updatedAt = new Date().toISOString();
						await this.plugin.saveSettings();
						this.display();
					})
			);
		const qwenWebSearchAvailable = profile.type === "openai-compatible"
			&& modelIsQwen37Plus(profile.model);
		new Setting(modelForm)
			.setName("Qwen3.7-Plus 联网搜索")
			.setDesc(
				qwenWebSearchAvailable
					? "通过 OpenAI 兼容 Chat Completions 的 enable_search 参数启用。切换后需重新测试连接。"
					: "仅在 OpenAI 兼容配置使用 qwen3.7-plus 或其快照模型时可启用。",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(profile.webSearch.enabled === true)
					.setDisabled(!qwenWebSearchAvailable)
					.onChange(async (value) => {
						profile.webSearch.enabled = value;
						profile.webSearch.configured = true;
						this.invalidateProviderProfile(profile);
						await this.plugin.saveSettings();
						this.display();
					})
			);
		if (qwenWebSearchAvailable && profile.webSearch.enabled) {
			new Setting(modelForm)
				.setName("搜索协议")
				.setDesc("当前 Direct API 适配器使用 /v1/chat/completions；不会发送 Responses API 或 DashScope 原生请求。")
				.addDropdown((dropdown) =>
					dropdown
						.addOption("qwen-chat-completions", "Qwen Chat Completions")
						.setValue(profile.webSearch.protocol)
						.setDisabled(true)
				);
			new Setting(modelForm)
				.setName("强制联网")
				.setDesc("启用 forced_search，确保选择“联网搜索”时每轮都触发搜索，而不是由模型自行判断。")
				.addToggle((toggle) =>
					toggle
						.setValue(profile.webSearch.forcedSearch !== false)
						.onChange(async (value) => {
							profile.webSearch.forcedSearch = value;
							this.invalidateProviderProfile(profile);
							await this.plugin.saveSettings();
						})
				);
			const webTimeoutSetting = new Setting(modelForm)
				.setName("联网请求超时")
				.setDesc(
					`联网搜索包含检索和内容整合，单独使用更长的请求上限。当前：${profile.webSearch.timeoutSeconds} 秒。`,
				)
				.addSlider((slider) =>
					slider
						.setLimits(20, 120, 5)
						.setValue(profile.webSearch.timeoutSeconds)
						.setDynamicTooltip()
						.onChange(async (value) => {
							profile.webSearch.timeoutSeconds = value;
							this.invalidateProviderProfile(profile);
							webTimeoutSetting.setDesc(
								`联网搜索包含检索和内容整合，单独使用更长的请求上限。当前：${value} 秒。`,
							);
							await this.plugin.saveSettings();
						})
				);
			new Setting(modelForm)
				.setName("搜索策略")
				.setDesc("turbo 适合日常查询；max 搜索更全面；agent 可能受模型版本和地域限制。")
				.addDropdown((dropdown) =>
					dropdown
						.addOption("turbo", "turbo · 默认")
						.addOption("max", "max · 更全面")
						.addOption("agent", "agent · 多轮搜索")
						.setValue(profile.webSearch.searchStrategy)
						.onChange(async (value) => {
							profile.webSearch.searchStrategy = value as "turbo" | "max" | "agent";
							if (value !== "turbo") profile.webSearch.assignedSites = [];
							this.invalidateProviderProfile(profile);
							await this.plugin.saveSettings();
							this.display();
						})
				);
			new Setting(modelForm)
				.setName("限定搜索站点")
				.setDesc(
					profile.webSearch.searchStrategy === "turbo"
						? "可选。输入逗号分隔的域名，最多 25 个；百炼仅在 turbo 策略下应用 assigned_site_list。"
						: "当前策略不是 turbo，因此不会发送 assigned_site_list。",
				)
				.addTextArea((text) =>
					text
						.setPlaceholder("pubmed.ncbi.nlm.nih.gov, nature.com")
						.setValue(profile.webSearch.assignedSites.join(", "))
						.setDisabled(profile.webSearch.searchStrategy !== "turbo")
						.onChange(async (value) => {
							profile.webSearch.assignedSites = normalizeAssignedSites(value);
							this.invalidateProviderProfile(profile);
							await this.plugin.saveSettings();
						})
				);
		}

		const controls = new Setting(modelForm)
			.setName("测试连接")
			.setDesc("验证 endpoint、凭据、模型和流式协议；成功后自动设为默认 Direct API 配置。");
		controls.addButton((button) => {
			const loading = runtime.status === "testing";
			button
				.setButtonText(loading ? "测试中…" : "测试连接")
				.setCta()
				.setDisabled(loading || runtime.status === "models")
				.onClick(async () => {
					this.plugin.providerRuntimeState.set(profile.id, {
						...runtime,
						status: "testing",
					});
					this.display();
					const result = await this.plugin.testProviderConnection(profile.id);
					const current = this.plugin.providerRuntimeState.get(profile.id) || {};
					this.plugin.providerRuntimeState.set(profile.id, {
						...current,
						status: "idle",
						result,
					});
					this.display();
				});
		});
		controls.settingEl.addClass("agent-dashboard-provider-test-setting");
		const result = runtime.result || (profile.lastTest
			? {
				ok: profile.lastTest.ok,
				type: profile.lastTest.type,
				model: profile.lastTest.model,
				modelExists: profile.lastTest.modelExists,
				endpoint: profile.lastTest.endpoint || profile.baseUrl,
				message: profile.lastTest.message,
				responseTimeMs: profile.lastTest.responseTimeMs,
				streaming: {
					supported: profile.capabilities.streaming,
					verified: profile.lastTest.streamingVerified,
				},
				webSearch: {
					supported: profileHasConfiguredQwenWebSearch(profile),
					verified: profile.lastTest.webSearchVerified,
					error: profile.lastTest.webSearchError,
					protocol: profile.webSearch.protocol,
					preview: profile.lastTest.webSearchPreview,
				},
				pdf: { supported: profile.capabilities.pdf, verified: false },
				testedAt: profile.lastTest.testedAt,
			}
			: null);
		if (result) this.renderConnectionResult(containerEl, result);
	}

	invalidateProviderProfile(profile: ProviderProfile): void {
		profile.lastTest = null;
		profile.updatedAt = new Date().toISOString();
		if (this.plugin.settings.activeProviderId === profile.id) {
			this.plugin.settings.activeProviderId = "";
		}
	}

	renderConnectionResult(
		parent: HTMLElement,
		result: ProviderConnectionTestResult,
	): void {
		const panel = parent.createDiv({
			cls: `agent-dashboard-provider-result ${result.ok ? "is-success" : "is-error"}`,
		});
		const heading = panel.createDiv({ cls: "agent-dashboard-provider-result-heading" });
		const icon = heading.createSpan();
		setIcon(icon, result.ok ? "circle-check" : "circle-alert");
		heading.createEl("strong", { text: result.ok ? "连接成功" : "连接失败" });
		const grid = panel.createDiv({ cls: "agent-dashboard-provider-result-grid" });
		const addRow = (label: string, value: unknown) => {
			const row = grid.createDiv();
			row.createSpan({ text: label });
			row.createEl("strong", { text: String(value || "—") });
		};
		if (result.endpoint) addRow("Endpoint", result.endpoint);
		addRow("模型", result.model || "—");
		if (result.ok) {
			addRow(
				"模型状态",
				result.modelExists === true
					? "存在，已验证"
					: result.modelExists === false
						? "列表中不存在"
						: "未验证，由实际任务确认",
			);
			const streaming = result.streaming?.supported
				? result.streaming.verified
					? "支持，已验证"
					: `支持，未验证${result.streaming?.error ? `：${result.streaming.error}` : ""}`
				: "不支持";
			addRow("流式输出", streaming);
			addRow("PDF", result.pdf?.supported ? "支持，未上传文件验证" : "不支持");
			if (result.webSearch?.supported) {
				addRow(
					"联网搜索",
					result.webSearch.verified
						? "请求已接受并返回内容"
						: `未通过${result.webSearch.error ? `：${result.webSearch.error}` : ""}`,
				);
				addRow("搜索协议", result.webSearch.protocol || "Qwen Chat Completions");
				if (result.webSearch.preview) addRow("联网测试响应", result.webSearch.preview);
			}
			addRow("响应时间", `${result.responseTimeMs} ms`);
			if (result.responsePreview) addRow("最小响应", result.responsePreview);
		} else {
			addRow("错误类型", this.plugin.getProviderErrorLabel(result.type));
			if (result.status) addRow("HTTP 状态", result.status);
			addRow("详情", result.message || "未知错误");
			addRow("耗时", `${result.responseTimeMs || 0} ms`);
		}
	}
}

