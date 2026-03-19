import { App, Notice, TFile, normalizePath } from 'obsidian';
import type { RegistryStore } from '../storage/registry-store';
import type { StagingStore } from '../storage/staging-store';
import type { FrontmatterService } from '../engine/frontmatter-service';
import type { BackupManager } from '../storage/backup-manager';
import type { OperationLock } from '../operation-lock';
import type { SchemaResolver } from '../engine/schema-resolver';
import type {
  MergeOptions, DryRunResult, BulkModifyResult,
} from '../types';
import { TAG_REGISTRY_FILE } from '../constants';
import { BulkYamlModifier } from './bulk-yaml-modifier';

/**
 * 标签合并（A→B）和删除模式。
 * 继承 BulkYamlModifier，使用逐文件追踪 + 崩溃恢复能力。
 *
 * 完整执行流程：
 * 1. OperationLock.acquire("标签合并")
 * 2. Git 检测 → Notice 建议 commit
 * 3. BackupManager 备份 registry
 * 4. BulkYamlModifier.execute() 逐文件修改 YAML
 * 5. StagingStore 同步清理
 * 6. RegistryStore 写入（后置 — 所有 YAML + Staging 完成后才执行）
 * 7. OperationLock.release()
 */
export class TagMerger extends BulkYamlModifier {
  private registryStore: RegistryStore;
  private stagingStore: StagingStore;
  private frontmatterService: FrontmatterService;
  private backupManager: BackupManager;
  private operationLock: OperationLock;
  private schemaResolver: SchemaResolver;
  private registryFilePath: string;

  constructor(
    app: App,
    stateFilePath: string,
    registryStore: RegistryStore,
    stagingStore: StagingStore,
    frontmatterService: FrontmatterService,
    backupManager: BackupManager,
    operationLock: OperationLock,
    schemaResolver: SchemaResolver,
  ) {
    super(app, stateFilePath);
    this.registryStore = registryStore;
    this.stagingStore = stagingStore;
    this.frontmatterService = frontmatterService;
    this.backupManager = backupManager;
    this.operationLock = operationLock;
    this.schemaResolver = schemaResolver;

    // registry 文件路径用于 backup
    // stateFilePath 格式: {pluginDir}/merge-state.json → 提取 pluginDir
    const pluginDir = stateFilePath.substring(0, stateFilePath.lastIndexOf('/'));
    this.registryFilePath = normalizePath(pluginDir + '/' + TAG_REGISTRY_FILE);
  }

  /**
   * Dry-run 预览：扫描全库 YAML，列出所有受影响笔记。
   * 不修改任何数据。
   */
  async dryRun(options: MergeOptions): Promise<DryRunResult> {
    const { sourceTag, targetTag } = options;
    const affectedFiles: DryRunResult['affectedFiles'] = [];

    const mdFiles = this.app.vault.getMarkdownFiles();
    for (const file of mdFiles) {
      const tagged = await this.frontmatterService.read(file);
      if (tagged.types.length === 0) continue;

      let affected = false;
      for (const typeName of tagged.types) {
        const typeData = tagged.typeData[typeName];
        if (!typeData) continue;
        for (const facetValue of Object.values(typeData)) {
          if (Array.isArray(facetValue)) {
            if (facetValue.includes(sourceTag)) { affected = true; break; }
          } else if (facetValue === sourceTag) {
            affected = true; break;
          }
        }
        if (affected) break;
      }

      if (affected) {
        const changes = targetTag
          ? `${sourceTag} → ${targetTag}`
          : `移除 ${sourceTag}`;
        affectedFiles.push({ path: file.path, changes });
      }
    }

    return { affectedFiles, totalAffected: affectedFiles.length };
  }

  /**
   * 执行合并/删除操作。
   * 按照安全顺序：Lock → Git → Backup → YAML → Staging → Registry → Unlock
   */
  async merge(
    options: MergeOptions,
    onProgress?: (completed: number, total: number) => void,
  ): Promise<BulkModifyResult> {
    // 1. 获取操作锁
    if (!this.operationLock.acquire('标签合并')) {
      new Notice(`当前有操作正在执行：${this.operationLock.getCurrentOp()}`);
      return { total: 0, completed: 0, failed: 0, failedFiles: {} };
    }

    try {
      // 2. Git 检测
      if (await this.isGitRepo()) {
        new Notice('检测到 Git 仓库，建议在合并标签前先 git commit');
      }

      // 3. 备份 registry
      await this.backupManager.createBackup(this.registryFilePath);

      // 4. 扫描受影响文件
      const dryRunResult = await this.dryRun(options);
      const affectedPaths = dryRunResult.affectedFiles.map(f => f.path);
      const affectedTFiles: TFile[] = [];
      for (const path of affectedPaths) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          affectedTFiles.push(file);
        }
      }

      // 5. BulkYamlModifier.execute() — 逐文件修改 YAML
      const result = await this.execute(affectedTFiles, options, onProgress);

      // 6. Staging 同步清理
      await this.cleanupStaging(options);

      // 7. Registry 写入（后置 — 所有 YAML + Staging 完成后才执行）
      await this.updateRegistry(options);

      // 清理状态文件
      await this.cleanupState();

      return result;
    } finally {
      // 8. 释放锁
      this.operationLock.release();
    }
  }

  /**
   * 覆写 resume()：在 YAML 修改恢复完成后，
   * 重新执行 staging 清理 + registry 写入（两者幂等，安全重复执行）。
   * 包裹在 OperationLock 中确保互斥。
   */
  async override_resume(context: any): Promise<BulkModifyResult> {
    if (!this.operationLock.acquire('标签合并')) {
      new Notice(`当前有操作正在执行：${this.operationLock.getCurrentOp()}`);
      return { total: 0, completed: 0, failed: 0, failedFiles: {} };
    }

    try {
      // 恢复剩余 YAML 修改
      const result = await super.resume(context);

      // staging 清理和 registry 写入是幂等的，崩溃恢复后安全重新执行
      const options = context as MergeOptions;
      await this.cleanupStaging(options);
      await this.updateRegistry(options);
      await this.cleanupState();

      return result;
    } finally {
      this.operationLock.release();
    }
  }

  /**
   * detectIncomplete + resume 的完整恢复流程入口。
   * 供 main.ts 启动恢复使用。
   */
  async resumeIncomplete(): Promise<BulkModifyResult | null> {
    const incomplete = await this.detectIncomplete();
    if (!incomplete) return null;
    return this.override_resume(incomplete.context);
  }

  /** 检测 vault 是否为 git 仓库 */
  async isGitRepo(): Promise<boolean> {
    try {
      return await this.app.vault.adapter.exists('.git');
    } catch {
      return false;
    }
  }

  // ── modifyFile 实现 ──

  /**
   * 单文件 YAML 修改。
   * 绕过 FrontmatterService 直接使用 processFrontMatter，
   * 因为 FrontmatterService 只有 read/write/removeTypeBlock，
   * 不支持"在 facet 数组中替换单个标签"这种手术式操作。
   */
  protected async modifyFile(file: TFile, context: any): Promise<boolean> {
    const { sourceTag, targetTag } = context as MergeOptions;
    let modified = false;

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const types: string[] = Array.isArray(frontmatter.type) ? frontmatter.type : [];

      for (const typeName of types) {
        const typeBlock = frontmatter[typeName];
        if (!typeBlock || typeof typeBlock !== 'object') continue;

        for (const [facetName, facetValue] of Object.entries(typeBlock)) {
          if (Array.isArray(facetValue)) {
            // allow_multiple: true 的 facet
            const idx = facetValue.indexOf(sourceTag);
            if (idx !== -1) {
              modified = true;
              if (targetTag !== null) {
                // 合并模式
                if (facetValue.includes(targetTag)) {
                  // A 和 B 都存在 → 移除 A，保留 B（防重复）
                  facetValue.splice(idx, 1);
                } else {
                  // 只有 A → 替换为 B
                  facetValue[idx] = targetTag;
                }
              } else {
                // 删除模式 → 从数组中移除
                facetValue.splice(idx, 1);
              }
              // 数组空了则删除整个 facet 键
              if (facetValue.length === 0) {
                delete typeBlock[facetName];
              }
            }
          } else if (facetValue === sourceTag) {
            // allow_multiple: false 的单值 facet
            modified = true;
            if (targetTag !== null) {
              typeBlock[facetName] = targetTag;
            } else {
              delete typeBlock[facetName];
            }
          }
        }
      }
    });

    return modified;
  }

  // ── Staging 同步清理 ──

  /**
   * Staging 清理逻辑。
   * 合并模式需处理三种情况（需预扫描判断 A/B 共存）：
   * - 仅 A 存在：label 替换为 B，保留 user_status/badge 等状态
   * - A 和 B 同时存在：直接移除 A，保留原始 B 不动
   * - 仅 B 存在：不操作
   *
   * 删除模式：直接移除所有 sourceTag 条目。
   *
   * 实现：使用 stagingStore.update() 做单次原子操作，
   * 在遍历中可以看到完整的 facet items 列表，
   * 因此能正确判断 A/B 共存并做出差异化处理。
   * 避免了 findAndUpdateTagGlobally 只能看到单条目的局限。
   */
  private async cleanupStaging(options: MergeOptions): Promise<void> {
    const { sourceTag, targetTag } = options;

    if (targetTag === null) {
      // 删除模式：直接移除所有 sourceTag 条目
      await this.stagingStore.findAndUpdateTagGlobally(sourceTag, () => null);
      return;
    }

    // 合并模式：单次原子操作处理所有三种情况
    await this.stagingStore.update(data => {
      for (const [notePath, note] of Object.entries(data.notes)) {
        for (const [typeName, facets] of Object.entries(note.types)) {
          for (const [facetName, items] of Object.entries(facets)) {
            const sourceIdx = items.findIndex(item => item.label === sourceTag);
            if (sourceIdx === -1) continue; // 该 facet 无 A，跳过

            const hasTarget = items.some(item => item.label === targetTag);

            if (hasTarget) {
              // A 和 B 同时存在 → 直接移除 A，保留原始 B 不动
              items.splice(sourceIdx, 1);
            } else {
              // 仅 A 存在 → 替换 label 为 B，保留其余属性
              items[sourceIdx] = { ...items[sourceIdx]!, label: targetTag };
            }

            // 清理空 facet
            if (items.length === 0) {
              delete facets[facetName];
            }
          }
          // 清理空 type
          if (Object.keys(facets).length === 0) {
            delete note.types[typeName];
          }
        }
        // 清理空笔记
        if (Object.keys(note.types).length === 0) {
          delete data.notes[notePath];
        }
      }
    });
  }

  // ── Registry 更新 ──

  /**
   * Registry 写入（后置，所有 YAML + Staging 完成后才执行）。
   * 合并模式：rejectTag(A, B) + B 继承 A 的 relations
   * 删除模式：deleteTag(A) 彻底移除
   */
  private async updateRegistry(options: MergeOptions): Promise<void> {
    const { sourceTag, targetTag } = options;

    if (targetTag === null) {
      // 删除模式
      await this.registryStore.deleteTag(sourceTag);
      return;
    }

    // 合并模式：A → B
    // 先读取 A 的 relations（在 reject 之前）
    const sourceEntry = await this.registryStore.getTag(sourceTag);

    // reject A → B
    await this.registryStore.rejectTag(sourceTag, targetTag);

    // B 继承 A 的 relations
    if (sourceEntry) {
      const targetEntry = await this.registryStore.getTag(targetTag);
      if (targetEntry) {
        await this.registryStore.update(data => {
          const target = data.tags[targetTag];
          if (!target) return;

          // 合并 relations（concat + dedup）
          for (const rel of ['broader', 'narrower', 'related'] as const) {
            const merged = new Set([
              ...target.relations[rel],
              ...sourceEntry.relations[rel],
            ]);
            // 移除自引用
            merged.delete(targetTag);
            merged.delete(sourceTag);
            target.relations[rel] = Array.from(merged);
          }
        });
      }
    }
  }
}
