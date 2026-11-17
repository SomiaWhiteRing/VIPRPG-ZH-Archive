import { IntlMessageFormat } from "intl-messageformat";
import { UI_LOCALES, type UiLocale } from "../lib/i18n/locale";
import { zh } from "../lib/i18n/messages/zh-Hans";
import { ja } from "../lib/i18n/messages/ja";
import { en } from "../lib/i18n/messages/en";

const catalogs: Record<UiLocale, Record<string, string>> = { "zh-Hans": zh, ja, en };
// These sentence fragments contain only a separating space because word order differs.
const emptyFragments = new Set([
  "ja:timeline.feed.commentBefore", // Japanese puts the verb after the linked target.
  "en:timeline.feed.commentAfter", // English puts the verb before the linked target.
]);
type Ast = ReturnType<IntlMessageFormat["getAst"]>;
type Argument = { kinds: Set<string>; choices: Set<string> };

function argumentsOf(nodes: Ast, argumentsByName = new Map<string, Argument>()) {
  for (const node of nodes) {
    if (node.type === 0 || node.type === 7) continue; // Literal text and plural #.
    const argument = argumentsByName.get(node.value) ?? { kinds: new Set<string>(), choices: new Set<string>() };
    argument.kinds.add(node.type === 8 ? "tag" : node.type === 5 ? "select"
      : node.type === 2 || node.type === 6 ? "number" : node.type === 3 || node.type === 4 ? "date" : "value");
    argumentsByName.set(node.value, argument);
    if (node.type === 8) argumentsOf(node.children, argumentsByName);
    if (node.type === 5 || node.type === 6) {
      // Select branches represent domain values; plural categories may differ by language.
      if (node.type === 5) for (const choice of Object.keys(node.options)) argument.choices.add(choice);
      for (const option of Object.values(node.options)) argumentsOf(option.value, argumentsByName);
    }
  }
  return argumentsByName;
}

const issues: string[] = [];
const keys = Object.keys(zh);
const keySet = new Set(keys);
const signatures = new Map<string, Record<string, { kind: string; choices: string[] }>>();
let messages = 0;
const locales: UiLocale[] = ["zh-Hans", ...(Object.keys(UI_LOCALES) as UiLocale[]).filter(locale => locale !== "zh-Hans")];
for (const locale of locales) {
  const catalog = catalogs[locale];
  for (const key of Object.keys(catalog)) if (!keySet.has(key)) issues.push(`${locale}:${key}: 中文词库中不存在的键`);
  for (const key of keys) {
    const label = `${locale}:${key}`;
    const message = catalog[key];
    if (!Object.hasOwn(catalog, key)) { issues.push(`${label}: 缺少词条`); continue; }
    messages++;
    if (typeof message !== "string" || (!message.trim() && !emptyFragments.has(label))) {
      issues.push(`${label}: 词条必须是非空字符串`);
      continue;
    }
    try {
      const argumentsByName = argumentsOf(new IntlMessageFormat(message, locale).getAst());
      const signature = Object.fromEntries([...argumentsByName].sort(([a], [b]) => a.localeCompare(b)).map(([name, argument]) => {
        // A numeric/date/select argument can also be printed without a formatter.
        if (argument.kinds.size > 1 && !argument.kinds.has("tag")) argument.kinds.delete("value");
        if (argument.kinds.size > 1) issues.push(`${label}: 参数 ${name} 有不兼容的用途：${[...argument.kinds].join(", ")}`);
        return [name, { kind: [...argument.kinds].join("|"), choices: [...argument.choices].sort() }];
      }));
      if (locale === "zh-Hans") { signatures.set(key, signature); continue; }
      const baseline = signatures.get(key);
      if (!baseline) continue; // The Chinese parse error is already reported.
      if (JSON.stringify(Object.keys(signature)) !== JSON.stringify(Object.keys(baseline))) {
        issues.push(`${label}: 参数/富文本标签不一致，期望 ${Object.keys(baseline).join(", ")}，实际 ${Object.keys(signature).join(", ")}`);
        continue;
      }
      for (const [name, expected] of Object.entries(baseline)) {
        const actual = signature[name];
        const scalar = [expected.kind, actual.kind].every(kind => ["value", "number", "date"].includes(kind));
        if (expected.kind !== actual.kind && !(scalar && [expected.kind, actual.kind].includes("value")))
          issues.push(`${label}: 参数 ${name} 类型不兼容：${expected.kind} / ${actual.kind}`);
        if (JSON.stringify(expected.choices) !== JSON.stringify(actual.choices))
          issues.push(`${label}: 参数 ${name} 的 select 分支不一致`);
      }
    } catch (error) {
      issues.push(`${label}: ICU 解析失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
if (issues.length) {
  console.error(issues.join("\n"));
  console.error(`i18n 词条检查失败：${issues.length} 项问题`);
  process.exitCode = 1;
} else {
  console.log(`i18n 词条检查通过：${Object.keys(catalogs).length} 种语言，${keys.length} 个键，${messages} 条消息；键集合、空值、ICU 语法、参数和富文本标签兼容。`);
}
