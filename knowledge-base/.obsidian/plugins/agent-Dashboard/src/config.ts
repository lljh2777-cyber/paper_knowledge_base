export const VIEW_TYPE = "agent-dashboard-research-vault";
export const CODE_PRACTICE_VIEW_TYPE = "agent-dashboard-code-practice";
export const QUERY_WIKI_VIEW_TYPE = "agent-dashboard-query-wiki";

export const MAX_VAULT_IMAGE_BYTES = 7 * 1024 * 1024;
export const MAX_QUERY_IMAGE_ATTACHMENTS = 6;
export const MAX_QUERY_IMAGE_TOTAL_BYTES = 20 * 1024 * 1024;

export const VAULT_IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
};

export interface ModelOption {
	id: string;
	label: string;
	description: string;
	supportsFast: boolean;
}

export const MODEL_OPTIONS: readonly ModelOption[] = [
	{ id: "gpt-5.6-terra", label: "GPT-5.6-Terra", description: "均衡模型", supportsFast: true },
	{ id: "gpt-5.6-sol", label: "GPT-5.6-Sol", description: "高能力模型", supportsFast: true },
	{ id: "gpt-5.3-codex-spark", label: "GPT-5.3-Codex-Spark", description: "快速代码模型", supportsFast: false },
];

export interface ReasoningOption {
	id: "low" | "medium" | "high" | "xhigh";
	label: string;
}

export const REASONING_OPTIONS: readonly ReasoningOption[] = [
	{ id: "low", label: "低" },
	{ id: "medium", label: "中" },
	{ id: "high", label: "高" },
	{ id: "xhigh", label: "极高" },
];

export type ProviderTypeId =
	| "openai"
	| "anthropic"
	| "openai-compatible"
	| "ollama"
	| "lm-studio";

export interface ProviderCapabilities {
	streaming: boolean;
	pdf: boolean;
	vision: boolean;
}

export interface ProviderTypeDefinition {
	id: ProviderTypeId;
	label: string;
	defaultBaseUrl: string;
	defaultModel: string;
	requiresSecret: boolean;
	capabilities: ProviderCapabilities;
}

export const PROVIDER_TYPES: readonly ProviderTypeDefinition[] = [
	{
		id: "openai",
		label: "OpenAI",
		defaultBaseUrl: "https://api.openai.com",
		defaultModel: "",
		requiresSecret: true,
		capabilities: { streaming: true, pdf: true, vision: true },
	},
	{
		id: "anthropic",
		label: "Anthropic",
		defaultBaseUrl: "https://api.anthropic.com",
		defaultModel: "",
		requiresSecret: true,
		capabilities: { streaming: true, pdf: true, vision: true },
	},
	{
		id: "openai-compatible",
		label: "OpenAI 兼容 / OpenRouter",
		defaultBaseUrl: "https://openrouter.ai/api",
		defaultModel: "",
		requiresSecret: false,
		capabilities: { streaming: true, pdf: false, vision: false },
	},
	{
		id: "ollama",
		label: "Ollama",
		defaultBaseUrl: "http://127.0.0.1:11434",
		defaultModel: "",
		requiresSecret: false,
		capabilities: { streaming: true, pdf: false, vision: false },
	},
	{
		id: "lm-studio",
		label: "LM Studio",
		defaultBaseUrl: "http://127.0.0.1:1234",
		defaultModel: "",
		requiresSecret: false,
		capabilities: { streaming: true, pdf: false, vision: false },
	},
];

export const PROVIDER_TYPE_BY_ID = new Map(
	PROVIDER_TYPES.map((provider) => [provider.id, provider]),
);

export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export const CONNECTION_TEST_MESSAGES: readonly ChatMessage[] = [
	{ role: "system", content: "This is a connection test. Do not use tools or external data." },
	{ role: "user", content: "Reply with exactly OK." },
];

export const WEB_SEARCH_TEST_MESSAGES: readonly ChatMessage[] = [
	{
		role: "system",
		content: "This is a web search capability test. Do not use any local files or private data.",
	},
	{
		role: "user",
		content: "请强制联网搜索并用一句话回答：阿里云百炼联网搜索文档的页面标题是什么？",
	},
];
