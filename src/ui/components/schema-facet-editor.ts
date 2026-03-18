import type { FacetDefinition } from '../../types';

export interface SchemaFacetEditorCallbacks {
  onSave: (facetName: string, updated: Partial<FacetDefinition>) => Promise<void>;
  onRename: (oldName: string, newName: string) => Promise<void>;
  onDeleteEnumValue: (facetName: string, value: string) => Promise<void>;
  onAddEnumValue: (facetName: string, value: string) => Promise<void>;
}

/**
 * Facet 属性编辑面板（Tab B 右侧详情）。
 * description / value_type(只读) / allow_multiple / verification_required
 * + enum 时的 values 列表编辑器。
 */
export class SchemaFacetEditor {
  private containerEl: HTMLElement;

  constructor(
    parentEl: HTMLElement,
    private facetName: string,
    private facetDef: FacetDefinition,
    private readonly callbacks: SchemaFacetEditorCallbacks,
  ) {
    this.containerEl = parentEl.createDiv({ cls: 'toot-schema-facet-editor' });
    this.build();
  }

  /** 切换到编辑另一个 facet */
  switchTo(facetName: string, facetDef: FacetDefinition): void {
    this.facetName = facetName;
    this.facetDef = facetDef;
    this.containerEl.empty();
    this.build();
  }

  private build(): void {
    // Title
    this.containerEl.createDiv({
      cls: 'toot-schema-facet-title',
      text: `编辑 facet: ${this.facetName}`,
    });

    // Facet name (rename)
    const nameRow = this.createField('名称');
    const nameInput = nameRow.createEl('input', {
      cls: 'toot-schema-input',
      attr: { type: 'text', value: this.facetName },
    });
    const renameBtn = nameRow.createEl('button', { cls: 'toot-schema-btn', text: '重命名' });
    renameBtn.addEventListener('click', () => {
      const newName = nameInput.value.trim();
      if (newName && newName !== this.facetName) {
        this.callbacks.onRename(this.facetName, newName);
      }
    });

    // Description
    const descRow = this.createField('描述');
    const descInput = descRow.createEl('textarea', {
      cls: 'toot-schema-textarea',
      text: this.facetDef.description,
    });

    // Value type (read-only)
    const vtRow = this.createField('值类型');
    vtRow.createSpan({
      cls: 'toot-schema-readonly',
      text: `${this.facetDef.value_type}（不可修改，需直接编辑 JSON）`,
    });

    // Allow multiple
    const multiRow = this.createField('允许多值');
    const multiCheck = multiRow.createEl('input', {
      attr: { type: 'checkbox' },
    }) as HTMLInputElement;
    multiCheck.checked = this.facetDef.allow_multiple;

    // Verification required
    const verifyRow = this.createField('需要验证');
    const verifyCheck = verifyRow.createEl('input', {
      attr: { type: 'checkbox' },
    }) as HTMLInputElement;
    verifyCheck.checked = this.facetDef.verification_required;

    // Enum values editor
    if (this.facetDef.value_type === 'enum') {
      this.buildEnumValuesEditor();
    }

    // Save button
    const saveBtn = this.containerEl.createEl('button', {
      cls: 'toot-schema-save-btn',
      text: '保存',
    });
    saveBtn.addEventListener('click', () => {
      this.callbacks.onSave(this.facetName, {
        description: descInput.value.trim(),
        allow_multiple: multiCheck.checked,
        verification_required: verifyCheck.checked,
      });
    });
  }

  private buildEnumValuesEditor(): void {
    const section = this.containerEl.createDiv({ cls: 'toot-schema-enum-section' });
    section.createDiv({ cls: 'toot-schema-field-label', text: '枚举值列表' });

    const values = this.facetDef.values ?? [];
    const listEl = section.createDiv({ cls: 'toot-schema-enum-list' });

    for (const value of values) {
      const row = listEl.createDiv({ cls: 'toot-schema-enum-row' });
      row.createSpan({ text: value });
      const delBtn = row.createEl('button', { cls: 'toot-schema-btn toot-schema-btn--danger', text: '×' });
      delBtn.addEventListener('click', () => {
        this.callbacks.onDeleteEnumValue(this.facetName, value);
      });
    }

    // Add value
    const addRow = section.createDiv({ cls: 'toot-schema-enum-add' });
    const addInput = addRow.createEl('input', {
      cls: 'toot-schema-input',
      attr: { type: 'text', placeholder: '新枚举值…' },
    });
    const addBtn = addRow.createEl('button', { cls: 'toot-schema-btn', text: '+ 添加' });
    addBtn.addEventListener('click', () => {
      const val = addInput.value.trim();
      if (val) {
        this.callbacks.onAddEnumValue(this.facetName, val);
        addInput.value = '';
      }
    });
    addInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addBtn.click();
      }
    });
  }

  private createField(label: string): HTMLElement {
    const row = this.containerEl.createDiv({ cls: 'toot-schema-field' });
    row.createDiv({ cls: 'toot-schema-field-label', text: label });
    return row;
  }

  destroy(): void {
    this.containerEl.remove();
  }
}
