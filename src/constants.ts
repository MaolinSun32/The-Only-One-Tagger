/** View type ID for the tag review sidebar. */
export const TAG_REVIEW_VIEW_TYPE = 'atw-tag-review';

/** File names for plugin data stored in the plugin directory. */
export const SCHEMA_FILE = 'tag-schema.json';
export const REGISTRY_FILE = 'tag-registry.json';
export const QUEUE_FILE = 'verification-queue.json';
export const BATCH_STATE_FILE = 'batch-state.json';

/** AI defaults. */
export const DEFAULT_MAX_TOKENS = 2048;
export const DEFAULT_TEMPERATURE = 0.3;
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Note content truncation limits (chars). */
export const NOTE_CONTENT_HEAD = 4000;
export const NOTE_CONTENT_TAIL = 1000;

/** Batch processing defaults. */
export const DEFAULT_BATCH_CONCURRENCY = 1;
export const DEFAULT_RATE_LIMIT_RPM = 20;
export const DEFAULT_AUTO_ACCEPT_THRESHOLD = 0;

/** Tag normalization. */
export const TAG_ID_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
