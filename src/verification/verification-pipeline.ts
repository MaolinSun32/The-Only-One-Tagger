import type TheOnlyOneTagger from '../main';
import type { VerificationResult, TagEntry } from '../types';
import { WikipediaClient } from './wikipedia-client';
import { AIVerifier } from './ai-verifier';

/**
 * 3-tier verification orchestrator:
 *   Tier 1: Local registry (free, instant)
 *   Tier 2: Wikipedia API (free, network)
 *   Tier 3: AI + web search (paid, network)
 *
 * Now includes `needs_review` status per dev-plan §3.2.
 */
export class VerificationPipeline {
	private plugin: TheOnlyOneTagger;

	constructor(plugin: TheOnlyOneTagger) {
		this.plugin = plugin;
	}

	async verify(tagId: string, tagLabel: string, facet: string, sourceNote = ''): Promise<VerificationResult> {
		// ── Tier 1: Local registry ──────────────────────
		const existing = this.plugin.registryStore.getTag(tagId);
		if (existing && existing.status === 'verified') {
			return {
				tagId,
				status: 'verified',
				source: existing.source.verified_by,
				canonicalLabel: existing.label,
				url: existing.source.url,
				reason: 'Already verified in local registry',
			};
		}

		// If offline, queue and return pending
		if (this.plugin.settings.offlineMode) {
			this.plugin.queueStore.enqueue(tagLabel, facet, 'ai', sourceNote);
			await this.plugin.queueStore.save();
			return {
				tagId,
				status: 'pending',
				source: 'seed',
				reason: 'Queued for verification (offline mode)',
			};
		}

		// ── Tier 2: Wikipedia ───────────────────────────
		if (this.plugin.settings.useWikipedia) {
			try {
				const wiki = new WikipediaClient(this.plugin.settings.wikipediaLang);
				const wikiResult = await wiki.verifyTerm(tagLabel);

				if (wikiResult) {
					const result: VerificationResult = {
						tagId,
						status: 'verified',
						source: 'wikipedia',
						canonicalLabel: wikiResult.canonicalTitle,
						url: wikiResult.url,
						reason: wikiResult.description,
					};
					await this.updateRegistry(tagId, tagLabel, facet, result);
					return result;
				}
			} catch (err) {
				console.warn('Wikipedia verification failed, falling through to AI:', err);
			}
		}

		// ── Tier 3: AI + web search ─────────────────────
		try {
			const verifier = new AIVerifier(
				this.plugin.settings.verification,
				this.plugin.settings.timeoutMs,
			);
			const result = await verifier.verifyTag(tagId, tagLabel, facet);

			// AI uncertain → needs_review instead of rejected
			if (result.status === 'rejected' && result.reason?.includes('uncertain')) {
				result.status = 'needs_review';
			}

			await this.updateRegistry(tagId, tagLabel, facet, result);
			return result;
		} catch (err) {
			console.error('AI verification failed:', err);
			// All tiers failed — queue for later
			this.plugin.queueStore.enqueue(tagLabel, facet, 'ai', sourceNote);
			await this.plugin.queueStore.save();
			return {
				tagId,
				status: 'needs_review',
				source: 'seed',
				reason: 'Verification failed, queued for retry',
			};
		}
	}

	async verifyAllPending(): Promise<VerificationResult[]> {
		const results: VerificationResult[] = [];
		const allTags = this.plugin.registryStore.registry.tags;

		for (const [id, entry] of Object.entries(allTags)) {
			if (entry.status !== 'pending' && entry.status !== 'needs_review') continue;
			const result = await this.verify(id, entry.label, entry.facet);
			results.push(result);
		}

		return results;
	}

	async drainQueue(): Promise<VerificationResult[]> {
		const queued = this.plugin.queueStore.dequeueAll();
		await this.plugin.queueStore.save();

		const results: VerificationResult[] = [];
		for (const item of queued) {
			const tagId = item.tag_label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
			const result = await this.verify(tagId, item.tag_label, item.facet, item.source_note);
			results.push(result);
		}
		return results;
	}

	private async updateRegistry(
		tagId: string,
		tagLabel: string,
		facet: string,
		result: VerificationResult,
	): Promise<void> {
		const existing = this.plugin.registryStore.getTag(tagId);
		const entry: TagEntry = existing ?? {
			label: tagLabel,
			aliases: [],
			facet,
			status: 'pending',
			relations: { broader: [], narrower: [], related: [] },
			source: { verified_by: 'seed' },
		};

		entry.status = result.status;
		entry.source = {
			verified_by: result.source,
			url: result.url,
			verified_at: new Date().toISOString().split('T')[0],
		};
		if (result.canonicalLabel) {
			entry.label = result.canonicalLabel;
		}

		this.plugin.registryStore.setTag(tagId, entry);
		await this.plugin.registryStore.save();
	}
}
