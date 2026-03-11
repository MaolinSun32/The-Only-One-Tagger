import type { AIService } from '../ai-service';
import type { AIProviderConfig } from '../../settings';
import type { SuggestedTag, NoteType } from '../../types';
import { httpPostJson } from '../../utils/http';
import { buildTagExtractionPrompt } from '../prompts';
import { MissingApiKeyError, AIServiceError } from '../../utils/errors';
import { DEFAULT_TEMPERATURE, DEFAULT_MAX_TOKENS } from '../../constants';

interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

interface ChatCompletionResponse {
	choices: Array<{
		message: {
			content: string;
		};
	}>;
}

/**
 * Base class for all OpenAI-compatible providers.
 */
export class OpenAICompatibleService implements AIService {
	private config: AIProviderConfig;
	private timeoutMs: number;

	constructor(config: AIProviderConfig, timeoutMs: number) {
		this.config = config;
		this.timeoutMs = timeoutMs;
	}

	async suggestTags(
		noteContent: string,
		noteType: NoteType,
		facetNames: string[],
		existingTagIds: string[],
		maxTagsPerFacet: number,
	): Promise<SuggestedTag[]> {
		if (!this.config.apiKey) {
			throw new MissingApiKeyError(this.config.provider);
		}

		const { systemPrompt, userPrompt } = buildTagExtractionPrompt(
			noteContent, noteType, facetNames, existingTagIds, maxTagsPerFacet,
		);

		const messages: ChatMessage[] = [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userPrompt },
		];

		const responseText = await this.chatCompletion(messages);
		return this.parseTagResponse(responseText);
	}

	protected async chatCompletion(messages: ChatMessage[]): Promise<string> {
		const url = `${this.config.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;

		const body = {
			model: this.config.model,
			messages,
			temperature: DEFAULT_TEMPERATURE,
			max_tokens: DEFAULT_MAX_TOKENS,
			response_format: { type: 'json_object' },
		};

		try {
			const response = await httpPostJson(url, body, {
				'Authorization': `Bearer ${this.config.apiKey}`,
			});

			const data = response.json as ChatCompletionResponse;
			const content = data?.choices?.[0]?.message?.content;
			if (!content) {
				throw new AIServiceError('Empty response from AI provider');
			}
			return content;
		} catch (err) {
			if (err instanceof AIServiceError || err instanceof MissingApiKeyError) {
				throw err;
			}
			const msg = err instanceof Error ? err.message : String(err);
			throw new AIServiceError(`AI API call failed: ${msg}`);
		}
	}

	private parseTagResponse(text: string): SuggestedTag[] {
		try {
			const parsed = JSON.parse(text);
			const tags: unknown[] = parsed.tags ?? parsed.suggestions ?? [];
			return tags.map((raw: unknown) => {
				const t = raw as Record<string, unknown>;
				return {
					facet: String(t['facet'] ?? ''),
					tagId: String(t['tagId'] ?? t['tag_id'] ?? ''),
					label: String(t['label'] ?? t['prefLabel'] ?? t['pref_label'] ?? ''),
					confidence: Number(t['confidence'] ?? 0.5),
					reason: String(t['reason'] ?? ''),
					isExisting: false,
					reviewStatus: 'pending' as const,
				};
			}).filter(t => t.tagId && t.facet);
		} catch {
			throw new AIServiceError(`Failed to parse AI response as JSON: ${text.slice(0, 200)}`);
		}
	}
}
