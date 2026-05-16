import { getEnvApiKey, getModel, type Api, type KnownProvider, type Model } from '@earendil-works/pi-ai'
import { getMlxLocalModel, isMlxLocalProvider } from './mlxLocalModel.js'

/**
 * Resolves `BRAIN_LLM` / `BRAIN_FAST_LLM` (parsed to provider + id) to a pi-ai `Model`, including Brain-only
 * providers (e.g. `mlx-local`) that are not in `@earendil-works/pi-ai`'s static registry.
 */
export function resolveModel(provider: string, modelId: string): Model<Api> | undefined {
  if (isMlxLocalProvider(provider)) {
    return getMlxLocalModel(modelId)
  }
  return getModel(provider as KnownProvider, modelId as never)
}

/**
 * API key for completions: known pi-ai env mapping, or a placeholder for local MLX.
 */
export function resolveLlmApiKey(provider: string): string | undefined {
  if (isMlxLocalProvider(provider)) {
    const k = process.env.MLX_LOCAL_API_KEY?.trim()
    return k === '' || k === undefined ? 'local' : k
  }
  return getEnvApiKey(provider as KnownProvider)
}
