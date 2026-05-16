import { expect, type Locator, type Page } from '@playwright/test'

/** One tool row under {@link ToolCallBlock}; registry name from `data-tool-name`. */
export type ToolCallSnapshot = {
  name: string
  displayLabel: string
  summary?: string
  done: boolean
  error: boolean
}

export type AssistantReplySnapshot = {
  assistantText: string
  tools: ToolCallSnapshot[]
}

export type WaitForAssistantReplyOptions = {
  timeoutMs?: number
  /** Defaults to the last `.message.assistant` bubble. */
  assistantMessage?: Locator
}

/**
 * Snapshot for stdout and `test.info().attach` when a reply does not contain the tools the spec expected
 * (e.g. `draft_email` missing while `search_index` ran).
 */
export function formatAssistantReplyDiagnostics(
  snapshot: AssistantReplySnapshot,
  opts?: { assistantTextMaxChars?: number },
): Record<string, unknown> {
  const max = opts?.assistantTextMaxChars ?? 6000
  const text = snapshot.assistantText
  const truncated = text.length > max
  return {
    toolCount: snapshot.tools.length,
    tools: snapshot.tools.map((t) => ({
      name: t.name,
      done: t.done,
      error: t.error,
      displayLabel: t.displayLabel,
      ...(t.summary !== undefined ? { summary: t.summary } : {}),
    })),
    assistantTextChars: text.length,
    assistantTextTruncated: truncated,
    assistantText: truncated ? `${text.slice(0, max)}\n…(truncated, ${max} max chars)` : text,
    draft_email_rows: snapshot.tools.filter((t) => t.name === 'draft_email'),
    mail_discovery_tool_names: snapshot.tools
      .map((t) => t.name)
      .filter((n) => /search|mail|index|inbox|draft/i.test(n)),
  }
}

async function readSummaryLine(toolRow: Locator): Promise<string | undefined> {
  const summaryText = toolRow.locator('.tool-summary-text, .tool-summary-plain').first()
  if ((await summaryText.count()) > 0) {
    const t = (await summaryText.textContent())?.trim()
    if (t) return t
  }
  return undefined
}

async function snapshotTools(lastAssistant: Locator): Promise<ToolCallSnapshot[]> {
  const toolRows = lastAssistant.locator('.tool-part[data-tool-name]')
  const n = await toolRows.count()
  const tools: ToolCallSnapshot[] = []
  for (let i = 0; i < n; i++) {
    const row = toolRows.nth(i)
    const name = (await row.getAttribute('data-tool-name')) ?? ''
    const done = (await row.getAttribute('data-tool-done')) === 'true'
    const error = (await row.getAttribute('data-tool-error')) === 'true'
    const displayLabel = (await row.locator('.tool-name').first().textContent())?.trim() ?? ''
    const summary = await readSummaryLine(row)
    tools.push({
      name,
      displayLabel,
      ...(summary !== undefined ? { summary } : {}),
      done,
      error,
    })
  }
  return tools
}

/**
 * Waits until the assistant finishes streaming and returns visible reply text plus tool rows
 * (`data-tool-*` attributes on `.tool-part` in the chat tool UI).
 */
export async function waitForAssistantReply(
  page: Page,
  opts?: WaitForAssistantReplyOptions,
): Promise<AssistantReplySnapshot> {
  const timeoutMs = opts?.timeoutMs ?? 22_000
  const lastAssistant = opts?.assistantMessage ?? page.locator('.message.assistant').last()

  await expect(lastAssistant).toBeVisible({ timeout: timeoutMs })

  const textParts = lastAssistant.locator('.msg-content:not(.thinking-block)')
  await expect(textParts.last()).toBeVisible({ timeout: timeoutMs })
  await expect(textParts.last()).toContainText(/\S+/, { timeout: timeoutMs })

  await expect(page.locator('.stop-btn')).toHaveCount(0, { timeout: timeoutMs })

  const chunks = await textParts.allTextContents()
  const assistantText = chunks.map((t) => t.trim()).filter(Boolean).join('\n\n')

  const tools = await snapshotTools(lastAssistant)

  return { assistantText, tools }
}
