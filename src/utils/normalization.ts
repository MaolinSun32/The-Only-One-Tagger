import { TAG_ID_REGEX } from '../constants';

/**
 * Normalize a tag label to a canonical lowercase-hyphenated slug.
 * "Machine Learning" → "machine-learning"
 * "C++" → "cpp"
 * "Named Entity Recognition (NER)" → "named-entity-recognition"
 */
export function normalizeTagId(label: string): string {
	return label
		.toLowerCase()
		.replace(/\+\+/g, 'pp')            // C++ → cpp
		.replace(/[()[\]{}<>]/g, '')        // strip brackets
		.replace(/[^a-z0-9]+/g, '-')        // non-alphanum → hyphen
		.replace(/^-+|-+$/g, '');            // trim leading/trailing hyphens
}

/** Check if a string is a valid tag ID. */
export function isValidTagId(id: string): boolean {
	return TAG_ID_REGEX.test(id);
}
