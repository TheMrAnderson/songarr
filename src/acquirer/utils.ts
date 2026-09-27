export function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function describeError(error: unknown) {
  if (!(error instanceof Error)) return { message: String(error) };

  const cause = error.cause;
  return {
    name: error.name,
    message: error.message,
    cause:
      cause instanceof Error
        ? {
            name: cause.name,
            message: cause.message,
            code: (cause as Error & { code?: string }).code,
          }
        : cause,
  };
}
