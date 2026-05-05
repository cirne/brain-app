import { tick } from 'svelte'
import { describe, expect, it } from 'vitest'
import { render } from '@client/test/render.js'
import TipTapMarkdownEditor from './TipTapMarkdownEditor.svelte'

describe('TipTapMarkdownEditor', () => {
  it('wraps BubbleMenu / FloatingMenu roots in an out-of-flow host so scroll flex-1 fills height', async () => {
    const { container, unmount } = render(TipTapMarkdownEditor, {
      props: { initialMarkdown: '# Hi\n\nBody.', autoPersist: false },
    })
    await tick()
    await tick()

    try {
      const root = container.querySelector('.tiptap-md-root')
      const scroll = container.querySelector('.tiptap-md-scroll')
      const host = container.querySelector('.tiptap-menu-host')
      expect(root).toBeTruthy()
      expect(scroll).toBeTruthy()
      expect(host).toBeTruthy()
      expect(host!.parentElement).toBe(root)
      /** Tailwind utilities in markup (jsdom computed styles omit them). */
      expect(host!.getAttribute('class')).toMatch(/\babsolute\b/)
      expect(host!.getAttribute('class')).toMatch(/\bh-0\b/)
      expect(host!.getAttribute('class')).toMatch(/\bw-0\b/)
      expect(host!.querySelector(':scope > .tiptap-bubble-menu')).toBeTruthy()
      expect(host!.querySelector(':scope > .tiptap-floating-menu')).toBeTruthy()
    } finally {
      unmount()
    }
  })
})
