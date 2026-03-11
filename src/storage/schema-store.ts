import { normalizePath } from 'obsidian';
import type TheOnlyOneTagger from '../main';
import type { TagSchema } from '../types';
import { SCHEMA_FILE } from '../constants';
import { createDefaultSchema } from '../seed/seed-schema';

/**
 * Manages loading and saving of tag-schema.json.
 */
export class SchemaStore {
	private plugin: TheOnlyOneTagger;
	schema: TagSchema;

	constructor(plugin: TheOnlyOneTagger) {
		this.plugin = plugin;
		this.schema = createDefaultSchema();
	}

	private get filePath(): string {
		return normalizePath(`${this.plugin.manifest.dir}/${SCHEMA_FILE}`);
	}

	async load(): Promise<void> {
		const adapter = this.plugin.app.vault.adapter;
		if (await adapter.exists(this.filePath)) {
			const raw = await adapter.read(this.filePath);
			this.schema = JSON.parse(raw) as TagSchema;
		} else {
			this.schema = createDefaultSchema();
			await this.save();
		}
	}

	async save(): Promise<void> {
		const adapter = this.plugin.app.vault.adapter;
		await adapter.write(this.filePath, JSON.stringify(this.schema, null, '\t'));
	}

	/** Get all facet names (required + optional) for a note type. */
	getAllFacetNames(noteType: string): string[] {
		const nt = this.schema.note_types[noteType as keyof typeof this.schema.note_types];
		if (!nt) return [];
		return [...nt.required_facets, ...nt.optional_facets];
	}

	/** Check if a facet is required for a note type. */
	isFacetRequired(noteType: string, facetName: string): boolean {
		const nt = this.schema.note_types[noteType as keyof typeof this.schema.note_types];
		if (!nt) return false;
		return nt.required_facets.includes(facetName);
	}
}
