import { ItemView, type WorkspaceLeaf, type TFile } from 'obsidian';
import { TOOT_VIEW_TYPE } from '../constants';
import type TheOnlyOneTagger from '../main';
import type { BatchState, StagingNote } from '../types';
import { ManualModeRenderer } from './manual-mode-renderer';
import { AIModeRenderer } from './ai-mode-renderer';
import { SchemaEditorRenderer } from './schema-editor-renderer';

type ActiveTab = 'review' | 'schema';

interface Renderer {
  destroy(): void;
}

/**
 * 右侧边栏主视图。
 * - Tab A「标签审核」：根据状态委托给 ManualModeRenderer / AIModeRenderer / 等待态
 * - Tab B「标签模式」：SchemaEditorRenderer
 * - 监听 active-leaf-change 自动刷新
 * - 缓存批量状态避免频繁磁盘读取
 */
export class TagReviewView extends ItemView {
  private plugin: TheOnlyOneTagger;
  private activeTab: ActiveTab = 'review';
  private currentNotePath: string | null = null;
  private currentFile: TFile | null = null;
  private currentRenderer: Renderer | null = null;

  // Tab elements
  private tabBarEl!: HTMLElement;
  private contentEl_!: HTMLElement;

  // Batch state cache
  private cachedBatchState: BatchState | null = null;

  // Event handler refs for cleanup
  private stagingChangeHandler: (() => void) | null = null;
  private batchChangeHandler: (() => void) | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: TheOnlyOneTagger) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return TOOT_VIEW_TYPE; }
  getDisplayText(): string { return '标签审核'; }
  getIcon(): string { return 'tags'; }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('toot-view');

    // Tab bar
    this.tabBarEl = container.createDiv({ cls: 'toot-tab-bar' });
    this.buildTabBar();

    // Content area
    this.contentEl_ = container.createDiv({ cls: 'toot-content' });

    // Cache batch state
    await this.refreshBatchCache();

    // Subscribe to batch state changes
    this.batchChangeHandler = () => this.refreshBatchCache();
    this.plugin.batchStateStore.on('change', this.batchChangeHandler);

    // Subscribe to staging changes (debounced refresh for review tab)
    this.stagingChangeHandler = () => {
      if (this.activeTab !== 'review') return;
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => this.refreshReviewTab(), 300);
    };
    this.plugin.stagingStore.on('change', this.stagingChangeHandler);

    // Listen to active leaf changes
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        if (this.activeTab !== 'review') return;
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') {
          if (this.currentNotePath) {
            this.currentNotePath = null;
            this.currentFile = null;
            this.showNoFile();
          }
          return;
        }
        if (file.path === this.currentNotePath) return;
        this.currentNotePath = file.path;
        this.currentFile = file;
        this.refreshReviewTab();
      }),
    );

    // Initial render
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile && activeFile.extension === 'md') {
      this.currentNotePath = activeFile.path;
      this.currentFile = activeFile;
    }
    this.renderActiveTab();
  }

  async onClose(): Promise<void> {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);

    this.currentRenderer?.destroy();
    this.currentRenderer = null;

    if (this.stagingChangeHandler) {
      this.plugin.stagingStore.off('change', this.stagingChangeHandler);
    }
    if (this.batchChangeHandler) {
      this.plugin.batchStateStore.off('change', this.batchChangeHandler);
    }
  }

  // ── Tab bar ──

  private buildTabBar(): void {
    this.tabBarEl.empty();

    const reviewTab = this.tabBarEl.createEl('button', {
      cls: `toot-tab-btn ${this.activeTab === 'review' ? 'toot-tab-btn--active' : ''}`,
      text: '📋 标签审核',
    });
    reviewTab.addEventListener('click', () => this.switchTab('review'));

    const schemaTab = this.tabBarEl.createEl('button', {
      cls: `toot-tab-btn ${this.activeTab === 'schema' ? 'toot-tab-btn--active' : ''}`,
      text: '⚙️ 标签模式',
    });
    schemaTab.addEventListener('click', () => this.switchTab('schema'));
  }

  private switchTab(tab: ActiveTab): void {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    this.buildTabBar();
    this.renderActiveTab();
  }

  // ── Rendering ──

  private renderActiveTab(): void {
    this.currentRenderer?.destroy();
    this.currentRenderer = null;
    this.contentEl_.empty();

    if (this.activeTab === 'schema') {
      this.currentRenderer = new SchemaEditorRenderer(this.contentEl_, this.plugin);
    } else {
      this.refreshReviewTab();
    }
  }

  private async refreshReviewTab(): Promise<void> {
    if (this.activeTab !== 'review') return;

    this.currentRenderer?.destroy();
    this.currentRenderer = null;
    this.contentEl_.empty();

    if (!this.currentNotePath || !this.currentFile) {
      this.showNoFile();
      return;
    }

    // Check batch queue
    if (this.isInBatchQueue(this.currentNotePath)) {
      this.showBatchWaiting();
      return;
    }

    // Check staging
    const staging = await this.plugin.stagingStore.getNoteStaging(this.currentNotePath);

    if (staging && Object.keys(staging.types).length > 0) {
      this.currentRenderer = new AIModeRenderer(
        this.contentEl_, this.plugin, this.currentNotePath, this.currentFile, staging,
      );
    } else {
      this.currentRenderer = new ManualModeRenderer(
        this.contentEl_, this.plugin, this.currentNotePath, this.currentFile,
      );
    }
  }

  private showNoFile(): void {
    this.contentEl_.empty();
    this.contentEl_.createDiv({
      cls: 'toot-empty-state',
      text: '请打开一个 Markdown 文件以查看标签',
    });
  }

  private showBatchWaiting(): void {
    this.contentEl_.empty();
    const waiting = this.contentEl_.createDiv({ cls: 'toot-batch-waiting' });
    waiting.setText('⏳ 此笔记在批量处理队列中，处理完成后可审核');
  }

  // ── Batch state cache ──

  private async refreshBatchCache(): Promise<void> {
    try {
      this.cachedBatchState = await this.plugin.batchStateStore.load();
    } catch {
      this.cachedBatchState = null;
    }
  }

  /**
   * 检查笔记是否在批量处理队列中（未处理）。
   * 使用缓存的 batch state，避免每次切换笔记都磁盘读取。
   */
  private isInBatchQueue(notePath: string): boolean {
    if (!this.cachedBatchState) return false;
    if (this.cachedBatchState.status !== 'running') return false;
    // In queue = batch is running AND file not yet processed
    return !this.cachedBatchState.processed_files.includes(notePath);
  }

  destroy(): void {
    // Called by ItemView lifecycle
  }
}
