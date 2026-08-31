import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const appRoot = path.resolve("app");
const files = collectTsx(appRoot);
const sources = files.map((file) => ({ file, source: ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) }));

const violations: string[] = [];
for (const { file, source } of sources) {
  function visit(node: ts.Node) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const openingElement = ts.isJsxElement(node) ? node.openingElement : node;
      const tagName = openingElement.tagName.getText(source);
      if (!file.startsWith(path.join(appRoot, "components", "ui")) && ["button", "textarea", "select", "label"].includes(tagName)) {
        violations.push(`${relative(file)}: raw <${tagName}>`);
      }
      if (!file.startsWith(path.join(appRoot, "components", "ui")) && tagName === "input") {
        const typeAttribute = openingElement.attributes.properties.find(
          (property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && property.name.getText(source) === "type",
        );
        const typeValue = typeAttribute?.initializer && ts.isStringLiteral(typeAttribute.initializer)
          ? typeAttribute.initializer.text
          : "";
        if (typeValue !== "hidden" && typeValue !== "file") {
          violations.push(`${relative(file)}: raw visible <input>`);
        }
      }
      if (!file.startsWith(path.join(appRoot, "components", "ui")) && openingElement.attributes.properties.some((property) => ts.isJsxAttribute(property) && property.name.getText(source) === "style")) {
        violations.push(`${relative(file)}: inline style outside shared UI primitives`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

assert.equal(violations.length, 0, violations.join("\n"));
console.log(`ui self-check passed (${files.length} page/component files scanned)`);

function collectTsx(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? collectTsx(fullPath) : entry.name.endsWith(".tsx") ? [fullPath] : [];
  });
}

function relative(file: string): string {
  return path.relative(process.cwd(), file);
}
