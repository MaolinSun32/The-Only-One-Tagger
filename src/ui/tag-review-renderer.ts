import type { TagSuggestionResult, SuggestedTag, NoteTypeSchema, TagSchema } from '../types';
import { createTagChip, createConfidenceBadge, createFacetHeader, createReviewButtons } from './components';

/**
 * Renders the diff-style tag review UI inside a container element.
 */
export class TagReviewRenderer {
	private containerEl: HTMLElement;
	private result: TagSuggestionResult | null = null;
	private schema: TagSchema | null = null;
	private noteTypeSchema: NoteTypeSchema | null = null;
	private currentTags: string[] = [];
	private onChanged: () => void;

	constructor(containerEl: HTMLElement, onChanged: () => void) {
		this.containerEl = containerEl;
		this.onChanged = onChanged;
	}

	setData(
		result: TagSuggestionResult,
		schema: TagSchema,
		currentTags: string[],
	): void {
		this.result = result;
		this.schema = schema;
		this.noteTypeSchema = schema.note_types[result.noteType];
		this.currentTags = currentTags;
		this.render();
	}

	clear(): void {
		this.result = null;
		this.schema = null;
		this.noteTypeSchema = null;
		this.containerEl.empty();
		this.containerEl.createEl('p', {
			cls: 'atw-empty-state',
			text: 'Open a note and run "Analyze current note" to see tag suggestions.',
		});
	}

	private render(): void {
		this.containerEl.empty();
		if (!this.result || !this.noteTypeSchema || !this.schema) {
			this.clear();
			return;
		}

		// Header
		const header = this.containerEl.createEl('div', { cls: 'atw-review-header' });
		header.createEl('h4', { text: this.result.filePath.split('/').pop() ?? 'Note' });
		header.createEl('span', {
			cls: 'atw-note-type-badge',
			text: this.result.noteType,
		});

		// Current tags
		if (this.currentTags.length > 0) {
			const currentSection = this.containerEl.createEl('div', { cls: 'atw-current-tags' });
			currentSection.createEl('h5', { text: 'Current tags' });
			const tagList = currentSection.createEl('div', { cls: 'atw-tag-list' });
			for (const t of this.currentTags) {
				tagList.createEl('span', { cls: 'atw-tag-chip atw-tag-current', text: t });
			}
		}

		// Suggestions grouped by facet — required first, then optional
		const byFacet = this.groupByFacet(this.result.suggestions);
		const allFacets = [...this.noteTypeSchema.required_facets, ...this.noteTypeSchema.optional_facets];

		for (const facetName of allFacets) {
			const suggestions = byFacet.get(facetName) ?? [];
			const isRequired = this.noteTypeSchema.required_facets.includes(facetName);
			if (suggestions.length === 0 && !isRequired) continue;

			const facetDef = this.schema.facet_definitions[facetName];
			const displayName = facetDef ? `${facetName} — ${facetDef.description}` : facetName;

			const section = this.containerEl.createEl('div', { cls: 'atw-facet-section' });
			createFacetHeader(section, displayName, isRequired);

			if (suggestions.length === 0) {
				section.createEl('p', { cls: 'atw-no-suggestions', text: 'No suggestions' });
				continue;
			}

			for (const tag of suggestions) {
				this.renderTagRow(section, tag);
			}
		}

		// Apply button
		const footer = this.containerEl.createEl('div', { cls: 'atw-review-footer' });
		const applyBtn = footer.createEl('button', {
			cls: 'atw-btn atw-btn-primary',
			text: 'Apply accepted tags',
		});
		applyBtn.addEventListener('click', () => {
			this.onChanged();
		});
	}

	private renderTagRow(container: HTMLElement, tag: SuggestedTag): void {
		const row = container.createEl('div', {
			cls: `atw-tag-row atw-review-${tag.reviewStatus ?? 'pending'}`,
		});

		const info = row.createEl('div', { cls: 'atw-tag-info' });
		createTagChip(info, tag);
		createConfidenceBadge(info, tag.confidence);

		if (tag.reason) {
			info.createEl('span', { cls: 'atw-tag-reason', text: tag.reason });
		}

		createReviewButtons(row, tag,
			() => { tag.reviewStatus = 'accepted'; this.render(); },
			() => { tag.reviewStatus = 'rejected'; this.render(); },
		);
	}

	getAcceptedTags(): SuggestedTag[] {
		return this.result?.suggestions.filter(s => s.reviewStatus === 'accepted') ?? [];
	}

	private groupByFacet(tags: SuggestedTag[]): Map<string, SuggestedTag[]> {
		const map = new Map<string, SuggestedTag[]>();
		for (const t of tags) {
			const list = map.get(t.facet) ?? [];
			list.push(t);
			map.set(t.facet, list);
		}
		return map;
	}
}
