import type { TypeSummary } from '../../types';

export interface TypeSelectorCallbacks {
  onChangeType: (oldType: string, newType: string) => Promise<void>;
  onAddType: (newType: string) => Promise<void>;
  onDeleteType: (type: string) => Promise<void>;
}

/**
 * Type 选择器：下拉显示当前 type + 修改/增加/删除按钮。
 * 多 type 笔记为每个 type 显示独立行。
 * 无 type 笔记显示选择下拉供用户选择。
 */
export class TypeSelector {
  private containerEl: HTMLElement;

  constructor(
    parentEl: HTMLElement,
    private readonly currentTypes: string[],
    private readonly allTypes: TypeSummary[],
    private readonly callbacks: TypeSelectorCallbacks,
  ) {
    this.containerEl = parentEl.createDiv({ cls: 'toot-type-selector' });
    this.build();
  }

  private build(): void {
    if (this.currentTypes.length === 0) {
      this.buildNoTypeUI();
      return;
    }

    for (const typeName of this.currentTypes) {
      this.buildTypeRow(typeName);
    }

    // Add type button
    const addBtn = this.containerEl.createEl('button', {
      cls: 'toot-type-add-btn',
      text: '+ 增加 type',
    });
    addBtn.addEventListener('click', () => this.openAddTypeUI());
  }

  private buildTypeRow(typeName: string): void {
    const summary = this.allTypes.find(t => t.name === typeName);
    const row = this.containerEl.createDiv({ cls: 'toot-type-row' });

    row.createSpan({ cls: 'toot-type-label', text: `Type: ${summary?.label ?? typeName}` });

    const actions = row.createDiv({ cls: 'toot-type-actions' });

    // Change type
    const changeBtn = actions.createEl('button', {
      cls: 'toot-type-btn',
      text: '修改',
    });
    changeBtn.addEventListener('click', () => this.openChangeTypeUI(typeName, row));

    // Delete type
    const deleteBtn = actions.createEl('button', {
      cls: 'toot-type-btn toot-type-btn--danger',
      text: '× 删除',
    });
    deleteBtn.addEventListener('click', () => {
      if (confirm(`确认删除 type "${summary?.label ?? typeName}"？`)) {
        this.callbacks.onDeleteType(typeName);
      }
    });
  }

  private buildNoTypeUI(): void {
    const row = this.containerEl.createDiv({ cls: 'toot-type-row toot-type-row--empty' });
    row.createSpan({ text: '未指定 Type，请选择：', cls: 'toot-type-empty-hint' });

    const select = row.createEl('select', { cls: 'toot-type-select' });
    select.createEl('option', { text: '选择 type…', attr: { value: '' } });

    for (const t of this.allTypes) {
      select.createEl('option', { text: `${t.label} (${t.name})`, attr: { value: t.name } });
    }

    select.addEventListener('change', () => {
      if (select.value) {
        this.callbacks.onAddType(select.value);
      }
    });
  }

  private openChangeTypeUI(currentType: string, row: HTMLElement): void {
    // Remove any existing change UI
    row.querySelector('.toot-type-change-ui')?.remove();

    const ui = row.createDiv({ cls: 'toot-type-change-ui' });
    const select = ui.createEl('select', { cls: 'toot-type-select' });
    select.createEl('option', { text: '选择新 type…', attr: { value: '' } });

    for (const t of this.allTypes) {
      if (t.name === currentType) continue;
      if (this.currentTypes.includes(t.name)) continue;
      select.createEl('option', { text: `${t.label} (${t.name})`, attr: { value: t.name } });
    }

    select.focus();
    select.addEventListener('change', () => {
      if (select.value) {
        this.callbacks.onChangeType(currentType, select.value);
      }
      ui.remove();
    });
    select.addEventListener('blur', () => setTimeout(() => ui.remove(), 200));
  }

  private openAddTypeUI(): void {
    this.containerEl.querySelector('.toot-type-add-ui')?.remove();

    const ui = this.containerEl.createDiv({ cls: 'toot-type-add-ui' });
    const select = ui.createEl('select', { cls: 'toot-type-select' });
    select.createEl('option', { text: '选择要添加的 type…', attr: { value: '' } });

    for (const t of this.allTypes) {
      if (this.currentTypes.includes(t.name)) continue;
      select.createEl('option', { text: `${t.label} (${t.name})`, attr: { value: t.name } });
    }

    select.focus();
    select.addEventListener('change', () => {
      if (select.value) {
        this.callbacks.onAddType(select.value);
      }
      ui.remove();
    });
    select.addEventListener('blur', () => setTimeout(() => ui.remove(), 200));
  }

  destroy(): void {
    this.containerEl.remove();
  }
}
