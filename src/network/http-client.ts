import { requestUrl } from 'obsidian';

/** 标准化的 HTTP 错误 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly isTimeout: boolean,
    public readonly isNetworkError: boolean,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * requestUrl 薄封装。
 * 统一超时处理、错误码规范化、JSON 自动解析。
 */
export class HttpClient {
  private timeoutMs: number;

  constructor(settings: { request_timeout_ms: number }) {
    this.timeoutMs = settings.request_timeout_ms;
  }

  async get<T>(url: string, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('GET', url, undefined, headers);
  }

  async post<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('POST', url, body, headers);
  }

  updateTimeout(ms: number): void {
    this.timeoutMs = ms;
  }

  // ── internal ──

  private async request<T>(
    method: string,
    url: string,
    body: unknown | undefined,
    headers?: Record<string, string>,
  ): Promise<T> {
    const mergedHeaders: Record<string, string> = {
      // 仅在有 body 时设置 Content-Type，避免 GET 请求带多余 header 导致严格 API 返回 400/415
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    };

    const reqPromise = requestUrl({
      url,
      method,
      headers: mergedHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      throw: false,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new HttpError(0, 'Request timeout', true, false)),
        this.timeoutMs,
      );
    });

    let response: Awaited<ReturnType<typeof requestUrl>>;
    try {
      response = await Promise.race([reqPromise, timeoutPromise]);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(0, String(err), false, true);
    }

    if (response.status >= 200 && response.status < 300) {
      return response.json as T;
    }

    throw new HttpError(
      response.status,
      `HTTP ${response.status}: ${response.text?.slice(0, 200) ?? 'Unknown error'}`,
      false,
      false,
    );
  }
}
