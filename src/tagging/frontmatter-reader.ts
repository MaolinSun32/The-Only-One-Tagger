import { App, TFile } from 'obsidian';
import type { NoteType } from '../types';

/** Tag data currently present in a note's YAML frontmatter. */
export interface FrontmatterTagData {
	/** Declared note type, if any. */
	noteType?: NoteType;
	/** Nested facet→value map from the type's section. */
	facetValues: Record<string, string | string[]>;
	/** All frontmatter key-value pairs. */
	allFields: Record<string, unknown>;
	/** Current _tag_version (0 if never tagged). */
	tagVersion: number;
}

const VALID_NOTE_TYPES = new Set<string>([
	'academic', 'project', 'course', 'journal', 'growth',
	'relationship', 'meeting', 'finance', 'health', 'career',
	'creative', 'admin',
]);

/**
 * Read current tag information from a note's frontmatter.
 * Reads the NESTED format (dev-plan §3.3):
 *   type: academic
 *   academic:
 *     area: [attention-mechanism, NLP]
 */
export function readFrontmatterTags(app: App, file: TFile): FrontmatterTagData {
	const cache = app.metadataCache.getFileCache(file);
	const fm = cache?.frontmatter ?? {};

	// Note type
	const rawType = fm['type'] as string | undefined;
	const noteType = rawType && VALID_NOTE_TYPES.has(rawType)
		? rawType as NoteType
		: undefined;

	// Read nested facet values
	let facetValues: Record<string, string | string[]> = {};
	if (noteType && fm[noteType] && typeof fm[noteType] === 'object') {
		facetValues = { ...(fm[noteType] as Record<string, string | string[]>) };
	}

	const tagVersion = typeof fm['_tag_version'] === 'number' ? fm['_tag_version'] : 0;

	return {
		noteType,
		facetValues,
		allFields: { ...fm },
		tagVersion,
	};
}

/** Extract all tag IDs from the nested facet values as a flat list. */
export function flattenFacetValues(facetValues: Record<string, string | string[]>): string[] {
	const result: string[] = [];
	for (const value of Object.values(facetValues)) {
		if (Array.isArray(value)) {
			result.push(...value);
		} else if (typeof value === 'string') {
			result.push(value);
		}
	}
	return result;
}
