import * as fs from "node:fs";
import * as path from "node:path";

import type { ProviderProfile } from "../providers/profile";
import type { CliBackendId } from "../config";

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

export interface DashboardSettings {
	projectRoot: string;
	codexExecutable: string;
	codexModel: string;
	codexReasoningEffort: string;
	claudeExecutable: string;
	claudeModel: string;
	claudeReasoningEffort: string;
	annotationBackendId: "auto" | CliBackendId;
	pythonExecutable: string;
	rscriptExecutable: string;
	codePracticeTimeoutSeconds: number;
	taskTimeoutMinutes: number;
	activeProviderId: string;
	providerProfiles: ProviderProfile[];
	providerTimeoutSeconds: number;
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
	codexModel: "gpt-5.6-terra",
	codexReasoningEffort: "medium",
	claudeExecutable: findPreferredClaudeExecutable(),
	claudeModel: "",
	claudeReasoningEffort: "medium",
	annotationBackendId: "auto",
	pythonExecutable: "D:\\python\\python.exe",
	rscriptExecutable: "C:\\Program Files\\R\\R-4.5.1\\bin\\Rscript.exe",
	codePracticeTimeoutSeconds: 30,
	taskTimeoutMinutes: 60,
	activeProviderId: "",
	providerProfiles: [],
	providerTimeoutSeconds: 20,
};
