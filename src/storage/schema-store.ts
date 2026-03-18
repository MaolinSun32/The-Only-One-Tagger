import type { App, PluginManifest } from 'obsidian';
import type { Schema } from '../types';
import { TAG_SCHEMA_FILE } from '../constants';
import { DataStore } from './data-store';

const DEFAULT_SCHEMA: Schema = {
  version: 1,
  note_types: {},
  facet_definitions: {},
};

export class SchemaStore extends DataStore<Schema> {
  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest, TAG_SCHEMA_FILE, DEFAULT_SCHEMA);
  }
}
