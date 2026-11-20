export function logFailure(where, error) {
  console.error(where, error instanceof SyntaxError ? error.name : error?.message ?? String(error));
}
