const escape = (text) => String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const STYLE = `
  * { box-sizing: border-box; }
  body { margin: 0; width: 1024px; padding: 36px 32px 28px; background: #e8eaed; font-family: Inter, "Helvetica Neue", Arial, sans-serif; color: #111827; }
  h1 { margin: 0 0 26px; text-align: center; font-size: 46px; letter-spacing: -0.02em; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
  .panel { position: relative; background: #eef0f3; border: 2px solid #c8ced6; border-radius: 16px; padding: 22px 24px 26px; }
  .panel.full { grid-column: 1 / -1; }
  .panel h2 { margin: 0 0 14px; font-size: 27px; letter-spacing: -0.01em; }
  .bubble { display: flex; align-items: center; gap: 18px; }
  .avatar { width: 64px; height: 64px; flex: none; border-radius: 50%; border: 3px solid #9ca3af; background: radial-gradient(circle at 50% 38%, #9ca3af 0 22%, transparent 23%), radial-gradient(ellipse at 50% 105%, #9ca3af 0 42%, transparent 43%); }
  .speech { background: #fff; border: 2px solid #c8ced6; border-radius: 22px; padding: 20px 28px; font-size: 30px; }
  .sub { background: #fff; border-radius: 12px; padding: 14px 16px; margin-bottom: 10px; font-size: 22px; }
  .buttons { display: flex; gap: 12px; margin-top: 14px; }
  .button { flex: 1; text-align: center; padding: 14px 10px; border-radius: 10px; border: 2px solid #c8ced6; background: #fff; font-size: 22px; font-weight: 600; }
  .button.primary { background: #2f7cf6; border-color: #2f7cf6; color: #fff; }
  .bar { margin: 16px 0 6px; }
  .bar .label { font-size: 22px; margin-bottom: 6px; }
  .track { height: 20px; border-radius: 10px; background: #d5d9df; overflow: hidden; }
  .fill { height: 100%; border-radius: 10px; background: #8b93a0; min-width: 4px; }
  .fill.good { background: #2f7cf6; }
  .chips { display: flex; flex-wrap: wrap; gap: 10px; }
  .chip { background: #fff; border: 2px solid #c8ced6; border-radius: 12px; padding: 10px 16px; font-size: 21px; }
  .chip::before { content: "✓ "; color: #16a34a; font-weight: 700; }
  .stat .number { font-size: 76px; font-weight: 800; letter-spacing: -0.03em; line-height: 1; color: #2f7cf6; }
  .stat .caption { margin-top: 8px; font-size: 22px; color: #4b5563; }
  .callout { display: inline-block; margin-top: 16px; padding: 10px 14px; border: 2px solid #dc2626; background: #fef2f2; color: #b91c1c; border-radius: 8px; font-size: 19px; font-weight: 600; line-height: 1.25; }
  .callout::before { content: "↑  "; }
  .bubble .callout { margin: 0; flex: none; max-width: 230px; }
  .bubble .callout::before { content: "←  "; }
  .footer { margin-top: 22px; text-align: center; font-size: 22px; font-weight: 600; color: #6b7280; }
`;

function renderPanel(panel) {
  const callout = panel.callout ? `<div class="callout">${escape(panel.callout)}</div>` : "";
  const heading = panel.title ? `<h2>${escape(panel.title)}</h2>` : "";
  let body = "";
  if (panel.type === "bubble") body = `<div class="bubble"><div class="avatar"></div><div class="speech">${escape(panel.text)}</div>${callout}</div>`;
  else if (panel.type === "card") {
    const lines = (panel.lines ?? []).map((line) => `<div class="sub">${escape(line)}</div>`).join("");
    const buttons = panel.buttons?.length ? `<div class="buttons">${panel.buttons.map((b) => `<div class="button ${b.primary ? "primary" : ""}">${escape(b.label)}</div>`).join("")}</div>` : "";
    body = `${heading}${lines}${buttons}`;
  } else if (panel.type === "bars") {
    const max = panel.max ?? Math.max(...panel.bars.map((bar) => bar.value), 1);
    body = heading + panel.bars.map((bar) => `<div class="bar"><div class="label">${escape(bar.label)}: ${escape(bar.value)}${escape(panel.unit ?? "")}</div><div class="track"><div class="fill ${bar.good ? "good" : ""}" style="width:${Math.max(0, Math.min(100, (bar.value / max) * 100))}%"></div></div></div>`).join("");
  } else if (panel.type === "grid") body = `${heading}<div class="chips">${panel.items.map((item) => `<div class="chip">${escape(item)}</div>`).join("")}</div>`;
  else if (panel.type === "stat") body = `<div class="stat">${heading}<div class="number">${escape(panel.value)}</div><div class="caption">${escape(panel.caption)}</div></div>`;
  else throw new Error(`unknown infographic panel type "${panel.type}"; use bubble, card, bars, grid or stat`);
  return `<section class="panel ${panel.full || panel.type === "bubble" ? "full" : ""}">${body}${panel.type === "bubble" ? "" : callout}</section>`;
}

export function infographicHtml(spec) {
  const panels = spec.panels.map(renderPanel).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body><h1>${escape(spec.title)}</h1><div class="grid">${panels}</div><div class="footer">${escape(spec.footer ?? "")}</div></body></html>`;
}

export async function renderInfographic({ spec, htmlPath, outPath, playwrightUrl, chromiumPath }) {
  const { writeFileSync } = await import("node:fs");
  const { pathToFileURL } = await import("node:url");
  writeFileSync(htmlPath, infographicHtml(spec));
  const { chromium } = await import(playwrightUrl);
  const browser = await chromium.launch({ executablePath: chromiumPath, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 800 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(htmlPath).href);
    await page.screenshot({ path: outPath, fullPage: true });
  } finally {
    await browser.close();
  }
}
