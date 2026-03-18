// Minimal obsidian mock for vitest
// Only exports types/classes that engine tests reference

export type App = {
  vault: {
    read: (file: TFile) => Promise<string>;
    adapter: {
      read: (path: string) => Promise<string>;
      write: (path: string, data: string) => Promise<void>;
    };
  };
  fileManager: {
    processFrontMatter: (file: TFile, fn: (frontmatter: Record<string, unknown>) => void) => Promise<void>;
  };
  metadataCache: {
    getFileCache: (file: TFile) => { frontmatter?: Record<string, unknown> } | null;
  };
};

export type TFile = {
  path: string;
  basename: string;
};

export type PluginManifest = {
  dir: string;
};

export class Plugin {}

export function normalizePath(path: string): string {
  return path;
}
