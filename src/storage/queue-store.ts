import type { App, PluginManifest } from 'obsidian';
import type { VerificationQueue } from '../types';
import { VERIFICATION_QUEUE_FILE } from '../constants';
import { DataStore } from './data-store';

const DEFAULT_QUEUE: VerificationQueue = {
  queue: [],
};

export class QueueStore extends DataStore<VerificationQueue> {
  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest, VERIFICATION_QUEUE_FILE, DEFAULT_QUEUE);
  }
}
