import { Modal, Notice } from 'obsidian';
import type { App } from 'obsidian';
import type { OperationLock } from '../../operation-lock';

export interface SchemaSyncConfig {
  description: string;
  affectedFiles: string[];
  /** 执行 Staging + Registry + YAML 同步的完整流程 */
  onSync: () => Promise<void>;
  /** 仅修改 schema，不动 YAML/registry/staging */
  onSchemaOnly: () => Promise<void>;
}

/**
 * Schema 修改/删除同步确认弹窗。
 * 继承 Obsidian Modal。
 * 三按钮：[同步更新] [仅修改模式] [取消]
 */
export class SchemaSyncDialog extends Modal {
  constructor(
    app: App,
    private readonly config: SchemaSyncConfig,
    private readonly operationLock: OperationLock,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('toot-sync-dialog');

    // Title
    contentEl.createEl('h3', { text: '⚠️ Schema 修改将影响以下笔记：' });

    // Description
    contentEl.createDiv({ cls: 'toot-sync-desc', text: this.config.description });

    // Affected files list
    const listEl = contentEl.createDiv({ cls: 'toot-sync-file-list' });
    const filesToShow = this.config.affectedFiles.slice(0, 20);
    for (const file of filesToShow) {
      listEl.createDiv({ cls: 'toot-sync-file-item', text: `• ${file}` });
    }
    if (this.config.affectedFiles.length > 20) {
      listEl.createDiv({
        cls: 'toot-sync-file-more',
        text: `… 还有 ${this.config.affectedFiles.length - 20} 篇`,
      });
    }

    contentEl.createDiv({
      cls: 'toot-sync-count',
      text: `共 ${this.config.affectedFiles.length} 篇笔记受影响`,
    });

    // Buttons
    const btnRow = contentEl.createDiv({ cls: 'toot-sync-buttons' });

    const syncBtn = btnRow.createEl('button', {
      cls: 'mod-cta toot-sync-btn',
      text: '同步更新',
    });
    syncBtn.addEventListener('click', async () => {
      if (this.operationLock.isLocked()) {
        new Notice(`当前有 ${this.operationLock.getCurrentOp() ?? '操作'} 正在执行，请等待完成`);
        return;
      }
      syncBtn.disabled = true;
      syncBtn.setText('同步中…');
      try {
        await this.config.onSync();
        new Notice('Schema 同步完成');
      } catch (e) {
        // BulkYamlModifier stub 会抛异常，在 onSync 内部应已捕获
        console.error('[TOOT] Schema sync error', e);
      }
      this.close();
    });

    const schemaOnlyBtn = btnRow.createEl('button', {
      cls: 'toot-sync-btn',
      text: '仅修改模式',
    });
    schemaOnlyBtn.addEventListener('click', async () => {
      await this.config.onSchemaOnly();
      new Notice('仅修改了 Schema 定义');
      this.close();
    });

    const cancelBtn = btnRow.createEl('button', {
      cls: 'toot-sync-btn',
      text: '取消',
    });
    cancelBtn.addEventListener('click', () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
