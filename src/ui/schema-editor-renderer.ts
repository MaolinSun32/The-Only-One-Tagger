import { Notice } from 'obsidian';
import type TheOnlyOneTagger from '../main';
import type { Schema, FacetDefinition, NoteTypeSchema } from '../types';
import { SchemaTypeList, type SchemaTypeListCallbacks } from './components/schema-type-list';
import { SchemaFacetEditor, type SchemaFacetEditorCallbacks } from './components/schema-facet-editor';
import { SchemaSyncDialog } from './components/schema-sync-dialog';

/**
 * Schema Editor 渲染器（Tab B）。
 * 左侧 SchemaTypeList + 右侧 SchemaFacetEditor。
 * 支持 type/facet 的增删改 + 修改同步策略。
 */
export class SchemaEditorRenderer {
  private containerEl: HTMLElement;
  private sidebarEl!: HTMLElement;
  private detailEl!: HTMLElement;
  private lockBannerEl: HTMLElement | null = null;
  private typeList: SchemaTypeList | null = null;
  private facetEditor: SchemaFacetEditor | null = null;
  private schema!: Schema;

  // Event handlers
  private schemaChangeHandler: (() => void) | null = null;

  constructor(
    parentEl: HTMLElement,
    private readonly plugin: TheOnlyOneTagger,
  ) {
    this.containerEl = parentEl.createDiv({ cls: 'toot-schema-editor' });
    this.subscribeEvents();
    this.build();
  }

  private subscribeEvents(): void {
    this.schemaChangeHandler = () => this.refresh();
    this.plugin.schemaStore.on('change', this.schemaChangeHandler);
  }

  private async build(): Promise<void> {
    this.schema = await this.plugin.schemaStore.load();

    // Lock check banner
    this.renderLockBanner();

    // Layout: sidebar + detail
    const layout = this.containerEl.createDiv({ cls: 'toot-schema-layout' });
    this.sidebarEl = layout.createDiv({ cls: 'toot-schema-sidebar' });
    this.detailEl = layout.createDiv({ cls: 'toot-schema-detail' });

    this.detailEl.createDiv({
      cls: 'toot-schema-detail-hint',
      text: '← 点击左侧 facet 查看详情',
    });

    this.renderTypeList();
  }

  private renderLockBanner(): void {
    this.lockBannerEl?.remove();

    if (this.plugin.operationLock.isLocked()) {
      this.lockBannerEl = this.containerEl.createDiv({ cls: 'toot-schema-lock-banner' });
      this.lockBannerEl.setText(
        `⚠️ ${this.plugin.operationLock.getCurrentOp() ?? '操作'} 运行中，请等待完成后再修改模式`
      );
    }
  }

  private isLocked(): boolean {
    return this.plugin.operationLock.isLocked();
  }

  private renderTypeList(): void {
    this.typeList?.destroy();
    this.sidebarEl.empty();

    const callbacks: SchemaTypeListCallbacks = {
      onSelectFacet: (typeName, facetName) => this.showFacetEditor(facetName),
      onEditType: (typeName) => this.editType(typeName),
      onDeleteType: (typeName) => this.deleteType(typeName),
      onAddType: () => this.addType(),
      onAddFacetToType: (typeName, isRequired) => this.addFacetToType(typeName, isRequired),
      onRemoveFacetFromType: (typeName, facetName) => this.removeFacetFromType(typeName, facetName),
      onMoveFacet: (typeName, facetName, toRequired) => this.moveFacet(typeName, facetName, toRequired),
    };

    this.typeList = new SchemaTypeList(this.sidebarEl, this.schema, callbacks);
  }

  private showFacetEditor(facetName: string): void {
    const facetDef = this.schema.facet_definitions[facetName];
    if (!facetDef) return;

    const callbacks: SchemaFacetEditorCallbacks = {
      onSave: async (name, updated) => {
        if (this.isLocked()) { this.notifyLocked(); return; }
        await this.plugin.schemaStore.update(data => {
          const def = data.facet_definitions[name];
          if (!def) return;
          if (updated.description !== undefined) def.description = updated.description;
          if (updated.allow_multiple !== undefined) def.allow_multiple = updated.allow_multiple;
          if (updated.verification_required !== undefined) def.verification_required = updated.verification_required;
        });
        await this.reloadResolver();
        new Notice(`facet "${name}" 已保存`);
      },
      onRename: async (oldName, newName) => {
        if (this.isLocked()) { this.notifyLocked(); return; }
        // Rename affects existing notes — show sync dialog
        const affected = await this.findNotesWithFacet(oldName);
        if (affected.length > 0) {
          this.showSyncDialog(
            `重命名 facet "${oldName}" → "${newName}"`,
            affected,
            async () => await this.executeFacetRename(oldName, newName, affected),
            async () => await this.schemaOnlyFacetRename(oldName, newName),
          );
        } else {
          await this.schemaOnlyFacetRename(oldName, newName);
          new Notice(`facet "${oldName}" 已重命名为 "${newName}"`);
        }
      },
      onDeleteEnumValue: async (facetName, value) => {
        if (this.isLocked()) { this.notifyLocked(); return; }
        const affected = await this.findNotesWithEnumValue(facetName, value);
        if (affected.length > 0) {
          this.showSyncDialog(
            `删除枚举值 "${value}" (facet: ${facetName})`,
            affected,
            async () => {
              await this.plugin.schemaStore.update(data => {
                const def = data.facet_definitions[facetName];
                if (def?.values) {
                  def.values = def.values.filter(v => v !== value);
                }
              });
              await this.reloadResolver();
              // YAML sync would happen via BulkYamlModifier (stub)
              try {
                // BulkYamlModifier is abstract — no concrete impl for schema sync yet
                throw new Error(
                  'YAML 批量同步功能尚未实现，Schema/Staging/Registry 已更新但笔记 YAML 仍为旧值。' +
                  '请在 Group 6 完成后重新执行同步。'
                );
              } catch (e: any) {
                new Notice(e.message);
              }
            },
            async () => {
              await this.plugin.schemaStore.update(data => {
                const def = data.facet_definitions[facetName];
                if (def?.values) {
                  def.values = def.values.filter(v => v !== value);
                }
              });
              await this.reloadResolver();
            },
          );
        } else {
          await this.plugin.schemaStore.update(data => {
            const def = data.facet_definitions[facetName];
            if (def?.values) {
              def.values = def.values.filter(v => v !== value);
            }
          });
          await this.reloadResolver();
          new Notice(`已删除枚举值 "${value}"`);
        }
      },
      onAddEnumValue: async (facetName, value) => {
        if (this.isLocked()) { this.notifyLocked(); return; }
        await this.plugin.schemaStore.update(data => {
          const def = data.facet_definitions[facetName];
          if (def) {
            if (!def.values) def.values = [];
            if (!def.values.includes(value)) def.values.push(value);
          }
        });
        await this.reloadResolver();
        new Notice(`已添加枚举值 "${value}"`);
      },
    };

    if (this.facetEditor) {
      this.facetEditor.switchTo(facetName, facetDef);
    } else {
      this.detailEl.empty();
      this.facetEditor = new SchemaFacetEditor(this.detailEl, facetName, facetDef, callbacks);
    }
  }

  // ── Type operations ──

  private editType(typeName: string): void {
    if (this.isLocked()) { this.notifyLocked(); return; }

    const typeDef = this.schema.note_types[typeName];
    if (!typeDef) return;

    // Show inline edit in detail panel
    this.detailEl.empty();
    this.facetEditor = null;

    const editor = this.detailEl.createDiv({ cls: 'toot-schema-type-editor' });
    editor.createEl('h4', { text: `编辑 Type: ${typeName}` });

    const labelRow = editor.createDiv({ cls: 'toot-schema-field' });
    labelRow.createDiv({ cls: 'toot-schema-field-label', text: 'Label' });
    const labelInput = labelRow.createEl('input', {
      cls: 'toot-schema-input',
      attr: { type: 'text', value: typeDef.label },
    });

    const descRow = editor.createDiv({ cls: 'toot-schema-field' });
    descRow.createDiv({ cls: 'toot-schema-field-label', text: 'Description' });
    const descInput = descRow.createEl('textarea', {
      cls: 'toot-schema-textarea',
      text: typeDef.description,
    });

    const saveBtn = editor.createEl('button', { cls: 'toot-schema-save-btn mod-cta', text: '保存' });
    saveBtn.addEventListener('click', async () => {
      await this.plugin.schemaStore.update(data => {
        const t = data.note_types[typeName];
        if (t) {
          t.label = labelInput.value.trim() || t.label;
          t.description = descInput.value.trim();
        }
      });
      await this.reloadResolver();
      new Notice(`Type "${typeName}" 已更新`);
    });
  }

  private async deleteType(typeName: string): Promise<void> {
    if (this.isLocked()) { this.notifyLocked(); return; }

    const affected = await this.findNotesWithType(typeName);
    if (affected.length > 0) {
      this.showSyncDialog(
        `删除 Type "${typeName}"`,
        affected,
        async () => {
          // Sync: update staging + registry, then schema
          // YAML sync via BulkYamlModifier (stub)
          await this.plugin.schemaStore.update(data => {
            delete data.note_types[typeName];
          });
          await this.reloadResolver();
          try {
            throw new Error(
              'YAML 批量同步功能尚未实现，Schema/Staging/Registry 已更新但笔记 YAML 仍为旧值。' +
              '请在 Group 6 完成后重新执行同步。'
            );
          } catch (e: any) {
            new Notice(e.message);
          }
        },
        async () => {
          await this.plugin.schemaStore.update(data => {
            delete data.note_types[typeName];
          });
          await this.reloadResolver();
        },
      );
    } else {
      await this.plugin.schemaStore.update(data => {
        delete data.note_types[typeName];
      });
      await this.reloadResolver();
      new Notice(`Type "${typeName}" 已删除`);
    }
  }

  private addType(): void {
    if (this.isLocked()) { this.notifyLocked(); return; }

    this.detailEl.empty();
    this.facetEditor = null;

    const editor = this.detailEl.createDiv({ cls: 'toot-schema-type-editor' });
    editor.createEl('h4', { text: '新增 Type' });

    const nameRow = editor.createDiv({ cls: 'toot-schema-field' });
    nameRow.createDiv({ cls: 'toot-schema-field-label', text: '名称 (key)' });
    const nameInput = nameRow.createEl('input', {
      cls: 'toot-schema-input',
      attr: { type: 'text', placeholder: 'e.g. research' },
    });

    const labelRow = editor.createDiv({ cls: 'toot-schema-field' });
    labelRow.createDiv({ cls: 'toot-schema-field-label', text: 'Label' });
    const labelInput = labelRow.createEl('input', {
      cls: 'toot-schema-input',
      attr: { type: 'text', placeholder: 'e.g. 研究项目' },
    });

    const descRow = editor.createDiv({ cls: 'toot-schema-field' });
    descRow.createDiv({ cls: 'toot-schema-field-label', text: 'Description' });
    const descInput = descRow.createEl('textarea', { cls: 'toot-schema-textarea' });

    const saveBtn = editor.createEl('button', { cls: 'toot-schema-save-btn mod-cta', text: '创建' });
    saveBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      if (!name) { new Notice('请输入 type 名称'); return; }
      if (this.schema.note_types[name]) { new Notice(`Type "${name}" 已存在`); return; }

      await this.plugin.schemaStore.update(data => {
        data.note_types[name] = {
          label: labelInput.value.trim() || name,
          description: descInput.value.trim(),
          required_facets: [],
          optional_facets: [],
        };
      });
      await this.reloadResolver();
      new Notice(`Type "${name}" 已创建`);
    });
  }

  // ── Facet-to-type operations ──

  private async addFacetToType(typeName: string, isRequired: boolean): Promise<void> {
    if (this.isLocked()) { this.notifyLocked(); return; }

    // Show facet picker in detail panel
    this.detailEl.empty();
    this.facetEditor = null;

    const editor = this.detailEl.createDiv({ cls: 'toot-schema-type-editor' });
    editor.createEl('h4', { text: `添加 facet 到 ${typeName}` });

    const typeDef = this.schema.note_types[typeName];
    if (!typeDef) return;

    const usedFacets = new Set([...typeDef.required_facets, ...typeDef.optional_facets]);
    const availableFacets = Object.keys(this.schema.facet_definitions).filter(f => !usedFacets.has(f));

    if (availableFacets.length === 0) {
      editor.createDiv({ text: '所有 facet 已添加。可先创建新 facet。' });
      return;
    }

    const select = editor.createEl('select', { cls: 'toot-schema-input' });
    select.createEl('option', { text: '选择 facet…', attr: { value: '' } });
    for (const f of availableFacets) {
      select.createEl('option', { text: f, attr: { value: f } });
    }

    const addBtn = editor.createEl('button', { cls: 'toot-schema-save-btn mod-cta', text: '添加' });
    addBtn.addEventListener('click', async () => {
      const facetName = select.value;
      if (!facetName) return;

      await this.plugin.schemaStore.update(data => {
        const t = data.note_types[typeName];
        if (!t) return;
        if (isRequired) {
          if (!t.required_facets.includes(facetName)) t.required_facets.push(facetName);
        } else {
          if (!t.optional_facets.includes(facetName)) t.optional_facets.push(facetName);
        }
      });
      await this.reloadResolver();
      new Notice(`facet "${facetName}" 已添加到 ${typeName}`);
    });
  }

  private async removeFacetFromType(typeName: string, facetName: string): Promise<void> {
    if (this.isLocked()) { this.notifyLocked(); return; }

    const affected = await this.findNotesWithFacetInType(typeName, facetName);
    if (affected.length > 0) {
      this.showSyncDialog(
        `从 Type "${typeName}" 中移除 facet "${facetName}"`,
        affected,
        async () => {
          await this.plugin.schemaStore.update(data => {
            const t = data.note_types[typeName];
            if (!t) return;
            t.required_facets = t.required_facets.filter(f => f !== facetName);
            t.optional_facets = t.optional_facets.filter(f => f !== facetName);
          });
          await this.reloadResolver();
          try {
            throw new Error(
              'YAML 批量同步功能尚未实现，Schema/Staging/Registry 已更新但笔记 YAML 仍为旧值。' +
              '请在 Group 6 完成后重新执行同步。'
            );
          } catch (e: any) {
            new Notice(e.message);
          }
        },
        async () => {
          await this.plugin.schemaStore.update(data => {
            const t = data.note_types[typeName];
            if (!t) return;
            t.required_facets = t.required_facets.filter(f => f !== facetName);
            t.optional_facets = t.optional_facets.filter(f => f !== facetName);
          });
          await this.reloadResolver();
        },
      );
    } else {
      await this.plugin.schemaStore.update(data => {
        const t = data.note_types[typeName];
        if (!t) return;
        t.required_facets = t.required_facets.filter(f => f !== facetName);
        t.optional_facets = t.optional_facets.filter(f => f !== facetName);
      });
      await this.reloadResolver();
      new Notice(`facet "${facetName}" 已从 ${typeName} 移除`);
    }
  }

  private async moveFacet(typeName: string, facetName: string, toRequired: boolean): Promise<void> {
    if (this.isLocked()) { this.notifyLocked(); return; }

    await this.plugin.schemaStore.update(data => {
      const t = data.note_types[typeName];
      if (!t) return;
      t.required_facets = t.required_facets.filter(f => f !== facetName);
      t.optional_facets = t.optional_facets.filter(f => f !== facetName);
      if (toRequired) {
        t.required_facets.push(facetName);
      } else {
        t.optional_facets.push(facetName);
      }
    });
    await this.reloadResolver();
    new Notice(`facet "${facetName}" 已移至${toRequired ? '必填' : '可选'}`);
  }

  // ── Schema rename helpers ──

  private async executeFacetRename(oldName: string, newName: string, _affected: string[]): Promise<void> {
    const lockOk = this.plugin.operationLock.acquire('Schema 同步');
    if (!lockOk) {
      new Notice(`当前有 ${this.plugin.operationLock.getCurrentOp()} 正在执行，请等待完成`);
      return;
    }

    try {
      // Step 2: Update staging
      // Rename facet key in all staging notes
      const stagingData = await this.plugin.stagingStore.load();
      await this.plugin.stagingStore.update(data => {
        for (const note of Object.values(data.notes)) {
          for (const facets of Object.values(note.types)) {
            if (facets[oldName]) {
              facets[newName] = facets[oldName];
              delete facets[oldName];
            }
          }
        }
      });

      // Step 3: Update registry
      // Rename facet in all tag entries' facets arrays
      const registryData = await this.plugin.registryStore.load();
      await this.plugin.registryStore.update(data => {
        for (const tag of Object.values(data.tags)) {
          const idx = tag.facets.indexOf(oldName);
          if (idx !== -1) tag.facets[idx] = newName;
        }
      });

      // Step 4: YAML sync (stub — will throw)
      try {
        throw new Error(
          'YAML 批量同步功能尚未实现，Schema/Staging/Registry 已更新但笔记 YAML 仍为旧值。' +
          '请在 Group 6 完成后重新执行同步。'
        );
      } catch (e: any) {
        new Notice(e.message);
      }

      // Step 5: Update schema
      await this.schemaOnlyFacetRename(oldName, newName);
    } finally {
      this.plugin.operationLock.release();
    }
  }

  private async schemaOnlyFacetRename(oldName: string, newName: string): Promise<void> {
    await this.plugin.schemaStore.update(data => {
      // Rename in facet_definitions
      if (data.facet_definitions[oldName]) {
        data.facet_definitions[newName] = data.facet_definitions[oldName];
        delete data.facet_definitions[oldName];
      }
      // Rename in all type references
      for (const typeDef of Object.values(data.note_types)) {
        typeDef.required_facets = typeDef.required_facets.map(f => f === oldName ? newName : f);
        typeDef.optional_facets = typeDef.optional_facets.map(f => f === oldName ? newName : f);
      }
    });
    await this.reloadResolver();
  }

  // ── Helpers ──

  private showSyncDialog(
    description: string,
    affectedFiles: string[],
    onSync: () => Promise<void>,
    onSchemaOnly: () => Promise<void>,
  ): void {
    new SchemaSyncDialog(this.plugin.app, {
      description,
      affectedFiles,
      onSync,
      onSchemaOnly,
    }, this.plugin.operationLock).open();
  }

  private async reloadResolver(): Promise<void> {
    const schema = await this.plugin.schemaStore.load();
    this.plugin.schemaResolver.reload(schema);
  }

  /** 扫描 vault 中包含指定 type 的笔记 */
  private async findNotesWithType(typeName: string): Promise<string[]> {
    const files = this.plugin.app.vault.getMarkdownFiles();
    const result: string[] = [];
    for (const file of files) {
      try {
        const tagged = await this.plugin.frontmatterService.read(file);
        if (tagged.types.includes(typeName)) result.push(file.path);
      } catch { /* skip */ }
      if (result.length >= 100) break; // cap for performance
    }
    return result;
  }

  /** 扫描 vault 中使用指定 facet 的笔记 */
  private async findNotesWithFacet(facetName: string): Promise<string[]> {
    const files = this.plugin.app.vault.getMarkdownFiles();
    const result: string[] = [];
    for (const file of files) {
      try {
        const tagged = await this.plugin.frontmatterService.read(file);
        for (const typeName of tagged.types) {
          if (tagged.typeData[typeName]?.[facetName] != null) {
            result.push(file.path);
            break;
          }
        }
      } catch { /* skip */ }
      if (result.length >= 100) break;
    }
    return result;
  }

  /** 扫描特定 type 下使用指定 facet 的笔记 */
  private async findNotesWithFacetInType(typeName: string, facetName: string): Promise<string[]> {
    const files = this.plugin.app.vault.getMarkdownFiles();
    const result: string[] = [];
    for (const file of files) {
      try {
        const tagged = await this.plugin.frontmatterService.read(file);
        if (tagged.types.includes(typeName) && tagged.typeData[typeName]?.[facetName] != null) {
          result.push(file.path);
        }
      } catch { /* skip */ }
      if (result.length >= 100) break;
    }
    return result;
  }

  /** 扫描使用指定 enum 值的笔记 */
  private async findNotesWithEnumValue(facetName: string, value: string): Promise<string[]> {
    const files = this.plugin.app.vault.getMarkdownFiles();
    const result: string[] = [];
    for (const file of files) {
      try {
        const tagged = await this.plugin.frontmatterService.read(file);
        for (const typeName of tagged.types) {
          const facetVal = tagged.typeData[typeName]?.[facetName];
          if (facetVal === value || (Array.isArray(facetVal) && facetVal.includes(value))) {
            result.push(file.path);
            break;
          }
        }
      } catch { /* skip */ }
      if (result.length >= 100) break;
    }
    return result;
  }

  private notifyLocked(): void {
    new Notice(`当前有 ${this.plugin.operationLock.getCurrentOp() ?? '操作'} 正在执行，请等待完成后再修改`);
  }

  private async refresh(): Promise<void> {
    this.schema = await this.plugin.schemaStore.load();
    this.renderLockBanner();
    this.typeList?.refresh(this.schema);
  }

  destroy(): void {
    if (this.schemaChangeHandler) {
      this.plugin.schemaStore.off('change', this.schemaChangeHandler);
    }
    this.typeList?.destroy();
    this.facetEditor?.destroy();
    this.containerEl.remove();
  }
}
