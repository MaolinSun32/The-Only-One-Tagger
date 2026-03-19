/**
 * Token Bucket 限速器，按 baseUrl 维度隔离。
 * 使用 lazy refill：每次 acquire 时按时间差补充令牌，无定时器。
 */

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export class RateLimiter {
  private readonly tokensPerSecond: number;
  private readonly bucketSize: number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(config?: { tokensPerSecond?: number; bucketSize?: number }) {
    this.tokensPerSecond = config?.tokensPerSecond ?? 10;
    this.bucketSize = config?.bucketSize ?? 20;
  }

  /** 获取一个令牌，令牌不足时 await 阻塞。递归重试防止并发竞态。 */
  async acquire(dimension: string): Promise<void> {
    const bucket = this.getOrCreate(dimension);
    this.refill(bucket);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return;
    }

    // 令牌不足，计算等待时间
    const deficit = 1 - bucket.tokens;
    const waitMs = (deficit / this.tokensPerSecond) * 1000;
    await this.delay(waitMs);

    // 递归重试：等待后重新检查令牌（防止并发 acquire 同时等待后同时扣减导致 tokens 变负）
    return this.acquire(dimension);
  }

  // ── internal ──

  private getOrCreate(dimension: string): Bucket {
    let bucket = this.buckets.get(dimension);
    if (!bucket) {
      bucket = { tokens: this.bucketSize, lastRefill: Date.now() };
      this.buckets.set(dimension, bucket);
    }
    return bucket;
  }

  private refill(bucket: Bucket): void {
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(
      this.bucketSize,
      bucket.tokens + elapsed * this.tokensPerSecond,
    );
    bucket.lastRefill = now;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
