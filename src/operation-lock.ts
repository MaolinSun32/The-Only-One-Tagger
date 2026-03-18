/**
 * 全局互斥锁，防止破坏性批量操作并发执行。
 * 内存级锁，崩溃恢复依靠状态文件而非此锁。
 */
export class OperationLock {
  private locked = false;
  private currentOp: string | null = null;

  /** 同步获取锁。成功返回 true，已被占用返回 false。 */
  acquire(name: string): boolean {
    if (this.locked) return false;
    this.locked = true;
    this.currentOp = name;
    return true;
  }

  /** 释放锁 */
  release(): void {
    this.locked = false;
    this.currentOp = null;
  }

  /** 查询是否被占用 */
  isLocked(): boolean {
    return this.locked;
  }

  /** 当前占用的操作名称，未锁定时返回 null */
  getCurrentOp(): string | null {
    return this.currentOp;
  }
}
