import {
	App,
	Component,
	ItemView,
	MarkdownRenderer,
	Notice,
	TFile,
	setIcon,
	type ViewStateResult,
	type WorkspaceLeaf,
} from "obsidian";

import { MINERU_READER_VIEW_TYPE } from "../config";
import { bboxToPercent } from "../mineru/normalization";
import { MineruPackageLoader, resolvePackageAssetPath } from "../mineru/package-loader";
import { MineruPdfRenderer } from "../mineru/pdf-renderer";
import { prepareReaderMarkdown } from "../mineru/reader-markdown";
import type {
	MineruReaderMode,
	MineruReaderPackage,
	MineruReaderViewState,
	MineruReaderVisual,
	MineruViewerBlock,
} from "../mineru/types";

interface MineruReaderHost {
	app: App;
}

const DEFAULT_STATE: MineruReaderViewState = {
	articlePath: "",
	mode: "pdf",
	followReading: true,
	showLayoutBoxes: true,
	currentVisualId: "",
	markdownAnchor: "",
	pdfPage: 1,
	pdfZoom: 1,
	splitRatio: 0.64,
};

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? Math.max(min, Math.min(max, numeric)) : fallback;
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException
		? error.name === "AbortError"
		: /abort|cancel|superseded/i.test(error instanceof Error ? error.message : String(error));
}

function normalizeState(value: unknown): MineruReaderViewState {
	const record = value !== null && typeof value === "object"
		? value as Record<string, unknown>
		: {};
	const mode: MineruReaderMode = record.mode === "visuals" ? "visuals" : "pdf";
	return {
		articlePath: String(record.articlePath || ""),
		mode,
		followReading: record.followReading !== false,
		showLayoutBoxes: record.showLayoutBoxes !== false,
		currentVisualId: String(record.currentVisualId || ""),
		markdownAnchor: String(record.markdownAnchor || ""),
		pdfPage: Math.floor(boundedNumber(record.pdfPage, 1, 1, Number.MAX_SAFE_INTEGER)),
		pdfZoom: boundedNumber(record.pdfZoom, 1, 0.4, 4),
		splitRatio: boundedNumber(record.splitRatio, 0.64, 0.42, 0.78),
	};
}

function iconButton(
	parent: HTMLElement,
	icon: string,
	label: string,
	className = "",
): HTMLButtonElement {
	const button = parent.createEl("button", {
		cls: `agent-dashboard-mineru-icon-button ${className}`.trim(),
		attr: { "aria-label": label, title: label },
	});
	button.type = "button";
	setIcon(button, icon);
	return button;
}

export class MineruReaderView extends ItemView {
	private readonly plugin: MineruReaderHost;
	private readonly loader: MineruPackageLoader;
	private readonly pdfRenderer = new MineruPdfRenderer();
	private readerState: MineruReaderViewState = { ...DEFAULT_STATE };
	private readerPackage: MineruReaderPackage | null = null;
	private markdownScroller: HTMLElement | null = null;
	private referenceHost: HTMLElement | null = null;
	private workspaceEl: HTMLElement | null = null;
	private readingObserver: IntersectionObserver | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private workspaceAbortController: AbortController | null = null;
	private referenceAbortController: AbortController | null = null;
	private markdownComponent: Component | null = null;
	private loadGeneration = 0;
	private referenceGeneration = 0;
	private opened = false;
	private resizeTimer: number | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: MineruReaderHost) {
		super(leaf);
		this.plugin = plugin;
		this.loader = new MineruPackageLoader(plugin.app);
		this.navigation = true;
	}

	getViewType(): string {
		return MINERU_READER_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.readerPackage?.title || "MinerU 文献阅读器";
	}

	getIcon(): string {
		return "book-open-text";
	}

	getState(): Record<string, unknown> {
		return { ...this.readerState };
	}

	async setState(state: unknown, _result: ViewStateResult): Promise<void> {
		const previousPath = this.readerState.articlePath;
		this.readerState = normalizeState(state);
		if (this.opened && this.readerState.articlePath) {
			if (this.readerState.articlePath !== previousPath || !this.readerPackage) {
				await this.loadAndRender();
			} else {
				await this.renderWorkspace();
			}
		}
	}

	async setArticlePath(articlePath: string): Promise<void> {
		if (articlePath === this.readerState.articlePath && this.readerPackage) return;
		this.readerState.articlePath = articlePath;
		this.readerState.currentVisualId = "";
		this.readerState.markdownAnchor = "";
		this.readerState.pdfPage = 1;
		if (this.opened) await this.loadAndRender();
		this.requestStateSave();
	}

	async onOpen(): Promise<void> {
		this.opened = true;
		if (!this.readerState.articlePath) {
			this.renderNoDocument();
			return;
		}
		await this.loadAndRender();
	}

	async onClose(): Promise<void> {
		this.opened = false;
		this.loadGeneration += 1;
		this.referenceGeneration += 1;
		this.clearWorkspaceLifecycle();
		if (this.resizeTimer) window.clearTimeout(this.resizeTimer);
		this.resizeTimer = null;
		await this.pdfRenderer.destroy();
		this.contentEl.empty();
	}

	onResize(): void {
		if (this.resizeTimer) window.clearTimeout(this.resizeTimer);
		this.resizeTimer = window.setTimeout(() => {
			this.resizeTimer = null;
			if (this.readerState.mode === "pdf") void this.renderReference();
		}, 140);
	}

	private async loadAndRender(): Promise<void> {
		const generation = ++this.loadGeneration;
		this.renderLoading();
		try {
			const loaded = await this.loader.load(this.readerState.articlePath);
			if (!this.opened || generation !== this.loadGeneration) return;
			this.readerPackage = loaded;
			if (loaded.pdfPath) {
				try {
					await this.pdfRenderer.load(this.app, loaded.pdfPath);
				} catch (error) {
					loaded.issues.push(
						`包内 PDF 无法加载，已保留 Markdown 与原始图片阅读：${error instanceof Error ? error.message : String(error)}`,
					);
					loaded.pdfPath = null;
					await this.pdfRenderer.destroy();
				}
			} else {
				await this.pdfRenderer.destroy();
			}
			if (!this.opened || generation !== this.loadGeneration) return;
			if (!loaded.visuals.some((visual) => visual.id === this.readerState.currentVisualId)) {
				this.readerState.currentVisualId = loaded.visuals[0]?.id || "";
			}
			this.readerState.pdfPage = Math.max(
				1,
				Math.min(this.pdfRenderer.numPages || Number.MAX_SAFE_INTEGER, this.readerState.pdfPage),
			);
			await this.renderWorkspace();
			this.requestStateSave();
		} catch (error) {
			if (!this.opened || generation !== this.loadGeneration) return;
			this.readerPackage = null;
			await this.pdfRenderer.destroy();
			this.renderError(error);
		}
	}

	private renderLoading(): void {
		this.clearWorkspaceLifecycle();
		this.contentEl.empty();
		this.contentEl.addClass("agent-dashboard-mineru-reader-view");
		const state = this.contentEl.createDiv({ cls: "agent-dashboard-mineru-reader-state" });
		state.createDiv({ cls: "agent-dashboard-mineru-reader-spinner" });
		state.createEl("h2", { text: "正在准备文献阅读器" });
		state.createEl("p", { text: "正在核验 MinerU 包、构建图文索引并加载 PDF。" });
	}

	private renderNoDocument(): void {
		this.clearWorkspaceLifecycle();
		this.contentEl.empty();
		this.contentEl.addClass("agent-dashboard-mineru-reader-view");
		const state = this.contentEl.createDiv({ cls: "agent-dashboard-mineru-reader-state" });
		setIcon(state.createDiv({ cls: "agent-dashboard-mineru-empty-icon" }), "book-open-text");
		state.createEl("h2", { text: "尚未选择 MinerU 文献" });
		state.createEl("p", {
			text: "请在 papers/<citekey>/article.md 上使用文件菜单，或先打开该文件再运行“打开 MinerU 文献阅读器”。",
		});
	}

	private renderError(error: unknown): void {
		this.clearWorkspaceLifecycle();
		this.contentEl.empty();
		this.contentEl.addClass("agent-dashboard-mineru-reader-view");
		const state = this.contentEl.createDiv({ cls: "agent-dashboard-mineru-reader-state is-error" });
		setIcon(state.createDiv({ cls: "agent-dashboard-mineru-empty-icon" }), "circle-alert");
		state.createEl("h2", { text: "无法打开 MinerU 文献包" });
		state.createEl("p", { text: error instanceof Error ? error.message : String(error) });
	}

	private async renderWorkspace(): Promise<void> {
		const readerPackage = this.readerPackage;
		if (!readerPackage) return;
		this.clearWorkspaceLifecycle();
		this.workspaceAbortController = new AbortController();
		this.contentEl.empty();
		this.contentEl.addClass("agent-dashboard-mineru-reader-view");
		const shell = this.contentEl.createDiv({ cls: "agent-dashboard-mineru-reader-shell" });
		this.renderTopbar(shell);
		const workspace = shell.createDiv({ cls: "agent-dashboard-mineru-workspace" });
		workspace.style.setProperty(
			"--agent-dashboard-mineru-markdown-width",
			`${this.readerState.splitRatio * 100}%`,
		);
		this.workspaceEl = workspace;
		await this.renderMarkdownPane(workspace);
		this.renderSplitter(workspace);
		const referencePane = workspace.createEl("section", {
			cls: "agent-dashboard-mineru-reference-pane",
			attr: { "aria-label": "文献参考视图" },
		});
		this.referenceHost = referencePane;
		await this.renderReference();
		this.resizeObserver?.disconnect();
		this.resizeObserver = typeof ResizeObserver === "function"
			? new ResizeObserver(() => this.onResize())
			: null;
		this.resizeObserver?.observe(referencePane);
	}

	private renderTopbar(parent: HTMLElement): void {
		const readerPackage = this.readerPackage;
		if (!readerPackage) return;
		const topbar = parent.createEl("header", { cls: "agent-dashboard-mineru-topbar" });
		const identity = topbar.createDiv({ cls: "agent-dashboard-mineru-document-identity" });
		const openMarkdown = iconButton(identity, "file-text", "在新标签页打开原始 Markdown");
		this.onWorkspaceEvent(openMarkdown, "click", () => void this.openArticleMarkdown());
		const titleBlock = identity.createDiv({ cls: "agent-dashboard-mineru-title-block" });
		titleBlock.createEl("h1", { text: readerPackage.title });
		titleBlock.createEl("p", { text: readerPackage.articlePath });
		const controls = topbar.createDiv({ cls: "agent-dashboard-mineru-top-controls" });
		const follow = controls.createEl("button", {
			cls: this.readerState.followReading
				? "agent-dashboard-mineru-toggle is-active"
				: "agent-dashboard-mineru-toggle",
			attr: {
				"aria-pressed": this.readerState.followReading ? "true" : "false",
				title: "让右侧参考内容跟随 Markdown 阅读位置",
			},
		});
		follow.type = "button";
		follow.createSpan({ text: "跟随阅读" });
		follow.createSpan({ cls: "agent-dashboard-mineru-toggle-track" });
		this.onWorkspaceEvent(follow, "click", () => {
			this.readerState.followReading = !this.readerState.followReading;
			follow.toggleClass("is-active", this.readerState.followReading);
			follow.setAttribute("aria-pressed", this.readerState.followReading ? "true" : "false");
			if (this.readerState.followReading) void this.syncReferenceToCurrentVisual();
			this.requestStateSave();
		});
		if (readerPackage.issues.length) {
			const issue = iconButton(controls, "info", `${readerPackage.issues.length} 条兼容性提示`);
			this.onWorkspaceEvent(issue, "click", () => {
				new Notice(readerPackage.issues.slice(0, 5).join("\n"), 9000);
			});
		}
	}

	private async renderMarkdownPane(parent: HTMLElement): Promise<void> {
		const readerPackage = this.readerPackage;
		if (!readerPackage) return;
		const pane = parent.createEl("section", {
			cls: "agent-dashboard-mineru-markdown-pane",
			attr: { "aria-label": "Markdown 正文" },
		});
		const paneHeader = pane.createDiv({ cls: "agent-dashboard-mineru-pane-heading" });
		paneHeader.createEl("strong", { text: "Markdown" });
		paneHeader.createSpan({ text: "图片与图注已移至参考栏，正文阅读位置保持独立" });
		const scroller = pane.createDiv({
			cls: "agent-dashboard-mineru-markdown-scroll markdown-reading-view",
		});
		const article = scroller.createEl("article", {
			cls: "agent-dashboard-mineru-article markdown-preview-view markdown-rendered",
		});
		this.markdownScroller = scroller;
		const prepared = prepareReaderMarkdown(readerPackage.articleMarkdown, readerPackage.visuals);
		this.markdownComponent?.unload();
		this.markdownComponent = new Component();
		this.markdownComponent.load();
		await MarkdownRenderer.render(
			this.app,
			prepared,
			article,
			readerPackage.articlePath,
			this.markdownComponent,
		);
		readerPackage.visuals.forEach((visual) => {
			const anchor = article.querySelector<HTMLElement>(`[data-visual-id="${CSS.escape(visual.id)}"]`);
			if (!anchor) return;
			anchor.dataset.label = visual.label;
			anchor.setAttribute("title", `在参考栏查看 ${visual.label}`);
			anchor.setAttribute("role", "button");
			anchor.tabIndex = 0;
			this.onWorkspaceEvent(anchor, "click", () => void this.selectVisual(visual.id, false));
			this.onWorkspaceEvent(anchor, "keydown", (event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					void this.selectVisual(visual.id, false);
				}
			});
		});
		this.observeReadingAnchors(article, scroller);
		window.requestAnimationFrame(() => this.restoreMarkdownPosition(article));
	}

	private renderSplitter(parent: HTMLElement): void {
		const splitter = parent.createDiv({
			cls: "agent-dashboard-mineru-splitter",
			attr: {
				role: "separator",
				"aria-label": "调整 Markdown 与参考栏宽度",
				"aria-orientation": "vertical",
				tabindex: "0",
			},
		});
		splitter.createDiv({ cls: "agent-dashboard-mineru-splitter-grip" });
		const updateRatio = (clientX: number) => {
			const workspace = this.workspaceEl;
			if (!workspace) return;
			const rect = workspace.getBoundingClientRect();
			if (!rect.width) return;
			this.readerState.splitRatio = Math.max(0.42, Math.min(0.78, (clientX - rect.left) / rect.width));
			workspace.style.setProperty(
				"--agent-dashboard-mineru-markdown-width",
				`${this.readerState.splitRatio * 100}%`,
			);
		};
		let move: ((event: PointerEvent) => void) | null = null;
		let up: (() => void) | null = null;
		const stop = () => {
			if (move) document.removeEventListener("pointermove", move);
			if (up) document.removeEventListener("pointerup", up);
			move = null;
			up = null;
			splitter.removeClass("is-dragging");
			document.body.removeClass("agent-dashboard-mineru-resizing");
			this.requestStateSave();
			this.onResize();
		};
		this.onWorkspaceEvent(splitter, "pointerdown", (event) => {
			event.preventDefault();
			splitter.setPointerCapture?.(event.pointerId);
			splitter.addClass("is-dragging");
			document.body.addClass("agent-dashboard-mineru-resizing");
			move = (pointerEvent) => updateRatio(pointerEvent.clientX);
			up = stop;
			document.addEventListener("pointermove", move);
			document.addEventListener("pointerup", up, { once: true });
		});
		this.onWorkspaceEvent(splitter, "keydown", (event) => {
			if (!this.workspaceEl || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
			event.preventDefault();
			this.readerState.splitRatio = Math.max(
				0.42,
				Math.min(0.78, this.readerState.splitRatio + (event.key === "ArrowLeft" ? -0.02 : 0.02)),
			);
			this.workspaceEl.style.setProperty(
				"--agent-dashboard-mineru-markdown-width",
				`${this.readerState.splitRatio * 100}%`,
			);
			this.requestStateSave();
			this.onResize();
		});
		this.workspaceAbortController?.signal.addEventListener("abort", stop, { once: true });
	}

	private async renderReference(): Promise<void> {
		const host = this.referenceHost;
		const readerPackage = this.readerPackage;
		if (!host || !readerPackage) return;
		this.referenceAbortController?.abort();
		this.referenceAbortController = new AbortController();
		this.pdfRenderer.cancelPageRender();
		this.pdfRenderer.cancelCropRender();
		const generation = ++this.referenceGeneration;
		host.empty();
		const header = host.createDiv({ cls: "agent-dashboard-mineru-reference-header" });
		const tabs = header.createDiv({ cls: "agent-dashboard-mineru-reference-tabs", attr: { role: "tablist" } });
		this.renderModeTab(tabs, "pdf", "原始 PDF");
		this.renderModeTab(tabs, "visuals", "图片与图注");
		const body = host.createDiv({ cls: "agent-dashboard-mineru-reference-body" });
		try {
			if (this.readerState.mode === "pdf") {
				await this.renderPdfReference(body, generation);
			} else {
				await this.renderVisualReference(body, generation);
			}
		} catch (error) {
			if (generation !== this.referenceGeneration) return;
			body.empty();
			const state = body.createDiv({ cls: "agent-dashboard-mineru-reference-empty is-error" });
			setIcon(state.createDiv(), "circle-alert");
			state.createEl("strong", { text: "参考视图渲染失败" });
			state.createEl("p", { text: error instanceof Error ? error.message : String(error) });
		}
	}

	private renderModeTab(parent: HTMLElement, mode: MineruReaderMode, label: string): void {
		const active = this.readerState.mode === mode;
		const button = parent.createEl("button", {
			cls: active ? "agent-dashboard-mineru-reference-tab is-active" : "agent-dashboard-mineru-reference-tab",
			text: label,
			attr: { role: "tab", "aria-selected": active ? "true" : "false" },
		});
		button.type = "button";
		this.onReferenceEvent(button, "click", () => {
			if (this.readerState.mode === mode) return;
			this.readerState.mode = mode;
			void this.renderReference();
			this.requestStateSave();
		});
	}

	private async renderPdfReference(parent: HTMLElement, generation: number): Promise<void> {
		const readerPackage = this.readerPackage;
		if (!readerPackage) return;
		if (!readerPackage.pdfPath || !this.pdfRenderer.numPages) {
			const state = parent.createDiv({ cls: "agent-dashboard-mineru-reference-empty" });
			setIcon(state.createDiv(), "file-warning");
			state.createEl("strong", { text: "文献包未附带原始 PDF" });
			state.createEl("p", {
				text: readerPackage.externalPdfRecorded
					? "清单记录了外部 PDF，但阅读器不会自动读取 Vault 外的绝对路径。重新入库时勾选“在原文包中附带 PDF”即可启用版面框与整图重建。"
					: "重新入库时勾选“在原文包中附带 PDF”，即可启用版面框与整图重建。",
			});
			return;
		}
		const toolbar = parent.createDiv({ cls: "agent-dashboard-mineru-pdf-toolbar" });
		const previous = iconButton(toolbar, "chevron-left", "上一页");
		previous.disabled = this.readerState.pdfPage <= 1;
		this.onReferenceEvent(previous, "click", () => void this.changePdfPage(-1));
		const pageInput = toolbar.createEl("input", {
			cls: "agent-dashboard-mineru-page-input",
			attr: {
				type: "number",
				min: "1",
				max: String(this.pdfRenderer.numPages),
				value: String(this.readerState.pdfPage),
				"aria-label": "PDF 页码",
			},
		});
		pageInput.value = String(this.readerState.pdfPage);
		this.onReferenceEvent(pageInput, "change", () => {
			const page = Math.floor(boundedNumber(
				pageInput.value,
				this.readerState.pdfPage,
				1,
				this.pdfRenderer.numPages,
			));
			this.readerState.pdfPage = page;
			this.scrollPdfToPage(page, "smooth");
			this.requestStateSave();
		});
		toolbar.createSpan({ cls: "agent-dashboard-mineru-page-count", text: `/ ${this.pdfRenderer.numPages}` });
		const next = iconButton(toolbar, "chevron-right", "下一页");
		next.disabled = this.readerState.pdfPage >= this.pdfRenderer.numPages;
		this.onReferenceEvent(next, "click", () => void this.changePdfPage(1));
		toolbar.createDiv({ cls: "agent-dashboard-mineru-toolbar-divider" });
		const zoomOut = iconButton(toolbar, "minus", "缩小 PDF");
		this.onReferenceEvent(zoomOut, "click", () => void this.changePdfZoom(1 / 1.15));
		toolbar.createSpan({
			cls: "agent-dashboard-mineru-zoom-value",
			text: `${Math.round(this.readerState.pdfZoom * 100)}%`,
		});
		const zoomIn = iconButton(toolbar, "plus", "放大 PDF");
		this.onReferenceEvent(zoomIn, "click", () => void this.changePdfZoom(1.15));
		const fit = toolbar.createEl("button", { cls: "agent-dashboard-mineru-toolbar-button", text: "适合宽度" });
		fit.type = "button";
		this.onReferenceEvent(fit, "click", () => {
			this.readerState.pdfZoom = 1;
			void this.renderReference();
			this.requestStateSave();
		});
		const layout = toolbar.createEl("button", {
			cls: this.readerState.showLayoutBoxes
				? "agent-dashboard-mineru-toolbar-button is-active"
				: "agent-dashboard-mineru-toolbar-button",
			attr: { "aria-pressed": this.readerState.showLayoutBoxes ? "true" : "false" },
		});
		layout.type = "button";
		setIcon(layout.createSpan(), "panels-top-left");
		layout.createSpan({ text: "版面框" });
		this.onReferenceEvent(layout, "click", () => {
			this.readerState.showLayoutBoxes = !this.readerState.showLayoutBoxes;
			void this.renderReference();
			this.requestStateSave();
		});
		const scroll = parent.createDiv({ cls: "agent-dashboard-mineru-pdf-scroll" });
		const availableWidth = Math.max(260, scroll.clientWidth - 34);
		const estimatedWidth = Math.floor(availableWidth * this.readerState.pdfZoom);
		const pageWrappers: HTMLElement[] = [];
		for (let pageNumber = 1; pageNumber <= this.pdfRenderer.numPages; pageNumber += 1) {
			const pageWrapper = scroll.createDiv({
				cls: "agent-dashboard-mineru-pdf-page is-loading",
				attr: {
					"data-page-number": String(pageNumber),
					"aria-label": `PDF 第 ${pageNumber} 页`,
				},
			});
			pageWrapper.dataset.renderState = "idle";
			pageWrapper.style.width = `${estimatedWidth}px`;
			pageWrapper.createDiv({
				cls: "agent-dashboard-mineru-pdf-page-placeholder",
				text: `正在载入第 ${pageNumber} 页…`,
			});
			const canvas = pageWrapper.createEl("canvas", { attr: { "aria-label": `PDF 第 ${pageNumber} 页内容` } });
			canvas.hidden = true;
			pageWrappers.push(pageWrapper);
		}

		let renderQueue = Promise.resolve();
		const queuePageRender = (pageWrapper: HTMLElement): void => {
			if (pageWrapper.dataset.renderState !== "idle") return;
			pageWrapper.dataset.renderState = "queued";
			renderQueue = renderQueue.then(async () => {
				if (generation !== this.referenceGeneration || !pageWrapper.isConnected) return;
				const pageNumber = Number(pageWrapper.dataset.pageNumber || 1);
				const canvas = pageWrapper.querySelector<HTMLCanvasElement>("canvas");
				if (!canvas) return;
				pageWrapper.dataset.renderState = "rendering";
				try {
					const size = await this.pdfRenderer.renderPage(
						pageNumber,
						canvas,
						availableWidth,
						this.readerState.pdfZoom,
					);
					if (generation !== this.referenceGeneration || !pageWrapper.isConnected) return;
					pageWrapper.style.width = `${Math.floor(size.width)}px`;
					pageWrapper.style.height = `${Math.floor(size.height)}px`;
					pageWrapper.querySelector(".agent-dashboard-mineru-pdf-page-placeholder")?.remove();
					canvas.hidden = false;
					pageWrapper.removeClass("is-loading", "is-error");
					pageWrapper.addClass("is-rendered");
					pageWrapper.dataset.renderState = "rendered";
					if (this.readerState.showLayoutBoxes) this.renderPdfOverlays(pageWrapper, pageNumber);
				} catch (error) {
					if (generation !== this.referenceGeneration || !pageWrapper.isConnected) return;
					if (isAbortError(error)) {
						pageWrapper.dataset.renderState = "idle";
						return;
					}
					pageWrapper.dataset.renderState = "error";
					pageWrapper.removeClass("is-loading");
					pageWrapper.addClass("is-error");
					const placeholder = pageWrapper.querySelector<HTMLElement>(
						".agent-dashboard-mineru-pdf-page-placeholder",
					);
					if (placeholder) placeholder.setText(`第 ${pageNumber} 页加载失败`);
				}
			}).catch(() => undefined);
		};

		const renderObserver = typeof IntersectionObserver !== "undefined"
			? new IntersectionObserver((entries) => {
				entries.forEach((entry) => {
					if (entry.isIntersecting) queuePageRender(entry.target as HTMLElement);
				});
			}, { root: scroll, rootMargin: "1400px 0px", threshold: 0.01 })
			: null;
		if (renderObserver) {
			pageWrappers.forEach((pageWrapper) => renderObserver.observe(pageWrapper));
		} else {
			pageWrappers.forEach(queuePageRender);
		}
		this.referenceAbortController?.signal.addEventListener("abort", () => renderObserver?.disconnect(), { once: true });

		let scrollFrame = 0;
		const updateVisiblePage = (): void => {
			scrollFrame = 0;
			if (generation !== this.referenceGeneration) return;
			const probe = scroll.scrollTop + Math.min(scroll.clientHeight * 0.35, 260);
			let currentPage = 1;
			for (const pageWrapper of pageWrappers) {
				if (pageWrapper.offsetTop > probe) break;
				currentPage = Number(pageWrapper.dataset.pageNumber || currentPage);
			}
			if (currentPage === this.readerState.pdfPage) return;
			this.readerState.pdfPage = currentPage;
			pageInput.value = String(currentPage);
			previous.disabled = currentPage <= 1;
			next.disabled = currentPage >= this.pdfRenderer.numPages;
			this.requestStateSave();
		};
		this.onReferenceEvent(scroll, "scroll", () => {
			if (scrollFrame) return;
			scrollFrame = window.requestAnimationFrame(updateVisiblePage);
		});
		this.referenceAbortController?.signal.addEventListener("abort", () => {
			if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
		}, { once: true });

		const initialPage = pageWrappers[this.readerState.pdfPage - 1];
		if (initialPage) {
			scroll.scrollTop = Math.max(0, initialPage.offsetTop - 12);
			queuePageRender(initialPage);
			if (this.readerState.pdfPage > 1) queuePageRender(pageWrappers[this.readerState.pdfPage - 2]);
			if (this.readerState.pdfPage < pageWrappers.length) queuePageRender(pageWrappers[this.readerState.pdfPage]);
		}
		this.renderReferenceStatus(parent);
	}

	private renderPdfOverlays(parent: HTMLElement, pageNumber: number): void {
		const readerPackage = this.readerPackage;
		if (!readerPackage) return;
		const pageIdx = pageNumber - 1;
		const blocks = readerPackage.viewerIndex.pages.find((page) => page.page_idx === pageIdx)?.blocks || [];
		const overlay = parent.createDiv({ cls: "agent-dashboard-mineru-pdf-overlay" });
		for (const block of blocks) {
			if (!block.bbox_norm || block.role === "discarded") continue;
			const visual = this.visualForBlock(block.id);
			const boxOptions = {
				cls: [
					"agent-dashboard-mineru-layout-box",
					`is-${block.role}`,
					visual?.id === this.readerState.currentVisualId ? "is-current" : "",
				].filter(Boolean).join(" "),
				attr: {
					"aria-label": visual ? `定位 ${visual.label}` : `${block.source_type} 版面块`,
					title: visual ? `定位 ${visual.label}` : block.source_type,
				},
			};
			const box = visual
				? overlay.createEl("button", boxOptions)
				: overlay.createDiv(boxOptions);
			if (box instanceof HTMLButtonElement) box.type = "button";
			const percent = bboxToPercent(block.bbox_norm);
			box.style.left = `${percent.left}%`;
			box.style.top = `${percent.top}%`;
			box.style.width = `${percent.width}%`;
			box.style.height = `${percent.height}%`;
			if (visual) this.onReferenceEvent(box, "click", () => void this.selectVisual(visual.id, true));
		}
	}

	private async renderVisualReference(parent: HTMLElement, generation: number): Promise<void> {
		const readerPackage = this.readerPackage;
		if (!readerPackage) return;
		if (!readerPackage.visuals.length) {
			const state = parent.createDiv({ cls: "agent-dashboard-mineru-reference-empty" });
			setIcon(state.createDiv(), "image-off");
			state.createEl("strong", { text: "没有可显示的图片或表格" });
			state.createEl("p", { text: "正文仍可正常阅读；当前 MinerU JSON 没有可解析的视觉资源。" });
			return;
		}
		const visual = this.currentVisual() || readerPackage.visuals[0];
		const index = readerPackage.visuals.indexOf(visual);
		const toolbar = parent.createDiv({ cls: "agent-dashboard-mineru-visual-toolbar" });
		const title = toolbar.createDiv();
		title.createEl("strong", { text: visual.label });
		const pageLabel = visual.captionPageIdx !== undefined && visual.captionPageIdx !== visual.pageIdx
			? `图第 ${visual.pageIdx + 1} 页 · 图注第 ${visual.captionPageIdx + 1} 页`
			: `第 ${visual.pageIdx + 1} 页`;
		title.createSpan({ text: `${pageLabel} · ${index + 1} / ${readerPackage.visuals.length}` });
		const controls = toolbar.createDiv({ cls: "agent-dashboard-mineru-visual-nav" });
		const previous = iconButton(controls, "chevron-left", "上一幅图片");
		previous.disabled = index <= 0;
		this.onReferenceEvent(previous, "click", () => void this.selectVisualAt(index - 1));
		const next = iconButton(controls, "chevron-right", "下一幅图片");
		next.disabled = index >= readerPackage.visuals.length - 1;
		this.onReferenceEvent(next, "click", () => void this.selectVisualAt(index + 1));
		const scroll = parent.createDiv({ cls: "agent-dashboard-mineru-visual-scroll" });
		const stage = scroll.createDiv({ cls: "agent-dashboard-mineru-visual-stage" });
		await this.renderVisualAsset(stage, visual, generation);
		if (generation !== this.referenceGeneration) return;
		if (visual.caption) {
			const caption = scroll.createEl("p", { cls: "agent-dashboard-mineru-visual-caption" });
			caption.createEl("strong", { text: `${visual.label}. ` });
			caption.appendText(visual.caption.replace(/^\s*(?:Extended Data Fig(?:ure)?\.?|Supplementary Fig(?:ure)?\.?|Fig(?:ure)?\.?|Table|图|表)\s*[A-Za-z0-9.-]+\s*[|｜.:：-]?\s*/i, ""));
		}
		if (visual.captionStatus === "partial") {
			const note = scroll.createDiv({ cls: "agent-dashboard-mineru-caption-note is-partial" });
			setIcon(note.createSpan(), "info");
			note.createSpan({ text: "已匹配下一页图注；MinerU 未提取到全部续栏文字，当前仅显示可验证部分。" });
		}
		const actions = scroll.createDiv({ cls: "agent-dashboard-mineru-visual-actions" });
		const back = actions.createEl("button", { text: "回到正文位置" });
		back.type = "button";
		setIcon(back.createSpan({ cls: "agent-dashboard-mineru-button-icon" }), "locate-fixed");
		this.onReferenceEvent(back, "click", () => this.scrollToVisualAnchor(visual.id));
		if (visual.display.mode === "asset") {
			const open = actions.createEl("button", { text: "打开原图" });
			open.type = "button";
			setIcon(open.createSpan({ cls: "agent-dashboard-mineru-button-icon" }), "external-link");
			this.onReferenceEvent(open, "click", () => void this.openAsset(visual.display.mode === "asset" ? visual.display.assetPath : ""));
		}
		this.renderThumbnailRail(scroll, visual.id);
		this.renderReferenceStatus(parent);
	}

	private async renderVisualAsset(
		parent: HTMLElement,
		visual: MineruReaderVisual,
		generation: number,
	): Promise<void> {
		const readerPackage = this.readerPackage;
		if (!readerPackage) return;
		if (visual.display.mode === "asset") {
			const image = parent.createEl("img", {
				attr: { alt: visual.label, loading: "eager" },
			});
			image.src = this.resourceUrl(visual.display.assetPath);
			return;
		}
		if (visual.display.mode === "pdf-crop" && readerPackage.pdfPath && this.pdfRenderer.numPages) {
			const canvas = parent.createEl("canvas", { attr: { "aria-label": `${visual.label} 完整图重建` } });
			await this.pdfRenderer.renderCrop(
				visual.pageIdx + 1,
				visual.display.bbox,
				visual.display.padding,
				canvas,
				Math.max(260, parent.clientWidth - 8),
			);
			if (generation !== this.referenceGeneration) return;
			return;
		}
		const warning = parent.createDiv({ cls: "agent-dashboard-mineru-fragment-warning" });
		warning.createSpan({ text: "缺少包内 PDF，暂以 MinerU 原始碎片回退显示。" });
		const grid = parent.createDiv({ cls: "agent-dashboard-mineru-fragment-grid" });
		visual.memberAssetPaths.forEach((assetPath) => {
			const image = grid.createEl("img", { attr: { alt: `${visual.label} 碎片`, loading: "lazy" } });
			image.src = this.resourceUrl(assetPath);
		});
	}

	private renderThumbnailRail(parent: HTMLElement, currentVisualId: string): void {
		const readerPackage = this.readerPackage;
		if (!readerPackage || readerPackage.visuals.length < 2) return;
		const rail = parent.createDiv({ cls: "agent-dashboard-mineru-thumbnail-rail", attr: { "aria-label": "图片导航" } });
		readerPackage.visuals.forEach((visual) => {
			const button = rail.createEl("button", {
				cls: visual.id === currentVisualId
					? "agent-dashboard-mineru-thumbnail is-active"
					: "agent-dashboard-mineru-thumbnail",
				attr: {
					"aria-label": `查看 ${visual.label}`,
					"aria-pressed": visual.id === currentVisualId ? "true" : "false",
				},
			});
			button.type = "button";
			const previewPath = visual.display.mode === "asset"
				? visual.display.assetPath
				: visual.memberAssetPaths[0];
			if (previewPath) {
				const image = button.createEl("img", { attr: { alt: "", loading: "lazy" } });
				image.src = this.resourceUrl(previewPath);
			} else {
				setIcon(button.createDiv(), "image");
			}
			button.createSpan({ text: visual.label });
			if (visual.repairDecision === "auto") button.createSpan({ cls: "agent-dashboard-mineru-rebuilt-mark", text: "重建" });
			this.onReferenceEvent(button, "click", () => void this.selectVisual(visual.id, false));
		});
	}

	private renderReferenceStatus(parent: HTMLElement): void {
		const readerPackage = this.readerPackage;
		if (!readerPackage) return;
		const status = parent.createDiv({ cls: "agent-dashboard-mineru-reference-status" });
		const visual = this.currentVisual();
		if (visual?.captionStatus === "partial" && visual.captionPageIdx !== undefined) {
			status.addClass("has-warning");
			setIcon(status.createSpan(), "triangle-alert");
			status.createSpan({
				text: `${visual.label}：已关联第 ${visual.captionPageIdx + 1} 页图注，但 MinerU 图注文本不完整`,
			});
		} else if (visual?.captionPageIdx !== undefined && visual.captionPageIdx !== visual.pageIdx) {
			setIcon(status.createSpan(), "link");
			status.createSpan({ text: `${visual.label}：跨页图注已匹配至第 ${visual.captionPageIdx + 1} 页` });
		} else if (
			visual?.repairDecision === "auto"
			&& visual.display.mode === "fragment-set"
		) {
			status.addClass("has-warning");
			setIcon(status.createSpan(), "triangle-alert");
			status.createSpan({
				text: `${visual.label}：已识别疑似碎图，但缺少包内 PDF，当前保留 MinerU 原始图块`,
			});
		} else if (visual?.repairDecision === "auto") {
			setIcon(status.createSpan(), "scan-line");
			status.createSpan({
				text: `${visual.label}：完整图已在显示层重建 · 置信度 ${Math.round(visual.confidence * 100)}%`,
			});
		} else {
			setIcon(status.createSpan(), "shield-check");
			status.createSpan({ text: "原始 MinerU 产物保持不变；当前仅调整阅读显示。" });
		}
	}

	private observeReadingAnchors(article: HTMLElement, scroller: HTMLElement): void {
		this.readingObserver?.disconnect();
		const anchors = [...article.querySelectorAll<HTMLElement>("[data-visual-id]")];
		if (!anchors.length || typeof IntersectionObserver !== "function") return;
		this.readingObserver = new IntersectionObserver((entries) => {
			const visible = entries
				.filter((entry) => entry.isIntersecting)
				.sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
			const visualId = (visible?.target as HTMLElement | undefined)?.dataset.visualId;
			if (!visualId || visualId === this.readerState.markdownAnchor) return;
			this.readerState.markdownAnchor = visualId;
			if (this.readerState.followReading) void this.selectVisual(visualId, false);
			this.requestStateSave();
		}, {
			root: scroller,
			rootMargin: "-18% 0px -52% 0px",
			threshold: [0, 0.1, 0.5, 1],
		});
		anchors.forEach((anchor) => this.readingObserver?.observe(anchor));
	}

	private restoreMarkdownPosition(article: HTMLElement): void {
		const anchorId = this.readerState.markdownAnchor || this.readerState.currentVisualId;
		if (!anchorId) return;
		const anchor = article.querySelector<HTMLElement>(`[data-visual-id="${CSS.escape(anchorId)}"]`);
		anchor?.scrollIntoView({ block: "center" });
	}

	private currentVisual(): MineruReaderVisual | null {
		return this.readerPackage?.visuals.find((visual) => visual.id === this.readerState.currentVisualId) || null;
	}

	private visualForBlock(blockId: string): MineruReaderVisual | null {
		return this.readerPackage?.visuals.find((visual) => visual.memberBlockIds.includes(blockId)) || null;
	}

	private async selectVisual(
		visualId: string,
		scrollMarkdown: boolean,
	): Promise<void> {
		const visual = this.readerPackage?.visuals.find((candidate) => candidate.id === visualId);
		if (!visual) return;
		this.readerState.currentVisualId = visual.id;
		if (scrollMarkdown) this.scrollToVisualAnchor(visual.id);
		if (this.readerState.followReading && this.readerState.mode === "pdf") {
			this.readerState.pdfPage = visual.pageIdx + 1;
		}
		await this.renderReference();
		this.requestStateSave();
	}

	private async selectVisualAt(index: number): Promise<void> {
		const visual = this.readerPackage?.visuals[index];
		if (visual) await this.selectVisual(visual.id, false);
	}

	private scrollToVisualAnchor(visualId: string): void {
		const anchor = this.markdownScroller?.querySelector<HTMLElement>(
			`[data-visual-id="${CSS.escape(visualId)}"]`,
		);
		anchor?.scrollIntoView({ behavior: "smooth", block: "center" });
		this.readerState.markdownAnchor = visualId;
		this.requestStateSave();
	}

	private async syncReferenceToCurrentVisual(): Promise<void> {
		const visual = this.currentVisual();
		if (visual && this.readerState.mode === "pdf") this.readerState.pdfPage = visual.pageIdx + 1;
		await this.renderReference();
	}

	private async changePdfPage(delta: number): Promise<void> {
		this.readerState.pdfPage = Math.max(
			1,
			Math.min(this.pdfRenderer.numPages, this.readerState.pdfPage + delta),
		);
		this.scrollPdfToPage(this.readerState.pdfPage, "smooth");
		this.requestStateSave();
	}

	private scrollPdfToPage(pageNumber: number, behavior: ScrollBehavior): void {
		const scroll = this.referenceHost?.querySelector<HTMLElement>(".agent-dashboard-mineru-pdf-scroll");
		const page = scroll?.querySelector<HTMLElement>(`[data-page-number="${pageNumber}"]`);
		if (!scroll || !page) return;
		scroll.scrollTo({ top: Math.max(0, page.offsetTop - 12), behavior });
	}

	private async changePdfZoom(factor: number): Promise<void> {
		this.readerState.pdfZoom = Math.max(0.4, Math.min(4, this.readerState.pdfZoom * factor));
		await this.renderReference();
		this.requestStateSave();
	}

	private async openArticleMarkdown(): Promise<void> {
		const readerPackage = this.readerPackage;
		if (!readerPackage) return;
		const file = this.app.vault.getAbstractFileByPath(readerPackage.articlePath);
		if (!(file instanceof TFile)) return;
		await this.app.workspace.getLeaf("tab").openFile(file);
	}

	private async openAsset(assetPath: string): Promise<void> {
		const readerPackage = this.readerPackage;
		if (!readerPackage || !assetPath) return;
		const file = this.app.vault.getAbstractFileByPath(
			resolvePackageAssetPath(readerPackage.packagePath, assetPath),
		);
		if (!(file instanceof TFile)) {
			new Notice("未找到原始图片资源");
			return;
		}
		await this.app.workspace.getLeaf("tab").openFile(file);
	}

	private resourceUrl(assetPath: string): string {
		const readerPackage = this.readerPackage;
		if (!readerPackage) return "";
		const file = this.app.vault.getAbstractFileByPath(
			resolvePackageAssetPath(readerPackage.packagePath, assetPath),
		);
		return file instanceof TFile ? this.app.vault.getResourcePath(file) : "";
	}

	private clearWorkspaceLifecycle(): void {
		this.referenceGeneration += 1;
		this.pdfRenderer.cancelPageRender();
		this.pdfRenderer.cancelCropRender();
		this.referenceAbortController?.abort();
		this.referenceAbortController = null;
		this.workspaceAbortController?.abort();
		this.workspaceAbortController = null;
		this.markdownComponent?.unload();
		this.markdownComponent = null;
		this.readingObserver?.disconnect();
		this.readingObserver = null;
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.markdownScroller = null;
		this.referenceHost = null;
		this.workspaceEl = null;
	}

	private onWorkspaceEvent<K extends keyof HTMLElementEventMap>(
		element: HTMLElement,
		type: K,
		listener: (event: HTMLElementEventMap[K]) => void,
	): void {
		const signal = this.workspaceAbortController?.signal;
		if (!signal) return;
		element.addEventListener(type, listener as EventListener, { signal });
	}

	private onReferenceEvent<K extends keyof HTMLElementEventMap>(
		element: HTMLElement,
		type: K,
		listener: (event: HTMLElementEventMap[K]) => void,
	): void {
		const signal = this.referenceAbortController?.signal;
		if (!signal) return;
		element.addEventListener(type, listener as EventListener, { signal });
	}

	private requestStateSave(): void {
		void this.app.workspace.requestSaveLayout();
	}
}
