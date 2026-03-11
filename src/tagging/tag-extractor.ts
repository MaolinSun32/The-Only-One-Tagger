import { TFile } from 'obsidian';
import type TheOnlyOneTagger from '../main';
import type { TagSuggestionResult, NoteType } from '../types';
import { createAIService } from '../ai/ai-service';
import { readFrontmatterTags } from './frontmatter-reader';
import { matchSuggestionsToRegistry } from './tag-matcher';
import { normalizeTagId } from '../utils/normalization';

/**
 * Orchestrates: read note → determine type → call AI → match against registry → return result.
 */
export async function extractTagsForNote(
	plugin: TheOnlyOneTagger,
	file: TFile,
): Promise<TagSuggestionResult> {
	const app = plugin.app;

	// 1. Read current frontmatter
	const fmData = readFrontmatterTags(app, file);

	// 2. Determine note type (from frontmatter or fallback to 'academic')
	const noteType: NoteType = fmData.noteType ?? 'academic';

	// 3. Get all facet names for this type from schema
	const facetNames = plugin.schemaStore.getAllFacetNames(noteType);

	// 4. Gather existing tag IDs from registry for context
	const existingTagIds = plugin.registryStore.getAllIds();

	// 5. Read note content
	const content = await app.vault.cachedRead(file);

	// 6. Call AI
	const aiService = createAIService(plugin.settings.generation, plugin.settings);
	let suggestions = await aiService.suggestTags(
		content, noteType, facetNames, existingTagIds, plugin.settings.maxTagsPerFacet,
	);

	// 7. Normalize tag IDs
	suggestions = suggestions.map(s => ({
		...s,
		tagId: normalizeTagId(s.tagId) || s.tagId,
	}));

	// 8. Match against registry
	suggestions = matchSuggestionsToRegistry(suggestions, plugin.registryStore);

	// 9. Auto-register new tags as pending in registry
	for (const s of suggestions) {
		if (!s.isExisting) {
			plugin.registryStore.setTag(s.tagId, {
				label: s.tagId,
				aliases: [],
				facet: s.facet,
				status: 'pending',
				relations: { broader: [], narrower: [], related: [] },
				source: {
					verified_by: 'ai_search',
					verified_at: new Date().toISOString().split('T')[0],
				},
			});
		}
	}
	await plugin.registryStore.save();

	return {
		filePath: file.path,
		noteType,
		suggestions,
		analyzedAt: new Date().toISOString(),
	};
}
