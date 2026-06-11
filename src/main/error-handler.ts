/**
 * error-handler.ts — Helpers de tratamento de erro
 *
 * Reduz repetição de try/catch e error instanceof checks.
 */
export function safeAsync<T>(fn: () => Promise<T>, onError?: (err: Error) => void): Promise<T | undefined> {
  return fn().catch((raw) => {
    const err = raw instanceof Error ? raw : new Error(String(raw));
    onError?.(err);
    return undefined;
  });
}

export function toError(raw: unknown): Error {
  return raw instanceof Error ? raw : new Error(String(raw));
}

export function logAndIgnore(onLog?: (msg: string) => void) {
  return (err: unknown): void => {
    onLog?.(toError(err).message);
  };
}
