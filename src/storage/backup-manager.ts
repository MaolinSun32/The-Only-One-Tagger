import { App, normalizePath, type PluginManifest } from 'obsidian';
import { BACKUPS_DIR } from '../constants';

export class BackupManager {
  private app: App;
  private backupsDir: string;

  constructor(app: App, manifest: PluginManifest) {
    this.app = app;
    this.backupsDir = normalizePath(manifest.dir + '/' + BACKUPS_DIR);
  }

  /**
   * 创建带时间戳的 JSON 备份。
   * 备份文件名格式：{originalName}.backup.{timestamp}.json
   * @returns 备份文件的完整路径
   */
  async createBackup(sourceFile: string): Promise<string> {
    const adapter = this.app.vault.adapter;

    // 确保 backups 目录存在
    if (!(await adapter.exists(this.backupsDir))) {
      await adapter.mkdir(this.backupsDir);
    }

    const content = await adapter.read(sourceFile);
    const baseName = sourceFile.split('/').pop()?.replace('.json', '') ?? 'unknown';
    const backupName = `${baseName}.backup.${Date.now()}.json`;
    const backupPath = normalizePath(this.backupsDir + '/' + backupName);

    await adapter.write(backupPath, content);
    return backupPath;
  }

  /**
   * 列出 backups/ 目录下的所有备份文件。
   * @returns 备份文件路径数组，按时间降序排列
   */
  async listBackups(): Promise<string[]> {
    const adapter = this.app.vault.adapter;

    if (!(await adapter.exists(this.backupsDir))) {
      return [];
    }

    const listing = await adapter.list(this.backupsDir);
    return listing.files
      .filter(f => f.includes('.backup.'))
      .sort((a, b) => {
        const tsA = this.extractTimestamp(a);
        const tsB = this.extractTimestamp(b);
        return tsB - tsA; // 降序
      });
  }

  private extractTimestamp(path: string): number {
    const match = path.match(/\.backup\.(\d+)\.json$/);
    return match?.[1] ? parseInt(match[1], 10) : 0;
  }
}
