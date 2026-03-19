import { Plugin, Notice, normalizePath, type WorkspaceLeaf } from 'obsidian';
import type { TootSettings } from './types';
import { DEFAULT_SETTINGS, TOOT_VIEW_TYPE, MERGE_STATE_FILE } from './constants';
import { OperationLock } from './operation-lock';
import { SchemaStore } from './storage/schema-store';
import { RegistryStore } from './storage/registry-store';
import { StagingStore } from './storage/staging-store';
import { QueueStore } from './storage/queue-store';
import { BatchStateStore } from './storage/batch-state-store';
import { BackupManager } from './storage/backup-manager';
import { SeedInitializer } from './seed/initializer';
import { TootSettingTab } from './settings';
// M3 engine
import { SchemaResolver } from './engine/schema-resolver';
import { TagMatcher } from './engine/tag-matcher';
import { PromptFilterBuilder } from './engine/prompt-filter-builder';
// M4 network
import { HttpClient } from './network/http-client';
import { HealthChecker } from './network/health-checker';
import { NetworkStatusAggregator } from './network/network-status-aggregator';
// M4 AI
import { RateLimiter } from './ai/rate-limiter';
import { OpenAICompatibleProvider } from './ai/openai-compatible';
import { PromptAssembler } from './ai/prompt-assembler';
import { AIResponseValidator } from './ai/ai-response-validator';
import { WikilinkCandidateCollector } from './ai/wikilink-candidate-collector';
import { TagNormalizer } from './engine/tag-normalizer';
// M4 verification
import { WikipediaClient } from './verification/wikipedia-client';
import { SearchClient } from './verification/search-client';
import { AIVerifier } from './verification/ai-verifier';
import { VerificationPipeline } from './verification/verification-pipeline';
import { VerificationQueueManager } from './verification/verification-queue-manager';
// M3 engine (additional)
import { FrontmatterService } from './engine/frontmatter-service';
import { ContentHasher } from './engine/content-hasher';
// M5 operations
import { AnalysisOrchestrator } from './operations/analysis-orchestrator';
import { TagOperationExecutor } from './operations/tag-operation-executor';
import { TypeOperationExecutor } from './operations/type-operation-executor';
// M6 UI
import { TagReviewView } from './ui/tag-review-view';
// M7 batch
import { VaultScanner } from './batch/vault-scanner';
import { BatchProcessor } from './batch/batch-processor';
import { BatchStateManager } from './batch/batch-state-manager';
import { BatchStatusBarItem } from './ui/batch-status-bar';
import { BatchProgressModal } from './ui/batch-progress-modal';
// M8 management
import { TagMerger } from './management/tag-merger';
import { ImportExportManager } from './management/import-export-manager';
import { RelationDiscoverer } from './management/relation-discoverer';
import { TagBrowserModal } from './ui/tag-browser-modal';
import { StatisticsPanel } from './ui/statistics-panel';

export default class TheOnlyOneTagger extends Plugin {
  settings!: TootSettings;
  operationLock!: OperationLock;

  // M1/M2 存储
  schemaStore!: SchemaStore;
  registryStore!: RegistryStore;
  stagingStore!: StagingStore;
  queueStore!: QueueStore;
  batchStateStore!: BatchStateStore;
  backupManager!: BackupManager;

  // M3 engine
  schemaResolver!: SchemaResolver;
  tagMatcher!: TagMatcher;
  promptFilterBuilder!: PromptFilterBuilder;

  // M4 网络
  httpClient!: HttpClient;
  generationChecker!: HealthChecker;
  verificationChecker!: HealthChecker;
  searchChecker!: HealthChecker;
  wikipediaChecker!: HealthChecker;
  networkAggregator!: NetworkStatusAggregator;

  // M4 AI
  rateLimiter!: RateLimiter;
  generationProvider!: OpenAICompatibleProvider;
  verificationProvider!: OpenAICompatibleProvider;
  promptAssembler!: PromptAssembler;
  aiResponseValidator!: AIResponseValidator;
  wikilinkCandidateCollector!: WikilinkCandidateCollector;

  // M4 验证
  wikipediaClient!: WikipediaClient;
  searchClient!: SearchClient;
  aiVerifier!: AIVerifier;
  verificationPipeline!: VerificationPipeline;
  verificationQueueManager!: VerificationQueueManager;

  // M3 engine (additional)
  frontmatterService!: FrontmatterService;
  contentHasher!: ContentHasher;

  // M5 业务编排
  analysisOrchestrator!: AnalysisOrchestrator;
  tagOperationExecutor!: TagOperationExecutor;
  typeOperationExecutor!: TypeOperationExecutor;

  // M7 批量处理
  vaultScanner!: VaultScanner;
  batchStateManager!: BatchStateManager;
  batchProcessor!: BatchProcessor;
  batchStatusBarItem!: BatchStatusBarItem;

  // M8 标签库管理
  tagMerger!: TagMerger;
  importExportManager!: ImportExportManager;
  relationDiscoverer!: RelationDiscoverer;
  statisticsPanel!: StatisticsPanel;

  async onload(): Promise<void> {
    await this.loadSettings();

    // 基础设施
    this.operationLock = new OperationLock();

    // ── M1/M2 数据存储 ──
    this.schemaStore = new SchemaStore(this.app, this.manifest);
    this.registryStore = new RegistryStore(this.app, this.manifest);
    this.stagingStore = new StagingStore(this.app, this.manifest);
    this.queueStore = new QueueStore(this.app, this.manifest);
    this.batchStateStore = new BatchStateStore(this.app, this.manifest);
    this.backupManager = new BackupManager(this.app, this.manifest);

    // 种子数据初始化（幂等）
    const seeder = new SeedInitializer(this.schemaStore, this.registryStore);
    await seeder.initialize();

    // ── M3 engine ──
    const schema = await this.schemaStore.load();
    this.schemaResolver = new SchemaResolver(schema);
    this.tagMatcher = new TagMatcher(this.registryStore);
    this.promptFilterBuilder = new PromptFilterBuilder(this.schemaResolver, this.registryStore);

    // ── M4 网络层 ──
    this.httpClient = new HttpClient({ request_timeout_ms: this.settings.request_timeout_ms });
    this.rateLimiter = new RateLimiter();

    this.generationChecker = new HealthChecker({
      name: 'generation',
      getEndpoint: () => `${this.settings.generation_base_url}/models`,
      getApiKey: () => this.settings.generation_api_key,
      pingIntervalMs: this.settings.ping_interval_ms,
      httpClient: this.httpClient,
    });
    this.verificationChecker = new HealthChecker({
      name: 'verification',
      getEndpoint: () => `${this.settings.verification_base_url}/models`,
      getApiKey: () => this.settings.verification_api_key,
      pingIntervalMs: this.settings.ping_interval_ms,
      httpClient: this.httpClient,
    });
    this.searchChecker = new HealthChecker({
      name: 'search',
      getEndpoint: () => {
        // Brave: 用简单查询 ping；Tavily: 用 base URL
        if (this.settings.search_type === 'brave') {
          const base = this.settings.search_base_url || 'https://api.search.brave.com/res/v1/web/search';
          return `${base}?q=test&count=1`;
        }
        return this.settings.search_base_url;
      },
      getApiKey: () => this.settings.search_api_key,
      pingIntervalMs: this.settings.ping_interval_ms,
      httpClient: this.httpClient,
      buildPingHeaders: (apiKey): Record<string, string> => {
        // Brave 用 X-Subscription-Token，Tavily 用 Authorization
        if (this.settings.search_type === 'brave') {
          return { 'X-Subscription-Token': apiKey };
        }
        return { 'Authorization': `Bearer ${apiKey}` };
      },
    });
    this.wikipediaChecker = new HealthChecker({
      name: 'wikipedia',
      getEndpoint: () =>
        `https://${this.settings.knowledge_base_lang}.wikipedia.org/w/api.php?action=query&meta=siteinfo&format=json`,
      getApiKey: () => 'wikipedia', // 始终非空，使 checker 不进入 not_configured
      pingIntervalMs: this.settings.ping_interval_ms,
      httpClient: this.httpClient,
      buildPingHeaders: () => ({}), // Wikipedia 不需要认证
    });

    this.networkAggregator = new NetworkStatusAggregator({
      generation: this.generationChecker,
      verification: this.verificationChecker,
      search: this.searchChecker,
      wikipedia: this.wikipediaChecker,
    });

    // ── M4 AI 层 ──
    this.wikilinkCandidateCollector = new WikilinkCandidateCollector(this.app);

    this.promptAssembler = new PromptAssembler({
      app: this.app,
      schemaResolver: this.schemaResolver,
      promptFilterBuilder: this.promptFilterBuilder,
      wikilinkCandidateCollector: this.wikilinkCandidateCollector,
    });

    this.generationProvider = new OpenAICompatibleProvider({
      apiKey: this.settings.generation_api_key,
      baseUrl: this.settings.generation_base_url,
      model: this.settings.generation_model,
      temperature: this.settings.generation_temperature,
      maxTokens: this.settings.generation_max_tokens,
      enableThinking: this.settings.enable_thinking,
      httpClient: this.httpClient,
      rateLimiter: this.rateLimiter,
    });
    this.generationProvider.setPromptAssembler(this.promptAssembler);

    this.verificationProvider = new OpenAICompatibleProvider({
      apiKey: this.settings.verification_api_key,
      baseUrl: this.settings.verification_base_url,
      model: this.settings.verification_model,
      temperature: this.settings.verification_temperature,
      httpClient: this.httpClient,
      rateLimiter: this.rateLimiter,
    });

    this.aiResponseValidator = new AIResponseValidator({
      schemaResolver: this.schemaResolver,
      tagMatcher: this.tagMatcher,
      tagNormalizer: TagNormalizer,
      registryStore: this.registryStore,
    });

    // ── M4 验证层 ──
    this.wikipediaClient = new WikipediaClient({
      httpClient: this.httpClient,
      lang: this.settings.knowledge_base_lang,
    });

    this.searchClient = new SearchClient({
      httpClient: this.httpClient,
      searchType: this.settings.search_type,
      apiKey: this.settings.search_api_key,
      baseUrl: this.settings.search_base_url,
    });

    this.aiVerifier = new AIVerifier({
      searchClient: this.searchClient,
      verificationProvider: this.verificationProvider,
    });

    this.verificationPipeline = new VerificationPipeline({
      wikipediaClient: this.wikipediaClient,
      aiVerifier: this.aiVerifier,
      wikipediaChecker: this.wikipediaChecker,
      searchChecker: this.searchChecker,
      stagingStore: this.stagingStore,
      settings: {
        use_knowledge_base: this.settings.use_knowledge_base,
        request_timeout_ms: this.settings.request_timeout_ms,
      },
    });

    this.verificationQueueManager = new VerificationQueueManager({
      queueStore: this.queueStore,
      verificationPipeline: this.verificationPipeline,
      stagingStore: this.stagingStore,
      registryStore: this.registryStore,
      networkAggregator: this.networkAggregator,
    });

    // ── M5 业务编排 ──
    this.frontmatterService = new FrontmatterService(this.app);
    this.contentHasher = new ContentHasher(this.app);

    this.analysisOrchestrator = new AnalysisOrchestrator({
      app: this.app,
      schemaResolver: this.schemaResolver,
      generationProvider: this.generationProvider,
      promptFilterBuilder: this.promptFilterBuilder,
      frontmatterService: this.frontmatterService,
      aiResponseValidator: this.aiResponseValidator,
      stagingStore: this.stagingStore,
      registryStore: this.registryStore,
      contentHasher: this.contentHasher,
      verificationPipeline: this.verificationPipeline,
      wikilinkCandidateCollector: this.wikilinkCandidateCollector,
      settings: {
        max_tags_per_facet: this.settings.max_tags_per_facet,
        max_wikilink_candidates: this.settings.max_wikilink_candidates,
      },
    });

    this.tagOperationExecutor = new TagOperationExecutor({
      stagingStore: this.stagingStore,
      registryStore: this.registryStore,
      frontmatterService: this.frontmatterService,
      schemaResolver: this.schemaResolver,
      tagMatcher: this.tagMatcher,
      generationProvider: this.generationProvider,
      verificationPipeline: this.verificationPipeline,
      verificationQueueManager: this.verificationQueueManager,
      networkStatusAggregator: this.networkAggregator,
      operationLock: this.operationLock,
    });

    this.typeOperationExecutor = new TypeOperationExecutor({
      analysisOrchestrator: this.analysisOrchestrator,
      stagingStore: this.stagingStore,
      frontmatterService: this.frontmatterService,
    });

    // ── 启动 ──
    this.generationChecker.start();
    this.verificationChecker.start();
    this.searchChecker.start();
    this.wikipediaChecker.start();
    this.verificationQueueManager.start();
    await this.verificationQueueManager.cleanupOnStartup();

    // ── M6 UI ──
    this.registerView(TOOT_VIEW_TYPE, (leaf) => new TagReviewView(leaf, this));

    this.addRibbonIcon('tags', 'The Only One Tagger', () => {
      this.activateView();
    });

    this.addCommand({
      id: 'open-tag-review',
      name: '打开标签审核侧边栏',
      callback: () => { this.activateView(); },
    });

    this.addCommand({
      id: 'analyze-current-note',
      name: '分析当前笔记',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (checking) return true;
        this.analysisOrchestrator.analyzeNote(file);
        return true;
      },
    });

    // ── M7 批量处理 ──
    this.vaultScanner = new VaultScanner(this.app);
    this.batchStateManager = new BatchStateManager(this.batchStateStore);
    this.batchProcessor = new BatchProcessor(
      this.analysisOrchestrator,
      this.rateLimiter,
      this.batchStateManager,
      this.operationLock,
      this.settings,
    );
    this.batchProcessor.setVaultScanner(this.vaultScanner);

    const statusBarEl = this.addStatusBarItem();
    this.batchStatusBarItem = new BatchStatusBarItem(
      statusBarEl,
      this.batchProcessor,
      () => new BatchProgressModal(
        this.app,
        this.batchProcessor,
        this.batchStateManager,
        this.stagingStore,
        this.analysisOrchestrator,
      ).open(),
    );

    this.addCommand({
      id: 'batch-tag',
      name: '批量打标',
      callback: () => {
        const files = this.vaultScanner.scan({
          folders: [],
          skip_tagged: true,
        });
        if (files.length === 0) {
          new Notice('没有需要处理的笔记');
          return;
        }
        this.batchProcessor.start(files, { folders: [], skip_tagged: true });
        this.batchStatusBarItem.show();
      },
    });

    // ── M8 标签库管理 ──
    const mergeStatePath = normalizePath(this.manifest.dir + '/' + MERGE_STATE_FILE);
    this.tagMerger = new TagMerger(
      this.app,
      mergeStatePath,
      this.registryStore,
      this.stagingStore,
      this.frontmatterService,
      this.backupManager,
      this.operationLock,
      this.schemaResolver,
    );
    this.importExportManager = new ImportExportManager(this.registryStore);
    this.statisticsPanel = new StatisticsPanel(this.app, this.registryStore);
    this.relationDiscoverer = new RelationDiscoverer(
      this.registryStore,
      this.httpClient,
      this.rateLimiter,
      {
        apiKey: this.settings.generation_api_key,
        baseUrl: this.settings.generation_base_url,
        model: this.settings.generation_model,
        temperature: this.settings.generation_temperature,
      },
    );

    this.addCommand({
      id: 'open-tag-browser',
      name: '标签库浏览器',
      callback: () => {
        new TagBrowserModal(
          this.app,
          this.registryStore,
          this.tagMerger,
          this.importExportManager,
          this.statisticsPanel,
          this.relationDiscoverer,
        ).open();
      },
    });

    // ── 启动恢复检测 ──
    this.detectAndRecoverIncomplete();

    // 设置面板
    this.addSettingTab(new TootSettingTab(this.app, this));
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(TOOT_VIEW_TYPE);
    this.generationChecker.stop();
    this.verificationChecker.stop();
    this.searchChecker.stop();
    this.wikipediaChecker.stop();
    this.verificationQueueManager.stop();

    // M7 cleanup
    if (this.batchProcessor?.getState() === 'running') {
      this.batchProcessor.terminate();
    }
    this.batchStatusBarItem?.hide();
  }

  /** M7/M8 启动恢复检测（fire-and-forget） */
  private async detectAndRecoverIncomplete(): Promise<void> {
    try {
      // M7: 批量处理恢复
      if (await this.batchStateManager.hasIncomplete()) {
        new Notice('检测到未完成的批量处理任务。可通过命令面板"批量打标"继续。', 8000);
        this.batchStatusBarItem.show();
        this.batchStatusBarItem.update(0, 0);
      }

      // M8: 标签合并恢复（包含 YAML 修改 + staging 清理 + registry 写入）
      const mergeResult = await this.tagMerger.resumeIncomplete();
      if (mergeResult) {
        new Notice(`标签合并恢复完成：${mergeResult.completed} 成功，${mergeResult.failed} 失败`);
      }
    } catch (e) {
      console.error('[TOOT] Startup recovery failed', e);
    }
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(TOOT_VIEW_TYPE)[0];
    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (!rightLeaf) return;
      await rightLeaf.setViewState({ type: TOOT_VIEW_TYPE, active: true });
      leaf = rightLeaf;
    }
    workspace.revealLeaf(leaf);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
