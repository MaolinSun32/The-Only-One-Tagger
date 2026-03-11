/**
 * Token bucket rate limiter.
 * Controls how fast we make API calls to avoid hitting provider rate limits.
 */
export class RateLimiter {
	private tokens: number;
	private readonly maxTokens: number;
	private readonly refillRate: number; // tokens per ms
	private lastRefill: number;

	/**
	 * @param requestsPerMinute Maximum requests per minute
	 */
	constructor(requestsPerMinute: number) {
		this.maxTokens = requestsPerMinute;
		this.tokens = requestsPerMinute;
		this.refillRate = requestsPerMinute / 60_000; // tokens per ms
		this.lastRefill = Date.now();
	}

	/** Wait until a token is available, then consume it. */
	async acquire(): Promise<void> {
		this.refill();

		if (this.tokens >= 1) {
			this.tokens -= 1;
			return;
		}

		// Wait for one token to become available
		const waitMs = Math.ceil((1 - this.tokens) / this.refillRate);
		await this.sleep(waitMs);
		this.refill();
		this.tokens -= 1;
	}

	private refill(): void {
		const now = Date.now();
		const elapsed = now - this.lastRefill;
		this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
		this.lastRefill = now;
	}

	private sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}
