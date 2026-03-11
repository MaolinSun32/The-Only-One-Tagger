import type { AIProviderConfig } from '../settings';
import type { VerificationResult } from '../types';
import { httpPostJson } from '../utils/http';
import { MissingApiKeyError, AIServiceError } from '../utils/errors';
import { DEFAULT_TEMPERATURE, DEFAULT_MAX_TOKENS } from '../constants';

/**
 * Tier 3 verification: uses an AI model with web search capability.
 */
export class AIVerifier {
	private config: AIProviderConfig;
	private timeoutMs: number;

	constructor(config: AIProviderConfig, timeoutMs: number) {
		this.config = config;
		this.timeoutMs = timeoutMs;
	}

	async verifyTag(tagId: string, tagLabel: string, facet: string): Promise<VerificationResult> {
		if (!this.config.apiKey) {
			throw new MissingApiKeyError(this.config.provider);
		}

		const systemPrompt = `You are a knowledge verification assistant. Your task is to verify whether a given concept/term is real and well-established.

Respond with valid JSON:
{
  "exists": true/false,
  "uncertain": false,
  "canonicalLabel": "The standard name for this concept",
  "reason": "Brief explanation",
  "url": "A reference URL if available, or empty string"
}

Set "uncertain" to true if you cannot determine with confidence.`;

		const userPrompt = `Verify whether this is a real, established concept:
- Tag ID: ${tagId}
- Label: ${tagLabel}
- Facet/category: ${facet}

Is "${tagLabel}" a recognized concept, technology, method, or entity? Search the web if needed.`;

		const url = `${this.config.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
		const body = {
			model: this.config.model,
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userPrompt },
			],
			temperature: DEFAULT_TEMPERATURE,
			max_tokens: DEFAULT_MAX_TOKENS,
			response_format: { type: 'json_object' },
		};

		try {
			const response = await httpPostJson(url, body, {
				'Authorization': `Bearer ${this.config.apiKey}`,
			});

			const data = response.json as {
				choices: Array<{ message: { content: string } }>;
			};
			const content = data?.choices?.[0]?.message?.content;
			if (!content) throw new AIServiceError('Empty verification response');

			const parsed = JSON.parse(content) as {
				exists: boolean;
				uncertain?: boolean;
				canonicalLabel?: string;
				reason?: string;
				url?: string;
			};

			let status: 'verified' | 'rejected' | 'needs_review';
			if (parsed.uncertain) {
				status = 'needs_review';
			} else {
				status = parsed.exists ? 'verified' : 'rejected';
			}

			return {
				tagId,
				status,
				source: 'ai_search',
				canonicalLabel: parsed.canonicalLabel,
				url: parsed.url || undefined,
				reason: parsed.reason,
			};
		} catch (err) {
			if (err instanceof MissingApiKeyError) throw err;
			const msg = err instanceof Error ? err.message : String(err);
			throw new AIServiceError(`AI verification failed: ${msg}`);
		}
	}
}
