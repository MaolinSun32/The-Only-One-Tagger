import { App, Notice, TFile, normalizePath } from 'obsidian';
import type { RegistryStore } from '../storage/registry-store';
import type { StagingStore } from '../storage/staging-store';
import type { FrontmatterService } from '../engine/frontmatter-service';
import type { BackupManager } from '../storage/backup-manager';
import type { OperationLock } from '../operation-lock';
import type { SchemaResolver } from '../engine/schema-resolver';
import type {
  MergeOptions, DryRunResult, BulkModifyResult,
  StagingTagItem, Staging,
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
   * - A 和 B 同时存在：移除 A，保留 B
   * - 仅 B 存在：不操作（不会被 findAndUpdateTagGlobally 触发）
   *
   * 删除模式：直接移除所有 sourceTag 条目。
   */
  private async cleanupStaging(options: MergeOptions): Promise<void> {
    const { sourceTag, targetTag } = options;

    if (targetTag === null) {
      // 删除模式：直接移除所有 sourceTag 条目
      await this.stagingStore.findAndUpdateTagGlobally(sourceTag, () => null);
      return;
    }

    // 合并模式：预扫描 staging 判断每个 facet 中 A/B 共存情况
    const staging: Staging = await this.stagingStore.load();
    const coexistSet = new Set<string>(); // "notePath:type:facet" → true if both A and B exist

    for (const [notePath, note] of Object.entries(staging.notes)) {
      for (const [typeName, facets] of Object.entries(note.types)) {
        for (const [facetName, items] of Object.entries(facets)) {
          const hasSource = items.some(item => item.label === sourceTag);
          const hasTarget = items.some(item => item.label === targetTag);
          if (hasSource && hasTarget) {
            coexistSet.add(`${notePath}:${typeName}:${facetName}`);
          }
        }
      }
    }

    // 执行清理
    await this.stagingStore.findAndUpdateTagGlobally(
      sourceTag,
      (entry: StagingTagItem): StagingTagItem | null => {
        // findAndUpdateTagGlobally 在遍历时会给出 notePath:type:facet 信息
        // 但当前 API 只传入 entry，无法直接获取位置信息
        // 因此这里检查：如果同 facet 有 targetTag，则 A 和 B 共存 → 移除 A
        // 否则，仅 A → 替换 label 为 B

        // 由于 API 限制，我们使用保守策略：
        // 先移除所有 sourceTag，然后对"仅 A"的情况用 findAndUpdateTagGlobally 无法区分
        // 所以采用替换策略：将 sourceTag 替换为 targetTag
        // 如果 targetTag 已存在，会产生重复，但后续 applyAll 时会自然去重

        return { ...entry, label: targetTag };
      },
    );

    // 对于 A 和 B 共存的情况，替换后会产生两个 targetTag
    // 需要去重：移除重复的 targetTag 条目（保留原始的 B）
    if (coexistSet.size > 0) {
      await this.stagingStore.update(data => {
        for (const key of coexistSet) {
          const [notePath, typeName, facetName] = key.split(':');
          const items = data.notes[notePath!]?.types[typeName!]?.[facetName!];
          if (!items) continue;

          // 找到所有 targetTag 条目，保留第一个（原始 B），移除后续（从 A 替换来的）
          let foundFirst = false;
          for (let i = items.length - 1; i >= 0; i--) {
            if (items[i]!.label === targetTag) {
              if (foundFirst) {
                items.splice(i, 1);
              } else {
                foundFirst = true;
              }
            }
          }
        }
      });
    }
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
