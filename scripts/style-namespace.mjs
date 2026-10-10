import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import { __unstable__loadDesignSystem as loadDesignSystem } from "@tailwindcss/node";

const root = path.resolve(import.meta.dirname, "..");
const prefix = "vip:";
let statePromise;
async function state() {
  return statePromise ??= (async () => {
    const design = await loadDesignSystem(await fs.readFile(path.join(root, "app/globals.css"), "utf8"), { base: path.join(root, "app") });
    const owned = new Set();
    for (const dir of ["app", "android/web"]) {
      for (const file of await fs.readdir(path.join(root, dir), { recursive: true })) {
        if (!file.endsWith(".css")) continue;
        postcss.parse(await fs.readFile(path.join(root, dir, file), "utf8")).walkRules((rule) => {
          selectorParser((selectors) => selectors.walkClasses((node) => {
            // These are the lightbox library's public selectors, not ours.
            if (!node.value.startsWith("yarl__")) owned.add(node.value);
          })).processSync(rule.selector);
        });
      }
    }
    const cache = new Map();
    function rename(token) {
      if (token.startsWith(prefix) || token.startsWith("viprpg-")) return token;
      if (owned.has(token)) return `viprpg-${token}`;
      if (!cache.has(token)) cache.set(token, Boolean(design.candidatesToCss([token])[0]) || /^(group|peer)(\/[^\s]+)?$/.test(token));
      return cache.get(token) ? `${prefix}${token}` : token;
    }
    return { rename, owned };
  })();
}

function styleContext(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isJsxAttribute(p)) return /className$/i.test(p.name.getText());
    if (ts.isPropertyAssignment(p)) {
      const key = p.name.getText().replace(/["']/g, "");
      if (["variant", "size"].includes(key)) return false;
      if (/className$/i.test(key)) return true;
    }
    if (ts.isBinaryExpression(p)) {
      if ([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(p.operatorToken.kind)) return false;
      if (p.operatorToken.kind === ts.SyntaxKind.EqualsToken && /\.className$/.test(p.left.getText())) return true;
    }
    if (ts.isVariableDeclaration(p) && /class(Name|es)?$/i.test(p.name.getText())) return true;
    if (ts.isCallExpression(p) && /^(cn|clsx|cva)$/.test(p.expression.getText())) return true;
    if (ts.isStatement(p)) break;
  }
  return false;
}

export async function transformStyleSource(code, id) {
  if (id.replaceAll("\\", "/").endsWith("/lib/ui/cn.ts")) {
    const expected = 'import { twMerge } from "tailwind-merge";';
    if (!code.includes(expected)) throw new Error("Review style namespace adapter after changing lib/ui/cn.ts");
    return code.replace(expected, 'import { extendTailwindMerge } from "tailwind-merge";\nconst twMerge = extendTailwindMerge({ prefix: "vip" });');
  }
  const { rename } = await state();
  const source = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, id.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const edits = [];
  const renameList = (text) => text.replace(/\S+/g, rename);
  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const parent = node.parent;
      const rawStart = node.getStart(source) + 1;
      const rawEnd = node.end - (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) ? 2 : 1);
      const rawLiteral = code.slice(rawStart, rawEnd);
      const text = ts.isTaggedTemplateExpression(parent) && parent.tag.getText() === "String.raw" ? rawLiteral : node.text;
      let next = text;
      const tokens = text.trim().split(/\s+/);
      const isKey = ts.isPropertyAssignment(parent) && parent.name === node;
      const semantic = (ts.isJsxAttribute(parent) && !/className$/i.test(parent.name.getText()))
        || (ts.isPropertyAssignment(parent) && ["variant", "size"].includes(parent.name.getText()))
        || (ts.isBinaryExpression(parent) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(parent.operatorToken.kind));
      // Unambiguous utility constants cover lookup tables and shared class exports.
      // Never rewrite bare semantic values such as type="hidden" or status="hidden".
      const utilityConstant = tokens.every((token) => rename(token) !== token)
        && (tokens.length > 1 || /[-:[\]]/.test(text));
      if (!isKey && !semantic && (styleContext(node) || utilityConstant)) next = renameList(text);
      if (ts.isCallExpression(parent) && parent.arguments[0] === node && ts.isPropertyAccessExpression(parent.expression)
        && ["querySelector", "querySelectorAll", "closest", "matches"].includes(parent.expression.name.text)) {
        next = selectorParser((selectors) => selectors.walkClasses((n) => { n.value = rename(n.value); })).processSync(text);
      }
      if (next !== text) {
        // Preserve source quoting/escapes; only replace the raw class-token text.
        const start = node.getStart(source) + 1;
        const end = node.end - (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) ? 2 : 1);
        const raw = code.slice(start, end);
        if (raw !== text) throw new Error(`Escaped class literal needs explicit handling: ${id}:${source.getLineAndCharacterOfPosition(start).line + 1}`);
        edits.push([start, end, next]);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  for (const [start, end, next] of edits.sort((a, b) => b[0] - a[0])) code = code.slice(0, start) + next + code.slice(end);
  return code;
}

export async function transformStyleHtml(html) {
  const { rename } = await state();
  return html.replace(/\bclass="([^"]*)"/g, (_, value) => `class="${value.replace(/\S+/g, rename)}"`);
}

export function styleNamespaceCss() {
  return {
    postcssPlugin: "viprpg-style-namespace",
    async OnceExit(css) {
      if (process.env.NODE_ENV !== "production") return;
      const { rename } = await state();
      css.walkRules((rule) => {
        rule.selector = selectorParser((selectors) => selectors.walkClasses((node) => { node.value = rename(node.value); })).processSync(rule.selector);
      });
    },
  };
}

/** @returns {import("vite").Plugin} */
export function styleNamespace() {
  return {
    name: "viprpg-style-namespace",
    apply: "build",
    enforce: "pre",
    async transform(code, id) {
      const clean = id.split("?")[0].replaceAll("\\", "/");
      if (!/\.(ts|tsx)$/.test(clean) || !clean.startsWith(root.replaceAll("\\", "/") + "/")) return;
      const relative = path.relative(root, clean).replaceAll("\\", "/");
      if (!/^(app|lib|android\/web)\//.test(relative) || relative.startsWith("app/.server/")) return;
      const next = await transformStyleSource(code, clean);
      if (next !== code) return { code: next, map: null };
    },
    async writeBundle(options) {
      if (!options.dir) return;
      const file = path.resolve(options.dir, "play/player.html");
      try { await fs.writeFile(file, await transformStyleHtml(await fs.readFile(file, "utf8"))); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    },
  };
}
