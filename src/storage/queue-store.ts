import { normalizePath } from 'obsidian';
import type TheOnlyOneTagger from '../main';
import type { QueuedVerification } from '../types';
import { QUEUE_FILE } from '../constants';

/**
 * Persists verification-queue.json matching dev-plan §3.4.
 */
export class QueueStore {
	private plugin: TheOnlyOneTagger;
	queue: QueuedVerification[] = [];
	private nextId = 1;

	constructor(plugin: TheOnlyOneTagger) {
		this.plugin = plugin;
	}

	private get filePath(): string {
		return normalizePath(`${this.plugin.manifest.dir}/${QUEUE_FILE}`);
	}

	async load(): Promise<void> {
		const adapter = this.plugin.app.vault.adapter;
		if (await adapter.exists(this.filePath)) {
			const raw = await adapter.read(this.filePath);
			const data = JSON.parse(raw) as { queue?: QueuedVerification[] };
			this.queue = data.queue ?? [];
			// Restore next ID from existing items
			for (const item of this.queue) {
				const num = parseInt(item.id.replace('q_', ''), 10);
				if (!isNaN(num) && num >= this.nextId) {
					this.nextId = num + 1;
				}
			}
		} else {
			this.queue = [];
		}
	}

	async save(): Promise<void> {
		const adapter = this.plugin.app.vault.adapter;
		await adapter.write(this.filePath, JSON.stringify({ queue: this.queue }, null, '\t'));
	}

	enqueue(tagLabel: string, facet: string, suggestedBy: 'ai' | 'auto-extract' | 'user', sourceNote: string): void {
		// Avoid duplicates
		if (this.queue.some(q => q.tag_label === tagLabel && q.facet === facet)) return;

		this.queue.push({
			id: `q_${String(this.nextId++).padStart(3, '0')}`,
			tag_label: tagLabel,
			facet,
			suggested_by: suggestedBy,
			source_note: sourceNote,
			queued_at: new Date().toISOString(),
			attempts: 0,
		});
	}

	dequeueAll(): QueuedVerification[] {
		const items = [...this.queue];
		this.queue = [];
		return items;
	}

	/** Increment attempt count for a queued item. */
	incrementAttempts(id: string): void {
		const item = this.queue.find(q => q.id === id);
		if (item) item.attempts++;
	}

	get length(): number {
		return this.queue.length;
	}
}
