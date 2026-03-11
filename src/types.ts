/**
 * Core type definitions for The Only One Tagger.
 * Field names match the dev-plan JSON format exactly.
 *
 * Three main data structures:
 * 1. TagSchema — decision tree (tag-schema.json)
 * 2. TagRegistry — SKOS-inspired vocabulary (tag-registry.json)
 * 3. AI response / batch / verification types
 */

// ─── Note Types ──────────────────────────────────────────────

/** The 12 life-area note types that drive facet selection. */
export type NoteType =
	| 'academic'
	| 'project'
	| 'course'
	| 'journal'
	| 'growth'
	| 'relationship'
	| 'meeting'
	| 'finance'
	| 'health'
	| 'career'
	| 'creative'
	| 'admin';

// ─── Tag Schema (Decision Tree) — tag-schema.json ───────────

export type ValidationLevel = 'strict' | 'moderate' | 'loose';
export type FacetValueType = 'taxonomy' | 'enum';

/** Schema for one note type. */
export interface NoteTypeSchema {
	label: string;
	required_facets: string[];
	optional_facets: string[];
	validation: ValidationLevel;
}

/** Definition of a single facet (shared across note types). */
export interface FacetDefinition {
	description: string;
	value_type: FacetValueType;
	allow_multiple: boolean;
	verification_required: boolean;
	/** Predefined values for enum facets. Undefined for taxonomy facets. */
	values?: string[];
}

/** Top-level tag-schema.json structure. */
export interface TagSchema {
	version: number;
	note_types: Record<NoteType, NoteTypeSchema>;
	facet_definitions: Record<string, FacetDefinition>;
	validation_levels: Record<ValidationLevel, string>;
}

// ─── Tag Registry (SKOS-inspired) — tag-registry.json ───────

/** Verification status of a single tag. */
export type VerificationStatus = 'verified' | 'pending' | 'needs_review' | 'rejected';

/** Source that verified the tag. */
export type VerificationSource = 'seed' | 'wikipedia' | 'ai_search' | 'manual' | 'auto-extract';

/** SKOS relations for a tag. */
export interface TagRelations {
	broader: string[];
	narrower: string[];
	related: string[];
}

/** Verification source info for a tag. */
export interface TagSource {
	verified_by: VerificationSource;
	url?: string;
	verified_at?: string;
}

/** A single tag entry in the registry (matches dev-plan JSON format). */
export interface TagEntry {
	label: string;
	aliases: string[];
	/** Primary facet this tag belongs to. */
	facet: string;
	status: VerificationStatus;
	relations: TagRelations;
	source: TagSource;
}

/** Registry metadata. */
export interface RegistryMeta {
	version: number;
	last_updated: string;
	total_tags: number;
}

/** Top-level tag-registry.json structure. */
export interface TagRegistry {
	meta: RegistryMeta;
	tags: Record<string, TagEntry>;
}

// ─── AI Suggestion Types ────────────────────────────────────

/** A single tag suggested by the AI for a note. */
export interface SuggestedTag {
	facet: string;
	tagId: string;
	label: string;
	confidence: number;
	reason: string;
	isExisting: boolean;
	reviewStatus?: 'accepted' | 'rejected' | 'pending';
}

/** Full result of analyzing one note. */
export interface TagSuggestionResult {
	filePath: string;
	noteType: NoteType;
	suggestions: SuggestedTag[];
	analyzedAt: string;
}

// ─── Verification Types ─────────────────────────────────────

export interface VerificationResult {
	tagId: string;
	status: VerificationStatus;
	source: VerificationSource;
	canonicalLabel?: string;
	url?: string;
	reason?: string;
}

// ─── Verification Queue — verification-queue.json ───────────

export interface QueuedVerification {
	id: string;
	tag_label: string;
	facet: string;
	suggested_by: 'ai' | 'auto-extract' | 'user';
	source_note: string;
	queued_at: string;
	attempts: number;
}

// ─── Batch Processing ───────────────────────────────────────

export type BatchItemStatus = 'queued' | 'processing' | 'reviewed' | 'applied' | 'skipped' | 'error';

export interface BatchItem {
	filePath: string;
	status: BatchItemStatus;
	result?: TagSuggestionResult;
	error?: string;
}

export type BatchJobStatus = 'idle' | 'running' | 'paused' | 'completed' | 'aborted';

export interface BatchJob {
	id: string;
	status: BatchJobStatus;
	items: BatchItem[];
	currentIndex: number;
	autoAcceptThreshold: number;
	createdAt: string;
	updatedAt: string;
}
