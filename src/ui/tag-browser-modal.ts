import { App, Modal, Notice } from 'obsidian';
import type { RegistryStore } from '../storage/registry-store';
import type { TagMerger } from '../management/tag-merger';
import type { ImportExportManager } from '../management/import-export-manager';
import type { StatisticsPanel } from './statistics-panel';
import type { RelationDiscoverer } from '../management/relation-discoverer';
import type { TagEntry, MergeOptions, ImportStrategy } from '../types';
import { TagPropertyEditor } from './tag-property-editor';

const PAGE_SIZE = 20;

/**
 * 标签库浏览器主界面。
 * 提供搜索、过滤（按 facet / status / flagged）、分页浏览、标签属性编辑、
 * 合并/删除标签、导入导出、统计面板、关系自动发现。
 */
export class TagBrowserModal extends Modal {
  private searchQuery = '';
  private facetFilter = '';
  private statusFilter: 'all' | 'verified' | 'rejected' = 'all';
  private flaggedOnly = false;
  private currentPage = 0;
  private filteredTags: TagEntry[] = [];
  private allTags: TagEntry[] = [];
  private usageMap: Map<string, number> = new Map();
  private detailContainer: HTMLElement | null = null;
  private listContainer: HTMLElement | null = null;
  private paginationEl: HTMLElement | null = null;
  private tagEditor: TagPropertyEditor | null = null;

  constructor(
    app: App,
    private registryStore: RegistryStore,
    private tagMerger: TagMerger,
    private importExportManager: ImportExportManager,
    private statisticsPanel: StatisticsPanel,
    private relationDiscoverer: RelationDiscoverer,
  ) {
    super(app);
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('toot-tag-browser-modal');

    // 加载数据
    await this.loadData();

    // 标题栏 + 工具按钮
    const headerRow = contentEl.createDiv({ cls: 'toot-tag-browser-header' });
    headerRow.createEl('h2', { text: '标签库浏览器' });

    const toolBtns = headerRow.createDiv({ cls: 'toot-tag-browser-tools' });
    const statsBtn = toolBtns.createEl('button', { text: '统计', cls: 'toot-tag-browser-btn' });
    statsBtn.addEventListener('click', () => this.showStatistics());

    const exportBtn = toolBtns.createEl('button', { text: '导出', cls: 'toot-tag-browser-btn' });
    exportBtn.addEventListener('click', () => this.handleExport());

    // 搜索栏
    const searchRow = contentEl.createDiv({ cls: 'toot-tag-browser-search' });
    const searchInput = searchRow.createEl('input', {
      type: 'text',
      cls: 'toot-tag-browser-search-input',
      placeholder: '搜索标签名或别名...',
    });
    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value.trim().toLowerCase();
      this.currentPage = 0;
      this.applyFilters();
      this.renderList();
    });

    // 过滤栏
    const filterRow = contentEl.createDiv({ cls: 'toot-tag-browser-filters' });

    // Facet 过滤
    const facetSelect = filterRow.createEl('select', { cls: 'toot-tag-browser-select' });
    facetSelect.createEl('option', { text: '全部 Facet', value: '' });
    const allFacets = this.getAllFacets();
    for (const facet of allFacets) {
      facetSelect.createEl('option', { text: facet, value: facet });
    }
    facetSelect.addEventListener('change', () => {
      this.facetFilter = facetSelect.value;
      this.currentPage = 0;
      this.applyFilters();
      this.renderList();
    });

    // Status 过滤
    const statusSelect = filterRow.createEl('select', { cls: 'toot-tag-browser-select' });
    statusSelect.createEl('option', { text: '全部状态', value: 'all' });
    statusSelect.createEl('option', { text: 'Verified', value: 'verified' });
    statusSelect.createEl('option', { text: 'Rejected', value: 'rejected' });
    statusSelect.addEventListener('change', () => {
      this.statusFilter = statusSelect.value as any;
      this.currentPage = 0;
      this.applyFilters();
      this.renderList();
    });

    // Flagged 过滤
    const flaggedLabel = filterRow.createEl('label', { cls: 'toot-tag-browser-checkbox-label' });
    const flaggedCheckbox = flaggedLabel.createEl('input', { type: 'checkbox' });
    flaggedLabel.appendText(' 仅待复核');
    flaggedCheckbox.addEventListener('change', () => {
      this.flaggedOnly = flaggedCheckbox.checked;
      this.currentPage = 0;
      this.applyFilters();
      this.renderList();
    });

    // 主内容区 — 列表 + 详情（左右布局）
    const mainContent = contentEl.createDiv({ cls: 'toot-tag-browser-main' });
    this.listContainer = mainContent.createDiv({ cls: 'toot-tag-browser-list' });
    this.detailContainer = mainContent.createDiv({ cls: 'toot-tag-browser-detail' });

    // 分页
    this.paginationEl = contentEl.createDiv({ cls: 'toot-tag-browser-pagination' });

    // 底部操作按钮
    const actionRow = contentEl.createDiv({ cls: 'toot-tag-browser-actions' });

    const mergeBtn = actionRow.createEl('button', { text: '合并标签', cls: 'toot-tag-browser-btn' });
    mergeBtn.addEventListener('click', () => this.handleMerge());

    const importBtn = actionRow.createEl('button', { text: '导入', cls: 'toot-tag-browser-btn' });
    importBtn.addEventListener('click', () => this.handleImport());

    const relBtn = actionRow.createEl('button', { text: '关系发现', cls: 'toot-tag-browser-btn' });
    relBtn.addEventListener('click', () => this.handleRelationDiscovery());

    // 初始渲染
    this.applyFilters();
    this.renderList();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  // ── 数据加载 ──

  private async loadData(): Promise<void> {
    const registry = await this.registryStore.load();
    this.allTags = Object.values(registry.tags);

    // 预计算使用频率（从统计面板获取）
    const stats = await this.statisticsPanel.compute();
    this.usageMap = new Map(stats.usageFrequency.map(f => [f.label, f.count]));
  }

  // ── 过滤 ──

  private getAllFacets(): string[] {
    const facets = new Set<string>();
    for (const tag of this.allTags) {
      for (const f of tag.facets) facets.add(f);
    }
    return Array.from(facets).sort();
  }

  private applyFilters(): void {
    let tags = this.allTags;

    // 搜索
    if (this.searchQuery) {
      tags = tags.filter(t =>
        t.label.toLowerCase().includes(this.searchQuery) ||
        t.aliases.some(a => a.toLowerCase().includes(this.searchQuery)),
      );
    }

    // Facet 过滤
    if (this.facetFilter) {
      tags = tags.filter(t => t.facets.includes(this.facetFilter));
    }

    // Status 过滤
    if (this.statusFilter !== 'all') {
      tags = tags.filter(t => t.status === this.statusFilter);
    }

    // Flagged 过滤
    if (this.flaggedOnly) {
      tags = tags.filter(t => t.flagged);
    }

    this.filteredTags = tags;
  }

  // ── 列表渲染 ──

  private renderList(): void {
    if (!this.listContainer || !this.paginationEl) return;
    this.listContainer.empty();

    const start = this.currentPage * PAGE_SIZE;
    const pageItems = this.filteredTags.slice(start, start + PAGE_SIZE);

    for (const tag of pageItems) {
      const row = this.listContainer.createDiv({ cls: 'toot-tag-browser-row' });

      // 状态图标
      let icon = '✓';
      if (tag.flagged) icon = '⚠️';
      else if (tag.status === 'rejected') icon = '✗';
      row.createSpan({ text: icon, cls: 'toot-tag-browser-icon' });

      // 标签名
      row.createSpan({ text: tag.label, cls: 'toot-tag-browser-label' });

      // Facets
      row.createSpan({
        text: tag.facets.join(', '),
        cls: 'toot-tag-browser-facets',
      });

      // 使用次数
      const count = this.usageMap.get(tag.label) ?? 0;
      row.createSpan({ text: `使用 ${count} 次`, cls: 'toot-tag-browser-usage' });

      // Rejected 标签显示指向
      if (tag.status === 'rejected' && tag.rejected_in_favor_of) {
        row.createSpan({
          text: `→ ${tag.rejected_in_favor_of}`,
          cls: 'toot-tag-browser-redirect',
        });
      }

      // 详情箭头
      const arrowBtn = row.createSpan({ text: '→', cls: 'toot-tag-browser-arrow' });
      arrowBtn.addEventListener('click', () => this.showDetail(tag.label));
    }

    // 空状态
    if (pageItems.length === 0) {
      this.listContainer.createEl('p', {
        text: '没有匹配的标签',
        cls: 'toot-tag-browser-empty',
      });
    }

    // 分页
    this.renderPagination();
  }

  private renderPagination(): void {
    if (!this.paginationEl) return;
    this.paginationEl.empty();

    const totalPages = Math.ceil(this.filteredTags.length / PAGE_SIZE);
    if (totalPages <= 1) return;

    const prevBtn = this.paginationEl.createEl('button', { text: '◀', cls: 'toot-tag-browser-page-btn' });
    prevBtn.disabled = this.currentPage === 0;
    prevBtn.addEventListener('click', () => {
      if (this.currentPage > 0) {
        this.currentPage--;
        this.renderList();
      }
    });

    this.paginationEl.createSpan({
      text: ` ${this.currentPage + 1} / ${totalPages} `,
    });

    const nextBtn = this.paginationEl.createEl('button', { text: '▶', cls: 'toot-tag-browser-page-btn' });
    nextBtn.disabled = this.currentPage >= totalPages - 1;
    nextBtn.addEventListener('click', () => {
      if (this.currentPage < totalPages - 1) {
        this.currentPage++;
        this.renderList();
      }
    });
  }

  // ── 详情面板 ──

  private showDetail(tagLabel: string): void {
    if (!this.detailContainer) return;
    this.tagEditor = new TagPropertyEditor(
      this.detailContainer,
      this.registryStore,
      this.tagMerger,
    );
    this.tagEditor.render(tagLabel);
  }

  // ── 操作处理 ──

  private showStatistics(): void {
    if (!this.detailContainer) return;
    this.statisticsPanel.render(this.detailContainer);
  }

  private async handleExport(): Promise<void> {
    try {
      const json = await this.importExportManager.exportJSON();
      // 创建下载 — 使用 Blob + URL
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'tag-registry-export.json';
      a.click();
      URL.revokeObjectURL(url);
      new Notice('Registry 导出成功');
    } catch (e: any) {
      new Notice(`导出失败: ${e?.message}`);
    }
  }

  private async handleImport(): Promise<void> {
    // 创建文件选择器
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;

      try {
        const jsonData = await file.text();

        // 检测冲突
        const conflicts = await this.importExportManager.detectConflicts(jsonData);

        let strategy: ImportStrategy = 'skip';
        if (conflicts.length > 0) {
          const choice = confirm(
            `发现 ${conflicts.length} 个冲突标签。\n` +
            `点击"确定"覆盖现有标签，点击"取消"跳过冲突标签。`,
          );
          strategy = choice ? 'overwrite' : 'skip';
        }

        const result = await this.importExportManager.import(jsonData, strategy);
        new Notice(`导入完成：${result.imported} 个导入，${result.skipped} 个跳过`);

        // 刷新数据
        await this.loadData();
        this.applyFilters();
        this.renderList();
      } catch (e: any) {
        new Notice(`导入失败: ${e?.message}`);
      }
    });
    input.click();
  }

  private async handleMerge(): Promise<void> {
    // 简单的两步输入
    const sourceTag = prompt('输入源标签（要被合并的）：');
    if (!sourceTag) return;

    const targetTag = prompt('输入目标标签（合并到）：');
    if (!targetTag) return;

    const options: MergeOptions = { sourceTag, targetTag };
    try {
      const dryResult = await this.tagMerger.dryRun(options);

      if (dryResult.totalAffected === 0) {
        new Notice('没有需要修改的笔记');
        return;
      }

      const confirmed = confirm(
        `将 "${sourceTag}" 合并到 "${targetTag}"，` +
        `影响 ${dryResult.totalAffected} 个笔记。是否继续？`,
      );
      if (!confirmed) return;

      const result = await this.tagMerger.merge(options);
      new Notice(`合并完成：${result.completed} 成功，${result.failed} 失败`);

      // 刷新
      await this.loadData();
      this.applyFilters();
      this.renderList();
    } catch (e: any) {
      new Notice(`合并失败: ${e?.message}`);
    }
  }

  private async handleRelationDiscovery(): Promise<void> {
    new Notice('正在发现标签关系，请稍候...');
    try {
      const diffs = await this.relationDiscoverer.discover();

      if (diffs.length === 0) {
        new Notice('所有标签已有完整关系，无需补全');
        return;
      }

      // 显示预览
      if (!this.detailContainer) return;
      this.detailContainer.empty();
      this.detailContainer.createEl('h3', { text: '关系发现结果' });

      for (const diff of diffs) {
        const div = this.detailContainer.createDiv({ cls: 'toot-tag-browser-relation-diff' });
        div.createEl('strong', { text: diff.label });
        const details: string[] = [];
        if (diff.added.broader.length > 0) details.push(`broader: ${diff.added.broader.join(', ')}`);
        if (diff.added.narrower.length > 0) details.push(`narrower: ${diff.added.narrower.join(', ')}`);
        if (diff.added.related.length > 0) details.push(`related: ${diff.added.related.join(', ')}`);
        div.createEl('p', { text: details.join(' | ') });
      }

      const applyBtn = this.detailContainer.createEl('button', {
        text: `应用全部（${diffs.length} 个标签）`,
        cls: 'toot-tag-browser-btn',
      });
      applyBtn.addEventListener('click', async () => {
        await this.relationDiscoverer.apply(diffs);
        new Notice(`已应用 ${diffs.length} 个标签的关系补全`);
        await this.loadData();
        this.applyFilters();
        this.renderList();
      });
    } catch (e: any) {
      new Notice(`关系发现失败: ${e?.message}`);
    }
  }
}
