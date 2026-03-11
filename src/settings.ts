import { App, PluginSettingTab, Setting } from 'obsidian';
import type TheOnlyOneTagger from './main';

// ─── AI Provider IDs ─────────────────────────────────────────

export type AIProviderId = 'deepseek' | 'qwen' | 'kimi' | 'perplexity' | 'custom';

export interface AIProviderConfig {
	provider: AIProviderId;
	apiKey: string;
	baseUrl: string;
	model: string;
}

// ─── Plugin Settings ─────────────────────────────────────────

export interface PluginSettings {
	// Tag generation AI
	generation: AIProviderConfig;
	// Verification AI (separate provider, typically with web search)
	verification: AIProviderConfig;

	// Behavior
	autoAcceptThreshold: number;   // 0–1, 0 = disabled
	maxTagsPerFacet: number;

	// Wikipedia
	useWikipedia: boolean;
	wikipediaLang: string;

	// Advanced
	timeoutMs: number;
	batchConcurrency: number;
	rateLimitRpm: number;
	offlineMode: boolean;
}

// ─── Defaults ────────────────────────────────────────────────

const DEFAULT_DEEPSEEK: AIProviderConfig = {
	provider: 'deepseek',
	apiKey: '',
	baseUrl: 'https://api.deepseek.com',
	model: 'deepseek-chat',
};

const DEFAULT_QWEN: AIProviderConfig = {
	provider: 'qwen',
	apiKey: '',
	baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode',
	model: 'qwen-plus',
};

export const DEFAULT_SETTINGS: PluginSettings = {
	generation: { ...DEFAULT_DEEPSEEK },
	verification: { ...DEFAULT_QWEN },
	autoAcceptThreshold: 0,
	maxTagsPerFacet: 5,
	useWikipedia: true,
	wikipediaLang: 'en',
	timeoutMs: 30_000,
	batchConcurrency: 1,
	rateLimitRpm: 20,
	offlineMode: false,
};

// ─── Provider display info ───────────────────────────────────

const PROVIDER_OPTIONS: Record<AIProviderId, { name: string; defaultUrl: string; defaultModel: string }> = {
	deepseek:   { name: 'DeepSeek',    defaultUrl: 'https://api.deepseek.com',                       defaultModel: 'deepseek-chat' },
	qwen:       { name: 'Qwen',        defaultUrl: 'https://dashscope.aliyuncs.com/compatible-mode', defaultModel: 'qwen-plus' },
	kimi:       { name: 'Kimi',        defaultUrl: 'https://api.moonshot.cn',                        defaultModel: 'moonshot-v1-8k' },
	perplexity: { name: 'Perplexity',  defaultUrl: 'https://api.perplexity.ai',                      defaultModel: 'sonar' },
	custom:     { name: 'Custom',      defaultUrl: '',                                               defaultModel: '' },
};

// ─── Settings Tab ────────────────────────────────────────────

export class TaggerSettingTab extends PluginSettingTab {
	plugin: TheOnlyOneTagger;

	constructor(app: App, plugin: TheOnlyOneTagger) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// ── Generation AI ─────────────────────────────────
		containerEl.createEl('h2', { text: 'Tag Generation AI' });
		containerEl.createEl('p', {
			text: 'Used for bulk tag suggestion. Pick a cheap, fast model.',
			cls: 'setting-item-description',
		});
		this.renderProviderSection(containerEl, 'generation');

		// ── Verification AI ───────────────────────────────
		containerEl.createEl('h2', { text: 'Tag Verification AI' });
		containerEl.createEl('p', {
			text: 'Used to verify new tags via web search. Pick a model with search capability.',
			cls: 'setting-item-description',
		});
		this.renderProviderSection(containerEl, 'verification');

		// ── Wikipedia ─────────────────────────────────────
		containerEl.createEl('h2', { text: 'Wikipedia Verification' });

		new Setting(containerEl)
			.setName('Enable Wikipedia verification')
			.setDesc('Use Wikipedia API as tier-2 verification (free). Disable if blocked in your region.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useWikipedia)
				.onChange(async (value) => {
					this.plugin.settings.useWikipedia = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Wikipedia language')
			.setDesc('Language code for Wikipedia API (e.g. en, zh).')
			.addText(text => text
				.setPlaceholder('en')
				.setValue(this.plugin.settings.wikipediaLang)
				.onChange(async (value) => {
					this.plugin.settings.wikipediaLang = value || 'en';
					await this.plugin.saveSettings();
				}));

		// ── Behavior ──────────────────────────────────────
		containerEl.createEl('h2', { text: 'Behavior' });

		new Setting(containerEl)
			.setName('Auto-accept threshold')
			.setDesc('Tags with confidence above this are auto-accepted. 0 = manual review for all.')
			.addSlider(slider => slider
				.setLimits(0, 1, 0.05)
				.setValue(this.plugin.settings.autoAcceptThreshold)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.autoAcceptThreshold = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Max tags per facet')
			.setDesc('Maximum number of tags the AI should suggest per facet.')
			.addSlider(slider => slider
				.setLimits(1, 20, 1)
				.setValue(this.plugin.settings.maxTagsPerFacet)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.maxTagsPerFacet = value;
					await this.plugin.saveSettings();
				}));

		// ── Advanced ──────────────────────────────────────
		containerEl.createEl('h2', { text: 'Advanced' });

		new Setting(containerEl)
			.setName('Request timeout (ms)')
			.addText(text => text
				.setPlaceholder('30000')
				.setValue(String(this.plugin.settings.timeoutMs))
				.onChange(async (value) => {
					const n = parseInt(value, 10);
					if (!isNaN(n) && n > 0) {
						this.plugin.settings.timeoutMs = n;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Batch concurrency')
			.setDesc('Number of notes to process in parallel during batch tagging.')
			.addSlider(slider => slider
				.setLimits(1, 5, 1)
				.setValue(this.plugin.settings.batchConcurrency)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.batchConcurrency = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Rate limit (requests/min)')
			.addSlider(slider => slider
				.setLimits(1, 60, 1)
				.setValue(this.plugin.settings.rateLimitRpm)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.rateLimitRpm = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Offline mode')
			.setDesc('Only use local registry for tagging. Queue all verifications for later.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.offlineMode)
				.onChange(async (value) => {
					this.plugin.settings.offlineMode = value;
					await this.plugin.saveSettings();
				}));
	}

	/** Render provider dropdown + API key + base URL + model for a config section. */
	private renderProviderSection(
		containerEl: HTMLElement,
		section: 'generation' | 'verification',
	): void {
		const config = this.plugin.settings[section];

		new Setting(containerEl)
			.setName('Provider')
			.addDropdown(dropdown => {
				for (const [id, info] of Object.entries(PROVIDER_OPTIONS)) {
					dropdown.addOption(id, info.name);
				}
				dropdown.setValue(config.provider);
				dropdown.onChange(async (value) => {
					const pid = value as AIProviderId;
					config.provider = pid;
					const defaults = PROVIDER_OPTIONS[pid];
					if (defaults) {
						config.baseUrl = defaults.defaultUrl;
						config.model = defaults.defaultModel;
					}
					await this.plugin.saveSettings();
					this.display(); // re-render to update fields
				});
			});

		new Setting(containerEl)
			.setName('API Key')
			.addText(text => text
				.setPlaceholder('sk-...')
				.setValue(config.apiKey)
				.onChange(async (value) => {
					config.apiKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Base URL')
			.addText(text => text
				.setPlaceholder('https://api.example.com')
				.setValue(config.baseUrl)
				.onChange(async (value) => {
					config.baseUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Model')
			.addText(text => text
				.setPlaceholder('model-name')
				.setValue(config.model)
				.onChange(async (value) => {
					config.model = value;
					await this.plugin.saveSettings();
				}));
	}
}
