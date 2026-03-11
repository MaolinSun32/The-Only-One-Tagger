import { MarkdownView, Notice, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, PluginSettings, TaggerSettingTab } from './settings';
import { SchemaStore } from './storage/schema-store';
import { RegistryStore } from './storage/registry-store';
import { QueueStore } from './storage/queue-store';
import { TagReviewView } from './ui/tag-review-view';
import { BatchModal } from './ui/batch-modal';
import { TagBrowserModal } from './ui/tag-browser-modal';
import { VerificationPipeline } from './verification/verification-pipeline';
import { coldStartScan } from './tagging/cold-start-scanner';
import { TAG_REVIEW_VIEW_TYPE } from './constants';

export default class TheOnlyOneTagger extends Plugin {
	settings: PluginSettings = DEFAULT_SETTINGS;
	schemaStore: SchemaStore = undefined!;
	registryStore: RegistryStore = undefined!;
	queueStore: QueueStore = undefined!;

	async onload(): Promise<void> {
		// 1. Settings
		await this.loadSettings();
		this.addSettingTab(new TaggerSettingTab(this.app, this));

		// 2. Data stores
		this.schemaStore = new SchemaStore(this);
		this.registryStore = new RegistryStore(this);
		this.queueStore = new QueueStore(this);

		await this.schemaStore.load();
		await this.registryStore.load();
		await this.queueStore.load();

		// 3. Cold-start scan (方案 B): scan existing notes for tags on first load
		//    Only runs when registry has no auto-extract tags yet (i.e., first run)
		const hasAutoExtract = Object.values(this.registryStore.registry.tags)
			.some(t => t.source.verified_by === 'auto-extract');
		if (!hasAutoExtract) {
			// Run after layout ready so metadataCache is populated
			this.app.workspace.onLayoutReady(async () => {
				const count = await coldStartScan(this);
				if (count > 0) {
					console.log(`The Only One Tagger: cold-start scan found ${count} existing tags`);
					new Notice(`Imported ${count} existing tags from vault (pending verification)`);
				}
			});
		}

		const tagCount = this.registryStore.getAllIds().length;
		const typeCount = Object.keys(this.schemaStore.schema.note_types).length;
		console.log(`The Only One Tagger: loaded ${tagCount} tags, ${typeCount} note types`);

		// 4. Tag review sidebar view
		this.registerView(TAG_REVIEW_VIEW_TYPE, (leaf) => new TagReviewView(leaf, this));

		// 5. Ribbon icon
		this.addRibbonIcon('tags', 'Open Tag Review', () => {
			void this.activateTagReview();
		});

		// 6. Commands — single note
		this.addCommand({
			id: 'analyze-current-note',
			name: 'Analyze current note',
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view) return false;
				if (!checking) void this.analyzeActiveNote();
				return true;
			},
		});

		this.addCommand({
			id: 'open-tag-review',
			name: 'Open tag review panel',
			callback: () => { void this.activateTagReview(); },
		});

		// 7. Commands — batch processing
		this.addCommand({
			id: 'batch-tag-vault',
			name: 'Batch tag vault',
			callback: () => { new BatchModal(this.app, this).open(); },
		});

		// 8. Commands — tag registry management
		this.addCommand({
			id: 'open-tag-browser',
			name: 'Browse tag registry',
			callback: () => { new TagBrowserModal(this.app, this).open(); },
		});

		this.addCommand({
			id: 'verify-pending-tags',
			name: 'Verify all pending tags',
			callback: () => { void this.verifyAllPending(); },
		});

		this.addCommand({
			id: 'export-registry',
			name: 'Export tag registry',
			callback: () => { void this.exportRegistry(); },
		});

		this.addCommand({
			id: 'import-registry',
			name: 'Import tag registry',
			callback: () => { void this.importRegistry(); },
		});

		// Status bar
		const statusBarEl = this.addStatusBarItem();
		statusBarEl.setText(`Tags: ${tagCount}`);

		new Notice(`The Only One Tagger loaded (${tagCount} tags)`);
	}

	onunload(): void {
		console.log('The Only One Tagger: unloaded');
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async activateTagReview(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(TAG_REVIEW_VIEW_TYPE);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]!);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: TAG_REVIEW_VIEW_TYPE, active: true });
			this.app.workspace.revealLeaf(leaf);
		}
	}

	private async analyzeActiveNote(): Promise<void> {
		await this.activateTagReview();
		const leaves = this.app.workspace.getLeavesOfType(TAG_REVIEW_VIEW_TYPE);
		const reviewView = leaves[0]?.view as TagReviewView | undefined;
		if (reviewView) await reviewView.analyzeCurrentNote();
	}

	private async verifyAllPending(): Promise<void> {
		new Notice('Verifying pending tags...');
		try {
			const pipeline = new VerificationPipeline(this);
			const results = await pipeline.verifyAllPending();
			const verified = results.filter(r => r.status === 'verified').length;
			new Notice(`Verified ${verified}/${results.length} tags`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			new Notice(`Verification failed: ${msg}`);
		}
	}

	private async exportRegistry(): Promise<void> {
		const data = JSON.stringify(this.registryStore.registry, null, '\t');
		const path = `tag-registry-export-${Date.now()}.json`;
		await this.app.vault.create(path, data);
		new Notice(`Registry exported to ${path}`);
	}

	private async importRegistry(): Promise<void> {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.json';
		input.addEventListener('change', async () => {
			const file = input.files?.[0];
			if (!file) return;
			try {
				const text = await file.text();
				const imported = JSON.parse(text) as { tags?: Record<string, unknown> };
				if (!imported.tags) {
					new Notice('Invalid registry file: missing "tags" field');
					return;
				}
				let count = 0;
				for (const [id, entry] of Object.entries(imported.tags)) {
					if (!this.registryStore.hasTag(id)) {
						this.registryStore.setTag(id, entry as import('./types').TagEntry);
						count++;
					}
				}
				await this.registryStore.save();
				new Notice(`Imported ${count} new tags`);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				new Notice(`Import failed: ${msg}`);
			}
		});
		input.click();
	}
}
