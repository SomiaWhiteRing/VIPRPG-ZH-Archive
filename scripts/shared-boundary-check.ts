import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const roots = ["app", "lib", "worker", "android/web", "scripts"];
const files = roots.flatMap(collectSources).filter((file) => {
  const name = file.replaceAll(path.sep, "/");
  return !name.startsWith("scripts/") || (name !== "scripts/shared-boundary-check.ts" && !/(?:check|analysis|experiment)\.(?:ts|mjs)$/u.test(name));
});
const violations: string[] = [];
// Only these flows need to inspect a failed response before deciding what state to recover.
// Ordinary JSON, binary and 204 requests use requestJson/requestJsonValue/requestOk.
const responseConsumers = new Map<string, readonly string[]>([
  ["app/upload/upload-worker.ts", ["commitTask", "readOwnedImportJobState", "requestTerminalTransition", "jsonFetch"]],
  ["app/upload/upload-controller.ts", ["inspectDraftServerState", "resumeDraftOnServer", "cancelOwnedImportJob"]],
  ["app/components/ui/redirect-form.tsx", ["submit"]], // HTML redirects and JSON share this form protocol.
]);

for (const file of files) {
  const name = file.replaceAll(path.sep, "/");
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const browser = (name.startsWith("app/") && !name.startsWith("app/.server/")) || name.startsWith("lib/") || name.startsWith("android/web/");
  function report(node: ts.Node, rule: string, replacement: string) {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    violations.push(`${name}:${line} [${rule}] use ${replacement}`);
  }
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(source);
      if (["requestResponse", "readJsonResponse"].includes(callee) && name !== "lib/ui/api-response.ts") {
        let owner = "";
        for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
          if (ts.isFunctionDeclaration(parent) && parent.name) { owner = parent.name.text; break; }
        }
        if (!responseConsumers.get(name)?.includes(owner))
          report(node, "raw-response-consumer", "requestJson/requestJsonValue/requestOk; only recovery flows inspect raw responses");
      }
      if (["fetch", "window.fetch", "globalThis.fetch"].includes(callee) && name !== "lib/ui/api-response.ts")
        if (!name.startsWith("scripts/")) report(node, "raw-fetch", "lib/ui/api-response requestJson/requestResponse");
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "json") {
        if ((callee === "Response.json" || callee === "c.json") && name !== "lib/http.ts")
          report(node, "raw-json-response", "lib/http json");
        else if (browser && callee !== "Response.json" && name !== "lib/ui/api-response.ts")
          report(node, "raw-json-decode", "lib/ui/api-response readJsonResponse/requestJson");
        else if (name.startsWith("app/.server/") && callee === "request.json" && name !== "app/.server/http/request.ts")
          report(node, "raw-json-body", "app/.server/http/request readJsonObject");
      }
      if (callee === "crypto.subtle.digest" && node.arguments[0]?.getText(source).includes("SHA-256") && name !== "lib/sha256.ts")
        report(node, "raw-sha256", "lib/sha256 sha256Hex");
      if (callee === "Number" && node.arguments.some((argument) => /\b(?:context\.params\)|params)\.(?:userId|roleId|workId|characterId)\b/u.test(argument.getText(source))))
        report(node, "route-id-number", "parsePositiveId/parsePageId");
    }
    if (ts.isFunctionDeclaration(node) && node.name) {
      const functionName = node.name.text;
      if (name !== "app/.server/http/request.ts" && /^parse.*Id$/u.test(functionName) && /(?:Number\(|parseInt\()/u.test(node.getText(source)))
        report(node, "local-id-parser", "parsePositiveId/parsePageId");
      if (["blobKey", "corePackKey", "manifestKey"].includes(functionName) && name !== "lib/archive/object-keys.ts")
        report(node, "local-object-key", "lib/archive/object-keys");
      if (["formatBytes", "formatDuration", "formatTime"].includes(functionName) && name !== "lib/format.ts")
        report(node, "local-format", "lib/format");
      if (name.startsWith("app/.server/") && functionName !== "readJsonObject" && /JSON\.parse/u.test(node.getText(source))
        && /(?:read(?:ForumBody|RequestBody|Limited)\((?:request|req)\b|(?:request|req)\.(?:text|arrayBuffer)\()/u.test(node.getText(source)))
        report(node, "local-json-reader", "readJsonObject with a body limit");
    }
    if (ts.isCallExpression(node) && node.arguments.some((argument) => ts.isStringLiteral(argument)
      && /(?:^|\s)(?:npx\s+)?wrangler\s/u.test(argument.text)))
      report(node, "shell-wrangler", "scripts/run-wrangler runWrangler");
    if (ts.isTemplateExpression(node) && /(?:blobs|core-packs|manifests)\/sha256\//u.test(node.getText(source)) && name !== "lib/archive/object-keys.ts")
      report(node, "raw-object-key", "lib/archive/object-keys");
    ts.forEachChild(node, visit);
  }
  visit(source);
}

assert.equal(violations.length, 0, violations.join("\n"));
console.log(`shared boundary check passed (${files.length} source files scanned)`);

function collectSources(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? collectSources(file) : /\.(?:tsx?|m?js)$/u.test(entry.name) ? [file] : [];
  });
}
