import { PluginSettingTab, Setting, type App } from 'obsidian';
import type TheOnlyOneTagger from './main';

export class TootSettingTab extends PluginSettingTab {
  plugin: TheOnlyOneTagger;

  constructor(app: App, plugin: TheOnlyOneTagger) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ── Generation AI ──
    containerEl.createEl('h3', { text: 'Generation AI' });
    containerEl.createEl('p', {
      text: '需要支持多模态输入（图像、文本、音频）的 OpenAI-compatible API',
      cls: 'setting-item-description',
    });

    new Setting(containerEl)
      .setName('API Key')
      .addText(text => text
        .setPlaceholder('sk-...')
        .setValue(this.plugin.settings.generation_api_key)
        .onChange(async v => { this.plugin.settings.generation_api_key = v; await this.plugin.saveSettings(); })
        .inputEl.type = 'password');

    new Setting(containerEl)
      .setName('Base URL')
      .addText(text => text
        .setPlaceholder('https://api.openai.com/v1')
        .setValue(this.plugin.settings.generation_base_url)
        .onChange(async v => { this.plugin.settings.generation_base_url = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Model')
      .addText(text => text
        .setPlaceholder('gpt-4o')
        .setValue(this.plugin.settings.generation_model)
        .onChange(async v => { this.plugin.settings.generation_model = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Temperature')
      .setDesc('0.0–2.0')
      .addText(text => text
        .setValue(String(this.plugin.settings.generation_temperature))
        .onChange(async v => { this.plugin.settings.generation_temperature = parseFloat(v) || 0.7; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Max Tokens')
      .addText(text => text
        .setValue(String(this.plugin.settings.generation_max_tokens))
        .onChange(async v => { this.plugin.settings.generation_max_tokens = parseInt(v, 10) || 2048; await this.plugin.saveSettings(); }));

    // ── Verification AI ──
    containerEl.createEl('h3', { text: 'Verification AI' });
    containerEl.createEl('p', {
      text: '推荐使用任意 OpenAI-compatible API',
      cls: 'setting-item-description',
    });

    new Setting(containerEl)
      .setName('API Key')
      .addText(text => text
        .setPlaceholder('sk-...')
        .setValue(this.plugin.settings.verification_api_key)
        .onChange(async v => { this.plugin.settings.verification_api_key = v; await this.plugin.saveSettings(); })
        .inputEl.type = 'password');

    new Setting(containerEl)
      .setName('Base URL')
      .addText(text => text
        .setPlaceholder('https://api.openai.com/v1')
        .setValue(this.plugin.settings.verification_base_url)
        .onChange(async v => { this.plugin.settings.verification_base_url = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Model')
      .addText(text => text
        .setPlaceholder('gpt-4o-mini')
        .setValue(this.plugin.settings.verification_model)
        .onChange(async v => { this.plugin.settings.verification_model = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Temperature')
      .setDesc('0.0–2.0')
      .addText(text => text
        .setValue(String(this.plugin.settings.verification_temperature))
        .onChange(async v => { this.plugin.settings.verification_temperature = parseFloat(v) || 0.3; await this.plugin.saveSettings(); }));

    // ── Search API ──
    containerEl.createEl('h3', { text: 'Search API' });
    containerEl.createEl('p', {
      text: '用于标签验证的网页搜索，支持 Brave Search 和 Tavily Search',
      cls: 'setting-item-description',
    });

    new Setting(containerEl)
      .setName('Search Type')
      .addDropdown(dd => dd
        .addOption('brave', 'Brave Search')
        .addOption('tavily', 'Tavily Search')
        .setValue(this.plugin.settings.search_type)
        .onChange(async v => { this.plugin.settings.search_type = v as 'brave' | 'tavily'; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('API Key')
      .addText(text => text
        .setPlaceholder('API key')
        .setValue(this.plugin.settings.search_api_key)
        .onChange(async v => { this.plugin.settings.search_api_key = v; await this.plugin.saveSettings(); })
        .inputEl.type = 'password');

    new Setting(containerEl)
      .setName('Base URL')
      .setDesc('留空使用默认地址')
      .addText(text => text
        .setValue(this.plugin.settings.search_base_url)
        .onChange(async v => { this.plugin.settings.search_base_url = v; await this.plugin.saveSettings(); }));

    // ── Knowledge Base ──
    containerEl.createEl('h3', { text: 'Knowledge Base' });

    new Setting(containerEl)
      .setName('Source')
      .addText(text => text
        .setValue(this.plugin.settings.knowledge_base_source)
        .onChange(async v => { this.plugin.settings.knowledge_base_source = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Language')
      .addText(text => text
        .setValue(this.plugin.settings.knowledge_base_lang)
        .onChange(async v => { this.plugin.settings.knowledge_base_lang = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Enable Knowledge Base')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.use_knowledge_base)
        .onChange(async v => { this.plugin.settings.use_knowledge_base = v; await this.plugin.saveSettings(); }));

    // ── 标签行为 ──
    containerEl.createEl('h3', { text: '标签行为' });

    new Setting(containerEl)
      .setName('Max Tags Per Facet')
      .setDesc('每个 facet 最多生成的标签数')
      .addText(text => text
        .setValue(String(this.plugin.settings.max_tags_per_facet))
        .onChange(async v => { this.plugin.settings.max_tags_per_facet = parseInt(v, 10) || 5; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Regenerate Count')
      .setDesc('每次 Regenerate 的同义词数量')
      .addText(text => text
        .setValue(String(this.plugin.settings.regenerate_count))
        .onChange(async v => { this.plugin.settings.regenerate_count = parseInt(v, 10) || 5; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Max Wikilink Candidates')
      .setDesc('wikilink 候选池上限')
      .addText(text => text
        .setValue(String(this.plugin.settings.max_wikilink_candidates))
        .onChange(async v => { this.plugin.settings.max_wikilink_candidates = parseInt(v, 10) || 100; await this.plugin.saveSettings(); }));

    // ── 批量处理 & 网络 ──
    containerEl.createEl('h3', { text: '批量处理 & 网络' });

    new Setting(containerEl)
      .setName('Batch Concurrency')
      .setDesc('批量处理并发度')
      .addText(text => text
        .setValue(String(this.plugin.settings.batch_concurrency))
        .onChange(async v => { this.plugin.settings.batch_concurrency = parseInt(v, 10) || 1; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Max Batch Size')
      .setDesc('单次批量处理最大笔记数')
      .addText(text => text
        .setValue(String(this.plugin.settings.max_batch_size))
        .onChange(async v => { this.plugin.settings.max_batch_size = parseInt(v, 10) || 50; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Request Timeout (ms)')
      .setDesc('单个请求超时（毫秒）')
      .addText(text => text
        .setValue(String(this.plugin.settings.request_timeout_ms))
        .onChange(async v => { this.plugin.settings.request_timeout_ms = parseInt(v, 10) || 30000; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Ping Interval (ms)')
      .setDesc('健康检查间隔（毫秒）')
      .addText(text => text
        .setValue(String(this.plugin.settings.ping_interval_ms))
        .onChange(async v => { this.plugin.settings.ping_interval_ms = parseInt(v, 10) || 60000; await this.plugin.saveSettings(); }));
  }
}
