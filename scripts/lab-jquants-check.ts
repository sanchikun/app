/**
 * Yahoo Finance の日足が、東証の公式データ（J-Quants API）と合っているかを確かめる。
 * 無料プランは1分5回までなので、日付を間引いて全銘柄の日足を取り、始値・高値・安値・終値と寄りのギャップを比べる。
 *   npx tsx scripts/lab-jquants-check.ts          # API キーは環境の通信設定が付ける（x-api-key）
 * 取得した分は .cachev/jq-YYYYMMDD.json に保存する。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { DailyBar } from "../src/core/gapstudy";
import { CACHE, f } from "./lab";
import { universe } from "./universe";

interface JqBar { Code: string; O: number | null; H: number | null; L: number | null; C: number | null; AdjFactor: number; UL: string; LL: string }
async function jq(date: string): Promise<JqBar[]> {
  const file = `${CACHE}/jq-${date.replace(/-/g, "")}.json`;
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as JqBar[];
  const out: JqBar[] = [];
  let key = "";
  do {
    const res = await fetch(`https://api.jquants.com/v2/equities/bars/daily?date=${date.replace(/-/g, "")}${key ? `&pagination_key=${encodeURIComponent(key)}` : ""}`, { headers: { "x-api-key": "proxy-injected" } });
    if (!res.ok) throw new Error(`${date}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { data: JqBar[]; pagination_key?: string };
    out.push(...j.data);
    key = j.pagination_key ?? "";
    await new Promise((r) => setTimeout(r, 13000));
  } while (key);
  writeFileSync(file, JSON.stringify(out));
  return out;
}
const yahoo = new Map(universe("all").map((c) => [c, JSON.parse(readFileSync(`${CACHE}/${c}.T-1d-10y.json`, "utf8")) as DailyBar[]]));
const dates = yahoo.get("7203")!.map((b) => b.date).filter((d) => d >= "2024-09-02" && d <= "2026-08-27");
// 連続する2日を1組にして、間をあけて選ぶ（ギャップは前日の終値が要る）
const N = Number(process.argv[2] ?? 12);
const pairs = Array.from({ length: N }, (_, k) => Math.floor(((k + 0.5) * (dates.length - 1)) / N)).map((i) => [dates[i], dates[i + 1]]);
const diffs = { O: [] as number[], H: [] as number[], L: [] as number[], C: [] as number[], gap: [] as number[] };
const gdDiff: number[] = [], bad: string[] = [];
let n = 0, limit = 0, splitSkip = 0;
for (const [d0, d1] of pairs) {
  const a = new Map((await jq(d0)).map((b) => [b.Code, b])), b = new Map((await jq(d1)).map((x) => [x.Code, x]));
  for (const [code, bars] of yahoo) {
    const y0 = bars.find((x) => x.date === d0), y1 = bars.find((x) => x.date === d1), j0 = a.get(`${code}0`), j1 = b.get(`${code}0`);
    if (!y0 || !y1 || !j0 || !j1 || j1.O == null || j1.C == null || j0.C == null || j1.H == null || j1.L == null) continue;
    // 分割の日は調整の向きが絡むので飛ばす。Yahoo は分割調整済みなので、値そのものではなく同じ日の比率で比べる
    if (j1.AdjFactor !== 1) { splitSkip++; continue; }
    n++;
    if (j1.UL === "1" || j1.LL === "1") limit++;
    const r = (y: number, j: number) => Math.abs(y / y1.c / (j / j1.C!) - 1);
    diffs.O.push(r(y1.o, j1.O)); diffs.H.push(r(y1.h, j1.H)); diffs.L.push(r(y1.l, j1.L));
    diffs.C.push(Math.abs(y1.c / y0.c / (j1.C / j0.C) - 1));
    const gy = y1.o / (y0.c - (y1.dividend ?? 0)) - 1, gj = j1.O / (j0.C - (y1.dividend ?? 0) * (j0.C / y0.c)) - 1;
    diffs.gap.push(Math.abs(gy - gj));
    if (gj <= -0.01 || gy <= -0.01) { gdDiff.push(gy - gj); if (Math.abs(gy - gj) > 0.002 && bad.length < 10) bad.push(`${code} ${d1} Yahoo ギャップ${f(gy * 100, 6, 2)}% 公式${f(gj * 100, 6, 2)}%  Yahoo O${y1.o} C${y1.c} / 公式 O${j1.O} C${j1.C}`); }
  }
  console.log(`${d0} → ${d1} 済み（累計 ${n}件）`);
}
const q = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
console.log(`\n比べた ${n}件（${pairs.length}組の日付）。分割で飛ばした ${splitSkip}件、ストップ高・安に付いた ${limit}件`);
for (const k of ["O", "H", "L", "C", "gap"] as const) console.log(`  ${{ O: "始値", H: "高値", L: "安値", C: "終値（前日比）", gap: "寄りのギャップ" }[k].padEnd(10)} ずれ: 0.01%以内 ${f((diffs[k].filter((x) => x <= 0.0001).length / n) * 100, 5, 1)}%  0.1%超 ${diffs[k].filter((x) => x > 0.001).length}件  最大${f(q(diffs[k], 1) * 100, 6, 2)}%`);
console.log(`  1%以上安く寄った ${gdDiff.length}件: ギャップのずれ（Yahoo − 公式）平均${f((gdDiff.reduce((a, x) => a + x, 0) / Math.max(gdDiff.length, 1)) * 1e4, 6, 2)}bp、0.2%を超えてずれた ${gdDiff.filter((x) => Math.abs(x) > 0.002).length}件`);
if (bad.length) console.log(bad.join("\n"));
