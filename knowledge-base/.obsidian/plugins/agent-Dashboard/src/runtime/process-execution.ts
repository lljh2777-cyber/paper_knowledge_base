import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";

import type { DashboardAction } from "../actions";
import { MODEL_OPTIONS } from "../config";
import { getCliBackendLabel } from "../config";
import { ProviderConnectionError } from "../providers/shared";
import type { DashboardSettings } from "./settings";
import type { DashboardLifecycleState } from "./lifecycle-state";
import type {
	CliDiscoveredModel,
	CliModelDiscoveryResult,
	CodePracticeRequest,
	CodePracticeResult,
	CodexExecutionConfig,
	DashboardProcessHooks,
	DashboardProcessResult,
	ProviderConnectionTestResult,
} from "../types/contracts";

interface VaultActionProcessOptions {
	runId: string;
	action: DashboardAction;
	input: string;
	executionConfig: CodexExecutionConfig;
	settings: DashboardSettings;
	hooks?: DashboardProcessHooks;
}

interface JsonProcessOptions {
	runId: string;
	executable: string;
	args: string[];
	cwd: string;
	timeoutMs: number;
	timeoutMessage: string;
}

interface JsonProcessResult {
	stdout: string;
	stderr: string;
}

function appendOutput(current: string, chunk: Buffer | string, limit: number): string {
	return `${current}${chunk.toString()}`.slice(-limit);
}

function asRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object"
		? value as Record<string, unknown>
		: {};
}

export class ProcessExecutionService {
	constructor(private readonly state: DashboardLifecycleState) {}

	discoverCliModels(
		settings: DashboardSettings,
		backendId: "codex-cli" | "claude-code",
	): Promise<CliModelDiscoveryResult> {
		return backendId === "claude-code"
			? Promise.resolve(this.discoverClaudeModels(settings))
			: this.discoverCodexModels(settings);
	}

	private discoverCodexModels(settings: DashboardSettings): Promise<CliModelDiscoveryResult> {
		const executable = String(settings.codexExecutable || "");
		const fallback = (message = ""): CliModelDiscoveryResult => ({
			backendId: "codex-cli",
			models: MODEL_OPTIONS.map((model) => ({
				id: model.id,
				label: model.label,
				description: model.description,
				supportsFast: model.supportsFast,
			})),
			effectiveModel: settings.codexModel,
			source: "插件静态回退",
			complete: false,
			message,
			discoveredAt: new Date().toISOString(),
		});
		if (!executable || !fs.existsSync(executable)) {
			return Promise.resolve(fallback(`Codex 可执行文件不存在：${executable || "未配置"}`));
		}
		return new Promise((resolve) => {
			let settled = false;
			let stdoutBuffer = "";
			let stderr = "";
			let timer = 0;
			const child = spawn(executable, ["app-server", "--stdio"], {
				cwd: settings.projectRoot,
				shell: false,
				windowsHide: true,
			});
			const finish = (result: CliModelDiscoveryResult): void => {
				if (settled) return;
				settled = true;
				window.clearTimeout(timer);
				if (!child.killed) child.kill();
				resolve(result);
			};
			const send = (payload: Record<string, unknown>): void => {
				if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify(payload)}\n`);
			};
			const inspectLine = (line: string): void => {
				if (!line.trim()) return;
				let event: Record<string, unknown>;
				try {
					event = asRecord(JSON.parse(line));
				} catch {
					return;
				}
				if (event.id === 1 && event.result) {
					send({
						method: "model/list",
						id: 2,
						params: { limit: 100, includeHidden: false },
					});
					return;
				}
				if (event.id !== 2) return;
				const result = asRecord(event.result);
				const data = Array.isArray(result.data) ? result.data : [];
				const models = data
					.map((value): CliDiscoveredModel | null => {
						const model = asRecord(value);
						const id = String(model.id || model.model || "").trim();
						if (!id) return null;
						const tiers = Array.isArray(model.serviceTiers) ? model.serviceTiers : [];
						const legacyTiers = Array.isArray(model.additionalSpeedTiers)
							? model.additionalSpeedTiers
							: [];
						const reasoning = Array.isArray(model.supportedReasoningEfforts)
							? model.supportedReasoningEfforts
								.map((option) => String(asRecord(option).reasoningEffort || "").trim())
								.filter(Boolean)
							: [];
						return {
							id,
							label: String(model.displayName || id),
							description: String(model.description || ""),
							isDefault: model.isDefault === true,
							supportedReasoningEfforts: reasoning,
							supportsFast: tiers.length > 0 || legacyTiers.includes("fast"),
						};
					})
					.filter((model): model is CliDiscoveredModel => model !== null);
				if (!models.length) {
					finish(fallback("Codex app-server 返回了空模型目录"));
					return;
				}
				const catalogDefault = models.find((model) => model.isDefault)?.id || "";
				finish({
					backendId: "codex-cli",
					models,
					effectiveModel: settings.codexModel || catalogDefault,
					source: "Codex app-server",
					complete: true,
					discoveredAt: new Date().toISOString(),
				});
			};
			child.stdout.on("data", (chunk: Buffer) => {
				stdoutBuffer += chunk.toString();
				const lines = stdoutBuffer.split(/\r?\n/);
				stdoutBuffer = lines.pop() || "";
				lines.forEach(inspectLine);
			});
			child.stderr.on("data", (chunk: Buffer) => {
				stderr = appendOutput(stderr, chunk, 4000);
			});
			child.once("error", (error: Error) => finish(fallback(error.message)));
			child.once("close", () => {
				if (stdoutBuffer) inspectLine(stdoutBuffer);
				if (!settled) finish(fallback(stderr.trim() || "Codex app-server 提前退出"));
			});
			send({
				method: "initialize",
				id: 1,
				params: {
					clientInfo: {
						name: "agent-dashboard",
						title: "Agent Dashboard",
						version: "0.24.0",
					},
					capabilities: {
						experimentalApi: false,
						requestAttestation: false,
					},
				},
			});
			timer = window.setTimeout(() => {
				finish(fallback("Codex 模型目录检测超过 15 秒"));
			}, 15000);
		});
	}

	private discoverClaudeModels(settings: DashboardSettings): CliModelDiscoveryResult {
		const candidates = new Map<string, CliDiscoveredModel>();
		const addModel = (id: unknown, label: string): void => {
			const normalized = String(id || "").trim();
			if (!normalized || candidates.has(normalized)) return;
			candidates.set(normalized, {
				id: normalized,
				label,
				supportsFast: false,
				supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
			});
		};
		let configuredModel = "";
		let settingsFound = false;
		const settingsPath = path.join(
			process.env.USERPROFILE || "",
			".claude",
			"settings.json",
		);
		try {
			const source = asRecord(JSON.parse(fs.readFileSync(settingsPath, "utf8")));
			const env = asRecord(source.env);
			settingsFound = true;
			configuredModel = String(env.ANTHROPIC_MODEL || "").trim();
			addModel(configuredModel, configuredModel ? `当前模型 · ${configuredModel}` : "");
			for (const [key, label] of [
				["ANTHROPIC_DEFAULT_FABLE_MODEL", "Fable"],
				["ANTHROPIC_DEFAULT_HAIKU_MODEL", "Haiku"],
				["ANTHROPIC_DEFAULT_OPUS_MODEL", "Opus"],
				["ANTHROPIC_DEFAULT_SONNET_MODEL", "Sonnet"],
			] as const) {
				const model = String(env[key] || "").trim();
				addModel(model, model ? `${label} · ${model}` : "");
			}
		} catch {
			// Claude can still use an explicit plugin model or its own internal default.
		}
		const testedResult = this.state.providerRuntimeState.get("claude-code")?.result;
		const testedModel = testedResult?.ok
			? String(testedResult.model || "").trim()
			: "";
		addModel(settings.claudeModel, `插件设置 · ${settings.claudeModel}`);
		addModel(testedModel, `初始化事件 · ${testedModel}`);
		const effectiveModel = settings.claudeModel.trim()
			|| testedModel
			|| configuredModel;
		return {
			backendId: "claude-code",
			models: [...candidates.values()],
			effectiveModel,
			source: settings.claudeModel.trim()
				? "插件设置覆盖"
				: testedModel
					? "Claude 初始化事件"
					: settingsFound
						? "Claude settings / CC Switch"
						: "Claude Code 默认配置",
			complete: false,
			message: settingsFound
				? "Claude Code 不提供完整模型目录；此处列出 CC Switch/Claude 设置中可识别的模型。"
				: "Claude Code 不提供完整模型目录，且未找到可读取的 CC Switch/Claude 模型设置。",
			discoveredAt: new Date().toISOString(),
		};
	}

	recoverInterruptedPracticeRuns(settings: DashboardSettings): void {
		const runsDirectory = path.join(
			settings.projectRoot,
			"tool-library",
			"output",
			"code-practice",
			"runs",
		);
		if (!fs.existsSync(runsDirectory)) return;
		for (const name of fs.readdirSync(runsDirectory)) {
			if (!name.endsWith(".json")) continue;
			const recordPath = path.join(runsDirectory, name);
			try {
				const record = JSON.parse(
					fs.readFileSync(recordPath, "utf8"),
				) as Record<string, unknown>;
				if (record.status !== "queued" && record.status !== "running") continue;
				record.status = "stopped";
				record.finished_at = new Date().toISOString();
				record.stderr = `${String(record.stderr || "")}\nExecution interrupted before the plugin restarted.`.trim();
				fs.writeFileSync(recordPath, JSON.stringify(record, null, 2), "utf8");
			} catch (error) {
				console.warn(`Could not recover code-practice record: ${recordPath}`, error);
			}
		}
	}

	runCodePractice(
		settings: DashboardSettings,
		request: CodePracticeRequest,
	): Promise<CodePracticeResult> {
		const projectRoot = settings.projectRoot;
		const runner = path.join(projectRoot, "tool-library", "scripts", "run_code_practice.py");
		if (!fs.existsSync(runner)) {
			return Promise.reject(new Error(`代码练习 runner 不存在：${runner}`));
		}
		const interpreter = request.language === "python"
			? settings.pythonExecutable
			: settings.rscriptExecutable;
		if (!interpreter || !fs.existsSync(interpreter)) {
			return Promise.reject(new Error(
				`${request.language === "python" ? "Python" : "Rscript"} 解释器不可用：${interpreter || "未配置"}`,
			));
		}
		const stopPath = path.join(
			projectRoot,
			"tool-library",
			"output",
			"code-practice",
			"stop",
			`${request.run_id}.stop`,
		);
		const args = [
			runner,
			"--project-root",
			projectRoot,
			"--python",
			settings.pythonExecutable,
			"--rscript",
			settings.rscriptExecutable,
		];

		return new Promise((resolve, reject) => {
			let stdout = "";
			let stderr = "";
			let settled = false;
			const child = spawn(settings.pythonExecutable, args, {
				cwd: projectRoot,
				shell: false,
				windowsHide: true,
				env: {
					...process.env,
					PYTHONUTF8: "1",
					PYTHONIOENCODING: "utf-8",
				},
			});
			this.state.activePracticeRuns.set(request.run_id, { child, stopPath });
			child.stdout.on("data", (chunk: Buffer) => {
				stdout = appendOutput(stdout, chunk, 400000);
			});
			child.stderr.on("data", (chunk: Buffer) => {
				stderr = appendOutput(stderr, chunk, 400000);
			});
			child.once("error", (error: Error) => {
				if (settled) return;
				settled = true;
				this.state.activePracticeRuns.delete(request.run_id);
				reject(error);
			});
			child.once("close", () => {
				if (settled) return;
				settled = true;
				this.state.activePracticeRuns.delete(request.run_id);
				try {
					const result = JSON.parse(stdout.trim()) as CodePracticeResult;
					if (stderr.trim()) result.runner_stderr = stderr.trim();
					resolve(result);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					reject(new Error(
						`无法读取代码练习结果：${stderr.trim() || stdout.trim() || message}`,
					));
				}
			});
			child.stdin.end(JSON.stringify(request), "utf8");
		});
	}

	stopCodePractice(runId: string): boolean {
		const active = this.state.activePracticeRuns.get(runId);
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

	runVaultAction(options: VaultActionProcessOptions): Promise<DashboardProcessResult> {
		const { runId, action, input, executionConfig, settings, hooks = {} } = options;
		const projectRoot = settings.projectRoot;
		const runner = path.join(projectRoot, "tool-library", "scripts", "run_vault_action.py");
		const timeoutSeconds = Math.max(
			60,
			Math.min(14400, Number(settings.taskTimeoutMinutes) * 60 || 3600),
		);
		const stopPath = path.join(
			projectRoot,
			"tool-library",
			"output",
			"dashboard-runs",
			"stop",
			`${runId}.stop`,
		);
		fs.mkdirSync(path.dirname(stopPath), { recursive: true });
		if (fs.existsSync(stopPath)) fs.unlinkSync(stopPath);
		const args = [
			runner,
			"--action",
			action.id,
			"--project-root",
			projectRoot,
			"--backend",
			executionConfig.backend === "claude-code" ? "claude-code" : "codex-cli",
			"--backend-executable",
			executionConfig.backend === "claude-code"
				? settings.claudeExecutable
				: settings.codexExecutable,
			"--reasoning-effort",
			executionConfig.reasoningEffort,
			"--service-tier",
			executionConfig.serviceTier,
			"--python",
			settings.pythonExecutable,
			"--timeout-seconds",
			String(timeoutSeconds),
			"--stop-file",
			stopPath,
			"--run-id",
			runId,
		];
		if (executionConfig.backend === "claude-code") {
			if (executionConfig.model) {
				args.push("--backend-model", executionConfig.model);
			}
		} else {
			args.push("--model", executionConfig.model);
		}

		return new Promise((resolve, reject) => {
			let stdout = "";
			let stderr = "";
			let stderrBuffer = "";
			const events: DashboardProcessResult["events"] = [];
			let settled = false;
			let timedOut = false;
			let timer = 0;
			const child = spawn(settings.pythonExecutable, args, {
				cwd: projectRoot,
				shell: false,
				windowsHide: true,
				env: {
					...process.env,
					PYTHONUTF8: "1",
					PYTHONIOENCODING: "utf-8",
				},
			});
			this.state.activeProcesses.set(runId, child);
			this.state.activeProcessStops.set(runId, stopPath);
			const clearRunState = (): void => {
				this.state.activeProcesses.delete(runId);
				this.state.activeProcessStops.delete(runId);
				try {
					if (fs.existsSync(stopPath)) fs.unlinkSync(stopPath);
				} catch (error) {
					console.warn("Could not remove Dashboard stop signal", error);
				}
			};
			const consumeStderrLine = (line: string, keepNewline = true): void => {
				const normalized = line.replace(/\r$/, "");
				if (normalized.startsWith("DASHBOARD_EVENT ")) {
					try {
						const event = JSON.parse(
							normalized.slice("DASHBOARD_EVENT ".length),
						) as DashboardProcessResult["events"][number];
						events.push(event);
						hooks.onEvent?.(event);
					} catch (error) {
						console.warn("Could not parse Dashboard runner event", error);
					}
					return;
				}
				stderr = appendOutput(stderr, `${line}${keepNewline ? "\n" : ""}`, 160000);
				hooks.onStderr?.(line);
			};
			child.stdout.on("data", (chunk: Buffer) => {
				stdout = appendOutput(stdout, chunk, 160000);
				hooks.onStdout?.(chunk.toString("utf8"));
			});
			child.stderr.on("data", (chunk: Buffer) => {
				stderrBuffer += chunk.toString("utf8");
				const lines = stderrBuffer.split("\n");
				stderrBuffer = lines.pop() || "";
				lines.forEach((line) => consumeStderrLine(line));
			});
			child.once("error", (error: Error) => {
				if (settled) return;
				settled = true;
				window.clearTimeout(timer);
				clearRunState();
				reject(error);
			});
			child.once("close", (code, signal) => {
				if (settled) return;
				settled = true;
				window.clearTimeout(timer);
				clearRunState();
				if (stderrBuffer) consumeStderrLine(stderrBuffer, false);
				resolve({
					exitCode: timedOut ? 124 : typeof code === "number" ? code : 1,
					signal: signal || "",
					stdout,
					stderr: timedOut
						? `${stderr}\n任务超过 ${timeoutSeconds} 秒，已请求终止。`
						: stderr,
					events,
				});
			});
			timer = window.setTimeout(() => {
				timedOut = true;
				this.requestVaultActionStop(runId);
				window.setTimeout(() => {
					if (this.state.activeProcesses.get(runId) === child && !child.killed) child.kill();
				}, 10000);
			}, (timeoutSeconds + 15) * 1000);
			child.stdin.end(input, "utf8");
		});
	}

	runJsonProcess(options: JsonProcessOptions): Promise<JsonProcessResult> {
		return new Promise((resolve, reject) => {
			let stdout = "";
			let stderr = "";
			let settled = false;
			let timer = 0;
			const child = spawn(options.executable, options.args, {
				cwd: options.cwd,
				shell: false,
				windowsHide: true,
				env: {
					...process.env,
					PYTHONUTF8: "1",
					PYTHONIOENCODING: "utf-8",
				},
			});
			this.state.activeProcesses.set(options.runId, child);
			const finish = (callback: () => void): void => {
				if (settled) return;
				settled = true;
				window.clearTimeout(timer);
				if (this.state.activeProcesses.get(options.runId) === child) {
					this.state.activeProcesses.delete(options.runId);
				}
				callback();
			};
			child.stdout.on("data", (chunk: Buffer) => {
				stdout = appendOutput(stdout, chunk, 200000);
			});
			child.stderr.on("data", (chunk: Buffer) => {
				stderr = appendOutput(stderr, chunk, 40000);
			});
			child.once("error", (error: Error) => finish(() => reject(error)));
			child.once("close", (code) => {
				finish(() => {
					if (code !== 0) {
						reject(new Error(stderr.trim() || `进程退出码：${code}`));
						return;
					}
					resolve({ stdout, stderr });
				});
			});
			timer = window.setTimeout(() => {
				if (!child.killed) child.kill();
				finish(() => reject(new ProviderConnectionError("timeout", options.timeoutMessage)));
			}, options.timeoutMs);
			child.stdin.end();
		});
	}

	probeCodexCli(settings: DashboardSettings): Promise<ProviderConnectionTestResult> {
		const startedAt = Date.now();
		const executable = String(settings.codexExecutable || "");
		if (!executable || !fs.existsSync(executable)) {
			return Promise.resolve({
				ok: false,
				type: "configuration",
				model: settings.codexModel,
				message: `Codex 可执行文件不存在：${executable || "未配置"}`,
				responseTimeMs: Date.now() - startedAt,
				testedAt: new Date().toISOString(),
			});
		}
		return new Promise((resolve) => {
			let stdout = "";
			let stderr = "";
			let settled = false;
			let timer = 0;
			const child = spawn(executable, ["--version"], {
				cwd: settings.projectRoot,
				shell: false,
				windowsHide: true,
			});
			const finish = (
				result: Omit<ProviderConnectionTestResult, "model" | "responseTimeMs" | "testedAt">,
			): void => {
				if (settled) return;
				settled = true;
				window.clearTimeout(timer);
				resolve({
					model: settings.codexModel,
					responseTimeMs: Date.now() - startedAt,
					testedAt: new Date().toISOString(),
					...result,
				});
			};
			child.stdout.on("data", (chunk: Buffer) => {
				stdout = appendOutput(stdout, chunk, 4000);
			});
			child.stderr.on("data", (chunk: Buffer) => {
				stderr = appendOutput(stderr, chunk, 4000);
			});
			child.once("error", (error: Error) => {
				finish({ ok: false, type: "local-service-offline", message: error.message });
			});
			child.once("close", (code) => {
				if (code === 0) {
					finish({
						ok: true,
						type: "success",
						modelExists: null,
						modelCount: MODEL_OPTIONS.length,
						streaming: { supported: false, verified: false },
						pdf: { supported: true, verified: false },
						vision: { supported: true, verified: false },
						responsePreview: stdout.trim() || "Codex CLI 可用",
					});
					return;
				}
				finish({
					ok: false,
					type: "local-service-offline",
					message: stderr.trim() || stdout.trim() || `Codex CLI 退出码 ${code}`,
				});
			});
			timer = window.setTimeout(() => {
				if (!child.killed) child.kill();
				finish({ ok: false, type: "timeout", message: "Codex CLI 版本检查超过 10 秒" });
			}, 10000);
		});
	}

	probeClaudeCode(settings: DashboardSettings): Promise<ProviderConnectionTestResult> {
		const startedAt = Date.now();
		const executable = String(settings.claudeExecutable || "");
		if (!executable || !fs.existsSync(executable)) {
			return Promise.resolve({
				ok: false,
				type: "configuration",
				provider: "claude-code",
				model: settings.claudeModel || "CC Switch 默认模型",
				message: `Claude Code 可执行文件不存在：${executable || "未配置"}`,
				responseTimeMs: Date.now() - startedAt,
				testedAt: new Date().toISOString(),
			});
		}
		return new Promise((resolve) => {
			let stdout = "";
			let stderr = "";
			let settled = false;
			let timer = 0;
			let detectedModel = "";
			let responsePreview = "";
			const args = [
				"-p",
				"--safe-mode",
				"--permission-mode",
				"dontAsk",
				"--tools=",
				"--output-format",
				"stream-json",
				"--verbose",
				"--no-session-persistence",
			];
			if (settings.claudeModel.trim()) {
				args.push("--model", settings.claudeModel.trim());
			}
			args.push("仅回复：CLAUDE_BACKEND_OK");
			const child = spawn(executable, args, {
				cwd: settings.projectRoot,
				shell: false,
				windowsHide: true,
				env: {
					...process.env,
					PYTHONUTF8: "1",
					PYTHONIOENCODING: "utf-8",
				},
			});
			const finish = (
				result: Omit<ProviderConnectionTestResult, "model" | "responseTimeMs" | "testedAt">,
			): void => {
				if (settled) return;
				settled = true;
				window.clearTimeout(timer);
				resolve({
					model: detectedModel || settings.claudeModel || "CC Switch 默认模型",
					responseTimeMs: Date.now() - startedAt,
					testedAt: new Date().toISOString(),
					...result,
				});
			};
			const inspectLine = (line: string): void => {
				if (!line.trim()) return;
				try {
					const event = JSON.parse(line) as Record<string, unknown>;
					if (event.type === "system" && event.subtype === "init") {
						detectedModel = String(event.model || "");
					}
					if (event.type === "result") {
						responsePreview = String(event.result || "").trim().slice(0, 160);
					}
				} catch {
					// Preserve non-JSON diagnostics for the final error.
				}
			};
			child.stdout.on("data", (chunk: Buffer) => {
				stdout = appendOutput(stdout, chunk, 20000);
				String(chunk).split(/\r?\n/).forEach(inspectLine);
			});
			child.stderr.on("data", (chunk: Buffer) => {
				stderr = appendOutput(stderr, chunk, 8000);
			});
			child.once("error", (error: Error) => {
				finish({
					ok: false,
					type: "local-service-offline",
					provider: "claude-code",
					message: error.message,
				});
			});
			child.once("close", (code) => {
				stdout.split(/\r?\n/).forEach(inspectLine);
				if (code === 0 && detectedModel) {
					finish({
						ok: true,
						type: "success",
						provider: "claude-code",
						endpoint: "Claude Code / CC Switch",
						modelExists: null,
						streaming: { supported: true, verified: true },
						pdf: { supported: false, verified: false },
						vision: {
							supported: true,
							verified: false,
							note: "Claude Code Read 工具支持图片；当前 CC Switch 模型的视觉兼容性将在首次图片查询时验证",
						},
						webSearch: {
							supported: true,
							verified: false,
							note: "仅在查询侧边栏的“联网搜索”模式开放 WebSearch/WebFetch；实际可用性取决于当前 Claude Code/CC Switch 模型与账号",
						},
						responsePreview: responsePreview || "Claude Code 可用",
					});
					return;
				}
				finish({
					ok: false,
					type: "local-service-offline",
					provider: "claude-code",
					message: stderr.trim() || stdout.trim() || `Claude Code 退出码 ${code}`,
				});
			});
			timer = window.setTimeout(() => {
				if (!child.killed) child.kill();
				finish({
					ok: false,
					type: "timeout",
					provider: "claude-code",
					message: `${getCliBackendLabel("claude-code")} 连接测试超过 45 秒`,
				});
			}, 45000);
		});
	}

	stopVaultAction(runId: string): boolean {
		const child = this.state.activeProcesses.get(runId);
		if (!child || child.killed) return false;
		return this.requestVaultActionStop(runId);
	}

	requestVaultActionStop(runId: string): boolean {
		const child = this.state.activeProcesses.get(runId);
		const stopPath = this.state.activeProcessStops.get(runId);
		if (!child || child.killed || !stopPath) return false;
		try {
			fs.mkdirSync(path.dirname(stopPath), { recursive: true });
			fs.writeFileSync(stopPath, "stop\n", "utf8");
			return true;
		} catch (error) {
			console.error("Could not request Dashboard action stop", error);
			return false;
		}
	}

	isVaultActionProcessActive(runId: string): boolean {
		const child = this.state.activeProcesses.get(runId);
		return Boolean(child && !child.killed);
	}

	shutdown(): void {
		for (const runId of this.state.activePracticeRuns.keys()) {
			this.stopCodePractice(runId);
		}
		for (const [runId, child] of this.state.activeProcesses) {
			const stopRequested = this.requestVaultActionStop(runId);
			if (!stopRequested && !child.killed) child.kill();
		}
		for (const token of this.state.directQueryRuns.values()) {
			token.cancelled = true;
			token.abort?.();
		}
		this.state.clearTransientState();
	}
}
