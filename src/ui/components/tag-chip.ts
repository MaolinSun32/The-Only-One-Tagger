import type { App } from 'obsidian';
import type { StagingTagItem, FacetDefinition, BadgeType } from '../../types';
import { CandidateList } from './candidate-list';

export interface TagChipCallbacks {
  onAccept: (tagLabel: string) => Promise<void>;
  onDelete: (tagLabel: string) => Promise<void>;
  onEdit: (oldTag: string, newTag: string) => Promise<void>;
  onRegenerate: (tag: string) => Promise<string[]>;
  onConfirmRegenerate: (oldTag: string, selectedCandidate: string, allCandidates: string[]) => Promise<void>;
}

/**
 * 标签芯片组件。
 * 根据 value_type 渲染 5 种不同形态：
 * - taxonomy: badge 圆点 + label + ✓✗✎↻
 * - enum: 下拉选择器 + ✓✗
 * - wikilink: [[]] 输入框 + ✓✗
 * - free-text: 文本输入框 + ✓✗
 * - date: 日期输入 + ✓✗
 */
export class TagChip {
  private containerEl: HTMLElement;
  private candidateList: CandidateList | null = null;
  private editing = false;

  constructor(
    parentEl: HTMLElement,
    private readonly item: StagingTagItem,
    private readonly facetDef: FacetDefinition,
    private readonly callbacks: TagChipCallbacks,
    private readonly app?: App,
  ) {
    const vt = facetDef.value_type;
    this.containerEl = parentEl.createDiv({
      cls: `toot-tag-chip toot-tag-chip--${vt} toot-tag-chip--${item.user_status}`,
    });

    switch (vt) {
      case 'taxonomy': this.buildTaxonomy(); break;
      case 'enum':     this.buildEnum(); break;
      case 'wikilink': this.buildWikilink(); break;
      case 'free-text': this.buildFreeText(); break;
      case 'date':     this.buildDate(); break;
    }
  }

  // ── Taxonomy ──────────────────────────────────────────

  private buildTaxonomy(): void {
    // Badge dot
    this.containerEl.createSpan({
      cls: `toot-badge toot-badge--${this.badgeCssClass(this.item.badge)}`,
    });

    // Label
    const labelEl = this.containerEl.createSpan({
      cls: 'toot-tag-label',
      text: this.item.label,
    });

    // "AI 未推荐" indicator
    if (this.item.ai_recommended === false) {
      this.containerEl.createSpan({
        cls: 'toot-tag-not-recommended',
        text: 'AI 未推荐',
      });
    }

    const isVerifying = this.item.badge === 'verifying';
    const isRegistry = this.item.badge === 'registry';

    // Action buttons
    const actions = this.containerEl.createDiv({ cls: 'toot-tag-actions' });

    // ✓ Accept
    const acceptBtn = actions.createEl('button', {
      cls: 'toot-tag-btn toot-tag-btn--accept',
      attr: { 'aria-label': '接受' },
    });
    if (isVerifying) acceptBtn.disabled = true;
    acceptBtn.setText('✓');
    if (!isVerifying) {
      acceptBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onAccept(this.item.label);
      });
    }

    // ✗ Delete
    const deleteBtn = actions.createEl('button', {
      cls: 'toot-tag-btn toot-tag-btn--delete',
      attr: { 'aria-label': '删除' },
    });
    if (isVerifying) deleteBtn.disabled = true;
    deleteBtn.setText('✗');
    if (!isVerifying) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onDelete(this.item.label);
      });
    }

    // ✎ Edit + ↻ Regenerate — only for non-registry, non-verifying taxonomy
    if (!isRegistry && !isVerifying) {
      const editBtn = actions.createEl('button', {
        cls: 'toot-tag-btn toot-tag-btn--edit',
        attr: { 'aria-label': '编辑' },
      });
      editBtn.setText('✎');
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.enterEditMode(labelEl);
      });

      const regenBtn = actions.createEl('button', {
        cls: 'toot-tag-btn toot-tag-btn--regenerate',
        attr: { 'aria-label': '重新生成' },
      });
      regenBtn.setText('↻');
      regenBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openCandidateList(regenBtn);
      });
    }
  }

  private enterEditMode(labelEl: HTMLElement): void {
    if (this.editing) return;
    this.editing = true;
    this.containerEl.addClass('toot-tag-chip--editing');

    const currentText = this.item.label;
    const input = createEl('input', {
      cls: 'toot-tag-edit-input',
      attr: { type: 'text', value: currentText },
    });

    labelEl.replaceWith(input);
    input.focus();
    input.select();

    const commit = () => {
      const newVal = input.value.trim();
      if (newVal && newVal !== currentText) {
        this.callbacks.onEdit(currentText, newVal);
      }
      cleanup();
    };

    const cleanup = () => {
      this.editing = false;
      this.containerEl.removeClass('toot-tag-chip--editing');
      const newLabel = this.containerEl.createSpan({
        cls: 'toot-tag-label',
        text: input.value.trim() || currentText,
      });
      input.replaceWith(newLabel);
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); cleanup(); }
    });
    input.addEventListener('blur', commit);
  }

  private openCandidateList(anchorEl: HTMLElement): void {
    if (this.candidateList) {
      this.candidateList.destroy();
      this.candidateList = null;
      return;
    }

    this.candidateList = new CandidateList(
      anchorEl,
      (candidate) => {
        const all = this.candidateList?.getAllCandidates() ?? [];
        this.callbacks.onConfirmRegenerate(this.item.label, candidate, all);
        this.candidateList = null;
      },
      () => { this.candidateList = null; },
    );

    this.candidateList.showLoading();
    this.callbacks.onRegenerate(this.item.label).then((candidates) => {
      this.candidateList?.appendCandidates(candidates);
    }).catch(() => {
      this.candidateList?.destroy();
      this.candidateList = null;
    });
  }

  // ── Enum ──────────────────────────────────────────

  private buildEnum(): void {
    const select = this.containerEl.createEl('select', { cls: 'toot-tag-enum-select' });
    const values = this.facetDef.values ?? [];
    for (const v of values) {
      const opt = select.createEl('option', { text: v, attr: { value: v } });
      if (v === this.item.label) opt.selected = true;
    }

    select.addEventListener('change', () => {
      if (select.value !== this.item.label) {
        this.callbacks.onEdit(this.item.label, select.value);
      }
    });

    this.buildAcceptDeleteButtons();
  }

  // ── Wikilink ──────────────────────────────────────────

  private buildWikilink(): void {
    const wrapper = this.containerEl.createDiv({ cls: 'toot-tag-wikilink-wrapper' });
    wrapper.createSpan({ text: '[[', cls: 'toot-tag-wikilink-bracket' });

    const input = wrapper.createEl('input', {
      cls: 'toot-tag-wikilink-input',
      attr: { type: 'text', value: this.item.label },
    });

    wrapper.createSpan({ text: ']]', cls: 'toot-tag-wikilink-bracket' });

    // Vault autocomplete via suggest
    if (this.app) {
      this.setupWikilinkAutocomplete(input);
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const newVal = input.value.trim();
        if (newVal && newVal !== this.item.label) {
          this.callbacks.onEdit(this.item.label, newVal);
        }
      }
    });

    this.buildAcceptDeleteButtons();
  }

  private setupWikilinkAutocomplete(input: HTMLInputElement): void {
    if (!this.app) return;
    const app = this.app;

    let suggestEl: HTMLElement | null = null;

    const showSuggestions = () => {
      const query = input.value.trim().toLowerCase();
      if (!query) { hideSuggestions(); return; }

      const files = app.vault.getMarkdownFiles()
        .filter(f => f.basename.toLowerCase().includes(query))
        .slice(0, 10);

      if (files.length === 0) { hideSuggestions(); return; }

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
          hideSuggestions();
          if (file.basename !== this.item.label) {
            this.callbacks.onEdit(this.item.label, file.basename);
          }
        });
      }
    };

    const hideSuggestions = () => {
      suggestEl?.remove();
      suggestEl = null;
    };

    input.addEventListener('input', showSuggestions);
    input.addEventListener('blur', () => setTimeout(hideSuggestions, 200));
  }

  // ── Free-text ──────────────────────────────────────────

  private buildFreeText(): void {
    const input = this.containerEl.createEl('input', {
      cls: 'toot-tag-freetext-input',
      attr: { type: 'text', value: this.item.label },
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const newVal = input.value.trim();
        if (newVal && newVal !== this.item.label) {
          this.callbacks.onEdit(this.item.label, newVal);
        }
      }
    });

    this.buildAcceptDeleteButtons();
  }

  // ── Date ──────────────────────────────────────────

  private buildDate(): void {
    const input = this.containerEl.createEl('input', {
      cls: 'toot-tag-date-input',
      attr: { type: 'date', value: this.item.label },
    });

    input.addEventListener('change', () => {
      const newVal = input.value;
      if (newVal && newVal !== this.item.label) {
        this.callbacks.onEdit(this.item.label, newVal);
      }
    });

    this.buildAcceptDeleteButtons();
  }

  // ── Shared helpers ──────────────────────────────────────────

  private buildAcceptDeleteButtons(): void {
    const actions = this.containerEl.createDiv({ cls: 'toot-tag-actions' });

    const acceptBtn = actions.createEl('button', {
      cls: 'toot-tag-btn toot-tag-btn--accept',
      attr: { 'aria-label': '接受' },
    });
    acceptBtn.setText('✓');
    acceptBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onAccept(this.item.label);
    });

    const deleteBtn = actions.createEl('button', {
      cls: 'toot-tag-btn toot-tag-btn--delete',
      attr: { 'aria-label': '删除' },
    });
    deleteBtn.setText('✗');
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onDelete(this.item.label);
    });
  }

  private badgeCssClass(badge: BadgeType): string {
    return badge.replace(/_/g, '-');
  }

  /** 更新 badge 圆点（验证完成后精准更新，无需全量重渲染） */
  updateBadge(newBadge: BadgeType): void {
    const dot = this.containerEl.querySelector('.toot-badge');
    if (dot) {
      dot.className = `toot-badge toot-badge--${this.badgeCssClass(newBadge)}`;
    }
  }

  /** 更新 user_status 样式 */
  updateStatus(newStatus: string): void {
    this.containerEl.removeClass(
      'toot-tag-chip--pending', 'toot-tag-chip--accepted', 'toot-tag-chip--deleted',
    );
    this.containerEl.addClass(`toot-tag-chip--${newStatus}`);
  }

  destroy(): void {
    this.candidateList?.destroy();
    this.containerEl.remove();
  }
}
