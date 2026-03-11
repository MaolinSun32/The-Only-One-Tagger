import { requestUrl, RequestUrlParam, RequestUrlResponse } from 'obsidian';

/**
 * Thin wrapper around Obsidian's requestUrl for consistent error handling.
 * We use requestUrl (not fetch) because it bypasses CORS — critical for
 * calling external APIs (Wikipedia, AI providers) from a desktop plugin.
 */
export async function httpRequest(params: RequestUrlParam): Promise<RequestUrlResponse> {
	return requestUrl(params);
}

export async function httpGet(url: string, headers?: Record<string, string>): Promise<RequestUrlResponse> {
	return requestUrl({ url, headers });
}

export async function httpPostJson(
	url: string,
	body: unknown,
	headers?: Record<string, string>,
): Promise<RequestUrlResponse> {
	return requestUrl({
		url,
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...headers,
		},
		body: JSON.stringify(body),
	});
}
