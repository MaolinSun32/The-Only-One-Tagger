import type { BadgeType, FacetTagMap, FacetDefinition } from '../types';
import type { SchemaResolver } from '../engine/schema-resolver';
import type { TagMatcher } from '../engine/tag-matcher';
import { TagNormalizer } from '../engine/tag-normalizer';
import type { RegistryStore } from '../storage/registry-store';

/** 校验后的单个标签 */
export interface ValidatedTag {
  label: string;
  badge: BadgeType;
  isNew: boolean;
}

/** validate() 返回值 */
export interface ValidationOutput {
  facetTags: Record<string, ValidatedTag[]>;
  warnings: string[];
}

/**
 * 共用黑名单解析函数。
 * taxonomy 和 enum 的黑名单映射表均通过此函数解析。
 *
 * @returns resolved 替换后的值 + wasReplaced 标记；null 表示值不在黑名单中（交由调用方决定处理方式）
 */
export function resolveBlacklist(
  value: string,
  blacklistMap: Record<string, string>,
): { resolved: string; wasReplaced: boolean } | null {
  const target = blacklistMap[value];
  if (target !== undefined) {
    return { resolved: target, wasReplaced: true };
  }
  return null;
}

/**
 * AI 步骤 2 返回值校验器。
 *
 * 6 步校验规则：
 * 1. Facet 白名单过滤
 * 2. TagNormalizer 统一调用（taxonomy）
 * 3. TagMatcher 库内匹配 + rejected 自动替换
 * 4. Enum 黑名单解析
 * 5. 单值/多值规范化
 * 6. 空值过滤
 */
export class AIResponseValidator {
  constructor(private readonly deps: {
    schemaResolver: SchemaResolver;
    tagMatcher: TagMatcher;
    tagNormalizer: typeof TagNormalizer;
    registryStore: RegistryStore;
  }) {}

  async validate(rawOutput: FacetTagMap, type: string): Promise<ValidationOutput> {
    const schema = this.deps.schemaResolver.resolve(type);
    const allFacets: Record<string, FacetDefinition> = {
      ...schema.requiredFacets,
      ...schema.optionalFacets,
    };
    const warnings: string[] = [];
    const facetTags: Record<string, ValidatedTag[]> = {};

    for (const [facet, rawValues] of Object.entries(rawOutput)) {
      // Step 1: Facet 白名单
      if (!(facet in allFacets)) {
        warnings.push(`未知 facet "${facet}" 已丢弃`);
        continue;
      }

      const def = allFacets[facet]!;
      let values = Array.isArray(rawValues) ? [...rawValues] : [rawValues];

      // Step 6: 空值过滤（提前执行，减少后续处理量）
      values = values.filter(v => v != null && v !== '');

      const validated: ValidatedTag[] = [];

      for (const raw of values) {
        const rawStr = String(raw);

        if (def.value_type === 'taxonomy') {
          // Step 2: TagNormalizer
          const normalized = this.deps.tagNormalizer.normalize(rawStr);

          // Step 3: TagMatcher 匹配
          const matchResult = await this.deps.tagMatcher.match(normalized);

          if (matchResult && matchResult.matched && matchResult.entry) {
            if (matchResult.entry.status === 'verified') {
              // 命中 verified → 🟢，label 替换为正式 label
              validated.push({
                label: matchResult.entry.label,
                badge: 'registry',
                isNew: false,
              });
            } else if (matchResult.entry.status === 'rejected') {
              // 命中 rejected → 替换为目标标签
              const targetLabel = matchResult.entry.rejected_in_favor_of;
              if (targetLabel) {
                validated.push({
                  label: targetLabel,
                  badge: 'registry',
                  isNew: false,
                });
              } else {
                warnings.push(`Rejected 标签 "${normalized}" 无替换目标，已丢弃`);
              }
            }
          } else {
            // 未命中 → 新词（⚪ verifying）
            validated.push({
              label: normalized,
              badge: 'verifying',
              isNew: true,
            });
          }
        } else if (def.value_type === 'enum') {
          // Step 4: Enum 校验
          if (def.values && def.values.includes(rawStr)) {
            validated.push({ label: rawStr, badge: 'enum', isNew: false });
          } else {
            // 查 enum blacklist
            const resolved = resolveBlacklist(rawStr, def.blacklist ?? {});
            if (resolved) {
              validated.push({ label: resolved.resolved, badge: 'enum', isNew: false });
              if (resolved.wasReplaced) {
                warnings.push(`Enum 值 "${rawStr}" 替换为 "${resolved.resolved}"`);
              }
            } else {
              warnings.push(`非法 enum 值 "${rawStr}" 已丢弃`);
            }
          }
        } else if (def.value_type === 'wikilink') {
          validated.push({ label: rawStr, badge: 'wikilink', isNew: false });
        } else if (def.value_type === 'free-text') {
          validated.push({ label: rawStr, badge: 'free_text', isNew: false });
        } else if (def.value_type === 'date') {
          validated.push({ label: rawStr, badge: 'date', isNew: false });
        }
      }

      // Step 5: 单值/多值规范化
      if (!def.allow_multiple && validated.length > 1) {
        facetTags[facet] = [validated[0]!];
      } else {
        facetTags[facet] = validated;
      }
    }

    return { facetTags, warnings };
  }
}
