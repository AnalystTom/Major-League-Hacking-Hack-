export const DIRECTIVE_RE = new RegExp(
  "^(?:\\/\\/\\/?|\\/\\*+|\\*|#|<!--)?\\s*(?:eslint-(?:disable|enable)|@ts-(?:expect-error|ignore|nocheck|check)|prettier-ignore|istanbul|c8 |v8 ignore|noqa|type:|pragma|pylint:|fmt:|shellcheck|vim:|@vitest-environment|@jest-environment|@jsx|@jsxImportSource|webpackChunkName|<reference|go:build|biome-ignore|oxlint|SPDX-License-Identifier|Copyright|@license|@preserve|-\\*-)",
  "i"
);

export function isAllowedComment(text, lineNo) {
  const trimmed = text.trim();
  const body = text.replace(/^\s*(?:\/\/+|\/\*+|#+|\*+)\s*/, "").replace(/\*+\/\s*$/, "").trim();
  if (lineNo === 1 && text.startsWith("#!")) return true;
  if (lineNo <= 12 && /copyright|licen[sc]e|SPDX/i.test(text)) return true;
  return DIRECTIVE_RE.test(trimmed) || DIRECTIVE_RE.test(body);
}
