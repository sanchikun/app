/**
 * 分足をためる。Yahoo Finance の分足は、5分足が直近60日、1分足が直近7日で消えるので、週に1回これを動かして
 * data/intraday/ に1日1ファイルで保存する（すでにある日は書き換えない）。
 *   npx tsx scripts/intraday-archive.ts                 # ふだん（5分足は直近1か月、1分足は直近7日を取りにいく）
 *   npx tsx scripts/intraday-archive.ts --range5m 60d   # 初回や、しばらく動かせなかったとき
 * 保存するもの:
 *   data/intraday/5m/YYYY-MM-DD.csv.gz       その日の5分足（全銘柄、9:00〜15:30）
 *   data/intraday/1m-open/YYYY-MM-DD.csv.gz  その日の1分足のうち 9:00〜10:00（寄り付き直後を見るため）
 * 中身は「銘柄,時刻(UNIX秒),始値,高値,安値,終値,出来高」。読むときは scripts/lab.ts の readArchive を使う。
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { jstDate, jstMinutes } from "../src/core/market";
import type { Bar } from "../src/core/types";
import { getProvider } from "../src/data/provider";
import type { Range } from "../src/data/provider";
import { ARCHIVE, ETFS } from "./lab";
import { universe } from "./universe";

const args = process.argv.slice(2);
const range5m = (args[args.indexOf("--range5m") + 1] && args.includes("--range5m") ? args[args.indexOf("--range5m") + 1] : "1mo") as Range;
const provider = getProvider("yahoo");
const now = Math.floor(Date.now() / 1000);
const today = jstDate(now);
// 当日分は、大引けから30分以上たっていれば確定している
const complete = (d: string) => d < today || jstMinutes(now) >= 16 * 60;
const symbols = [...new Set([...universe("all").map((s) => `${s}.T`), ...ETFS])];
const KINDS = [
  // 前場の引け（11:30）と大引け（15:30）の足も残す
  { dir: "5m", interval: "5m" as const, range: range5m, keep: (b: Bar) => jstMinutes(b.t) >= 9 * 60 && jstMinutes(b.t) <= 15 * 60 + 30 },
  { dir: "1m-open", interval: "1m" as const, range: "7d" as Range, keep: (b: Bar) => jstMinutes(b.t) >= 9 * 60 && jstMinutes(b.t) < 10 * 60 },
];
let failed = 0;
for (const kind of KINDS) {
  const byDate = new Map<string, Map<string, Bar[]>>();
  for (const s of symbols) {
    try {
      for (const b of await provider.intraday(s, kind.interval, kind.range, now)) {
        if (!kind.keep(b)) continue;
        const d = jstDate(b.t);
        if (!byDate.has(d)) byDate.set(d, new Map());
        const m = byDate.get(d)!;
        const a = m.get(s);
        if (a) a.push(b); else m.set(s, [b]);
      }
    } catch (e) {
      failed++;
      console.log(`取得失敗 ${s} ${kind.interval}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  mkdirSync(`${ARCHIVE}/${kind.dir}`, { recursive: true });
  const wrote: string[] = [], skipped: string[] = [];
  for (const d of [...byDate.keys()].sort()) {
    const file = `${ARCHIVE}/${kind.dir}/${d}.csv.gz`;
    const m = byDate.get(d)!;
    // 銘柄が少なすぎる日（取得の失敗や、端の欠けた日）は書かない。次回また取りにいく
    if (existsSync(file) || !complete(d)) continue;
    if (m.size < symbols.length * 0.8) { skipped.push(`${d}(${m.size}銘柄)`); continue; }
    const lines = [...m.keys()].sort().flatMap((s) => m.get(s)!.sort((a, b) => a.t - b.t).map((b) => `${s},${b.t},${b.o},${b.h},${b.l},${b.c},${b.v}`));
    writeFileSync(file, gzipSync(lines.join("\n") + "\n", { level: 9 }));
    wrote.push(d);
  }
  console.log(`${kind.dir}: 新しく保存 ${wrote.length}日${wrote.length ? `（${wrote[0]}〜${wrote[wrote.length - 1]}）` : ""}${skipped.length ? `  銘柄が足りず見送り: ${skipped.join(" ")}` : ""}`);
}
console.log(`done 取得失敗 ${failed}件`);
