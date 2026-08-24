import { App, TFile, loadPdfJs } from "obsidian";

import { paddedBbox } from "./normalization";
import type { NormalizedBbox } from "./types";

interface PdfViewport {
	width: number;
	height: number;
}

interface PdfRenderTask {
	promise: Promise<void>;
	cancel(): void;
}

interface PdfPageProxy {
	getViewport(options: { scale: number }): PdfViewport;
	render(options: {
		canvasContext: CanvasRenderingContext2D;
		viewport: PdfViewport;
		transform?: number[];
		background?: string;
	}): PdfRenderTask;
	cleanup?(): void;
}

interface PdfDocumentProxy {
	numPages: number;
	getPage(pageNumber: number): Promise<PdfPageProxy>;
	destroy(): Promise<void>;
}

interface PdfLoadingTask {
	promise: Promise<PdfDocumentProxy>;
	destroy?(): Promise<void>;
}

export interface PdfPageRenderResult {
	width: number;
	height: number;
}

function outputScale(): number {
	return Math.max(1, Math.min(2, window.devicePixelRatio || 1));
}

function getCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
	const context = canvas.getContext("2d", { alpha: false });
	if (!context) throw new Error("当前环境无法创建 PDF Canvas");
	return context;
}

function isCancelledRender(error: unknown): boolean {
	const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
	return /RenderingCancelled|cancelled|canceled/i.test(message);
}

export class MineruPdfRenderer {
	private document: PdfDocumentProxy | null = null;
	private loadingTask: PdfLoadingTask | null = null;
	private pageTask: PdfRenderTask | null = null;
	private cropTask: PdfRenderTask | null = null;
	private generation = 0;
	private pageGeneration = 0;
	private cropGeneration = 0;

	get numPages(): number {
		return this.document?.numPages || 0;
	}

	async load(app: App, pdfPath: string): Promise<void> {
		const generation = ++this.generation;
		await this.clearResources();
		if (generation !== this.generation) return;
		const file = app.vault.getAbstractFileByPath(pdfPath);
		if (!(file instanceof TFile)) throw new Error(`未找到阅读器 PDF：${pdfPath}`);
		const bytes = new Uint8Array(await app.vault.readBinary(file));
		if (generation !== this.generation) return;
		const pdfjs = await loadPdfJs();
		if (generation !== this.generation) return;
		const loadingTask = pdfjs.getDocument({ data: bytes }) as PdfLoadingTask;
		this.loadingTask = loadingTask;
		const document = await loadingTask.promise;
		if (generation !== this.generation) {
			await document.destroy();
			return;
		}
		if (this.loadingTask === loadingTask) this.loadingTask = null;
		this.document = document;
	}

	async renderPage(
		pageNumber: number,
		canvas: HTMLCanvasElement,
		availableWidth: number,
		zoom: number,
	): Promise<PdfPageRenderResult> {
		const document = this.document;
		if (!document) throw new Error("PDF 尚未加载");
		this.cancelPageRender();
		const generation = ++this.pageGeneration;
		const documentGeneration = this.generation;
		const page = await document.getPage(Math.max(1, Math.min(document.numPages, pageNumber)));
		if (generation !== this.pageGeneration || documentGeneration !== this.generation || document !== this.document) {
			page.cleanup?.();
			throw new DOMException("PDF page render superseded", "AbortError");
		}
		const baseViewport = page.getViewport({ scale: 1 });
		const fitScale = Math.max(0.25, availableWidth / Math.max(1, baseViewport.width));
		const viewport = page.getViewport({ scale: fitScale * Math.max(0.4, Math.min(4, zoom)) });
		const ratio = outputScale();
		canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
		canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
		canvas.style.width = `${Math.floor(viewport.width)}px`;
		canvas.style.height = `${Math.floor(viewport.height)}px`;
		const task = page.render({
			canvasContext: getCanvasContext(canvas),
			viewport,
			transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
			background: "#ffffff",
		});
		this.pageTask = task;
		try {
			await task.promise;
		} catch (error) {
			if (isCancelledRender(error)) throw new DOMException("PDF page render cancelled", "AbortError");
			throw error;
		} finally {
			if (this.pageTask === task) this.pageTask = null;
			page.cleanup?.();
		}
		if (generation !== this.pageGeneration || documentGeneration !== this.generation) {
			throw new DOMException("PDF page render superseded", "AbortError");
		}
		return { width: viewport.width, height: viewport.height };
	}

	async renderCrop(
		pageNumber: number,
		bbox: NormalizedBbox,
		padding: number,
		canvas: HTMLCanvasElement,
		availableWidth: number,
	): Promise<PdfPageRenderResult> {
		const document = this.document;
		if (!document) throw new Error("缺少 PDF，无法重建完整图");
		this.cancelCropRender();
		const generation = ++this.cropGeneration;
		const documentGeneration = this.generation;
		const page = await document.getPage(Math.max(1, Math.min(document.numPages, pageNumber)));
		if (generation !== this.cropGeneration || documentGeneration !== this.generation || document !== this.document) {
			page.cleanup?.();
			throw new DOMException("PDF crop render superseded", "AbortError");
		}
		const baseViewport = page.getViewport({ scale: 1 });
		const crop = paddedBbox(bbox, padding);
		const cropWidthAtOne = baseViewport.width * (crop[2] - crop[0]) / 1000;
		const scale = Math.max(0.5, Math.min(4, availableWidth / Math.max(1, cropWidthAtOne)));
		const viewport = page.getViewport({ scale });
		const left = viewport.width * crop[0] / 1000;
		const top = viewport.height * crop[1] / 1000;
		const width = viewport.width * (crop[2] - crop[0]) / 1000;
		const height = viewport.height * (crop[3] - crop[1]) / 1000;
		const ratio = outputScale();
		canvas.width = Math.max(1, Math.floor(width * ratio));
		canvas.height = Math.max(1, Math.floor(height * ratio));
		canvas.style.width = `${Math.floor(width)}px`;
		canvas.style.height = `${Math.floor(height)}px`;
		const task = page.render({
			canvasContext: getCanvasContext(canvas),
			viewport,
			transform: [ratio, 0, 0, ratio, -left * ratio, -top * ratio],
			background: "#ffffff",
		});
		this.cropTask = task;
		try {
			await task.promise;
		} catch (error) {
			if (isCancelledRender(error)) throw new DOMException("PDF crop render cancelled", "AbortError");
			throw error;
		} finally {
			if (this.cropTask === task) this.cropTask = null;
			page.cleanup?.();
		}
		if (generation !== this.cropGeneration || documentGeneration !== this.generation) {
			throw new DOMException("PDF crop render superseded", "AbortError");
		}
		return { width, height };
	}

	cancelPageRender(): void {
		this.pageGeneration += 1;
		try {
			this.pageTask?.cancel();
		} catch {
			// PDF.js can throw when a completed task is cancelled during teardown.
		}
		this.pageTask = null;
	}

	cancelCropRender(): void {
		this.cropGeneration += 1;
		try {
			this.cropTask?.cancel();
		} catch {
			// See cancelPageRender.
		}
		this.cropTask = null;
	}

	async destroy(): Promise<void> {
		this.generation += 1;
		await this.clearResources();
	}

	private async clearResources(): Promise<void> {
		this.cancelPageRender();
		this.cancelCropRender();
		const document = this.document;
		const loadingTask = this.loadingTask;
		this.document = null;
		this.loadingTask = null;
		if (document) {
			try {
				await document.destroy();
			} catch {
				// The document may already be destroyed by a cancelled loading task.
			}
		} else if (loadingTask?.destroy) {
			try {
				await loadingTask.destroy();
			} catch {
				// Ignore teardown races.
			}
		}
	}
}
