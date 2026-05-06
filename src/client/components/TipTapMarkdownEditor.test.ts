import { tick } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@client/test/render.js'
import TipTapMarkdownEditor from './TipTapMarkdownEditor.svelte'

describe('TipTapMarkdownEditor', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('wraps BubbleMenu / FloatingMenu roots in an out-of-flow host so scroll flex-1 fills height', async () => {
    const { container, unmount } = render(TipTapMarkdownEditor, {
      props: {
        initialMarkdown: '# Hi\n\nBody.',
        autoPersist: false,
        floatingBlockMenu: true,
      },
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

  it('keeps a manual block menu shell when floatingBlockMenu is false; closed until long-press', async () => {
    const { container, unmount } = render(TipTapMarkdownEditor, {
      props: {
        initialMarkdown: '# Hi\n\nBody.',
        autoPersist: false,
        floatingBlockMenu: false,
      },
    })
    await tick()
    await tick()

    try {
      const host = container.querySelector('.tiptap-menu-host')
      expect(host).toBeTruthy()
      expect(host!.querySelector(':scope > .tiptap-bubble-menu')).toBeTruthy()
      expect(host!.querySelector(':scope > .tiptap-floating-menu')).toBeTruthy()
      expect(host!.querySelector('.tiptap-mobile-block-menu-open')).toBeNull()
    } finally {
      unmount()
    }
  })

  it('opens the manual block menu after a touch long-press when floatingBlockMenu is false', async () => {
    vi.useFakeTimers()
    const { container, unmount } = render(TipTapMarkdownEditor, {
      props: {
        initialMarkdown: '# Hi\n\nBody.',
        autoPersist: false,
        floatingBlockMenu: false,
      },
    })
    await tick()
    await tick()

    try {
      const pm = container.querySelector('.tiptap-md-mount .ProseMirror')
      expect(pm).toBeTruthy()
      const doc = document as Document & { elementFromPoint?: (_x: number, _y: number) => Element | null }
      const prevEfp = doc.elementFromPoint
      doc.elementFromPoint = () => pm as Element
      try {
        fireEvent.touchStart(pm!, {
          touches: [{ clientX: 24, clientY: 24 }],
        })
        await vi.advanceTimersByTimeAsync(480)
        await tick()
        expect(container.querySelector('.tiptap-mobile-block-menu-open')).toBeTruthy()
      } finally {
        if (prevEfp) doc.elementFromPoint = prevEfp
        else Reflect.deleteProperty(doc as object, 'elementFromPoint')
      }
    } finally {
      unmount()
    }
  })
})
