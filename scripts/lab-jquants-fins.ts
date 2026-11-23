/**
 * 決算などの開示日（J-Quants API の財務情報）を銘柄ごとに取得して .cachev/jq-fins-CODE.json に保存する。
 * 無料プランは1分5回までなので、260銘柄で1時間ほどかかる。途中で止めても続きから再開する。
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/lab-jquants-fins.ts
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/lab-jquants-fins.ts --dir .cachet   # その保存先にある日足の銘柄で取る
 */
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { CACHE as DEFAULT_DIR } from "./lab";
import { universe } from "./universe";
let done = 0, fail = 0;
const di = process.argv.indexOf("--dir");
const CACHE = di >= 0 ? process.argv[di + 1] : DEFAULT_DIR;
const codes = di >= 0 ? readdirSync(CACHE).filter((f) => /^\w{4}\.T-1d-10y\.json$/.test(f)).map((f) => f.slice(0, 4)) : universe("all");
for (const c of codes) {
  const file = `${CACHE}/jq-fins-${c}.json`;
  if (existsSync(file)) { done++; continue; }
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const out: unknown[] = [];
      let key = "";
      do {
        const res = await fetch(`https://api.jquants.com/v2/fins/summary?code=${c}${key ? `&pagination_key=${encodeURIComponent(key)}` : ""}`, { headers: { "x-api-key": "proxy-injected" } });
        if (res.status === 429) throw new Error("rate");
        if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
        const j = (await res.json()) as { data: { DiscDate: string; DiscTime: string; DocType: string; CurPerType: string }[]; pagination_key?: string };
        out.push(...j.data.map((x) => ({ d: x.DiscDate, t: x.DiscTime, type: x.DocType, per: x.CurPerType })));
        key = j.pagination_key ?? "";
        await new Promise((r) => setTimeout(r, 12500));
      } while (key);
      writeFileSync(file, JSON.stringify(out));
      done++;
      break;
    } catch (e) {
      if (attempt === 3) { fail++; console.log("fail", c, String(e)); }
      await new Promise((r) => setTimeout(r, 30000));
    }
  }
  if (done % 20 === 0) console.log(`${done}/${codes.length}`);
}
console.log(`done ${done} fail ${fail}`);
