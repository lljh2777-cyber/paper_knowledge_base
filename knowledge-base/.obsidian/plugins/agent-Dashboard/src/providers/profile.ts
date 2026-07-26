import {
	PROVIDER_TYPES,
	PROVIDER_TYPE_BY_ID,
	type ProviderTypeDefinition,
	type ProviderTypeId,
} from "../config";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
	return value !== null && typeof value === "object" ? value as UnknownRecord : {};
}

function providerMetadata(type: unknown): ProviderTypeDefinition {
	return PROVIDER_TYPE_BY_ID.get(String(type || "openai") as ProviderTypeId) || PROVIDER_TYPES[0];
}

export function modelHasKnownVisionSupport(model: unknown): boolean {
	return /^(qwen3\.[567]-(plus|flash)|qwen3-vl|qwen-vl|qvq)/i.test(
		String(model || "").trim(),
	);
}

export function modelIsQwen37Plus(model: unknown): boolean {
	return /^qwen3\.7-plus(?:$|-)/i.test(String(model || "").trim());
}

export function profileHasConfiguredQwenWebSearch(profile: unknown): boolean {
	const source = asRecord(profile);
	const webSearch = asRecord(source.webSearch);
	return source.type === "openai-compatible"
		&& modelIsQwen37Plus(source.model)
		&& webSearch.enabled === true
		&& webSearch.protocol === "qwen-chat-completions";
}

export function profileSupportsDirectWebSearch(profile: unknown): boolean {
	const source = asRecord(profile);
	return profileHasConfiguredQwenWebSearch(source)
		&& asRecord(source.lastTest).webSearchVerified === true;
}

export function normalizeAssignedSites(value: unknown): string[] {
	const seen = new Set<string>();
	const sites: string[] = [];
	const values = Array.isArray(value)
		? value
		: String(value || "").split(/[\s,，;；]+/);
	for (const item of values) {
		const raw = String(item || "").trim().toLowerCase();
		if (!raw) continue;
		let hostname = raw;
		try {
			hostname = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.toLowerCase();
		} catch {
			continue;
		}
		if (
			!hostname
			|| hostname === "localhost"
			|| !hostname.includes(".")
			|| !/^[a-z0-9.-]+$/i.test(hostname)
			|| seen.has(hostname)
		) {
			continue;
		}
		seen.add(hostname);
		sites.push(hostname);
		if (sites.length >= 25) break;
	}
	return sites;
}

export function profileSupportsQueryImage(profile: unknown): boolean {
	const source = asRecord(profile);
	return source.type === "openai-compatible"
		&& asRecord(source.capabilities).vision === true;
}

export interface ProviderProfile {
	id: string;
	name: string;
	type: ProviderTypeId;
	baseUrl: string;
	model: string;
	secretId: string;
	timeoutSeconds: number;
	capabilities: {
		streaming: boolean;
		pdf: boolean;
		vision: boolean;
		visionConfigured: boolean;
	};
	webSearch: {
		enabled: boolean;
		configured: boolean;
		protocol: "qwen-chat-completions";
		forcedSearch: boolean;
		searchStrategy: "turbo" | "max" | "agent";
		assignedSites: string[];
		timeoutSeconds: number;
	};
	lastTest: {
		ok: boolean;
		type: string;
		model: string;
		modelExists: boolean | null;
		endpoint: string;
		message: string;
		responseTimeMs: number;
		streamingVerified: boolean;
		webSearchVerified: boolean;
		webSearchError: string;
		webSearchPreview: string;
		testedAt: string;
	} | null;
	createdAt: string;
	updatedAt: string;
}

export function makeProviderProfile(type: unknown = "openai"): ProviderProfile {
	const metadata = providerMetadata(type);
	const now = new Date().toISOString();
	return {
		id: `provider-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		name: metadata.label,
		type: metadata.id,
		baseUrl: metadata.defaultBaseUrl,
		model: metadata.defaultModel,
		secretId: "",
		timeoutSeconds: 20,
		capabilities: { ...metadata.capabilities, visionConfigured: false },
		webSearch: {
			enabled: false,
			configured: false,
			protocol: "qwen-chat-completions",
			forcedSearch: true,
			searchStrategy: "turbo",
			assignedSites: [],
			timeoutSeconds: 60,
		},
		lastTest: null,
		createdAt: now,
		updatedAt: now,
	};
}

export function normalizeProviderProfile(profile: unknown): ProviderProfile {
	const source = asRecord(profile);
	const capabilities = asRecord(source.capabilities);
	const webSearch = asRecord(source.webSearch);
	const rawLastTest = asRecord(source.lastTest);
	const metadata = providerMetadata(source.type);
	const fallback = makeProviderProfile(metadata.id);
	const model = String(source.model || metadata.defaultModel).trim().slice(0, 160);
	const visionConfigured = capabilities.visionConfigured === true;
	const webSearchConfigured = webSearch.configured === true;
	const webSearchEnabled = webSearchConfigured
		? webSearch.enabled === true
		: modelIsQwen37Plus(model);
	const strategy = String(webSearch.searchStrategy || "");
	const webSearchStrategy = strategy === "max" || strategy === "agent" ? strategy : "turbo";
	const webSearchTimeout = Number.parseInt(String(webSearch.timeoutSeconds || ""), 10);
	const timeout = Number.parseInt(String(source.timeoutSeconds || ""), 10);
	const lastTest = source.lastTest && typeof source.lastTest === "object"
		? {
			ok: rawLastTest.ok === true,
			type: String(rawLastTest.type || ""),
			model: String(rawLastTest.model || ""),
			modelExists: rawLastTest.modelExists === true
				? true
				: rawLastTest.modelExists === false
					? false
					: null,
			endpoint: String(rawLastTest.endpoint || "").slice(0, 500),
			message: String(rawLastTest.message || "").slice(0, 500),
			responseTimeMs: Number(rawLastTest.responseTimeMs || 0),
			streamingVerified: rawLastTest.streamingVerified === true,
			webSearchVerified: rawLastTest.webSearchVerified === true,
			webSearchError: String(rawLastTest.webSearchError || "").slice(0, 500),
			webSearchPreview: String(rawLastTest.webSearchPreview || "").slice(0, 160),
			testedAt: String(rawLastTest.testedAt || ""),
		}
		: null;
	return {
		id: String(source.id || fallback.id).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100),
		name: String(source.name || metadata.label).trim().slice(0, 80),
		type: metadata.id,
		baseUrl: String(source.baseUrl || metadata.defaultBaseUrl).trim().slice(0, 500),
		model,
		secretId: String(source.secretId || "").trim().slice(0, 160),
		timeoutSeconds: Number.isFinite(timeout) ? Math.max(3, Math.min(120, timeout)) : 20,
		capabilities: {
			streaming: typeof capabilities.streaming === "boolean"
				? capabilities.streaming
				: metadata.capabilities.streaming,
			pdf: typeof capabilities.pdf === "boolean"
				? capabilities.pdf
				: metadata.capabilities.pdf,
			vision: visionConfigured
				? capabilities.vision === true
				: capabilities.vision === true
					|| metadata.capabilities.vision
					|| modelHasKnownVisionSupport(model),
			visionConfigured,
		},
		webSearch: {
			enabled: webSearchEnabled,
			configured: webSearchConfigured,
			protocol: "qwen-chat-completions",
			forcedSearch: webSearch.forcedSearch !== false,
			searchStrategy: webSearchStrategy,
			assignedSites: normalizeAssignedSites(webSearch.assignedSites),
			timeoutSeconds: Number.isFinite(webSearchTimeout)
				? Math.max(20, Math.min(120, webSearchTimeout))
				: 60,
		},
		lastTest,
		createdAt: String(source.createdAt || fallback.createdAt),
		updatedAt: String(source.updatedAt || fallback.updatedAt),
	};
}
