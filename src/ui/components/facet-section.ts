import type { App } from 'obsidian';
import type { StagingTagItem, FacetDefinition, BadgeType } from '../../types';
import { TagChip, type TagChipCallbacks } from './tag-chip';

export interface FacetSectionCallbacks {
  onAcceptTag: (facet: string, tagLabel: string) => Promise<void>;
  onDeleteTag: (facet: string, tagLabel: string) => Promise<void>;
  onEditTag: (facet: string, oldTag: string, newTag: string) => Promise<void>;
  onRegenerateTag: (facet: string, tag: string) => Promise<string[]>;
  onConfirmRegenerate: (facet: string, oldTag: string, selectedCandidate: string, allCandidates: string[]) => Promise<void>;
  onAddTag: (facet: string, value: string) => Promise<void>;
}

/**
 * Facet 区块：标题 + TagChip 列表 + 添加按钮。
 * 渲染结构按 value_type 自动适配。
 */
export class FacetSection {
  private containerEl: HTMLElement;
  private tagsEl!: HTMLElement;
  private chips: TagChip[] = [];

  constructor(
    parentEl: HTMLElement,
    private readonly facetName: string,
    private readonly facetDef: FacetDefinition,
    private readonly items: StagingTagItem[],
    private readonly isRequired: boolean,
    private readonly callbacks: FacetSectionCallbacks,
    private readonly app?: App,
  ) {
    this.containerEl = parentEl.createDiv({ cls: 'toot-facet-section' });
    this.build();
  }

  private build(): void {
    // Header
    const header = this.containerEl.createDiv({ cls: 'toot-facet-header' });
    header.createSpan({ cls: 'toot-facet-name', text: this.facetName });
    header.createSpan({
      cls: 'toot-facet-type-badge',
      text: this.facetDef.value_type,
    });
    if (this.isRequired) {
      header.createSpan({ cls: 'toot-facet-required', text: '必填' });
    }
    if (this.facetDef.description) {
      header.createSpan({ cls: 'toot-facet-desc', text: this.facetDef.description });
    }

    // Tags container
    this.tagsEl = this.containerEl.createDiv({ cls: 'toot-facet-tags' });
    this.renderChips();

    // Add button
    const addBtn = this.containerEl.createEl('button', {
      cls: 'toot-facet-add-btn',
      text: '+ 添加',
    });
    addBtn.addEventListener('click', () => this.openAddUI());
  }

  private renderChips(): void {
    for (const chip of this.chips) chip.destroy();
    this.chips = [];
    this.tagsEl.empty();

    for (const item of this.items) {
      const chipCallbacks: TagChipCallbacks = {
        onAccept: (tag) => this.callbacks.onAcceptTag(this.facetName, tag),
        onDelete: (tag) => this.callbacks.onDeleteTag(this.facetName, tag),
        onEdit: (old, nw) => this.callbacks.onEditTag(this.facetName, old, nw),
        onRegenerate: (tag) => this.callbacks.onRegenerateTag(this.facetName, tag),
        onConfirmRegenerate: (old, sel, all) => this.callbacks.onConfirmRegenerate(this.facetName, old, sel, all),
      };
      this.chips.push(new TagChip(this.tagsEl, item, this.facetDef, chipCallbacks, this.app));
    }
  }

  private openAddUI(): void {
    const vt = this.facetDef.value_type;

    // Remove any existing add UI
    this.containerEl.querySelector('.toot-facet-add-ui')?.remove();

    const addUI = this.containerEl.createDiv({ cls: 'toot-facet-add-ui' });

    if (vt === 'enum') {
      this.buildEnumAdd(addUI);
    } else if (vt === 'date') {
      this.buildDateAdd(addUI);
    } else if (vt === 'wikilink') {
      this.buildTextAdd(addUI, '输入 wikilink 目标…');
    } else {
      // taxonomy / free-text
      this.buildTextAdd(addUI, vt === 'taxonomy' ? '输入标签…' : '输入文本…');
    }
  }

  private buildTextAdd(container: HTMLElement, placeholder: string): void {
    const input = container.createEl('input', {
      cls: 'toot-facet-add-input',
      attr: { type: 'text', placeholder },
    });
    input.focus();

    const commit = () => {
      const val = input.value.trim();
      if (val) {
        this.callbacks.onAddTag(this.facetName, val);
      }
      container.remove();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); container.remove(); }
    });
    input.addEventListener('blur', () => setTimeout(() => container.remove(), 200));

    // Wikilink autocomplete
    if (this.facetDef.value_type === 'wikilink' && this.app) {
      this.setupWikilinkSuggest(input, container);
    }
  }

  private buildEnumAdd(container: HTMLElement): void {
    const values = this.facetDef.values ?? [];
    const existingLabels = new Set(this.items.map(i => i.label));
    const available = values.filter(v => !existingLabels.has(v));

    if (available.length === 0) {
      container.createSpan({ text: '所有选项已添加', cls: 'toot-facet-add-empty' });
      setTimeout(() => container.remove(), 1500);
      return;
    }

    const select = container.createEl('select', { cls: 'toot-facet-add-select' });
    select.createEl('option', { text: '选择…', attr: { value: '' } });
    for (const v of available) {
      select.createEl('option', { text: v, attr: { value: v } });
    }
    select.focus();

    select.addEventListener('change', () => {
      if (select.value) {
        this.callbacks.onAddTag(this.facetName, select.value);
      }
      container.remove();
    });
    select.addEventListener('blur', () => setTimeout(() => container.remove(), 200));
  }

  private buildDateAdd(container: HTMLElement): void {
    const input = container.createEl('input', {
      cls: 'toot-facet-add-input',
      attr: { type: 'date' },
    });
    input.focus();

    input.addEventListener('change', () => {
      if (input.value) {
        this.callbacks.onAddTag(this.facetName, input.value);
      }
      container.remove();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); container.remove(); }
    });
  }

  private setupWikilinkSuggest(input: HTMLInputElement, _container: HTMLElement): void {
    if (!this.app) return;
    const app = this.app;

    let suggestEl: HTMLElement | null = null;

    input.addEventListener('input', () => {
      const query = input.value.trim().toLowerCase();
      if (!query) { suggestEl?.remove(); suggestEl = null; return; }

      const files = app.vault.getMarkdownFiles()
        .filter(f => f.basename.toLowerCase().includes(query))
        .slice(0, 10);

      if (files.length === 0) { suggestEl?.remove(); suggestEl = null; return; }

      if (!suggestEl) {
        suggestEl = createDiv({ cls: 'toot-wikilink-suggest' });
        input.parentElement?.appendChild(suggestEl);
      }
      suggestEl.empty();

      for (const file of files) {
        const item = suggestEl.createDiv({ cls: 'toot-wikilink-suggest-item', text: file.basename });
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          input.value = file.basename;
          suggestEl?.remove();
          suggestEl = null;
        });
      }
    });
  }

  /** 精准更新某个标签的 badge */
  updateTagBadge(tagLabel: string, newBadge: BadgeType): void {
    const idx = this.items.findIndex(i => i.label === tagLabel);
    if (idx >= 0 && this.chips[idx]) {
      this.chips[idx].updateBadge(newBadge);
    }
  }

  destroy(): void {
    for (const chip of this.chips) chip.destroy();
    this.containerEl.remove();
  }
}
