import { afterEach, describe, expect, it } from 'vitest'
import { MLX_LOCAL_PROVIDER } from './mlxLocalModel.js'
import { patchMlxLocalChatTemplateThinking } from './mlxLocalChatPayload.js'

describe('patchMlxLocalChatTemplateThinking', () => {
  afterEach(() => {
    delete process.env.MLX_LOCAL_THINKING
  })

  it('returns undefined for non-mlx provider', () => {
    expect(
      patchMlxLocalChatTemplateThinking({ model: 'x', messages: [] }, { provider: 'openai' }),
    ).toBeUndefined()
  })

  it('defaults enable_thinking to false when MLX_LOCAL_THINKING unset', () => {
    const out = patchMlxLocalChatTemplateThinking(
      { model: 'm', messages: [], chat_template_kwargs: { foo: 1 } },
      { provider: MLX_LOCAL_PROVIDER },
    )
    expect(out?.chat_template_kwargs).toEqual({ foo: 1, enable_thinking: false })
  })

  it('sets enable_thinking true when MLX_LOCAL_THINKING=1', () => {
    process.env.MLX_LOCAL_THINKING = '1'
    const out = patchMlxLocalChatTemplateThinking({ model: 'm', messages: [] }, { provider: MLX_LOCAL_PROVIDER })
    expect(out?.chat_template_kwargs).toEqual({ enable_thinking: true })
  })
})
