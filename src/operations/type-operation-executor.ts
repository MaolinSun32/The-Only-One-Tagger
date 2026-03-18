import type { TFile } from 'obsidian';
import type { StagingStore } from '../storage/staging-store';
import type { FrontmatterService } from '../engine/frontmatter-service';
import type { AnalysisOrchestrator } from './analysis-orchestrator';

/**
 * 笔记类型操作执行器。
 *
 * ChangeType / AddType / DeleteType 三个操作。
 * 通过 AnalysisOrchestrator 触发重新分析，通过 StagingStore/FrontmatterService 清理旧数据。
 */
export class TypeOperationExecutor {
  constructor(private readonly deps: {
    analysisOrchestrator: AnalysisOrchestrator;
    stagingStore: StagingStore;
    frontmatterService: FrontmatterService;
  }) {}

  /** 更换笔记类型：清除旧 type → 移除 YAML → 以新 type 重新分析 */
  async changeType(
    notePath: string,
    file: TFile,
    oldType: string,
    newType: string,
  ): Promise<void> {
    await this.removeTypeFromStaging(notePath, oldType);

    const taggedNote = await this.deps.frontmatterService.read(file);
    if (taggedNote.types.includes(oldType)) {
      await this.deps.frontmatterService.removeTypeBlock(file, oldType);
    }

    await this.deps.analysisOrchestrator.analyzeWithType(file, newType);
  }

  /** 添加额外类型（完全独立，不影响现有 type） */
  async addType(
    _notePath: string,
    file: TFile,
    additionalType: string,
  ): Promise<void> {
    await this.deps.analysisOrchestrator.analyzeWithType(file, additionalType);
  }

  /** 删除类型：清除 staging + 移除 YAML */
  async deleteType(
    notePath: string,
    file: TFile,
    type: string,
  ): Promise<void> {
    await this.removeTypeFromStaging(notePath, type);

    const taggedNote = await this.deps.frontmatterService.read(file);
    if (taggedNote.types.includes(type)) {
      await this.deps.frontmatterService.removeTypeBlock(file, type);
    }
  }

  private async removeTypeFromStaging(notePath: string, type: string): Promise<void> {
    await this.deps.stagingStore.removeType(notePath, type);
  }
}
