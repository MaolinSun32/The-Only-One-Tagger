import type { TagSchema, NoteTypeSchema, FacetDefinition, ValidationLevel } from '../types';

/**
 * Default tag schema matching dev-plan.md §3.1 exactly.
 * - 12 note types with required/optional facets
 * - Shared facet_definitions with value_type (taxonomy/enum)
 * - Validation levels: strict / moderate / loose
 */

// ─── Note type schemas (§3.1 note_types) ─────────────────────

const NOTE_TYPES: Record<string, NoteTypeSchema> = {
	academic: {
		label: '学术研究',
		required_facets: ['area', 'genre', 'lang'],
		optional_facets: [
			'method', 'algorithm', 'concept', 'dataset',
			'problem', 'software', 'programming-language',
			'scholar', 'venue',
		],
		validation: 'strict',
	},
	project: {
		label: '项目/复现',
		required_facets: ['domain', 'status', 'tech-stack'],
		optional_facets: [
			'programming-language', 'software',
			'collaborator', 'source-repo',
		],
		validation: 'strict',
	},
	course: {
		label: '课程学习',
		required_facets: ['domain', 'source', 'instructor'],
		optional_facets: ['concept', 'method', 'platform'],
		validation: 'moderate',
	},
	journal: {
		label: '日记',
		required_facets: ['mood'],
		optional_facets: ['people', 'location', 'event-type', 'reflection-topic'],
		validation: 'loose',
	},
	growth: {
		label: '自我成长',
		required_facets: ['growth-area'],
		optional_facets: ['method', 'trigger', 'insight-type'],
		validation: 'loose',
	},
	relationship: {
		label: '人际关系',
		required_facets: ['person', 'relation-type'],
		optional_facets: ['affiliation', 'domain', 'interaction-type'],
		validation: 'moderate',
	},
	meeting: {
		label: '会议/社交',
		required_facets: ['participants', 'meeting-type'],
		optional_facets: ['project', 'action-items', 'location'],
		validation: 'loose',
	},
	finance: {
		label: '财务',
		required_facets: ['finance-type', 'amount-range'],
		optional_facets: ['category', 'recurring'],
		validation: 'loose',
	},
	health: {
		label: '健康',
		required_facets: ['health-area'],
		optional_facets: ['metric', 'provider', 'condition'],
		validation: 'moderate',
	},
	career: {
		label: '职业发展',
		required_facets: ['career-aspect'],
		optional_facets: ['company', 'role', 'skill', 'milestone'],
		validation: 'moderate',
	},
	creative: {
		label: '创作',
		required_facets: ['medium', 'status'],
		optional_facets: ['theme', 'audience', 'inspiration'],
		validation: 'loose',
	},
	admin: {
		label: '行政/生活',
		required_facets: ['admin-type'],
		optional_facets: ['deadline', 'priority'],
		validation: 'loose',
	},
};

// ─── Facet definitions (§3.1 facet_definitions) ──────────────

const FACET_DEFINITIONS: Record<string, FacetDefinition> = {
	// ── Taxonomy facets (need verification) ──
	area: {
		description: '研究/知识领域',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: true,
	},
	method: {
		description: '方法论/技术方法',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: true,
	},
	algorithm: {
		description: '具名算法',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: true,
	},
	concept: {
		description: '核心概念/理论',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: true,
	},
	dataset: {
		description: '具名数据集',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: true,
	},
	problem: {
		description: '问题领域',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: true,
	},
	software: {
		description: '软件/框架',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: true,
	},
	'programming-language': {
		description: '编程语言',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: true,
	},
	scholar: {
		description: '引用的研究者',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: false,
	},
	venue: {
		description: '会议/期刊',
		value_type: 'taxonomy',
		allow_multiple: false,
		verification_required: true,
	},
	domain: {
		description: '业务/知识领域（项目、课程等通用）',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: true,
	},
	'tech-stack': {
		description: '技术栈',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: true,
	},
	collaborator: {
		description: '合作者',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: false,
	},
	'source-repo': {
		description: '源代码仓库',
		value_type: 'taxonomy',
		allow_multiple: false,
		verification_required: false,
	},
	source: {
		description: '来源（课程平台、书籍等）',
		value_type: 'taxonomy',
		allow_multiple: false,
		verification_required: false,
	},
	instructor: {
		description: '讲师',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: false,
	},
	platform: {
		description: 'MOOC 平台',
		value_type: 'taxonomy',
		allow_multiple: false,
		verification_required: false,
	},
	people: {
		description: '涉及的人',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: false,
	},
	person: {
		description: '人物',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: false,
	},
	location: {
		description: '地点',
		value_type: 'taxonomy',
		allow_multiple: false,
		verification_required: false,
	},
	'event-type': {
		description: '事件类型',
		value_type: 'taxonomy',
		allow_multiple: false,
		verification_required: false,
	},
	'reflection-topic': {
		description: '反思主题',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: false,
	},
	'growth-area': {
		description: '成长领域',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: false,
	},
	trigger: {
		description: '触发因素',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: false,
	},
	'insight-type': {
		description: '洞察类型',
		value_type: 'taxonomy',
		allow_multiple: false,
		verification_required: false,
	},
	'relation-type': {
		description: '关系类型',
		value_type: 'taxonomy',
		allow_multiple: false,
		verification_required: false,
	},
	affiliation: {
		description: '所属组织',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: false,
	},
	'interaction-type': {
		description: '互动类型',
		value_type: 'taxonomy',
		allow_multiple: false,
		verification_required: false,
	},
	participants: {
		description: '参会人',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: false,
	},
	'meeting-type': {
		description: '会议类型',
		value_type: 'taxonomy',
		allow_multiple: false,
		verification_required: false,
	},
	project: {
		description: '关联项目',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: false,
	},
	'action-items': {
		description: '待办事项',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: false,
	},
	'finance-type': {
		description: '财务类型',
		value_type: 'taxonomy',
		allow_multiple: false,
		verification_required: false,
	},
	'amount-range': {
		description: '金额范围',
		value_type: 'taxonomy',
		allow_multiple: false,
		verification_required: false,
	},
	category: {
		description: '分类',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: false,
	},
	recurring: {
		description: '是否周期性',
		value_type: 'taxonomy',
		allow_multiple: false,
		verification_required: false,
	},
	'health-area': {
		description: '健康领域',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: false,
	},
	metric: {
		description: '追踪指标',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: false,
	},
	provider: {
		description: '医疗服务提供者',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: false,
	},
	condition: {
		description: '健康状况',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: false,
	},
	'career-aspect': {
		description: '职业发展维度',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: false,
	},
	company: {
		description: '公司',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: false,
	},
	role: {
		description: '角色/职位',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: false,
	},
	skill: {
		description: '技能',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: true,
	},
	milestone: {
		description: '里程碑',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: false,
	},
	medium: {
		description: '创作媒介',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: false,
	},
	theme: {
		description: '主题',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: false,
	},
	audience: {
		description: '目标受众',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: false,
	},
	inspiration: {
		description: '灵感来源',
		value_type: 'taxonomy',
		allow_multiple: true,
		verification_required: false,
	},
	'admin-type': {
		description: '行政事务类型',
		value_type: 'taxonomy',
		allow_multiple: false,
		verification_required: false,
	},
	deadline: {
		description: '截止日期',
		value_type: 'taxonomy',
		allow_multiple: false,
		verification_required: false,
	},
	priority: {
		description: '优先级',
		value_type: 'taxonomy',
		allow_multiple: false,
		verification_required: false,
	},

	// ── Enum facets (predefined values, no verification) ──
	genre: {
		description: '内容类型',
		value_type: 'enum',
		values: ['paper', 'textbook', 'tutorial', 'lecture-note', 'blog', 'documentation', 'thesis'],
		allow_multiple: false,
		verification_required: false,
	},
	lang: {
		description: '语言',
		value_type: 'enum',
		values: ['en', 'zh', 'ja', 'de', 'fr', 'ko'],
		allow_multiple: false,
		verification_required: false,
	},
	mood: {
		description: '情绪状态',
		value_type: 'enum',
		values: ['great', 'good', 'neutral', 'low', 'bad'],
		allow_multiple: false,
		verification_required: false,
	},
	status: {
		description: '进度状态',
		value_type: 'enum',
		values: ['not-started', 'in-progress', 'completed', 'paused', 'abandoned'],
		allow_multiple: false,
		verification_required: false,
	},
};

// ─── Validation level descriptions ───────────────────────────

const VALIDATION_LEVELS: Record<string, string> = {
	strict: '所有 taxonomy 类标签必须经过在线验证',
	moderate: '优先匹配本地标签库，新标签建议验证',
	loose: '允许 AI 自由生成，仅去重检查',
};

// ─── Factory ─────────────────────────────────────────────────

export function createDefaultSchema(): TagSchema {
	return {
		version: 1,
		note_types: NOTE_TYPES as Record<import('../types').NoteType, NoteTypeSchema>,
		facet_definitions: FACET_DEFINITIONS,
		validation_levels: VALIDATION_LEVELS as Record<import('../types').ValidationLevel, string>,
	};
}
