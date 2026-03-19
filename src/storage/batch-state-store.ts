import type { App, PluginManifest } from 'obsidian';
import type { BatchState } from '../types';
import { BATCH_STATE_FILE } from '../constants';
import { DataStore } from './data-store';

const DEFAULT_BATCH_STATE: BatchState = {
  task_id: '',
  started_at: '',
  status: 'completed',
  total_files: 0,
  filter: { folders: [], skip_tagged: true },
  processed_files: [],
  failed_files: {},
};

export class BatchStateStore extends DataStore<BatchState> {
  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest, BATCH_STATE_FILE, DEFAULT_BATCH_STATE);
  }
}
