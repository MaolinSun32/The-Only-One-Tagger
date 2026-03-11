import type TheOnlyOneTagger from '../main';
import type { TagEntry, VerificationSource } from '../types';
import { normalizeTagId } from '../utils/normalization';

/**
 * Cold-start: scan existing vault notes for inline tags and frontmatter tags.
 * Extracts them as "auto-extract" pending entries into the registry.
 * Per dev-plan §4 (方案 B): scanned tags still need verification.
 */
export async function coldStartScan(plugin: TheOnlyOneTagger): Promise<number> {
	const files = plugin.app.vault.getMarkdownFiles();
	const discovered = new Map<string, string>(); // tagId → raw label

	for (const file of files) {
		const cache = plugin.app.metadataCache.getFileCache(file);
		if (!cache) continue;

		// 1. Extract from frontmatter `tags` field
		const fmTags = cache.frontmatter?.['tags'];
		if (Array.isArray(fmTags)) {
			for (const raw of fmTags) {
				const label = String(raw).replace(/^#/, '');
				const id = normalizeTagId(label);
				if (id && !discovered.has(id)) {
					discovered.set(id, label);
				}
			}
		}

		// 2. Extract inline tags from metadataCache
		if (cache.tags) {
			for (const tagCache of cache.tags) {
				const label = tagCache.tag.replace(/^#/, '');
				const id = normalizeTagId(label);
				if (id && !discovered.has(id)) {
					discovered.set(id, label);
				}
			}
		}
	}

	// Add to registry as pending (skip already-known tags)
	let addedCount = 0;
	for (const [id, label] of discovered) {
		if (plugin.registryStore.hasTag(id)) continue;

		const entry: TagEntry = {
			label,
			aliases: [],
			facet: 'area', // default facet, user can reclassify later
			status: 'pending',
			relations: { broader: [], narrower: [], related: [] },
			source: {
				verified_by: 'auto-extract' as VerificationSource,
				verified_at: new Date().toISOString().split('T')[0],
			},
		};

		plugin.registryStore.setTag(id, entry);
		addedCount++;
	}

	if (addedCount > 0) {
		await plugin.registryStore.save();
	}

	return addedCount;
}
