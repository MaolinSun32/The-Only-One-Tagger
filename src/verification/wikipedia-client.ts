import { httpGet } from '../utils/http';
import { VerificationError } from '../utils/errors';

export interface WikipediaSearchResult {
	title: string;
	snippet: string;
	pageid: number;
}

export interface WikipediaSummary {
	title: string;
	description?: string;
	extract?: string;
	content_urls?: {
		desktop?: { page?: string };
	};
}

/**
 * Client for the Wikipedia REST API.
 * Uses two endpoints:
 * - Action API for search: /w/api.php?action=query&list=search
 * - REST API for summaries: /api/rest_v1/page/summary/
 */
export class WikipediaClient {
	private lang: string;

	constructor(lang = 'en') {
		this.lang = lang;
	}

	private get baseUrl(): string {
		return `https://${this.lang}.wikipedia.org`;
	}

	/**
	 * Search Wikipedia for articles matching a query.
	 * Returns top results with title and snippet.
	 */
	async searchArticle(query: string, limit = 3): Promise<WikipediaSearchResult[]> {
		const params = new URLSearchParams({
			action: 'query',
			list: 'search',
			srsearch: query,
			srlimit: String(limit),
			format: 'json',
			origin: '*',
		});

		try {
			const url = `${this.baseUrl}/w/api.php?${params.toString()}`;
			const resp = await httpGet(url);
			const data = resp.json as { query?: { search?: WikipediaSearchResult[] } };
			return data?.query?.search ?? [];
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			throw new VerificationError(`Wikipedia search failed: ${msg}`);
		}
	}

	/**
	 * Get the summary of a specific Wikipedia article by title.
	 * Returns canonical title, description, and extract.
	 */
	async getArticleSummary(title: string): Promise<WikipediaSummary | null> {
		const encoded = encodeURIComponent(title.replace(/ /g, '_'));
		const url = `${this.baseUrl}/api/rest_v1/page/summary/${encoded}`;

		try {
			const resp = await httpGet(url);
			if (resp.status === 404) return null;
			return resp.json as WikipediaSummary;
		} catch {
			// 404 or network error — article doesn't exist
			return null;
		}
	}

	/**
	 * Convenience: search for a term and return the best match summary.
	 * Returns null if no relevant article found.
	 */
	async verifyTerm(term: string): Promise<{
		canonicalTitle: string;
		description: string;
		url: string;
	} | null> {
		const results = await this.searchArticle(term, 1);
		if (results.length === 0) return null;

		const topResult = results[0]!;
		const summary = await this.getArticleSummary(topResult.title);
		if (!summary) return null;

		return {
			canonicalTitle: summary.title,
			description: summary.description ?? summary.extract?.slice(0, 200) ?? '',
			url: summary.content_urls?.desktop?.page ?? `${this.baseUrl}/wiki/${encodeURIComponent(summary.title)}`,
		};
	}
}
