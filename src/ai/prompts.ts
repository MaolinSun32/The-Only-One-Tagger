import type { NoteType } from '../types';
import { NOTE_CONTENT_HEAD, NOTE_CONTENT_TAIL } from '../constants';

/**
 * Build the system + user prompts for tag extraction.
 */
export function buildTagExtractionPrompt(
	noteContent: string,
	noteType: NoteType,
	facetNames: string[],
	existingTagIds: string[],
	maxTagsPerFacet: number,
): { systemPrompt: string; userPrompt: string } {
	const systemPrompt = `You are a librarian-taxonomist. Your task is to analyze a note and suggest appropriate tags for it, organized by facets (classification dimensions).

Rules:
- Each tag must be a lowercase-hyphenated slug (e.g. "machine-learning", not "Machine Learning")
- Prefer reusing existing tags from the provided list over inventing new ones
- Only invent a new tag when no existing tag fits
- Each tag needs a human-readable label
- Provide a confidence score (0.0–1.0) for each tag
- Provide a brief reason explaining why this tag fits
- Suggest at most ${maxTagsPerFacet} tags per facet
- Only suggest tags for the provided facets

Respond with valid JSON in this exact format:
{
  "tags": [
    {
      "facet": "area",
      "tagId": "machine-learning",
      "label": "machine-learning",
      "confidence": 0.95,
      "reason": "The note discusses ML algorithms"
    }
  ]
}`;

	const truncated = truncateContent(noteContent);
	const facetList = facetNames.join(', ');
	const tagList = existingTagIds.length > 0
		? existingTagIds.join(', ')
		: '(none yet — you may create new tags)';

	const userPrompt = `Note type: ${noteType}
Available facets: ${facetList}
Existing tags in registry: ${tagList}

--- NOTE CONTENT ---
${truncated}
--- END ---

Analyze this note and suggest tags for each relevant facet.`;

	return { systemPrompt, userPrompt };
}

function truncateContent(content: string): string {
	if (content.length <= NOTE_CONTENT_HEAD + NOTE_CONTENT_TAIL) {
		return content;
	}
	const head = content.slice(0, NOTE_CONTENT_HEAD);
	const tail = content.slice(-NOTE_CONTENT_TAIL);
	return `${head}\n\n[... truncated ${content.length - NOTE_CONTENT_HEAD - NOTE_CONTENT_TAIL} characters ...]\n\n${tail}`;
}
