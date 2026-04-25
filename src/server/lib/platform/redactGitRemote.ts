/** Strip userinfo from HTTPS git URLs so PATs are not logged. */
export function redactGitRemote(url: string): string {
  const t = url.trim()
  if (!t.includes('@') || !/^https?:\/\//i.test(t)) return t
  return t.replace(/^(https?:\/\/)[^@]+@/i, '$1***@')
}
