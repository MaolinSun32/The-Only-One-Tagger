import { describe, it, expect } from 'vitest';
import { TagNormalizer } from '../../src/engine/tag-normalizer';

describe('TagNormalizer.normalize', () => {
  // Spaces and basic lowercase
  it('converts "Deep Learning" to "deep-learning"', () => {
    expect(TagNormalizer.normalize('Deep Learning')).toBe('deep-learning');
  });

  // Underscores
  it('converts "deep_learning" to "deep-learning"', () => {
    expect(TagNormalizer.normalize('deep_learning')).toBe('deep-learning');
  });

  // CamelCase: standard
  it('converts "DeepLearning" to "deep-learning"', () => {
    expect(TagNormalizer.normalize('DeepLearning')).toBe('deep-learning');
  });

  // CamelCase: mixed case with capital start
  it('converts "TensorFlow" to "tensor-flow"', () => {
    expect(TagNormalizer.normalize('TensorFlow')).toBe('tensor-flow');
  });

  // CamelCase: consecutive uppercase + lowercase
  it('converts "NLPModel" to "nlp-model"', () => {
    expect(TagNormalizer.normalize('NLPModel')).toBe('nlp-model');
  });

  // Pure uppercase abbreviations
  it('converts "GPT" to "gpt"', () => {
    expect(TagNormalizer.normalize('GPT')).toBe('gpt');
  });

  it('converts "BERT" to "bert"', () => {
    expect(TagNormalizer.normalize('BERT')).toBe('bert');
  });

  it('converts "CNN" to "cnn"', () => {
    expect(TagNormalizer.normalize('CNN')).toBe('cnn');
  });

  // Already normalized
  it('preserves "self-attention"', () => {
    expect(TagNormalizer.normalize('self-attention')).toBe('self-attention');
  });

  // Spaces to hyphens
  it('converts "self attention" to "self-attention"', () => {
    expect(TagNormalizer.normalize('self attention')).toBe('self-attention');
  });

  // Whitespace + duplicate hyphens
  it('converts "  deep--learning  " to "deep-learning"', () => {
    expect(TagNormalizer.normalize('  deep--learning  ')).toBe('deep-learning');
  });

  // Chinese: preserved
  it('preserves "机器学习"', () => {
    expect(TagNormalizer.normalize('机器学习')).toBe('机器学习');
  });

  it('preserves "深度学习"', () => {
    expect(TagNormalizer.normalize('深度学习')).toBe('深度学习');
  });

  // Mixed Latin + Chinese
  it('converts "AI模型" to "ai模型"', () => {
    expect(TagNormalizer.normalize('AI模型')).toBe('ai模型');
  });

  // Empty string
  it('returns "" for empty string', () => {
    expect(TagNormalizer.normalize('')).toBe('');
  });

  // All hyphens
  it('returns "" for "---"', () => {
    expect(TagNormalizer.normalize('---')).toBe('');
  });

  // CamelCase + digits
  it('converts "ResNet50" to "res-net50"', () => {
    expect(TagNormalizer.normalize('ResNet50')).toBe('res-net50');
  });

  // CamelCase
  it('converts "PyTorch" to "py-torch"', () => {
    expect(TagNormalizer.normalize('PyTorch')).toBe('py-torch');
  });

  // Whitespace only
  it('returns "" for whitespace-only input', () => {
    expect(TagNormalizer.normalize('   ')).toBe('');
  });

  // Underscore + spaces combined
  it('handles mixed separators: "deep_learning model" → "deep-learning-model"', () => {
    expect(TagNormalizer.normalize('deep_learning model')).toBe('deep-learning-model');
  });
});
