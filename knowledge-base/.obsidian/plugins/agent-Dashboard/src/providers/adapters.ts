import {
	CONNECTION_TEST_MESSAGES,
	MODEL_OPTIONS,
	PROVIDER_TYPE_BY_ID,
	WEB_SEARCH_TEST_MESSAGES,
	type ChatMessage,
	type ProviderCapabilities,
} from "../config";
import type {
	PluginHost,
	ProviderChatRequest,
	ProviderCompletion,
	ProviderConnectionTestResult,
	ProviderHttpRequestOptions,
	ProviderRequestOptions,
	ProviderRuntimeConfig,
} from "../types/contracts";
import {
	normalizeAssignedSites,
	profileHasConfiguredQwenWebSearch,
} from "./profile";
import {
	ProviderConnectionError,
	asRecord,
	buildProviderUrl,
	emitProviderDelta,
	extractOpenAIText,
	normalizeProviderModelList,
	parseProviderJson,
	type ProviderModel,
	type UnknownRecord,
} from "./shared";

type ProviderDeltaHandler = (delta: string) => void;

interface ProviderRuntimeCapabilities extends ProviderCapabilities {
	webSearch: boolean;
}

interface ProviderRequestBody {
	model: string;
	messages: readonly ChatMessage[];
	max_tokens: number;
	stream: boolean;
	enable_search?: boolean;
	search_options?: {
		forced_search: boolean;
		search_strategy: "turbo" | "max" | "agent";
		assigned_site_list?: string[];
	};
}

function contentAsText(content: ChatMessage["content"]): string {
	if (typeof content === "string") return content;
	return content
		.filter((item) => item.type === "text")
		.map((item) => item.text)
		.join("\n");
}

export class LLMProvider {
	readonly plugin: PluginHost;
	readonly config: ProviderRuntimeConfig;
	readonly capabilities: ProviderRuntimeCapabilities;

	constructor(plugin: PluginHost, config: ProviderRuntimeConfig) {
		this.plugin = plugin;
		this.config = config;
		const metadata = config.type === "codex-cli"
			? undefined
			: PROVIDER_TYPE_BY_ID.get(config.type);
		this.capabilities = {
			streaming: config.capabilities?.streaming ?? metadata?.capabilities.streaming ?? false,
			pdf: config.capabilities?.pdf ?? metadata?.capabilities.pdf ?? false,
			vision: config.capabilities?.vision ?? metadata?.capabilities.vision ?? false,
			webSearch: profileHasConfiguredQwenWebSearch(config),
		};
	}

	async testConnection(): Promise<ProviderConnectionTestResult> {
		const startedAt = Date.now();
		try {
			this.validateConfiguration();
			const models = await this.listModels();
			const selectedModel = this.config.model.trim();
			const modelExists = models.length
				? models.some((model) => model.id === selectedModel)
				: null;
			if (modelExists === false) {
				throw new ProviderConnectionError(
					"model-not-found",
					`endpoint 可访问，但模型列表中没有 \`${selectedModel}\``,
				);
			}
			const response = await this.complete({
				model: selectedModel,
				messages: CONNECTION_TEST_MESSAGES,
				maxTokens: 16,
			});
			let streamingVerified = false;
			let streamingError = "";
			if (this.capabilities.streaming) {
				try {
					streamingVerified = await this.probeStreaming({
						model: selectedModel,
						messages: CONNECTION_TEST_MESSAGES,
						maxTokens: 16,
					});
				} catch (error) {
					streamingError = this.plugin.normalizeProviderError(error).message;
				}
			}
			let webSearchVerified = false;
			let webSearchError = "";
			let webSearchPreview = "";
			if (this.capabilities.webSearch) {
				try {
					const webResponse = await this.complete({
						model: selectedModel,
						messages: WEB_SEARCH_TEST_MESSAGES,
						maxTokens: 128,
						webSearch: true,
					});
					webSearchPreview = String(webResponse.text || "").trim().slice(0, 160);
					webSearchVerified = Boolean(webSearchPreview);
					if (!webSearchVerified) {
						throw new ProviderConnectionError(
							"protocol",
							"联网搜索测试返回了空响应",
						);
					}
				} catch (error) {
					webSearchError = this.plugin.normalizeProviderError(error).message;
				}
			}
			return {
				ok: true,
				type: "success",
				provider: this.config.type,
				endpoint: this.config.baseUrl,
				model: selectedModel,
				modelExists,
				modelCount: models.length,
				streaming: {
					supported: this.capabilities.streaming,
					verified: streamingVerified,
					error: streamingError,
				},
				pdf: {
					supported: this.capabilities.pdf,
					verified: false,
					note: this.capabilities.pdf ? "适配器支持；连接测试未上传 PDF" : "不支持",
				},
				vision: {
					supported: this.capabilities.vision,
					verified: false,
				},
				webSearch: {
					supported: this.capabilities.webSearch,
					verified: webSearchVerified,
					error: webSearchError,
					protocol: this.config.webSearch?.protocol || "",
					preview: webSearchPreview,
				},
				responsePreview: String(response.text || "").trim().slice(0, 120),
				responseTimeMs: Date.now() - startedAt,
				testedAt: new Date().toISOString(),
			};
		} catch (error) {
			const normalized = this.plugin.normalizeProviderError(error);
			return {
				ok: false,
				type: normalized.type,
				provider: this.config.type,
				endpoint: normalized.endpoint || this.config.baseUrl,
				model: this.config.model,
				status: normalized.status,
				message: normalized.message,
				responseTimeMs: Date.now() - startedAt,
				testedAt: new Date().toISOString(),
			};
		}
	}

	validateConfiguration() {
		if (!this.config.baseUrl.trim()) {
			throw new ProviderConnectionError("configuration", "请先填写 endpoint");
		}
		if (!this.config.model.trim()) {
			throw new ProviderConnectionError("configuration", "请先填写或选择模型");
		}
	}

	async getSecret(required = false): Promise<string> {
		const secretId = String(this.config.secretId || "").trim();
		if (!secretId) {
			if (required) throw new ProviderConnectionError("missing-secret", "请选择或创建 SecretStorage 凭据");
			return "";
		}
		if (!this.plugin.app.secretStorage || typeof this.plugin.app.secretStorage.getSecret !== "function") {
			throw new ProviderConnectionError("secret-storage-unavailable", "当前 Obsidian 版本不支持 SecretStorage");
		}
		const secret = this.plugin.app.secretStorage.getSecret(secretId);
		if (!secret && required) {
			throw new ProviderConnectionError("missing-secret", `SecretStorage 中没有可用的 \`${secretId}\``);
		}
		return secret || "";
	}

	async request(
		route: string,
		options: Omit<ProviderHttpRequestOptions, "url"> = {},
	) {
		return this.plugin.providerHttpRequest({
			url: buildProviderUrl(this.config.baseUrl, route),
			method: options.method || "GET",
			headers: options.headers || {},
			body: options.body,
			timeoutMs: options.timeoutMs || this.config.timeoutSeconds * 1000,
			registerCancel: options.registerCancel,
		});
	}

	requireJson(
		result: Awaited<ReturnType<PluginHost["providerHttpRequest"]>>,
		operation: string,
	): UnknownRecord {
		if (!result?.json || typeof result.json !== "object") {
			throw new ProviderConnectionError(
				"protocol",
				`${operation}返回的不是有效 JSON`,
				{ endpoint: result?.endpoint || this.config.baseUrl },
			);
		}
		return result.json;
	}

	async listModels(): Promise<ProviderModel[]> {
		throw new ProviderConnectionError("unsupported", "该供应商尚未实现模型发现");
	}

	async complete(
		_request: ProviderChatRequest,
		_options: ProviderRequestOptions = {},
	): Promise<ProviderCompletion> {
		throw new ProviderConnectionError("unsupported", "该供应商尚未实现文本生成");
	}

	async stream(
		_request: ProviderChatRequest,
		_onDelta: ProviderDeltaHandler,
		_options: ProviderRequestOptions = {},
	): Promise<ProviderCompletion> {
		throw new ProviderConnectionError("unsupported", "该供应商尚未实现流式文本生成");
	}

	async probeStreaming(_request: ProviderChatRequest): Promise<boolean> {
		return false;
	}
}

export class OpenAIProvider extends LLMProvider {
	async headers(): Promise<Record<string, string>> {
		return {
			Authorization: `Bearer ${await this.getSecret(true)}`,
			"Content-Type": "application/json",
		};
	}

	async listModels(): Promise<ProviderModel[]> {
		const result = await this.request("v1/models", { headers: await this.headers() });
		return normalizeProviderModelList(this.requireJson(result, "模型列表"));
	}

	async complete(
		request: ProviderChatRequest,
		options: ProviderRequestOptions = {},
	): Promise<ProviderCompletion> {
		const result = await this.request("v1/responses", {
			method: "POST",
			headers: await this.headers(),
			body: {
				model: request.model || this.config.model,
				input: request.messages,
				max_output_tokens: request.maxTokens || 256,
				store: false,
			},
			registerCancel: options.registerCancel,
		});
		const payload = this.requireJson(result, "文本生成");
		return { text: extractOpenAIText(payload), raw: payload };
	}

	async stream(
		request: ProviderChatRequest,
		onDelta: ProviderDeltaHandler,
		options: ProviderRequestOptions = {},
	): Promise<ProviderCompletion> {
		let text = "";
		await this.plugin.providerHttpStream({
			url: buildProviderUrl(this.config.baseUrl, "v1/responses"),
			method: "POST",
			headers: await this.headers(),
			body: {
				model: request.model || this.config.model,
				input: request.messages,
				max_output_tokens: request.maxTokens || 256,
				store: false,
				stream: true,
			},
			timeoutMs: this.config.timeoutSeconds * 1000,
			format: "sse",
			registerCancel: options.registerCancel,
			onEvent: (data) => {
				if (data === "[DONE]") return;
				const payload = parseProviderJson(data);
				const choices = Array.isArray(payload?.choices) ? payload.choices : [];
				const firstChoice = asRecord(choices[0]);
				const delta = payload?.type === "response.output_text.delta"
					? payload.delta
					: asRecord(firstChoice.delta).content;
				text += emitProviderDelta(onDelta, delta);
			},
		});
		return { text };
	}

	async probeStreaming(request: ProviderChatRequest): Promise<boolean> {
		await this.request("v1/responses", {
			method: "POST",
			headers: await this.headers(),
			body: {
				model: request.model || this.config.model,
				input: request.messages,
				max_output_tokens: request.maxTokens || 16,
				store: false,
				stream: true,
			},
		});
		return true;
	}
}

export class AnthropicProvider extends LLMProvider {
	async headers(): Promise<Record<string, string>> {
		return {
			"x-api-key": await this.getSecret(true),
			"anthropic-version": "2023-06-01",
			"Content-Type": "application/json",
		};
	}

	async listModels(): Promise<ProviderModel[]> {
		const result = await this.request("v1/models?limit=1000", { headers: await this.headers() });
		return normalizeProviderModelList(this.requireJson(result, "模型列表"));
	}

	messageBody(request: ProviderChatRequest, stream = false) {
		const system = request.messages
			.filter((message) => message.role === "system")
			.map((message) => contentAsText(message.content))
			.join("\n");
		const messages = request.messages
			.filter((message) => message.role !== "system")
			.map((message) => ({ role: message.role, content: message.content }));
		return {
			model: request.model || this.config.model,
			system,
			messages,
			max_tokens: request.maxTokens || 256,
			stream,
		};
	}

	async complete(
		request: ProviderChatRequest,
		options: ProviderRequestOptions = {},
	): Promise<ProviderCompletion> {
		const result = await this.request("v1/messages", {
			method: "POST",
			headers: await this.headers(),
			body: this.messageBody(request),
			registerCancel: options.registerCancel,
		});
		const payload = this.requireJson(result, "文本生成");
		const text = Array.isArray(payload.content)
			? payload.content
				.map((item) => String(asRecord(item).text || ""))
				.filter(Boolean)
				.join("\n")
			: "";
		return { text, raw: payload };
	}

	async stream(
		request: ProviderChatRequest,
		onDelta: ProviderDeltaHandler,
		options: ProviderRequestOptions = {},
	): Promise<ProviderCompletion> {
		let text = "";
		await this.plugin.providerHttpStream({
			url: buildProviderUrl(this.config.baseUrl, "v1/messages"),
			method: "POST",
			headers: await this.headers(),
			body: this.messageBody(request, true),
			timeoutMs: this.config.timeoutSeconds * 1000,
			format: "sse",
			registerCancel: options.registerCancel,
			onEvent: (data) => {
				const payload = parseProviderJson(data);
				const delta = payload?.type === "content_block_delta"
					? asRecord(payload.delta).text
					: "";
				text += emitProviderDelta(onDelta, delta);
			},
		});
		return { text };
	}

	async probeStreaming(request: ProviderChatRequest): Promise<boolean> {
		await this.request("v1/messages", {
			method: "POST",
			headers: await this.headers(),
			body: this.messageBody(request, true),
		});
		return true;
	}
}

export class OpenAICompatibleProvider extends LLMProvider {
	async headers(): Promise<Record<string, string>> {
		const secret = await this.getSecret(false);
		return {
			...(secret ? { Authorization: `Bearer ${secret}` } : {}),
			"Content-Type": "application/json",
		};
	}

	async listModels(): Promise<ProviderModel[]> {
		const result = await this.request("v1/models", { headers: await this.headers() });
		return normalizeProviderModelList(this.requireJson(result, "模型列表"));
	}

	chatBody(request: ProviderChatRequest, stream = false): ProviderRequestBody {
		const body: ProviderRequestBody = {
			model: request.model || this.config.model,
			messages: request.messages,
			max_tokens: request.maxTokens || 256,
			stream,
		};
		if (request.webSearch === true) {
			const webSearch = this.config.webSearch;
			if (!webSearch || !profileHasConfiguredQwenWebSearch(this.config)) {
				throw new ProviderConnectionError(
					"unsupported",
					"当前配置没有启用 Qwen3.7-Plus Chat Completions 联网搜索",
				);
			}
			const strategy = ["turbo", "max", "agent"].includes(webSearch.searchStrategy)
				? webSearch.searchStrategy
				: "turbo";
			const searchOptions: NonNullable<ProviderRequestBody["search_options"]> = {
				forced_search: webSearch.forcedSearch !== false,
				search_strategy: strategy,
			};
			const assignedSites = normalizeAssignedSites(webSearch.assignedSites);
			if (strategy === "turbo" && assignedSites.length) {
				searchOptions.assigned_site_list = assignedSites;
			}
			body.enable_search = true;
			body.search_options = searchOptions;
		}
		return body;
	}

	async complete(
		request: ProviderChatRequest,
		options: ProviderRequestOptions = {},
	): Promise<ProviderCompletion> {
		const webSearchTimeout = request.webSearch === true
			? this.config.webSearch?.timeoutSeconds
			: undefined;
		const result = await this.request("v1/chat/completions", {
			method: "POST",
			headers: await this.headers(),
			body: this.chatBody(request),
			timeoutMs: webSearchTimeout ? webSearchTimeout * 1000 : undefined,
			registerCancel: options.registerCancel,
		});
		const payload = this.requireJson(result, "文本生成");
		return { text: extractOpenAIText(payload), raw: payload };
	}

	async stream(
		request: ProviderChatRequest,
		onDelta: ProviderDeltaHandler,
		options: ProviderRequestOptions = {},
	): Promise<ProviderCompletion> {
		let text = "";
		const webSearchTimeout = request.webSearch === true
			? this.config.webSearch?.timeoutSeconds
			: undefined;
		await this.plugin.providerHttpStream({
			url: buildProviderUrl(this.config.baseUrl, "v1/chat/completions"),
			method: "POST",
			headers: await this.headers(),
			body: this.chatBody(request, true),
			timeoutMs: (webSearchTimeout || this.config.timeoutSeconds) * 1000,
			format: "sse",
			registerCancel: options.registerCancel,
			onEvent: (data) => {
				if (data === "[DONE]") return;
				const payload = parseProviderJson(data);
				const choices = Array.isArray(payload?.choices) ? payload.choices : [];
				const firstChoice = asRecord(choices[0]);
				text += emitProviderDelta(onDelta, asRecord(firstChoice.delta).content);
			},
		});
		return { text };
	}

	async probeStreaming(request: ProviderChatRequest): Promise<boolean> {
		await this.request("v1/chat/completions", {
			method: "POST",
			headers: await this.headers(),
			body: this.chatBody(request, true),
		});
		return true;
	}
}

export class OllamaProvider extends LLMProvider {
	async headers(): Promise<Record<string, string>> {
		const secret = await this.getSecret(false);
		return {
			...(secret ? { Authorization: `Bearer ${secret}` } : {}),
			"Content-Type": "application/json",
		};
	}

	async listModels(): Promise<ProviderModel[]> {
		const result = await this.request("api/tags", { headers: await this.headers() });
		return normalizeProviderModelList(this.requireJson(result, "模型列表"));
	}

	chatBody(request: ProviderChatRequest, stream = false) {
		return {
			model: request.model || this.config.model,
			messages: request.messages,
			stream,
			options: { num_predict: request.maxTokens || 256 },
		};
	}

	async complete(
		request: ProviderChatRequest,
		options: ProviderRequestOptions = {},
	): Promise<ProviderCompletion> {
		const result = await this.request("api/chat", {
			method: "POST",
			headers: await this.headers(),
			body: this.chatBody(request),
			registerCancel: options.registerCancel,
		});
		const payload = this.requireJson(result, "文本生成");
		return { text: String(asRecord(payload.message).content || ""), raw: payload };
	}

	async stream(
		request: ProviderChatRequest,
		onDelta: ProviderDeltaHandler,
		options: ProviderRequestOptions = {},
	): Promise<ProviderCompletion> {
		let text = "";
		await this.plugin.providerHttpStream({
			url: buildProviderUrl(this.config.baseUrl, "api/chat"),
			method: "POST",
			headers: await this.headers(),
			body: this.chatBody(request, true),
			timeoutMs: this.config.timeoutSeconds * 1000,
			format: "ndjson",
			registerCancel: options.registerCancel,
			onEvent: (data) => {
				const payload = parseProviderJson(data);
				text += emitProviderDelta(onDelta, asRecord(payload?.message).content);
			},
		});
		return { text };
	}

	async probeStreaming(request: ProviderChatRequest): Promise<boolean> {
		await this.request("api/chat", {
			method: "POST",
			headers: await this.headers(),
			body: this.chatBody(request, true),
		});
		return true;
	}
}

export class LMStudioProvider extends OpenAICompatibleProvider {}

export class CodexCliProvider extends LLMProvider {
	constructor(
		plugin: PluginHost,
		config: Omit<ProviderRuntimeConfig, "type" | "baseUrl">,
	) {
		super(plugin, {
			...config,
			type: "codex-cli",
			baseUrl: "Codex CLI",
			capabilities: { streaming: false, pdf: true, vision: true },
		});
	}

	async listModels(): Promise<ProviderModel[]> {
		return MODEL_OPTIONS.map((model) => ({
			id: model.id,
			name: model.label,
			ownedBy: "Codex",
		}));
	}

	async complete(
		_request: ProviderChatRequest,
		_options: ProviderRequestOptions = {},
	): Promise<ProviderCompletion> {
		throw new ProviderConnectionError(
			"delegated",
			"Codex CLI 生成仍由现有 dashboard runner 管理，不通过 Direct API 适配器调用",
		);
	}

	async testConnection(): Promise<ProviderConnectionTestResult> {
		return this.plugin.probeCodexCliConnection();
	}
}


