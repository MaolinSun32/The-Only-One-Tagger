import { Notice } from 'obsidian';
import type { RegistryStore } from '../storage/registry-store';
import type { TagMerger } from '../management/tag-merger';
import type { TagEntry, MergeOptions } from '../types';

/**
 * 单标签属性编辑面板。
 * 在 TagBrowserModal 内嵌使用，渲染到指定容器中。
 * 每次修改后立即通过 registryStore.update() 持久化。
 */
export class TagPropertyEditor {
  constructor(
    private containerEl: HTMLElement,
    private registryStore: RegistryStore,
    private tagMerger: TagMerger,
  ) {}

  /** 渲染指定标签的编辑面板 */
  async render(tagLabel: string): Promise<void> {
    const tag = await this.registryStore.getTag(tagLabel);
    if (!tag) {
      this.containerEl.empty();
      this.containerEl.createEl('p', { text: `标签 "${tagLabel}" 不存在` });
      return;
    }

    this.containerEl.empty();
    this.containerEl.addClass('toot-tag-property-panel');

    // 标题
    const header = this.containerEl.createDiv({ cls: 'toot-tag-property-header' });
    header.createEl('h3', { text: `标签详情: ${tag.label}` });

    // 状态 + flagged
    const statusRow = this.containerEl.createDiv({ cls: 'toot-tag-property-row' });
    statusRow.createSpan({ text: `Status: ${tag.status}` });
    if (tag.flagged) {
      const flagBadge = statusRow.createSpan({ text: ' ⚠️ flagged', cls: 'toot-tag-property-flagged' });
      // 取消 flag 按钮
      const unflagBtn = flagBadge.createEl('button', { text: '确认保留', cls: 'toot-tag-property-btn-small' });
      unflagBtn.addEventListener('click', async () => {
        await this.registryStore.unflagTag(tag.label);
        new Notice(`已取消 ${tag.label} 的 flagged 标记`);
        await this.render(tagLabel);
      });
    }

    // Facets 编辑
    this.renderArrayField(tag, 'facets', 'Facets', tagLabel);

    // Aliases 编辑
    this.renderArrayField(tag, 'aliases', 'Aliases', tagLabel);

    // Relations 编辑
    this.renderRelations(tag, tagLabel);

    // 来源信息（只读）
    const sourceSection = this.containerEl.createDiv({ cls: 'toot-tag-property-section' });
    sourceSection.createEl('h4', { text: '来源信息' });
    sourceSection.createEl('p', { text: `验证来源: ${tag.source.verified_by}` });
    if (tag.source.url) {
      sourceSection.createEl('p', { text: `URL: ${tag.source.url}` });
    }
    sourceSection.createEl('p', { text: `验证时间: ${tag.source.verified_at}` });

    // 操作按钮
    const actionRow = this.containerEl.createDiv({ cls: 'toot-tag-property-actions' });

    const mergeBtn = actionRow.createEl('button', { text: '合并到其他标签', cls: 'toot-tag-property-btn' });
    mergeBtn.addEventListener('click', () => this.handleMerge(tag));

    const deleteBtn = actionRow.createEl('button', { text: '删除标签', cls: 'toot-tag-property-btn toot-tag-property-btn-danger' });
    deleteBtn.addEventListener('click', () => this.handleDelete(tag));
  }

  // ── 数组字段编辑 ──

  private renderArrayField(
    tag: TagEntry,
    field: 'facets' | 'aliases',
    label: string,
    tagLabel: string,
  ): void {
    const section = this.containerEl.createDiv({ cls: 'toot-tag-property-section' });
    section.createEl('h4', { text: label });

    const listEl = section.createDiv({ cls: 'toot-tag-property-pill-list' });
    const values: string[] = tag[field];

    for (const value of values) {
      const pill = listEl.createSpan({ text: value, cls: 'toot-tag-property-pill' });
      const removeBtn = pill.createSpan({ text: ' ×', cls: 'toot-tag-property-pill-remove' });
      removeBtn.addEventListener('click', async () => {
        await this.registryStore.update(data => {
          const t = data.tags[tagLabel];
          if (!t) return;
          const arr = t[field] as string[];
          const idx = arr.indexOf(value);
          if (idx !== -1) arr.splice(idx, 1);
          data.meta.last_updated = new Date().toISOString();
        });
        await this.render(tagLabel);
      });
    }

    // 添加按钮
    const addBtn = listEl.createEl('button', { text: '+ 添加', cls: 'toot-tag-property-btn-small' });
    addBtn.addEventListener('click', () => {
      const input = section.createEl('input', {
        type: 'text',
        cls: 'toot-tag-property-input',
        placeholder: `输入新 ${label.toLowerCase()}`,
      });
      input.focus();
      input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
          const val = input.value.trim();
          if (!val) return;
          await this.registryStore.update(data => {
            const t = data.tags[tagLabel];
            if (!t) return;
            const arr = t[field] as string[];
            if (!arr.includes(val)) {
              arr.push(val);
            }
            data.meta.last_updated = new Date().toISOString();
          });
          await this.render(tagLabel);
        } else if (e.key === 'Escape') {
          input.remove();
        }
      });
    });
  }

  // ── Relations 编辑 ──

  private renderRelations(tag: TagEntry, tagLabel: string): void {
    const section = this.containerEl.createDiv({ cls: 'toot-tag-property-section' });
    section.createEl('h4', { text: 'Relations' });

    for (const rel of ['broader', 'narrower', 'related'] as const) {
      const relDiv = section.createDiv({ cls: 'toot-tag-property-relation-group' });
      relDiv.createSpan({ text: `${rel}: `, cls: 'toot-tag-property-relation-label' });

      const listEl = relDiv.createSpan({ cls: 'toot-tag-property-pill-list-inline' });
      for (const relLabel of tag.relations[rel]) {
        const pill = listEl.createSpan({ text: relLabel, cls: 'toot-tag-property-pill' });
        const removeBtn = pill.createSpan({ text: ' ×', cls: 'toot-tag-property-pill-remove' });
        removeBtn.addEventListener('click', async () => {
          await this.registryStore.update(data => {
            const t = data.tags[tagLabel];
            if (!t) return;
            const arr = t.relations[rel];
            const idx = arr.indexOf(relLabel);
            if (idx !== -1) arr.splice(idx, 1);
            data.meta.last_updated = new Date().toISOString();
          });
          await this.render(tagLabel);
        });
      }

      // 添加按钮
      const addBtn = listEl.createEl('button', { text: '+ 添加', cls: 'toot-tag-property-btn-small' });
      addBtn.addEventListener('click', () => {
        const input = relDiv.createEl('input', {
          type: 'text',
          cls: 'toot-tag-property-input',
          placeholder: '输入标签名',
        });
        input.focus();
        input.addEventListener('keydown', async (e) => {
          if (e.key === 'Enter') {
            const val = input.value.trim();
            if (!val) return;
            // 验证标签存在
            const targetTag = await this.registryStore.getTag(val);
            if (!targetTag) {
              new Notice(`标签 "${val}" 不在 registry 中`);
              return;
            }
            await this.registryStore.update(data => {
              const t = data.tags[tagLabel];
              if (!t) return;
              if (!t.relations[rel].includes(val)) {
                t.relations[rel].push(val);
              }
              data.meta.last_updated = new Date().toISOString();
            });
            await this.render(tagLabel);
          } else if (e.key === 'Escape') {
            input.remove();
          }
        });
      });
    }
  }

  // ── 合并/删除操作 ──

  private async handleMerge(tag: TagEntry): Promise<void> {
    // 创建简单输入对话框
    const input = this.containerEl.createEl('input', {
      type: 'text',
      cls: 'toot-tag-property-input',
      placeholder: '输入目标标签名',
    });
    input.focus();

    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        const targetLabel = input.value.trim();
        if (!targetLabel) return;
        input.remove();

        const options: MergeOptions = { sourceTag: tag.label, targetTag: targetLabel };
        const dryResult = await this.tagMerger.dryRun(options);

        if (dryResult.totalAffected === 0) {
          new Notice('没有需要修改的笔记');
          return;
        }

        // 简单确认：直接执行（在完整 UI 中应有确认对话框）
        const confirmed = confirm(
          `将 "${tag.label}" 合并到 "${targetLabel}"，` +
          `影响 ${dryResult.totalAffected} 个笔记。是否继续？`,
        );
        if (!confirmed) return;

        const result = await this.tagMerger.merge(options);
        new Notice(`合并完成：${result.completed} 成功，${result.failed} 失败`);
        await this.render(targetLabel);
      } else if (e.key === 'Escape') {
        input.remove();
      }
    });
  }

  private async handleDelete(tag: TagEntry): Promise<void> {
    const options: MergeOptions = { sourceTag: tag.label, targetTag: null };
    const dryResult = await this.tagMerger.dryRun(options);

    const msg = dryResult.totalAffected > 0
      ? `将删除标签 "${tag.label}"，影响 ${dryResult.totalAffected} 个笔记。是否继续？`
      : `将删除标签 "${tag.label}"（无笔记受影响）。是否继续？`;

    const confirmed = confirm(msg);
    if (!confirmed) return;

    const result = await this.tagMerger.merge(options);
    new Notice(`删除完成：${result.completed} 成功，${result.failed} 失败`);

    // 清空编辑面板
    this.containerEl.empty();
    this.containerEl.createEl('p', { text: '标签已删除' });
  }
}
