// Builds DOM nodes for the reel and the skills sheet. API strings only ever go in through `text` (textContent) or
// attributes, never as HTML.

/**
 * el("button", { class: "x", text: "Go", onclick: fn, hidden: true }, ...children)
 * - text: textContent
 * - on<event> with a function: addEventListener
 * - a non-string value for a DOM property (hidden, muted, loop, default): set as that property
 * - anything else: an attribute (true becomes an empty attribute); null, undefined and false are skipped
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (typeof v !== "string" && k in node) node[k] = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  node.append(...children.filter(Boolean));
  return node;
}
