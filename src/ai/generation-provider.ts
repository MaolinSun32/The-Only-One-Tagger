import type { TypeSummary, TagGenContext, FacetTagMap } from '../types';

/** 多模态内容片段 */
export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

/** OpenAI chat completion message */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

/** 生成 AI 接口（步骤 1 type 识别 + 步骤 2 tag 生成 + Regenerate 同义词） */
export interface GenerationProvider {
  /** 步骤 1：识别笔记类型 */
  detectType(noteContent: string, typeDescriptions: TypeSummary[], sourcePath: string): Promise<string>;

  /** 步骤 2：按 type 生成标签 */
  generateTags(context: TagGenContext): Promise<FacetTagMap>;

  /** Regenerate：生成同义候选 */
  generateSynonyms(tag: string, facet: string, noteContext: string): Promise<string[]>;
}
