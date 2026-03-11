import type { PluginSettings, AIProviderConfig } from '../settings';
import type { SuggestedTag, NoteType } from '../types';
import { OpenAICompatibleService } from './providers/openai-compatible';

/**
 * Abstract interface for AI tag generation / verification services.
 */
export interface AIService {
	/** Generate tag suggestions for a note. */
	suggestTags(
		noteContent: string,
		noteType: NoteType,
		facetNames: string[],
		existingTagIds: string[],
		maxTagsPerFacet: number,
	): Promise<SuggestedTag[]>;
}

/**
 * Factory: create the appropriate AI service based on settings.
 * Both generation and verification providers use the same OpenAI-compatible format,
 * just with different base URLs and API keys.
 */
export function createAIService(config: AIProviderConfig, settings: PluginSettings): AIService {
	return new OpenAICompatibleService(config, settings.timeoutMs);
}
