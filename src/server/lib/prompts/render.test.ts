import { describe, expect, it } from 'vitest'
import { renderPromptTemplate } from './render.js'

describe('renderPromptTemplate', () => {
  it('renders assistant base with multiTenant and local messages flags', () => {
    const s = renderPromptTemplate('assistant/base.hbs', {
      meHint: '',
      assistantHint: '',
      includeLocalMessageCapabilities: true,
      multiTenant: true,
    })
    expect(s).toContain('**Hosted workspace:**')
    expect(s).toContain('The newest dated source normally wins.')
    expect(s).toContain('travel/archive/')
    expect(s).toContain('list_recent_messages')
  })

  it('omits local messages bullet when includeLocalMessageCapabilities is false', () => {
    const s = renderPromptTemplate('assistant/base.hbs', {
      meHint: '',
      assistantHint: '',
      includeLocalMessageCapabilities: false,
      multiTenant: false,
    })
    expect(s).not.toContain('list_recent_messages')
    expect(s).not.toContain('multi-tenant')
  })

  it('includes ask_collaborator bullet when brainCollaborationEnabled', () => {
    const s = renderPromptTemplate('assistant/base.hbs', {
      meHint: '',
      assistantHint: '',
      includeLocalMessageCapabilities: false,
      multiTenant: false,
      brainCollaborationEnabled: true,
    })
    expect(s).toContain('ask_collaborator')
  })
})
