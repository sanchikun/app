/** 5分足 × 60日を .cachev に保存する（押し目の指値がどの順で約定するかの確認用） */
import { existsSync, writeFileSync } from "node:fs";
import { getProvider } from "../src/data/provider";
import { CACHE } from "./lab";
import { universe } from "./universe";
const p = getProvider("yahoo");
const now = Math.floor(Date.now() / 1000);
for (const s of universe("all").map((x) => `${x}.T`)) {
  const f = `${CACHE}/${s}-5m-60d.json`;
  if (existsSync(f)) continue;
  try { writeFileSync(f, JSON.stringify(await p.intraday(s, "5m", "60d", now))); } catch (e) { console.log("fail", s, String(e)); }
  await new Promise((r) => setTimeout(r, 300));
}
console.log("done");
