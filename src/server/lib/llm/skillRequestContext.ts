import { AsyncLocalStorage } from 'node:async_hooks'

export type SkillRequestContext = {
  /** Surface context string from chat (e.g. selection); paired with slash-command placeholders. */
  selection: string
  openFile?: string
}

const storage = new AsyncLocalStorage<SkillRequestContext>()

export function runWithSkillRequestContext<T>(ctx: SkillRequestContext, fn: () => T): T {
  return storage.run(ctx, fn)
}

export async function runWithSkillRequestContextAsync<T>(
  ctx: SkillRequestContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(ctx, fn)
}

/** Per-request context for `load_skill` placeholders; undefined outside chat streaming. */
export function tryGetSkillRequestContext(): SkillRequestContext | undefined {
  return storage.getStore()
}
