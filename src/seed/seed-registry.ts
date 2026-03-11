import type { TagRegistry, TagEntry, VerificationSource } from '../types';

/**
 * Default seed registry matching dev-plan.md §3.2 format.
 * ~80 ACM CCS tags pre-marked verified, source=seed.
 */

function tag(
	label: string,
	aliases: string[],
	facet: string,
	broader: string[] = [],
	narrower: string[] = [],
	related: string[] = [],
): TagEntry {
	return {
		label,
		aliases,
		facet,
		status: 'verified',
		relations: { broader, narrower, related },
		source: {
			verified_by: 'seed' as VerificationSource,
			verified_at: new Date().toISOString().split('T')[0]!,
		},
	};
}

// ─── ACM CCS Top-level Areas ────────────────────────────────

const TOP_LEVEL: Record<string, TagEntry> = {
	'artificial-intelligence':     tag('artificial-intelligence',     ['人工智能', 'AI'],            'area', [], ['machine-learning', 'computer-vision', 'natural-language-processing', 'robotics', 'knowledge-representation']),
	'software-engineering':        tag('software-engineering',        ['软件工程'],                   'area', [], ['software-testing', 'software-architecture', 'version-control', 'devops']),
	'computer-vision':             tag('computer-vision',             ['计算机视觉', 'CV'],           'area', [], ['image-recognition', 'object-detection', 'image-segmentation'], ['artificial-intelligence']),
	'human-computer-interaction':  tag('human-computer-interaction',  ['人机交互', 'HCI'],            'area', [], ['usability', 'user-experience', 'accessibility']),
	'computer-networks':           tag('computer-networks',           ['计算机网络'],                  'area', [], ['network-security', 'distributed-systems', 'cloud-computing']),
	'databases':                   tag('databases',                   ['数据库'],                     'area', [], ['relational-databases', 'nosql', 'query-optimization']),
	'theory-of-computation':       tag('theory-of-computation',       ['计算理论'],                   'area', [], ['complexity-theory', 'automata-theory', 'formal-languages']),
	'computer-graphics':           tag('computer-graphics',           ['计算机图形学'],                'area', [], ['rendering', '3d-modeling', 'animation']),
	'information-retrieval':       tag('information-retrieval',       ['信息检索', 'IR'],             'area', [], ['search-engines', 'text-mining', 'recommender-systems']),
	'computer-security':           tag('computer-security',           ['计算机安全', 'cybersecurity'], 'area', [], ['cryptography', 'network-security', 'malware-analysis']),
	'operating-systems':           tag('operating-systems',           ['操作系统', 'OS'],             'area', [], ['process-management', 'memory-management', 'file-systems']),
	'programming-languages':       tag('programming-languages',       ['编程语言', 'PL'],             'area', [], ['type-systems', 'compilers', 'functional-programming']),
};

// ─── AI / ML ────────────────────────────────────────────────

const AI_ML: Record<string, TagEntry> = {
	'machine-learning':               tag('machine-learning',               ['机器学习', 'ML'],      'area',      ['artificial-intelligence'], ['deep-learning', 'reinforcement-learning', 'supervised-learning', 'unsupervised-learning']),
	'deep-learning':                  tag('deep-learning',                  ['深度学习', 'DL'],      'area',      ['machine-learning'],        ['neural-networks', 'convolutional-neural-networks', 'transformers']),
	'natural-language-processing':    tag('natural-language-processing',    ['自然语言处理', 'NLP'], 'area',      ['artificial-intelligence'], ['text-classification', 'named-entity-recognition', 'machine-translation']),
	'reinforcement-learning':         tag('reinforcement-learning',         ['强化学习', 'RL'],      'concept',   ['machine-learning']),
	'supervised-learning':            tag('supervised-learning',            ['监督学习'],             'concept',   ['machine-learning']),
	'unsupervised-learning':          tag('unsupervised-learning',          ['无监督学习'],           'concept',   ['machine-learning']),
	'neural-networks':                tag('neural-networks',                ['神经网络', 'NN'],      'concept',   ['deep-learning']),
	'convolutional-neural-networks':  tag('convolutional-neural-networks',  ['卷积神经网络', 'CNN'], 'algorithm', ['deep-learning'],  [], ['image-recognition']),
	'transformers':                   tag('transformers',                   ['Transformer模型'],      'method',    ['deep-learning'],  [], ['attention-mechanism']),
	'attention-mechanism':            tag('attention-mechanism',            ['注意力机制'],           'concept',   [],                 [], ['transformers']),
	'generative-adversarial-networks':tag('generative-adversarial-networks',['生成对抗网络', 'GAN'], 'algorithm', ['deep-learning']),
	'transfer-learning':              tag('transfer-learning',              ['迁移学习'],             'concept',   ['machine-learning']),
	'large-language-models':          tag('large-language-models',          ['大语言模型', 'LLM'],   'concept',   ['deep-learning', 'natural-language-processing'], [], ['transformers']),
};

// ─── CV sub-topics ──────────────────────────────────────────

const CV: Record<string, TagEntry> = {
	'image-recognition':  tag('image-recognition',  ['图像识别'], 'concept', ['computer-vision']),
	'object-detection':   tag('object-detection',   ['目标检测'], 'concept', ['computer-vision'], [], ['convolutional-neural-networks']),
	'image-segmentation': tag('image-segmentation', ['图像分割'], 'concept', ['computer-vision']),
};

// ─── SE sub-topics ──────────────────────────────────────────

const SE: Record<string, TagEntry> = {
	'software-testing':      tag('software-testing',      ['软件测试'], 'concept',  ['software-engineering']),
	'software-architecture': tag('software-architecture', ['软件架构'], 'concept',  ['software-engineering']),
	'version-control':       tag('version-control',       ['版本控制'], 'concept',  ['software-engineering'], [], ['git']),
	'devops':                tag('devops',                ['开发运维'], 'concept',  ['software-engineering']),
	'git':                   tag('git',                   [],           'software', [],                      [], ['version-control']),
};

// ─── NLP sub-topics ─────────────────────────────────────────

const NLP: Record<string, TagEntry> = {
	'text-classification':      tag('text-classification',      ['文本分类'],              'concept', ['natural-language-processing']),
	'named-entity-recognition': tag('named-entity-recognition', ['命名实体识别', 'NER'],  'concept', ['natural-language-processing']),
	'machine-translation':      tag('machine-translation',      ['机器翻译', 'MT'],       'concept', ['natural-language-processing']),
	'sentiment-analysis':       tag('sentiment-analysis',       ['情感分析'],              'concept', ['natural-language-processing']),
};

// ─── Common cross-cutting tags ──────────────────────────────

const COMMON: Record<string, TagEntry> = {
	// Programming languages
	'python':       tag('python',       [],              'programming-language'),
	'javascript':   tag('javascript',   ['JS'],          'programming-language'),
	'typescript':   tag('typescript',   ['TS'],          'programming-language', [], [], ['javascript']),
	'rust':         tag('rust',         [],              'programming-language'),
	'cpp':          tag('C++',          ['c-plus-plus'], 'programming-language'),
	'java':         tag('java',         [],              'programming-language'),

	// Frameworks / tools
	'pytorch':      tag('pytorch',      [],              'software', [], [], ['deep-learning', 'python']),
	'tensorflow':   tag('tensorflow',   ['TF'],          'software', [], [], ['deep-learning', 'python']),
	'docker':       tag('docker',       [],              'software'),
	'obsidian':     tag('obsidian',     ['黑曜石'],       'software'),

	// Datasets
	'imagenet':     tag('imagenet',     [],              'dataset', [], [], ['image-recognition']),
	'mnist':        tag('mnist',        [],              'dataset', [], [], ['image-recognition']),

	// Venues
	'neurips':      tag('neurips',      ['NIPS'],        'venue'),
	'icml':         tag('icml',         [],              'venue'),
	'cvpr':         tag('cvpr',         [],              'venue'),
	'acl-conf':     tag('acl',          [],              'venue'),
	'arxiv':        tag('arxiv',        [],              'venue'),
};

// ─── Factory ─────────────────────────────────────────────────

export function createDefaultRegistry(): TagRegistry {
	const tags: Record<string, TagEntry> = {
		...TOP_LEVEL,
		...AI_ML,
		...CV,
		...SE,
		...NLP,
		...COMMON,
	};

	return {
		meta: {
			version: 1,
			last_updated: new Date().toISOString().split('T')[0]!,
			total_tags: Object.keys(tags).length,
		},
		tags,
	};
}
