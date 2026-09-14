import { DatabaseSync, backup } from "node:sqlite";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import { forumSearchTokens } from "../lib/forum-search-index";
import { searchScopeSql } from "../lib/server/forum/search-index";

const args=process.argv.slice(2);
const option=(name:string)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const input=option("--input"),destination=option("--output");
if(!input||!destination||(!args.includes("--convert")&&!args.includes("--export")))
  throw new Error("Usage: tsx scripts/forum-offline.ts --input backup.sqlite|backup.sql --output new-directory --convert|--export [--apply]");
const source=resolve(input),folder=resolve(destination),apply=args.includes("--apply");
if(!existsSync(source)||existsSync(folder))throw new Error("Input must exist and output directory must be new.");
if(apply&&extname(source)!==".sqlite")throw new Error("--apply requires a stopped local SQLite database, never a remote SQL dump.");
mkdirSync(folder,{recursive:true});
const db=new DatabaseSync(extname(source)===".sql"?":memory:":source,{readOnly:!apply&&extname(source)!==".sql"});
if(extname(source)===".sql"){
  db.exec("PRAGMA foreign_keys=OFF");
  db.exec(readFileSync(source,"utf8"));
}
db.exec("PRAGMA foreign_keys=ON");
const tables=(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'forum_%' ORDER BY name").all() as {name:string}[])
  .map((r)=>r.name).filter((name)=>!name.startsWith("forum_search_"));
const quote=(value:unknown)=>value===null?"NULL":typeof value==="number"?String(value):`'${String(value).replaceAll("'","''")}'`;
const snapshot=(database:DatabaseSync)=>Object.fromEntries(tables.map((name)=>[name,database.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
const before=snapshot(db);
if(args.includes("--export")) {
  for(const [table,rows] of Object.entries(before))writeFileSync(resolve(folder,`${table}.jsonl`),rows.map((r)=>JSON.stringify(r)).join("\n")+"\n");
  writeFileSync(resolve(folder,"manifest.json"),JSON.stringify({createdAt:new Date().toISOString(),tables:Object.fromEntries(Object.entries(before).map(([name,rows])=>[name,rows.length]))},null,2));
} else {
  if(db.prepare("SELECT name FROM sqlite_master WHERE name='forum_search_documents'").get())throw new Error("Already converted; refusing to renumber or rebuild an existing model.");
  const failures=db.prepare(`SELECT t.id FROM forum_topics t LEFT JOIN forum_posts p ON p.topic_id=t.id GROUP BY t.id
    HAVING COUNT(p.id)=0 OR MIN(p.post_number)<>1 OR MAX(p.post_number)<>COUNT(p.id) OR t.next_post_number<>COUNT(p.id)+1`).all();
  if(failures.length||db.prepare("PRAGMA foreign_key_check").all().length)throw new Error("Source numbering or foreign keys are inconsistent; conversion stopped.");
  if(db.prepare(`SELECT id FROM forum_posts WHERE length(body)>CASE WHEN post_number=1 THEN 20000 ELSE 5000 END
    UNION ALL SELECT id FROM forum_post_comments WHERE length(body)>2000 LIMIT 1`).get())throw new Error("Source body exceeds the agreed limits; conversion stopped.");
  await backup(db,resolve(folder,"before.sqlite"));
  if(!apply)copyFileSync(resolve(folder,"before.sqlite"),resolve(folder,"converted.sqlite"));
  const converted=apply?db:new DatabaseSync(resolve(folder,"converted.sqlite"));
  converted.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
  const migration=readFileSync("migrations/0005_forum_read_model.sql","utf8");
  const statements=[migration];
  try {
    converted.exec(migration);
    const docs=converted.prepare(`SELECT d.id,CASE WHEN p.post_number=1 THEN t.title ELSE '' END AS title,
      COALESCE(p.body,c.body) AS body FROM forum_search_documents d
      LEFT JOIN forum_posts p ON p.id=d.post_id LEFT JOIN forum_post_comments c ON c.id=d.comment_id
      LEFT JOIN forum_topics t ON t.id=p.topic_id WHERE COALESCE(p.status,c.status)<>'deleted' ORDER BY d.id`).all();
    for(const row of docs){
      const encoded=forumSearchTokens(String(row.body));
      const sql=`INSERT INTO forum_search_index(rowid,title,body,scope) SELECT d.id,${quote(forumSearchTokens(String(row.title??"")))},${quote(encoded.slice(0,32000))},${searchScopeSql} FROM forum_search_documents d WHERE d.id=${row.id};`;
      converted.exec(sql);statements.push(sql);
      for(let start=32000;start<encoded.length;start+=32000){
        const append=`UPDATE forum_search_index SET body=body||${quote(encoded.slice(start,start+32000))} WHERE rowid=${row.id};`;
        converted.exec(append);statements.push(append);
      }
    }
    const ledger="INSERT INTO d1_migrations(name) VALUES('0005_forum_read_model.sql');";
    if(converted.prepare("SELECT name FROM sqlite_master WHERE name='d1_migrations'").get()){converted.exec(ledger);statements.push(ledger);}
    const after=snapshot(converted);
    for(const [name,rows] of Object.entries(before)){
      const restored=after[name].map((row)=>Object.fromEntries(Object.keys(rows[0]??{}).filter((key)=>key!=="body_search"&&key!=="title_search").map((key)=>[key,row[key]])));
      if(JSON.stringify(restored)!==JSON.stringify(rows.map((row)=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=="body_search"&&key!=="title_search")))))throw new Error(`Preserved values differ in ${name}.`);
    }
    if(converted.prepare("PRAGMA foreign_key_check").all().length)throw new Error("Converted foreign keys are inconsistent.");
    const indexed=Number(converted.prepare("SELECT COUNT(*) AS n FROM forum_search_index").get()!.n);
    if(indexed!==docs.length)throw new Error("Search document count differs.");
    const inconsistentNumbers=converted.prepare(`SELECT p.id FROM forum_posts p LEFT JOIN forum_post_comments c ON c.post_id=p.id
      GROUP BY p.id HAVING p.next_comment_number<>COUNT(c.id)+1 OR
        (COUNT(c.id)>0 AND (MIN(c.comment_number)<>1 OR MAX(c.comment_number)<>COUNT(c.id)))`).all();
    if(inconsistentNumbers.length)throw new Error("Converted comment positions are inconsistent.");
    const inconsistentTotals=converted.prepare(`SELECT t.id FROM forum_topics t WHERE t.reply_count<>
      (SELECT COUNT(*)-1 FROM forum_posts p WHERE p.topic_id=t.id)+
      (SELECT COUNT(*) FROM forum_post_comments c JOIN forum_posts p ON p.id=c.post_id WHERE p.topic_id=t.id)`).all();
    if(inconsistentTotals.length)throw new Error("Converted reply counts are inconsistent.");
    const mappingCount=Number(converted.prepare("SELECT COUNT(*) AS n FROM forum_search_documents").get()!.n);
    if(mappingCount!==before.forum_posts.length+before.forum_post_comments.length)throw new Error("Search source mapping differs.");
    for(const row of docs){
      const entry=converted.prepare(`SELECT f.title,f.body,f.scope,${searchScopeSql} AS expected_scope
        FROM forum_search_documents d JOIN forum_search_index f ON f.rowid=d.id WHERE d.id=?`).get(row.id)!;
      if(!entry||entry.title!==forumSearchTokens(String(row.title??""))||entry.body!==forumSearchTokens(String(row.body))||entry.scope!==entry.expected_scope)
        throw new Error(`Search content differs for document ${row.id}.`);
    }
    converted.exec("INSERT INTO forum_search_index(forum_search_index) VALUES('integrity-check')");
    converted.exec("COMMIT");
    writeFileSync(resolve(folder,"conversion.sql"),statements.join("\n"));
    writeFileSync(resolve(folder,"verification.json"),JSON.stringify({applied:apply,indexed,tables:Object.fromEntries(Object.entries(before).map(([name,rows])=>[name,{count:rows.length,sha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex')}]))},null,2));
  } catch(error){converted.exec("ROLLBACK");throw error;}
  if(!apply)converted.close();
}
db.close();
console.log(`Forum offline operation completed: ${folder}`);
