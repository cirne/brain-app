import { describe, expect, it } from 'vitest'
import { render, screen } from '@client/test/render.js'
import PolicyActivityList from './PolicyActivityList.svelte'

describe('PolicyActivityList.svelte', () => {
  it('shows question, returned answer, redaction chips, and internal draft when draft differs', () => {
    render(PolicyActivityList, {
      props: {
        entries: [
          {
            id: 'bql_1',
            ownerId: 'usr_owner',
            askerId: 'usr_a',
            question: 'Who is going to Nevis?',
            draftAnswer: 'Alice and Bob plan to meet in Nevis next week.',
            finalAnswer: 'Two people from your circle plan travel there next week.',
            filterNotes: JSON.stringify({ redactions: ['specific names'] }),
            status: 'ok',
            createdAtMs: Date.now(),
            durationMs: 4200,
          },
        ],
        resolveAskerHandle: () => 'peer',
      },
    })

    expect(screen.getByText('Question')).toBeInTheDocument()
    expect(screen.getByText(/Who is going to Nevis\?/)).toBeInTheDocument()
    expect(screen.getByText('Returned to collaborator')).toBeInTheDocument()
    expect(screen.getByText(/Two people from your circle/)).toBeInTheDocument()
    expect(screen.getByText('Privacy filter')).toBeInTheDocument()
    expect(screen.getByText('specific names')).toBeInTheDocument()
    expect(screen.getByText(/Internal draft \(before privacy filter\)/)).toBeInTheDocument()
    expect(screen.getByText(/Alice and Bob/)).toBeInTheDocument()
  })

  it('omits internal draft when draft matches final and no redactions', () => {
    render(PolicyActivityList, {
      props: {
        entries: [
          {
            id: 'bql_2',
            ownerId: 'usr_owner',
            askerId: 'usr_a',
            question: 'Ping?',
            draftAnswer: 'OK',
            finalAnswer: 'OK',
            filterNotes: null,
            status: 'ok',
            createdAtMs: Date.now(),
            durationMs: 100,
          },
        ],
      },
    })

    expect(screen.queryByText(/Internal draft/)).not.toBeInTheDocument()
  })

  it('shows error detail when status is error', () => {
    render(PolicyActivityList, {
      props: {
        entries: [
          {
            id: 'bql_3',
            ownerId: 'usr_owner',
            askerId: 'usr_a',
            question: 'Bad?',
            draftAnswer: '',
            finalAnswer: null,
            filterNotes: 'research_agent_failed',
            status: 'error',
            createdAtMs: Date.now(),
            durationMs: null,
          },
        ],
      },
    })

    expect(screen.getByText(/No answer returned/)).toBeInTheDocument()
    expect(screen.getByText('research_agent_failed')).toBeInTheDocument()
  })
})
