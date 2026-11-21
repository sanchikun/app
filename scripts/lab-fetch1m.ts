/** 1分足 × 7日を .cachev に保存する（寄り付き直後の値動きの確認用。9:00〜9:05 が入っているのは主に週の最初の営業日） */
import { existsSync, writeFileSync } from "node:fs";
import { getProvider } from "../src/data/provider";
import { CACHE } from "./lab";
import { universe } from "./universe";
const p = getProvider("yahoo");
const now = Math.floor(Date.now() / 1000);
for (const s of universe("all").map((x) => `${x}.T`)) {
  const f = `${CACHE}/${s}-1m-7d.json`;
  if (existsSync(f)) continue;
  try { writeFileSync(f, JSON.stringify(await p.intraday(s, "1m", "7d", now))); } catch (e) { console.log("fail", s, String(e)); }
  await new Promise((r) => setTimeout(r, 250));
}
console.log("done");
