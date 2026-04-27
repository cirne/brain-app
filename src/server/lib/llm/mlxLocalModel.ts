import type { Model, OpenAICompletionsCompat } from '@mariozechner/pi-ai'

/** Brain-app-only provider id for Apple Silicon MLX LM server (OpenAI-compatible). */
export const MLX_LOCAL_PROVIDER = 'mlx-local'

const MLX_LOCAL_COMPAT = {
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  thinkingFormat: 'qwen-chat-template',
} satisfies OpenAICompletionsCompat

const MLX_LOCAL_MODELS: Record<string, Omit<Model<'openai-completions'>, 'baseUrl'>> = {
  'mlx-community/Qwen3.6-27B-4bit': {
    id: 'mlx-community/Qwen3.6-27B-4bit',
    name: 'Qwen3.6 27B 4-bit (MLX)',
    api: 'openai-completions',
    provider: MLX_LOCAL_PROVIDER,
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262_144,
    maxTokens: 16_384,
    compat: MLX_LOCAL_COMPAT,
  },
  'mlx-community/Qwen3.6-27B-8bit': {
    id: 'mlx-community/Qwen3.6-27B-8bit',
    name: 'Qwen3.6 27B 8-bit (MLX)',
    api: 'openai-completions',
    provider: MLX_LOCAL_PROVIDER,
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262_144,
    maxTokens: 16_384,
    compat: MLX_LOCAL_COMPAT,
  },
}

export function isMlxLocalProvider(provider: string): boolean {
  return provider === MLX_LOCAL_PROVIDER
}

export function getMlxLocalModel(modelId: string): Model<'openai-completions'> | undefined {
  const entry = MLX_LOCAL_MODELS[modelId]
  if (!entry) return undefined
  const baseUrl = process.env.MLX_LOCAL_BASE_URL?.trim() || 'http://localhost:11444/v1'
  return { ...entry, baseUrl }
}
