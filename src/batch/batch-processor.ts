import { Events, TFile, Notice } from 'obsidian';
import type TheOnlyOneTagger from '../main';
import type { BatchJob, BatchItem, TagSuggestionResult } from '../types';
import { extractTagsForNote } from '../tagging/tag-extractor';
import { applyTagsToNote } from '../tagging/tag-applicator';
import { RateLimiter } from '../ai/rate-limiter';
import { VaultScanner, ScanOptions } from './vault-scanner';
import { BatchStateStore } from './batch-state';

/**
 * Events emitted during batch processing:
 * - 'progress': (current: number, total: number, filePath: string)
 * - 'item-done': (item: BatchItem)
 * - 'complete': ()
 * - 'error': (error: Error, filePath: string)
 */
export class BatchProcessor extends Events {
	private plugin: TheOnlyOneTagger;
	private stateStore: BatchStateStore;
	private rateLimiter: RateLimiter;
	private aborted = false;
	private paused = false;
	private pausePromise: { resolve: () => void } | null = null;

	constructor(plugin: TheOnlyOneTagger) {
		super();
		this.plugin = plugin;
		this.stateStore = new BatchStateStore(plugin);
		this.rateLimiter = new RateLimiter(plugin.settings.rateLimitRpm);
	}

	/** Start a new batch job from scratch. */
	async start(scanOptions: Partial<ScanOptions> = {}): Promise<void> {
		const scanner = new VaultScanner(this.plugin.app);
		const files = scanner.scan(scanOptions);

		if (files.length === 0) {
			new Notice('No files match the scan criteria');
			return;
		}

		const job: BatchJob = {
			id: Date.now().toString(36),
			status: 'running',
			items: files.map(f => ({
				filePath: f.path,
				status: 'queued' as const,
			})),
			currentIndex: 0,
			autoAcceptThreshold: this.plugin.settings.autoAcceptThreshold,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		this.stateStore.job = job;
		await this.stateStore.save();

		this.aborted = false;
		this.paused = false;
		await this.processLoop();
	}

	/** Resume a previously saved job. */
	async resume(): Promise<void> {
		await this.stateStore.load();
		if (!this.stateStore.job) {
			new Notice('No batch job to resume');
			return;
		}

		this.stateStore.job.status = 'running';
		this.aborted = false;
		this.paused = false;
		await this.processLoop();
	}

	pause(): void {
		this.paused = true;
		if (this.stateStore.job) {
			this.stateStore.job.status = 'paused';
		}
	}

	unpause(): void {
		this.paused = false;
		if (this.pausePromise) {
			this.pausePromise.resolve();
			this.pausePromise = null;
		}
		if (this.stateStore.job) {
			this.stateStore.job.status = 'running';
		}
	}

	abort(): void {
		this.aborted = true;
		this.unpause(); // release pause lock if paused
		if (this.stateStore.job) {
			this.stateStore.job.status = 'aborted';
		}
	}

	get job(): BatchJob | null {
		return this.stateStore.job;
	}

	/** Main processing loop. */
	private async processLoop(): Promise<void> {
		const job = this.stateStore.job;
		if (!job) return;

		const total = job.items.length;

		for (let i = job.currentIndex; i < total; i++) {
			if (this.aborted) break;

			// Handle pause
			if (this.paused) {
				await this.stateStore.save();
				await new Promise<void>(resolve => {
					this.pausePromise = { resolve };
				});
				if (this.aborted) break;
			}

			const item = job.items[i]!;
			job.currentIndex = i;
			item.status = 'processing';

			this.trigger('progress', i, total, item.filePath);

			try {
				await this.rateLimiter.acquire();
				const file = this.plugin.app.vault.getAbstractFileByPath(item.filePath);
				if (!(file instanceof TFile)) {
					item.status = 'skipped';
					item.error = 'File not found';
					continue;
				}

				const result = await extractTagsForNote(this.plugin, file as TFile);
				item.result = result;

				// Auto-accept tags above threshold
				if (job.autoAcceptThreshold > 0) {
					for (const s of result.suggestions) {
						if (s.confidence >= job.autoAcceptThreshold) {
							s.reviewStatus = 'accepted';
						}
					}

					// Auto-apply if all tags are auto-accepted
					const accepted = result.suggestions.filter(s => s.reviewStatus === 'accepted');
					if (accepted.length > 0 && accepted.length === result.suggestions.length) {
						await applyTagsToNote(this.plugin.app, file, result.noteType, accepted);
						item.status = 'applied';
					} else {
						item.status = 'reviewed';
					}
				} else {
					item.status = 'reviewed';
				}

				this.trigger('item-done', item);
			} catch (err) {
				item.status = 'error';
				item.error = err instanceof Error ? err.message : String(err);
				this.trigger('error', err, item.filePath);
				// Continue to next item — don't stop the batch
			}

			// Periodically save state
			if (i % 5 === 0) {
				job.updatedAt = new Date().toISOString();
				await this.stateStore.save();
			}
		}

		if (!this.aborted) {
			job.status = 'completed';
		}
		job.updatedAt = new Date().toISOString();
		await this.stateStore.save();
		this.trigger('complete');
	}
}
