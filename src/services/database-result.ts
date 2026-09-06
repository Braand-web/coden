/** Supabase builders are PromiseLike, and SQL failures resolve as { error }. */
export async function requireDatabaseResult<T>(
  query: PromiseLike<{ data?: T; error?: { code?: string; message?: string } | null }>,
  operation: string,
): Promise<T | undefined> {
  const result = await query;
  if (result.error) {
    // Do not leak SQL details, row values or credentials into public errors.
    throw Object.assign(new Error(`Database operation failed: ${operation}.`), {
      diagnosticCode: 'DATABASE_PERSISTENCE_FAILED',
      code: result.error.code,
    });
  }
  return result.data;
}
