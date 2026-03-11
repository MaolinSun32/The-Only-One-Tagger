import { App, TFile } from 'obsidian';
import type { SuggestedTag, NoteType } from '../types';
import type { RegistryStore } from '../storage/registry-store';

/**
 * Apply accepted tags to a note's YAML frontmatter.
 *
 * Writes NESTED format per dev-plan §3.3:
 *   type: academic
 *   academic:
 *     area: [attention-mechanism, NLP]
 *     method: [transformer]
 *     genre: paper
 *   _tag_status: confirmed
 *   _tag_version: 2
 *   _tagged_at: 2026-03-11
 */
export async function applyTagsToNote(
	app: App,
	file: TFile,
	noteType: NoteType,
	acceptedTags: SuggestedTag[],
): Promise<void> {
	await app.fileManager.processFrontMatter(file, (fm) => {
		// Set note type
		fm['type'] = noteType;

		// Group accepted tags by facet
		const byFacet = new Map<string, string[]>();
		for (const tag of acceptedTags) {
			const list = byFacet.get(tag.facet) ?? [];
			list.push(tag.tagId);
			byFacet.set(tag.facet, list);
		}

		// Write nested under the note type key
		const nested: Record<string, unknown> = (fm[noteType] as Record<string, unknown>) ?? {};
		for (const [facet, tagIds] of byFacet) {
			nested[facet] = tagIds.length === 1 ? tagIds[0] : tagIds;
		}
		fm[noteType] = nested;

		// Metadata
		fm['_tag_status'] = 'confirmed';
		fm['_tag_version'] = (typeof fm['_tag_version'] === 'number' ? fm['_tag_version'] : 0) + 1;
		fm['_tagged_at'] = new Date().toISOString().split('T')[0];
	});
}

/**
 * Merge tags across the entire vault: replace oldId with newId in all notes' frontmatter.
 * Used when merging duplicate tags in the registry.
 */
export async function mergeTagsAcrossVault(
	app: App,
	registryStore: RegistryStore,
	oldId: string,
	newId: string,
): Promise<number> {
	const files = app.vault.getMarkdownFiles();
	let updatedCount = 0;

	for (const file of files) {
		let modified = false;

		await app.fileManager.processFrontMatter(file, (fm) => {
			const noteType = fm['type'] as string | undefined;
			if (!noteType) return;

			const nested = fm[noteType] as Record<string, unknown> | undefined;
			if (!nested) return;

			// Scan all facet values for the old tag ID
			for (const [facet, value] of Object.entries(nested)) {
				if (Array.isArray(value)) {
					const idx = value.indexOf(oldId);
					if (idx >= 0) {
						value[idx] = newId;
						// Deduplicate
						nested[facet] = [...new Set(value)];
						modified = true;
					}
				} else if (value === oldId) {
					nested[facet] = newId;
					modified = true;
				}
			}

			if (modified) {
				fm[noteType] = nested;
			}
		});

		if (modified) updatedCount++;
	}

	// Update registry: merge relations from old into new, remove old
	const oldEntry = registryStore.getTag(oldId);
	const newEntry = registryStore.getTag(newId);
	if (oldEntry && newEntry) {
		// Union relations
		const r = newEntry.relations;
		r.broader = [...new Set([...r.broader, ...oldEntry.relations.broader])].filter(id => id !== newId);
		r.narrower = [...new Set([...r.narrower, ...oldEntry.relations.narrower])].filter(id => id !== newId);
		r.related = [...new Set([...r.related, ...oldEntry.relations.related])].filter(id => id !== newId);

		// Merge aliases
		newEntry.aliases = [...new Set([...newEntry.aliases, ...oldEntry.aliases, oldEntry.label])];

		registryStore.setTag(newId, newEntry);
		registryStore.removeTag(oldId);
	}
	await registryStore.save();

	return updatedCount;
}
