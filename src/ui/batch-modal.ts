import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import type TheOnlyOneTagger from '../main';
import type { BatchItem, SuggestedTag } from '../types';
import { BatchProcessor } from '../batch/batch-processor';
import { applyTagsToNote } from '../tagging/tag-applicator';
import { createTagChip, createConfidenceBadge, createReviewButtons } from './components';

/**
 * Modal for batch processing: progress, per-note review, pause/resume/abort.
 */
export class BatchModal extends Modal {
	private plugin: TheOnlyOneTagger;
	private processor: BatchProcessor;
	private currentReviewIndex = 0;
	private reviewableItems: BatchItem[] = [];

	constructor(app: App, plugin: TheOnlyOneTagger) {
		super(app);
		this.plugin = plugin;
		this.processor = new BatchProcessor(plugin);
	}

	onOpen(): void {
		this.contentEl.addClass('atw-batch-modal');
		this.renderStartView();
	}

	onClose(): void {
		this.processor.abort();
		this.contentEl.empty();
	}

	private renderStartView(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Batch Tag Processing' });

		new Setting(contentEl)
			.setName('Auto-accept threshold')
			.setDesc('Tags above this confidence are auto-accepted. 0 = review all.')
			.addSlider(slider => slider
				.setLimits(0, 1, 0.05)
				.setValue(this.plugin.settings.autoAcceptThreshold)
				.setDynamicTooltip()
				.onChange(value => { this.plugin.settings.autoAcceptThreshold = value; }));

		let untaggedOnly = true;
		new Setting(contentEl)
			.setName('Untagged notes only')
			.setDesc('Only process notes that have no existing tags.')
			.addToggle(toggle => toggle.setValue(true).onChange(value => { untaggedOnly = value; }));

		const btnContainer = contentEl.createEl('div', { cls: 'atw-batch-buttons' });

		const startBtn = btnContainer.createEl('button', { cls: 'atw-btn atw-btn-primary', text: 'Start batch' });
		startBtn.addEventListener('click', () => { void this.startBatch({ untaggedOnly }); });

		const resumeBtn = btnContainer.createEl('button', { cls: 'atw-btn', text: 'Resume previous' });
		resumeBtn.addEventListener('click', () => { void this.resumeBatch(); });
	}

	private async startBatch(options: { untaggedOnly: boolean }): Promise<void> {
		this.renderProgressView();
		this.processor.on('progress', (c: number, t: number, f: string) => this.updateProgress(c, t, f));
		this.processor.on('complete', () => this.renderReviewView());
		await this.processor.start({ untaggedOnly: options.untaggedOnly });
	}

	private async resumeBatch(): Promise<void> {
		this.renderProgressView();
		this.processor.on('progress', (c: number, t: number, f: string) => this.updateProgress(c, t, f));
		this.processor.on('complete', () => this.renderReviewView());
		await this.processor.resume();
	}

	private renderProgressView(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Processing...' });

		contentEl.createEl('progress', {
			cls: 'atw-progress-bar',
			attr: { id: 'atw-batch-progress', value: '0', max: '100' },
		});
		contentEl.createEl('p', {
			cls: 'atw-progress-status',
			attr: { id: 'atw-batch-status' },
			text: 'Starting...',
		});

		const controls = contentEl.createEl('div', { cls: 'atw-batch-buttons' });

		const pauseBtn = controls.createEl('button', { cls: 'atw-btn', text: 'Pause' });
		pauseBtn.addEventListener('click', () => {
			if (this.processor.job?.status === 'paused') {
				this.processor.unpause();
				pauseBtn.textContent = 'Pause';
			} else {
				this.processor.pause();
				pauseBtn.textContent = 'Resume';
			}
		});

		const abortBtn = controls.createEl('button', { cls: 'atw-btn atw-btn-reject', text: 'Stop' });
		abortBtn.addEventListener('click', () => {
			this.processor.abort();
			this.renderReviewView();
		});
	}

	private updateProgress(current: number, total: number, filePath: string): void {
		const bar = document.getElementById('atw-batch-progress') as HTMLProgressElement | null;
		const status = document.getElementById('atw-batch-status');
		if (bar) { bar.value = current; bar.max = total; }
		if (status) {
			status.textContent = `${current + 1} / ${total}: ${filePath.split('/').pop() ?? filePath}`;
		}
	}

	private renderReviewView(): void {
		const { contentEl } = this;
		contentEl.empty();

		const job = this.processor.job;
		if (!job) { contentEl.createEl('p', { text: 'No batch job data.' }); return; }

		const applied = job.items.filter(i => i.status === 'applied').length;
		const reviewed = job.items.filter(i => i.status === 'reviewed').length;
		const errors = job.items.filter(i => i.status === 'error').length;
		contentEl.createEl('h2', { text: 'Batch Complete' });
		contentEl.createEl('p', {
			text: `Applied: ${applied} | Needs review: ${reviewed} | Errors: ${errors} | Total: ${job.items.length}`,
		});

		this.reviewableItems = job.items.filter(i => i.status === 'reviewed' && i.result);
		if (this.reviewableItems.length === 0) {
			contentEl.createEl('p', { text: 'All notes processed. Nothing to review.' });
			return;
		}

		this.currentReviewIndex = 0;
		this.renderCurrentReviewItem(contentEl);
	}

	private renderCurrentReviewItem(contentEl: HTMLElement): void {
		const existing = contentEl.querySelector('.atw-batch-review-area');
		if (existing) existing.remove();

		const area = contentEl.createEl('div', { cls: 'atw-batch-review-area' });
		const item = this.reviewableItems[this.currentReviewIndex];
		if (!item?.result) return;

		const result = item.result;

		// Navigation
		const nav = area.createEl('div', { cls: 'atw-batch-nav' });
		const prevBtn = nav.createEl('button', { cls: 'atw-btn', text: '\u2190 Prev' });
		prevBtn.disabled = this.currentReviewIndex === 0;
		prevBtn.addEventListener('click', () => {
			this.currentReviewIndex = Math.max(0, this.currentReviewIndex - 1);
			this.renderCurrentReviewItem(contentEl);
		});
		nav.createEl('span', { text: `${this.currentReviewIndex + 1} / ${this.reviewableItems.length}` });
		const nextBtn = nav.createEl('button', { cls: 'atw-btn', text: 'Next \u2192' });
		nextBtn.disabled = this.currentReviewIndex >= this.reviewableItems.length - 1;
		nextBtn.addEventListener('click', () => {
			this.currentReviewIndex = Math.min(this.reviewableItems.length - 1, this.currentReviewIndex + 1);
			this.renderCurrentReviewItem(contentEl);
		});

		area.createEl('h3', { text: result.filePath.split('/').pop() ?? result.filePath });

		for (const tag of result.suggestions) {
			const row = area.createEl('div', { cls: `atw-tag-row atw-review-${tag.reviewStatus ?? 'pending'}` });
			const info = row.createEl('div', { cls: 'atw-tag-info' });
			createTagChip(info, tag);
			createConfidenceBadge(info, tag.confidence);
			if (tag.reason) info.createEl('span', { cls: 'atw-tag-reason', text: tag.reason });
			createReviewButtons(row, tag,
				() => { tag.reviewStatus = 'accepted'; this.renderCurrentReviewItem(contentEl); },
				() => { tag.reviewStatus = 'rejected'; this.renderCurrentReviewItem(contentEl); },
			);
		}

		const applyBtn = area.createEl('button', { cls: 'atw-btn atw-btn-primary', text: 'Apply accepted tags' });
		applyBtn.addEventListener('click', () => { void this.applyItemTags(item); });

		const bulkBtn = area.createEl('button', { cls: 'atw-btn', text: 'Apply all reviewed notes' });
		bulkBtn.addEventListener('click', () => { void this.applyAllReviewed(); });
	}

	private async applyItemTags(item: BatchItem): Promise<void> {
		if (!item.result) return;
		const accepted = item.result.suggestions.filter(s => s.reviewStatus === 'accepted');
		if (accepted.length === 0) { new Notice('No accepted tags'); return; }

		const file = this.app.vault.getAbstractFileByPath(item.filePath);
		if (!(file instanceof TFile)) { new Notice('File not found'); return; }

		await applyTagsToNote(this.app, file, item.result.noteType, accepted);
		item.status = 'applied';
		new Notice(`Applied ${accepted.length} tags to ${file.basename}`);
	}

	private async applyAllReviewed(): Promise<void> {
		let count = 0;
		for (const item of this.reviewableItems) {
			if (item.status !== 'reviewed' || !item.result) continue;
			const accepted = item.result.suggestions.filter(s => s.reviewStatus === 'accepted');
			if (accepted.length === 0) continue;

			const file = this.app.vault.getAbstractFileByPath(item.filePath);
			if (!(file instanceof TFile)) continue;

			await applyTagsToNote(this.app, file, item.result.noteType, accepted);
			item.status = 'applied';
			count++;
		}
		new Notice(`Applied tags to ${count} notes`);
		this.close();
	}
}
