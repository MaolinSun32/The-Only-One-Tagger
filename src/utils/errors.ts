/** Base error for all plugin errors. */
export class TaggerError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TaggerError';
	}
}

/** AI API call failed. */
export class AIServiceError extends TaggerError {
	statusCode?: number;
	constructor(message: string, statusCode?: number) {
		super(message);
		this.name = 'AIServiceError';
		this.statusCode = statusCode;
	}
}

/** Verification failed (Wikipedia or AI). */
export class VerificationError extends TaggerError {
	constructor(message: string) {
		super(message);
		this.name = 'VerificationError';
	}
}

/** API key not configured. */
export class MissingApiKeyError extends TaggerError {
	constructor(provider: string) {
		super(`API key not configured for ${provider}. Please set it in plugin settings.`);
		this.name = 'MissingApiKeyError';
	}
}
