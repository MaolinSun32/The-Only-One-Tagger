import { normalizePath } from 'obsidian';
import type TheOnlyOneTagger from '../main';
import type { BatchJob } from '../types';
import { BATCH_STATE_FILE } from '../constants';

/**
 * Persists batch job state across plugin reloads.
 * A batch job can be paused and resumed later.
 */
export class BatchStateStore {
	private plugin: TheOnlyOneTagger;
	job: BatchJob | null = null;

	constructor(plugin: TheOnlyOneTagger) {
		this.plugin = plugin;
	}

	private get filePath(): string {
		return normalizePath(`${this.plugin.manifest.dir}/${BATCH_STATE_FILE}`);
	}

	async load(): Promise<void> {
		const adapter = this.plugin.app.vault.adapter;
		if (await adapter.exists(this.filePath)) {
			const raw = await adapter.read(this.filePath);
			this.job = JSON.parse(raw) as BatchJob;
		} else {
			this.job = null;
		}
	}

	async save(): Promise<void> {
		const adapter = this.plugin.app.vault.adapter;
		if (this.job) {
			await adapter.write(this.filePath, JSON.stringify(this.job, null, '\t'));
		} else {
			if (await adapter.exists(this.filePath)) {
				await adapter.remove(this.filePath);
			}
		}
	}

	async clear(): Promise<void> {
		this.job = null;
		await this.save();
	}
}
