export function logFailure(where, error) {
  console.error(where, error?.message ?? String(error));
}
