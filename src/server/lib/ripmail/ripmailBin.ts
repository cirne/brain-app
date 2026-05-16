/**
 * Literal CLI program name (`ripmail`) used only for **string builders** (agent tool docs / tests)
 * that mirror historic `ripmail search …` argv shapes. The server does **not** spawn this binary;
 * mail runs in-process via `@server/ripmail`.
 */
export function ripmailBin(): string {
  return 'ripmail'
}
