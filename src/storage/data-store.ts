import { App, normalizePath, type PluginManifest } from 'obsidian';

/**
 * 泛型存储基类，封装 adapter.read/write + JSON 序列化。
 * 内置 Promise 链写入队列，保证并发 update() 串行执行且错误隔离。
 */
export class DataStore<T> {
  protected filePath: string;
  protected defaultValue: T;
  protected app: App;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(app: App, manifest: PluginManifest, fileName: string, defaultValue: T) {
    this.app = app;
    this.filePath = normalizePath(manifest.dir + '/' + fileName);
    this.defaultValue = defaultValue;
  }

  /**
   * 从磁盘加载 JSON。
   * 文件不存在 → 用默认值创建并写入。
   * 文件内容损坏（非法 JSON）→ console.error + 用默认值恢复。
   */
  async load(): Promise<T> {
    let content: string;
    try {
      content = await this.app.vault.adapter.read(this.filePath);
    } catch {
      // 文件不存在，用默认值创建
      await this.save(this.defaultValue);
      return JSON.parse(JSON.stringify(this.defaultValue));
    }

    try {
      return JSON.parse(content) as T;
    } catch {
      console.error(`[TOOT] Corrupted JSON in ${this.filePath}, recovering with defaults`);
      await this.save(this.defaultValue);
      return JSON.parse(JSON.stringify(this.defaultValue));
    }
  }

  /** 序列化写入磁盘 */
  async save(data: T): Promise<void> {
    await this.app.vault.adapter.write(this.filePath, JSON.stringify(data, null, 2));
  }

  /**
   * 串行化读-改-写。
   *
   * 内部维护写入队列（Promise 链），确保多个并发 update() 调用严格串行执行。
   * 单次 update() 失败向调用方返回 reject，但 Promise 链本身始终恢复，
   * 后续排队操作不受影响。
   */
  update(mutator: (data: T) => void): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.writeQueue = this.writeQueue
        .catch(() => {}) // 错误隔离：恢复链条
        .then(async () => {
          try {
            const data = await this.load();
            mutator(data);
            await this.save(data);
            resolve();
          } catch (err) {
            reject(err);
            throw err; // 让链进入 rejected，下一次 .catch 吞掉
          }
        });
    });
  }
}
