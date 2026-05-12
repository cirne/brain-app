import { isAbortError } from './asyncLatest.js'
import { notifyPossibleConnectionIssue } from './connectionStatus.js'

/**
 * App-wide fetch with credentials; connection/auth failures notify {@link notifyPossibleConnectionIssue}.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    const res = await fetch(input, { ...init, credentials: 'include' })
    if (res.status === 401) {
      notifyPossibleConnectionIssue()
    }
    return res
  } catch (err) {
    if (isAbortError(err)) throw err
    notifyPossibleConnectionIssue()
    throw err
  }
}
