// Nitro auto-imports used by server utils.
(globalThis as Record<string, unknown>).createError = (input: { statusCode?: number; statusMessage?: string }) =>
  Object.assign(new Error(input.statusMessage ?? "error"), input);
