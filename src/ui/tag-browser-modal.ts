import { App, Modal, Notice, Setting } from 'obsidian';
import type TheOnlyOneTagger from '../main';
import type { TagEntry } from '../types';
import { TagRelationshipEditor } from './tag-relationship-editor';
import { mergeTagsAcrossVault } from '../tagging/tag-applicator';

/**
 * Modal for browsing, searching, merging, and managing the tag registry.
 */
export class TagBrowserModal extends Modal {
	private plugin: TheOnlyOneTagger;
	private searchQuery = '';
	private filterFacet = '';
	private filterStatus = '';
	private listContainer: HTMLElement | null = null;

	constructor(app: App, plugin: TheOnlyOneTagger) {
		super(app);
		this.plugin = plugin;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('atw-tag-browser');
		contentEl.createEl('h2', { text: 'Tag Registry Browser' });

		this.renderStats(contentEl);

		// Search
		new Setting(contentEl)
			.setName('Search')
			.addText(text => text
				.setPlaceholder('Search by name, alias, or ID...')
				.onChange(value => {
					this.searchQuery = value.toLowerCase();
					this.renderList();
				}));

		// Facet filter
		new Setting(contentEl)
			.setName('Filter by facet')
			.addDropdown(dd => {
				dd.addOption('', 'All facets');
				for (const f of this.getAllFacets()) {
					dd.addOption(f, f);
				}
				dd.onChange(value => {
					this.filterFacet = value;
					this.renderList();
				});
			});

		// Status filter
		new Setting(contentEl)
			.setName('Filter by status')
			.addDropdown(dd => {
				dd.addOption('', 'All statuses');
				dd.addOption('verified', 'Verified');
				dd.addOption('pending', 'Pending');
				dd.addOption('needs_review', 'Needs Review');
				dd.addOption('rejected', 'Rejected');
				dd.onChange(value => {
					this.filterStatus = value;
					this.renderList();
				});
			});

		this.listContainer = contentEl.createEl('div', { cls: 'atw-tag-browser-list' });
		this.renderList();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderStats(container: HTMLElement): void {
		const tags = this.plugin.registryStore.registry.tags;
		const entries = Object.values(tags);
		const total = entries.length;
		const verified = entries.filter(t => t.status === 'verified').length;
		const pending = entries.filter(t => t.status === 'pending').length;
		const needsReview = entries.filter(t => t.status === 'needs_review').length;

		container.createEl('p', {
			cls: 'atw-stats',
			text: `Total: ${total} | Verified: ${verified} | Pending: ${pending} | Needs review: ${needsReview}`,
		});
	}

	private renderList(): void {
		if (!this.listContainer) return;
		this.listContainer.empty();

		const filtered = this.getFilteredTags();

		if (filtered.length === 0) {
			this.listContainer.createEl('p', {
				cls: 'atw-empty-state',
				text: 'No tags match your filters.',
			});
			return;
		}

		for (const [id, tag] of filtered) {
			this.renderTagItem(this.listContainer, id, tag);
		}
	}

	private renderTagItem(container: HTMLElement, tagId: string, tag: TagEntry): void {
		const item = container.createEl('div', { cls: 'atw-tag-browser-item' });

		// Main info
		const info = item.createEl('div', { cls: 'atw-tag-browser-info' });
		info.createEl('span', { cls: 'atw-tag-browser-label', text: tag.label });
		info.createEl('span', { cls: 'atw-tag-browser-id', text: tagId });

		// Status badge
		item.createEl('span', {
			cls: `atw-tag-browser-status atw-verification-${tag.status}`,
			text: tag.status,
		});

		// Facet
		item.createEl('div', { cls: 'atw-tag-browser-facets' }).createEl('span', {
			cls: 'atw-tag-chip atw-tag-current',
			text: tag.facet,
		});

		// Aliases
		if (tag.aliases.length > 0) {
			item.createEl('div', {
				cls: 'atw-tag-browser-aliases',
				text: `Aliases: ${tag.aliases.join(', ')}`,
			});
		}

		// Relations
		const r = tag.relations;
		const relParts: string[] = [];
		if (r.broader.length > 0) relParts.push(`broader: ${r.broader.join(', ')}`);
		if (r.narrower.length > 0) relParts.push(`narrower: ${r.narrower.join(', ')}`);
		if (r.related.length > 0) relParts.push(`related: ${r.related.join(', ')}`);
		if (relParts.length > 0) {
			item.createEl('div', { cls: 'atw-tag-browser-relations', text: relParts.join(' | ') });
		}

		// Action buttons
		const actions = item.createEl('div', { cls: 'atw-tag-browser-actions' });

		const editBtn = actions.createEl('button', { cls: 'atw-btn', text: 'Edit' });
		editBtn.addEventListener('click', () => {
			new TagRelationshipEditor(this.app, this.plugin, tagId).open();
		});

		const mergeBtn = actions.createEl('button', { cls: 'atw-btn', text: 'Merge into...' });
		mergeBtn.addEventListener('click', () => {
			void this.promptMerge(tagId);
		});
	}

	private async promptMerge(oldId: string): Promise<void> {
		const targetId = prompt(`Merge "${oldId}" into which tag ID?`);
		if (!targetId || !targetId.trim()) return;

		const target = targetId.trim();
		if (!this.plugin.registryStore.hasTag(target)) {
			new Notice(`Target tag "${target}" not found in registry`);
			return;
		}

		const count = await mergeTagsAcrossVault(
			this.app, this.plugin.registryStore, oldId, target,
		);
		new Notice(`Merged "${oldId}" → "${target}", updated ${count} notes`);
		this.renderList();
	}

	private getFilteredTags(): [string, TagEntry][] {
		const entries = Object.entries(this.plugin.registryStore.registry.tags);

		return entries.filter(([id, t]) => {
			if (this.searchQuery) {
				const matchesId = id.includes(this.searchQuery);
				const matchesLabel = t.label.toLowerCase().includes(this.searchQuery);
				const matchesAlias = t.aliases.some(a => a.toLowerCase().includes(this.searchQuery));
				if (!matchesId && !matchesLabel && !matchesAlias) return false;
			}
			if (this.filterFacet && t.facet !== this.filterFacet) return false;
			if (this.filterStatus && t.status !== this.filterStatus) return false;
			return true;
		}).sort((a, b) => a[1].label.localeCompare(b[1].label));
	}

	private getAllFacets(): string[] {
		const facets = new Set<string>();
		for (const tag of Object.values(this.plugin.registryStore.registry.tags)) {
			facets.add(tag.facet);
		}
		return [...facets].sort();
	}
}
