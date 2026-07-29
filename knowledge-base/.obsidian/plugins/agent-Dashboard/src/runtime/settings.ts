import * as fs from "node:fs";
import * as path from "node:path";

import type { ProviderProfile } from "../providers/profile";

export type ClaudeConfigSource = "official" | "cc-switch";
export type CodexConfigSource = "official" | "cc-switch";
export type OpenCodeConfigSource = "official" | "cc-switch";

const LEGACY_CODEX_EXECUTABLE =
	"C:\\Users\\Thomas Wade\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe";
const MANAGED_CODEX_BIN_ROOT = path.join(
	process.env.LOCALAPPDATA || "",
	"OpenAI",
	"Codex",
	"bin",
);
const DEFAULT_CLAUDE_EXECUTABLE = path.join(
	process.env.USERPROFILE || "",
	".local",
	"bin",
	"claude.exe",
);
const DEFAULT_OPENCODE_EXECUTABLE = path.join(
	process.env.USERPROFILE || "",
	".opencode",
	"bin",
	"opencode.exe",
);

export interface DashboardSettings {
	projectRoot: string;
	codexExecutable: string;
	codexConfigSource: CodexConfigSource;
	codexModel: string;
	codexReasoningEffort: string;
	claudeExecutable: string;
	claudeConfigSource: ClaudeConfigSource;
	claudeModel: string;
	claudeReasoningEffort: string;
	openCodeExecutable: string;
	openCodeConfigSource: OpenCodeConfigSource;
	openCodeModel: string;
	openCodeReasoningEffort: string;
	annotationBackendId: string;
	annotationCodexModel: string;
	annotationCodexReasoningEffort: string;
	annotationCodexServiceTier: "default" | "fast";
	annotationClaudeModel: string;
	annotationClaudeReasoningEffort: string;
	annotationOpenCodeModel: string;
	annotationOpenCodeReasoningEffort: string;
	annotationMaxTokens: number;
	pythonExecutable: string;
	rscriptExecutable: string;
	codePracticeTimeoutSeconds: number;
	taskTimeoutMinutes: number;
	activeProviderId: string;
	providerProfiles: ProviderProfile[];
	providerTimeoutSeconds: number;
}

export function findPreferredOpenCodeExecutable(): string {
	const candidates = [
		String(process.env.OPENCODE_PATH || "").trim(),
		DEFAULT_OPENCODE_EXECUTABLE,
		path.join(process.env.USERPROFILE || "", ".local", "bin", "opencode.exe"),
		path.join(process.env.USERPROFILE || "", "scoop", "shims", "opencode.exe"),
		path.join(process.env.APPDATA || "", "npm", "opencode.cmd"),
		path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Links", "opencode.exe"),
	].filter(Boolean);
	return candidates.find((candidate) => fs.existsSync(candidate))
		|| DEFAULT_OPENCODE_EXECUTABLE;
}

export function findPreferredClaudeExecutable(): string {
	const candidates = [
		String(process.env.CLAUDE_CODE_PATH || "").trim(),
		DEFAULT_CLAUDE_EXECUTABLE,
		path.join(process.env.LOCALAPPDATA || "", "AnthropicClaude", "claude.exe"),
	].filter(Boolean);
	return candidates.find((candidate) => fs.existsSync(candidate))
		|| DEFAULT_CLAUDE_EXECUTABLE;
}

export function inferLegacyClaudeConfigSource(): ClaudeConfigSource {
	const settingsPath = path.join(
		process.env.USERPROFILE || "",
		".claude",
		"settings.json",
	);
	try {
		const source = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
			env?: Record<string, unknown>;
		};
		const env = source.env && typeof source.env === "object" ? source.env : {};
		const customEndpoint = String(env.ANTHROPIC_BASE_URL || "").trim();
		const configuredModel = String(env.ANTHROPIC_MODEL || "").trim();
		return customEndpoint || configuredModel ? "cc-switch" : "official";
	} catch {
		return "official";
	}
}

export function getClaudeConfigSourceLabel(source: ClaudeConfigSource): string {
	return source === "cc-switch" ? "CC Switch" : "官方 Claude Code";
}

export function getClaudeDefaultModelLabel(source: ClaudeConfigSource): string {
	return source === "cc-switch" ? "CC Switch 当前模型" : "Claude CLI 默认模型";
}

export function getCodexConfigSourceLabel(source: CodexConfigSource): string {
	return source === "cc-switch" ? "CC Switch" : "官方 Codex CLI";
}

export function getCodexDefaultModelLabel(source: CodexConfigSource): string {
	return source === "cc-switch" ? "CC Switch 当前模型" : "Codex 官方默认模型";
}

export function getOpenCodeConfigSourceLabel(source: OpenCodeConfigSource): string {
	return source === "cc-switch" ? "CC Switch" : "官方 OpenCode Zen";
}

export function getOpenCodeDefaultModelLabel(source: OpenCodeConfigSource): string {
	return source === "cc-switch" ? "CC Switch 当前模型" : "OpenCode Zen 默认模型";
}

export function findPreferredCodexExecutable(): string {
	const candidates = new Set<string>();
	if (process.env.CODEX_CLI_PATH) candidates.add(process.env.CODEX_CLI_PATH);
	if (fs.existsSync(MANAGED_CODEX_BIN_ROOT)) {
		const direct = path.join(MANAGED_CODEX_BIN_ROOT, "codex.exe");
		if (fs.existsSync(direct)) candidates.add(direct);
		try {
			fs.readdirSync(MANAGED_CODEX_BIN_ROOT, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.forEach((entry) => {
					const executable = path.join(MANAGED_CODEX_BIN_ROOT, entry.name, "codex.exe");
					if (fs.existsSync(executable)) candidates.add(executable);
				});
		} catch (error) {
			console.warn("Agent Dashboard could not scan the managed Codex CLI directory", error);
		}
	}
	if (fs.existsSync(LEGACY_CODEX_EXECUTABLE)) candidates.add(LEGACY_CODEX_EXECUTABLE);
	return [...candidates]
		.map((executable) => {
			try {
				return { executable, mtime: fs.statSync(executable).mtimeMs };
			} catch {
				return { executable, mtime: 0 };
			}
		})
		.sort((a, b) => b.mtime - a.mtime)[0]?.executable || LEGACY_CODEX_EXECUTABLE;
}

export function isManagedCodexExecutable(executable: unknown): boolean {
	if (!executable) return false;
	const normalized = path.resolve(String(executable)).toLowerCase();
	const legacy = path.resolve(LEGACY_CODEX_EXECUTABLE).toLowerCase();
	const managedRoot = path.resolve(MANAGED_CODEX_BIN_ROOT).toLowerCase();
	return normalized === legacy
		|| normalized === managedRoot
		|| normalized.startsWith(`${managedRoot}${path.sep}`);
}

export const DEFAULT_SETTINGS: DashboardSettings = {
	projectRoot: "",
	codexExecutable: findPreferredCodexExecutable(),
	codexConfigSource: "official",
	codexModel: "gpt-5.6-terra",
	codexReasoningEffort: "medium",
	claudeExecutable: findPreferredClaudeExecutable(),
	claudeConfigSource: "official",
	claudeModel: "",
	claudeReasoningEffort: "medium",
	openCodeExecutable: findPreferredOpenCodeExecutable(),
	openCodeConfigSource: "official",
	openCodeModel: "opencode/mimo-v2.5-free",
	openCodeReasoningEffort: "medium",
	annotationBackendId: "auto",
	annotationCodexModel: "",
	annotationCodexReasoningEffort: "medium",
	annotationCodexServiceTier: "default",
	annotationClaudeModel: "",
	annotationClaudeReasoningEffort: "medium",
	annotationOpenCodeModel: "",
	annotationOpenCodeReasoningEffort: "medium",
	annotationMaxTokens: 900,
	pythonExecutable: "D:\\python\\python.exe",
	rscriptExecutable: "C:\\Program Files\\R\\R-4.5.1\\bin\\Rscript.exe",
	codePracticeTimeoutSeconds: 30,
	taskTimeoutMinutes: 60,
	activeProviderId: "",
	providerProfiles: [],
	providerTimeoutSeconds: 20,
};
