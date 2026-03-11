import { App, TFile, TFolder } from 'obsidian';

export interface ScanOptions {
	/** Only include files in these folders (empty = all). */
	includeFolders: string[];
	/** Exclude files in these folders. */
	excludeFolders: string[];
	/** If true, only include files that have no existing tags. */
	untaggedOnly: boolean;
}

/**
 * Scans the vault for markdown files matching filter criteria.
 */
export class VaultScanner {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	/**
	 * Enumerate markdown files matching the scan options.
	 * Returns files sorted by path for deterministic ordering.
	 */
	scan(options: Partial<ScanOptions> = {}): TFile[] {
		const allFiles = this.app.vault.getMarkdownFiles();

		let filtered = allFiles;

		// Include folders filter
		if (options.includeFolders && options.includeFolders.length > 0) {
			filtered = filtered.filter(f =>
				options.includeFolders!.some(folder => f.path.startsWith(folder + '/') || f.path.startsWith(folder))
			);
		}

		// Exclude folders filter
		if (options.excludeFolders && options.excludeFolders.length > 0) {
			filtered = filtered.filter(f =>
				!options.excludeFolders!.some(folder => f.path.startsWith(folder + '/') || f.path.startsWith(folder))
			);
		}

		// Untagged only: notes that haven't been tagged by this plugin yet
		if (options.untaggedOnly) {
			filtered = filtered.filter(f => {
				const cache = this.app.metadataCache.getFileCache(f);
				const fm = cache?.frontmatter;
				// Consider untagged if no _tag_status or _tag_status !== 'confirmed'
				return !fm?.['_tag_status'] || fm['_tag_status'] !== 'confirmed';
			});
		}

		return filtered.sort((a, b) => a.path.localeCompare(b.path));
	}

	/** Get all top-level folders for the UI filter. */
	getTopFolders(): string[] {
		const root = this.app.vault.getRoot();
		const folders: string[] = [];
		for (const child of root.children) {
			if (child instanceof TFolder) {
				folders.push(child.path);
			}
		}
		return folders.sort();
	}
}
