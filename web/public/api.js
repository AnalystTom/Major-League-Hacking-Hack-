// Same-origin JSON calls. Errors carry the server's message and status so pages can say what happened.

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "Something went wrong. Try again in a minute.");
    err.status = res.status;
    err.invalid = data.invalid;
    throw err;
  }
  return data;
}
