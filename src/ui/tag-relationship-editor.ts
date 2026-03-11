import { App, Modal, Notice, Setting } from 'obsidian';
import type TheOnlyOneTagger from '../main';
import type { TagEntry } from '../types';

/**
 * Modal for editing a single tag's label, aliases, facet, and relations.
 */
export class TagRelationshipEditor extends Modal {
	private plugin: TheOnlyOneTagger;
	private tagId: string;
	private entry: TagEntry;

	constructor(app: App, plugin: TheOnlyOneTagger, tagId: string) {
		super(app);
		this.plugin = plugin;
		this.tagId = tagId;
		const existing = plugin.registryStore.getTag(tagId);
		if (!existing) {
			throw new Error(`Tag not found: ${tagId}`);
		}
		this.entry = JSON.parse(JSON.stringify(existing)) as TagEntry;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: `Edit: ${this.entry.label}` });
		contentEl.createEl('p', { cls: 'atw-tag-browser-id', text: this.tagId });

		new Setting(contentEl)
			.setName('Label')
			.addText(text => text
				.setValue(this.entry.label)
				.onChange(value => { this.entry.label = value; }));

		new Setting(contentEl)
			.setName('Aliases (comma-separated)')
			.setDesc('Alternative labels, e.g. Chinese translations')
			.addText(text => text
				.setValue(this.entry.aliases.join(', '))
				.onChange(value => {
					this.entry.aliases = value.split(',').map(s => s.trim()).filter(Boolean);
				}));

		new Setting(contentEl)
			.setName('Facet')
			.addText(text => text
				.setValue(this.entry.facet)
				.onChange(value => { this.entry.facet = value.trim(); }));

		new Setting(contentEl)
			.setName('Broader (parent) tag IDs')
			.setDesc('Comma-separated tag IDs')
			.addText(text => text
				.setValue(this.entry.relations.broader.join(', '))
				.onChange(value => {
					this.entry.relations.broader = value.split(',').map(s => s.trim()).filter(Boolean);
				}));

		new Setting(contentEl)
			.setName('Narrower (child) tag IDs')
			.addText(text => text
				.setValue(this.entry.relations.narrower.join(', '))
				.onChange(value => {
					this.entry.relations.narrower = value.split(',').map(s => s.trim()).filter(Boolean);
				}));

		new Setting(contentEl)
			.setName('Related tag IDs')
			.addText(text => text
				.setValue(this.entry.relations.related.join(', '))
				.onChange(value => {
					this.entry.relations.related = value.split(',').map(s => s.trim()).filter(Boolean);
				}));

		const btnContainer = contentEl.createEl('div', { cls: 'atw-batch-buttons' });
		const saveBtn = btnContainer.createEl('button', {
			cls: 'atw-btn atw-btn-primary',
			text: 'Save',
		});
		saveBtn.addEventListener('click', () => { void this.saveChanges(); });
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async saveChanges(): Promise<void> {
		this.plugin.registryStore.setTag(this.tagId, this.entry);
		await this.plugin.registryStore.save();
		new Notice(`Updated tag: ${this.entry.label}`);
		this.close();
	}
}
