import { ItemView, WorkspaceLeaf, Notice, TFile, MarkdownView } from 'obsidian';
import type TheOnlyOneTagger from '../main';
import { TAG_REVIEW_VIEW_TYPE } from '../constants';
import { TagReviewRenderer } from './tag-review-renderer';
import { extractTagsForNote } from '../tagging/tag-extractor';
import { readFrontmatterTags, flattenFacetValues } from '../tagging/frontmatter-reader';
import { applyTagsToNote } from '../tagging/tag-applicator';
import { VerificationPipeline } from '../verification/verification-pipeline';

export class TagReviewView extends ItemView {
	private plugin: TheOnlyOneTagger;
	private renderer: TagReviewRenderer;
	private analyzing = false;

	constructor(leaf: WorkspaceLeaf, plugin: TheOnlyOneTagger) {
		super(leaf);
		this.plugin = plugin;
		this.renderer = undefined!;
	}

	getViewType(): string { return TAG_REVIEW_VIEW_TYPE; }
	getDisplayText(): string { return 'Tag Review'; }
	getIcon(): string { return 'tags'; }

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('atw-review-container');

		this.renderer = new TagReviewRenderer(container, () => {
			void this.applyAccepted();
		});

		const toolbar = container.createEl('div', { cls: 'atw-toolbar' });
		const verifyBtn = toolbar.createEl('button', {
			cls: 'atw-btn',
			text: 'Verify all pending tags',
		});
		verifyBtn.addEventListener('click', () => { void this.verifyPending(); });

		this.renderer.clear();
	}

	async onClose(): Promise<void> {
		this.containerEl.empty();
	}

	async analyzeCurrentNote(): Promise<void> {
		if (this.analyzing) {
			new Notice('Analysis already in progress...');
			return;
		}

		const file = this.getActiveFile();
		if (!file) {
			new Notice('No active markdown file');
			return;
		}

		this.analyzing = true;
		new Notice(`Analyzing: ${file.basename}...`);

		try {
			const result = await extractTagsForNote(this.plugin, file);
			const fmData = readFrontmatterTags(this.plugin.app, file);
			const currentTags = flattenFacetValues(fmData.facetValues);

			this.renderer.setData(result, this.plugin.schemaStore.schema, currentTags);
			new Notice(`Found ${result.suggestions.length} tag suggestions`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			new Notice(`Analysis failed: ${msg}`);
			console.error('Tag analysis failed:', err);
		} finally {
			this.analyzing = false;
		}
	}

	private async applyAccepted(): Promise<void> {
		const file = this.getActiveFile();
		if (!file) {
			new Notice('No active file to apply tags to');
			return;
		}

		const accepted = this.renderer.getAcceptedTags();
		if (accepted.length === 0) {
			new Notice('No tags accepted — nothing to apply');
			return;
		}

		const fmData = readFrontmatterTags(this.plugin.app, file);
		const noteType = fmData.noteType ?? 'academic';

		try {
			await applyTagsToNote(this.plugin.app, file, noteType, accepted);
			new Notice(`Applied ${accepted.length} tags to ${file.basename}`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			new Notice(`Failed to apply tags: ${msg}`);
		}
	}

	private async verifyPending(): Promise<void> {
		new Notice('Verifying pending tags...');
		try {
			const pipeline = new VerificationPipeline(this.plugin);
			const results = await pipeline.verifyAllPending();
			const verified = results.filter(r => r.status === 'verified').length;
			new Notice(`Verified ${verified}/${results.length} tags`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			new Notice(`Verification failed: ${msg}`);
		}
	}

	private getActiveFile(): TFile | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		return view?.file ?? null;
	}
}
