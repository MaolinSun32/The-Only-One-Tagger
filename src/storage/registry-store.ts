import { normalizePath } from 'obsidian';
import type TheOnlyOneTagger from '../main';
import type { TagRegistry, TagEntry } from '../types';
import { REGISTRY_FILE } from '../constants';
import { createDefaultRegistry } from '../seed/seed-registry';

/**
 * Manages loading and saving of tag-registry.json.
 * Provides lookup and mutation helpers for the tag vocabulary.
 */
export class RegistryStore {
	private plugin: TheOnlyOneTagger;
	registry: TagRegistry;

	constructor(plugin: TheOnlyOneTagger) {
		this.plugin = plugin;
		this.registry = createDefaultRegistry();
	}

	private get filePath(): string {
		return normalizePath(`${this.plugin.manifest.dir}/${REGISTRY_FILE}`);
	}

	async load(): Promise<void> {
		const adapter = this.plugin.app.vault.adapter;
		if (await adapter.exists(this.filePath)) {
			const raw = await adapter.read(this.filePath);
			this.registry = JSON.parse(raw) as TagRegistry;
		} else {
			this.registry = createDefaultRegistry();
			await this.save();
		}
	}

	async save(): Promise<void> {
		// Update meta before saving
		this.registry.meta.last_updated = new Date().toISOString().split('T')[0]!;
		this.registry.meta.total_tags = Object.keys(this.registry.tags).length;

		const adapter = this.plugin.app.vault.adapter;
		await adapter.write(this.filePath, JSON.stringify(this.registry, null, '\t'));
	}

	/** Look up a tag by ID. */
	getTag(id: string): TagEntry | undefined {
		return this.registry.tags[id];
	}

	/** Check if a tag ID exists. */
	hasTag(id: string): boolean {
		return id in this.registry.tags;
	}

	/** Add or update a tag entry. Does NOT auto-save. */
	setTag(id: string, entry: TagEntry): void {
		this.registry.tags[id] = entry;
	}

	/** Remove a tag by ID. Does NOT auto-save. */
	removeTag(id: string): void {
		delete this.registry.tags[id];
	}

	/** Get all tags belonging to a specific facet. */
	getTagsByFacet(facet: string): [string, TagEntry][] {
		return Object.entries(this.registry.tags).filter(([, t]) => t.facet === facet);
	}

	/** Get all tag IDs. */
	getAllIds(): string[] {
		return Object.keys(this.registry.tags);
	}
}
