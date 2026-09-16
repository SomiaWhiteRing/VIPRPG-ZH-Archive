import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  input: { type: "string" },
  output: { type: "string" },
  export: { type: "boolean" },
} });
const input=values.input,destination=values.output;
if(!input||!destination||!values.export)
  throw new Error("Usage: tsx scripts/forum-offline.ts --input backup.sqlite|backup.sql --output new-directory --export");
const source=resolve(input),folder=resolve(destination);
if(!existsSync(source)||existsSync(folder))throw new Error("Input must exist and output directory must be new.");
mkdirSync(folder,{recursive:true});
const db=new DatabaseSync(extname(source)===".sql"?":memory:":source,{readOnly:extname(source)!==".sql"});
if(extname(source)===".sql"){
  db.exec("PRAGMA foreign_keys=OFF");
  db.exec(readFileSync(source,"utf8"));
}
db.exec("PRAGMA foreign_keys=ON");
const tables=(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'forum_%' ORDER BY name").all() as {name:string}[])
  .map((r)=>r.name).filter((name)=>!name.startsWith("forum_search_"));
const snapshot=(database:DatabaseSync)=>Object.fromEntries(tables.map((name)=>[name,database.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
const before=snapshot(db);
for(const [table,rows] of Object.entries(before))writeFileSync(resolve(folder,`${table}.jsonl`),rows.map((r)=>JSON.stringify(r)).join("\n")+"\n");
writeFileSync(resolve(folder,"manifest.json"),JSON.stringify({createdAt:new Date().toISOString(),tables:Object.fromEntries(Object.entries(before).map(([name,rows])=>[name,rows.length]))},null,2));
db.close();
console.log(`Forum offline export completed: ${folder}`);
