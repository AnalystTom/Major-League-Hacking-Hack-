fetch("/api/me", { credentials: "same-origin" })
  .then((res) => (res.ok ? res.json() : null))
  .then((me) => {
    if (!me?.user) return;
    document.querySelectorAll("[data-cta]").forEach((a) => {
      a.href = "/app";
      a.textContent = "Open your feed";
    });
    document.querySelector("[data-signin-link]")?.remove();
  })
  .catch(() => {});
