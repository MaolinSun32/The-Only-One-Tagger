import type { Schema, NoteTypeSchema, FacetDefinition } from '../../types';

export interface SchemaTypeListCallbacks {
  onSelectFacet: (typeName: string, facetName: string) => void;
  onEditType: (typeName: string) => void;
  onDeleteType: (typeName: string) => void;
  onAddType: () => void;
  onAddFacetToType: (typeName: string, isRequired: boolean) => void;
  onRemoveFacetFromType: (typeName: string, facetName: string) => void;
  onMoveFacet: (typeName: string, facetName: string, toRequired: boolean) => void;
}

/**
 * Schema Editor 的 type 列表。
 * 两级可展开：type → required/optional facets。
 */
export class SchemaTypeList {
  private containerEl: HTMLElement;
  private expandedTypes: Set<string> = new Set();

  constructor(
    parentEl: HTMLElement,
    private schema: Schema,
    private readonly callbacks: SchemaTypeListCallbacks,
  ) {
    this.containerEl = parentEl.createDiv({ cls: 'toot-schema-type-list' });
    this.render();
  }

  /** 用新 schema 数据重新渲染 */
  refresh(schema: Schema): void {
    this.schema = schema;
    this.render();
  }

  private render(): void {
    this.containerEl.empty();

    for (const [typeName, typeDef] of Object.entries(this.schema.note_types)) {
      this.buildTypeItem(typeName, typeDef);
    }

    // Add new type button
    const addBtn = this.containerEl.createEl('button', {
      cls: 'toot-schema-add-type-btn',
      text: '+ 新增 Type',
    });
    addBtn.addEventListener('click', () => this.callbacks.onAddType());
  }

  private buildTypeItem(typeName: string, typeDef: NoteTypeSchema): void {
    const item = this.containerEl.createDiv({ cls: 'toot-schema-type-item' });
    const isExpanded = this.expandedTypes.has(typeName);

    // Header row
    const header = item.createDiv({ cls: 'toot-schema-type-header' });
    const toggle = header.createSpan({
      cls: 'toot-schema-toggle',
      text: isExpanded ? '▼' : '▶',
    });
    header.createSpan({
      cls: 'toot-schema-type-name',
      text: `${typeDef.label} (${typeName})`,
    });

    const headerActions = header.createDiv({ cls: 'toot-schema-type-actions' });
    const editBtn = headerActions.createEl('button', { cls: 'toot-schema-btn', text: '编辑' });
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); this.callbacks.onEditType(typeName); });

    const delBtn = headerActions.createEl('button', { cls: 'toot-schema-btn toot-schema-btn--danger', text: '删除' });
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); this.callbacks.onDeleteType(typeName); });

    // Toggle expand/collapse
    header.addEventListener('click', () => {
      if (this.expandedTypes.has(typeName)) {
        this.expandedTypes.delete(typeName);
      } else {
        this.expandedTypes.add(typeName);
      }
      this.render();
    });

    // Expanded content
    if (isExpanded) {
      const body = item.createDiv({ cls: 'toot-schema-type-body' });

      // Required facets
      this.buildFacetGroup(body, typeName, '必填 facets', typeDef.required_facets, true);

      // Optional facets
      this.buildFacetGroup(body, typeName, '可选 facets', typeDef.optional_facets, false);

      // Add facet buttons
      const addRow = body.createDiv({ cls: 'toot-schema-facet-add-row' });
      const addReqBtn = addRow.createEl('button', { cls: 'toot-schema-btn', text: '+ 必填 facet' });
      addReqBtn.addEventListener('click', () => this.callbacks.onAddFacetToType(typeName, true));
      const addOptBtn = addRow.createEl('button', { cls: 'toot-schema-btn', text: '+ 可选 facet' });
      addOptBtn.addEventListener('click', () => this.callbacks.onAddFacetToType(typeName, false));
    }
  }

  private buildFacetGroup(
    parent: HTMLElement,
    typeName: string,
    label: string,
    facets: string[],
    isRequired: boolean,
  ): void {
    if (facets.length === 0) return;

    const group = parent.createDiv({ cls: 'toot-schema-facet-group' });
    group.createDiv({ cls: 'toot-schema-facet-group-label', text: label });

    for (const facetName of facets) {
      const facetDef = this.schema.facet_definitions[facetName];
      const row = group.createDiv({ cls: 'toot-schema-facet-row' });

      const nameEl = row.createSpan({
        cls: 'toot-schema-facet-name',
        text: facetName,
      });
      nameEl.addEventListener('click', () => this.callbacks.onSelectFacet(typeName, facetName));

      if (facetDef) {
        row.createSpan({
          cls: 'toot-schema-facet-vtype',
          text: facetDef.value_type,
        });
      }

      const rowActions = row.createDiv({ cls: 'toot-schema-facet-actions' });

      // Move facet (required ↔ optional)
      const moveBtn = rowActions.createEl('button', {
        cls: 'toot-schema-btn',
        text: isRequired ? '→ 可选' : '→ 必填',
      });
      moveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onMoveFacet(typeName, facetName, !isRequired);
      });

      // Remove facet from type
      const removeBtn = rowActions.createEl('button', {
        cls: 'toot-schema-btn toot-schema-btn--danger',
        text: '移除',
      });
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onRemoveFacetFromType(typeName, facetName);
      });
    }
  }

  destroy(): void {
    this.containerEl.remove();
  }
}
