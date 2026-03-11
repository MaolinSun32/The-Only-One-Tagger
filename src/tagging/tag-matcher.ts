import type { RegistryStore } from '../storage/registry-store';
import type { SuggestedTag } from '../types';

/**
 * Match suggested tags against the registry.
 * Sets `isExisting = true` for tags found by ID or alias.
 */
export function matchSuggestionsToRegistry(
	suggestions: SuggestedTag[],
	registry: RegistryStore,
): SuggestedTag[] {
	// Build alias → id lookup
	const aliasMap = new Map<string, string>();
	for (const id of registry.getAllIds()) {
		const entry = registry.getTag(id);
		if (!entry) continue;
		aliasMap.set(id, id);
		aliasMap.set(entry.label.toLowerCase(), id);
		for (const alias of entry.aliases) {
			aliasMap.set(alias.toLowerCase(), id);
		}
	}

	return suggestions.map(s => {
		// Try exact ID match
		if (registry.hasTag(s.tagId)) {
			return { ...s, isExisting: true };
		}
		// Try alias/label match
		const matchedId = aliasMap.get(s.tagId) ?? aliasMap.get(s.label.toLowerCase());
		if (matchedId) {
			return { ...s, tagId: matchedId, isExisting: true };
		}
		return { ...s, isExisting: false };
	});
}
