import { Plugin } from 'obsidian';
import type { TootSettings } from './types';
import { DEFAULT_SETTINGS } from './constants';
import { OperationLock } from './operation-lock';
import { SchemaStore } from './storage/schema-store';
import { RegistryStore } from './storage/registry-store';
import { StagingStore } from './storage/staging-store';
import { QueueStore } from './storage/queue-store';
import { BatchStateStore } from './storage/batch-state-store';
import { BackupManager } from './storage/backup-manager';
import { SeedInitializer } from './seed/initializer';
import { TootSettingTab } from './settings';

export default class TheOnlyOneTagger extends Plugin {
  settings!: TootSettings;
  operationLock!: OperationLock;
  schemaStore!: SchemaStore;
  registryStore!: RegistryStore;
  stagingStore!: StagingStore;
  queueStore!: QueueStore;
  batchStateStore!: BatchStateStore;
  backupManager!: BackupManager;

  async onload(): Promise<void> {
    await this.loadSettings();

    // 基础设施
    this.operationLock = new OperationLock();

    // 数据存储
    this.schemaStore = new SchemaStore(this.app, this.manifest);
    this.registryStore = new RegistryStore(this.app, this.manifest);
    this.stagingStore = new StagingStore(this.app, this.manifest);
    this.queueStore = new QueueStore(this.app, this.manifest);
    this.batchStateStore = new BatchStateStore(this.app, this.manifest);
    this.backupManager = new BackupManager(this.app, this.manifest);

    // 种子数据初始化（幂等）
    const seeder = new SeedInitializer(this.schemaStore, this.registryStore);
    await seeder.initialize();

    // 设置面板
    this.addSettingTab(new TootSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
