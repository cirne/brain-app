import { describe, expect, it } from 'vitest'
import {
  decodeVisualArtifactRef,
  encodeVisualArtifactRef,
} from './visualArtifacts.js'

describe('decodeVisualArtifactRef', () => {
  it('round-trips canonical payloads', () => {
    const mail = encodeVisualArtifactRef({
      v: 1,
      type: 'mailAttachment',
      messageId: '<abc@example.com>',
      attachmentIndex: 2,
    })
    expect(decodeVisualArtifactRef(mail)).toEqual({
      v: 1,
      type: 'mailAttachment',
      messageId: '<abc@example.com>',
      attachmentIndex: 2,
    })

    const file = encodeVisualArtifactRef({ v: 1, type: 'indexedFile', id: 'driveFileId123' })
    expect(decodeVisualArtifactRef(file)).toEqual({
      v: 1,
      type: 'indexedFile',
      id: 'driveFileId123',
    })
  })

  it('strips whitespace and line breaks copied with the ref', () => {
    const compact = encodeVisualArtifactRef({
      v: 1,
      type: 'mailAttachment',
      messageId: 'mid',
      attachmentIndex: 1,
    })
    const [prefix, b64] = compact.split('.')
    const spaced = `  ${prefix}. ${b64.slice(0, 4)} \n ${b64.slice(4)}  `
    expect(decodeVisualArtifactRef(spaced)).toEqual({
      v: 1,
      type: 'mailAttachment',
      messageId: 'mid',
      attachmentIndex: 1,
    })
  })

  it('accepts LLM-typo attacmentIndex and snake_case attachment_index', () => {
    const typoJson = JSON.stringify({
      v: 1,
      type: 'mailAttachment',
      messageId: 'x@y',
      attacmentIndex: 3,
    })
    const b64 = Buffer.from(typoJson, 'utf8').toString('base64url').replace(/=+$/g, '')
    const typoRef = `va1.${b64}`
    expect(decodeVisualArtifactRef(typoRef)).toEqual({
      v: 1,
      type: 'mailAttachment',
      messageId: 'x@y',
      attachmentIndex: 3,
    })

    const snake = JSON.stringify({
      v: 1,
      type: 'mailAttachment',
      messageId: 'a',
      attachment_index: 2,
    })
    const b64s = Buffer.from(snake, 'utf8').toString('base64url').replace(/=+$/g, '')
    expect(decodeVisualArtifactRef(`va1.${b64s}`)).toEqual({
      v: 1,
      type: 'mailAttachment',
      messageId: 'a',
      attachmentIndex: 2,
    })
  })

  it('accepts string attachment indices', () => {
    const raw = JSON.stringify({
      v: 1,
      type: 'mailAttachment',
      messageId: 'm',
      attachmentIndex: '4',
    })
    const b64 = Buffer.from(raw, 'utf8').toString('base64url').replace(/=+$/g, '')
    expect(decodeVisualArtifactRef(`va1.${b64}`)).toEqual({
      v: 1,
      type: 'mailAttachment',
      messageId: 'm',
      attachmentIndex: 4,
    })
  })
})
