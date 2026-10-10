import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { extendTailwindMerge } from "tailwind-merge";
import { transformStyleSource, transformStyleHtml, styleNamespaceCss } from "./style-namespace.mjs";

const input = `const status="hidden";
const X=({view})=><><input type="hidden"/><div className={view === "grid" ? "hidden md:flex" : "flex"}/><div className={cn(buttonVariants({variant:"outline"}),"px-3","px-5")}/></>;`;
const output = await transformStyleSource(input, "fixture.tsx");
assert(output.includes('status="hidden"'));
assert(output.includes('type="hidden"'));
assert(output.includes('view === "grid"'));
assert(output.includes('variant:"outline"'));
assert(output.includes('"vip:hidden vip:md:flex"'));
assert(output.includes('"vip:px-3","vip:px-5"'));
const merge = extendTailwindMerge({ prefix: "vip" });
assert.equal(merge("vip:px-3", "vip:px-5"), "vip:px-5");
assert.equal(merge("vip:hidden vip:md:flex", "vip:block"), "vip:md:flex vip:block");
assert.equal(await transformStyleHtml('<input type="hidden"><div class="hidden md:flex">'), '<input type="hidden"><div class="vip:hidden vip:md:flex">');
assert((await transformStyleSource('document.querySelectorAll(".sea-dialogue");', "fixture.ts")).includes('.viprpg-sea-dialogue'));
assert((await transformStyleSource('<div className="yarl__button archive-lightbox"/>', "fixture.tsx")).includes('yarl__button viprpg-archive-lightbox'));

let scanned = 0;
for (const dir of ["app", "lib", "android/web"]) {
  for (const file of await fs.readdir(dir, { recursive: true })) {
    if (!/\.tsx?$/.test(file) || file.startsWith(".server/")) continue;
    const id = path.resolve(dir, file);
    const text = await transformStyleSource(await fs.readFile(id, "utf8"), id);
    const source = ts.createSourceFile(id, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    assert.equal(source.parseDiagnostics.length, 0, id);
    scanned++;
  }
}
const previous = process.env.NODE_ENV;
try {
  process.env.NODE_ENV = "production";
  for (const file of ["app/globals.css", "android/web/styles.css", "app/play/player.css"]) {
    const result = await postcss([tailwind(), styleNamespaceCss()]).process(await fs.readFile(file, "utf8"), { from: file });
    assert(!/(^|[\s,])\.hidden\s*\{/.test(result.css), file);
    if (file !== "app/play/player.css") assert(result.css.includes('.vip\\:hidden'), file);
  }
  process.env.NODE_ENV = "development";
  const dev = await postcss([styleNamespaceCss()]).process(".hidden { display: none }", { from: undefined });
  assert.equal(dev.css, ".hidden { display: none }");
} finally {
  if (previous === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous;
}
console.log(`style namespace check passed (${scanned} source files; three CSS entries)`);
