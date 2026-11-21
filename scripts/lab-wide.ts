/**
 * 銘柄を広げても同じ傾向が出るか。これまでの260銘柄（ルールを選ぶのに使った）と、使っていない銘柄群を並べて見る。
 *   npx tsx scripts/lab-probe.ts && npx tsx scripts/lab-fetch-wide.ts && npx tsx scripts/lab-wide.ts
 * 広げた銘柄は TOPIX500 かどうか分からないので、損切りの滑りは細かい呼値と通常の呼値の両方で出す。
 */
import { readFileSync } from "node:fs";
import { tickSize } from "../src/core/market";
import { CACHE, ETFS, PERIODS, build, f, mean, stat, tester } from "./lab";
import type { Rec } from "./lab";

const WIDE_CACHE = ".cachew";
const probe = JSON.parse(readFileSync(`${CACHE}/probe.json`, "utf8")) as Record<string, [number, number, string] | null>;
const turnover = (s: string) => probe[s.slice(0, 4)]?.[1] ?? 0;
const GROUPS: [string, ReturnType<typeof build>][] = [
  ["これまでの260銘柄", build((s) => !ETFS.includes(s))],
  ["広げた銘柄すべて", build(() => true, WIDE_CACHE)],
  ["広げた銘柄：売買代金20億円以上", build((s) => turnover(s) >= 2e9, WIDE_CACHE)],
  ["広げた銘柄：売買代金5〜20億円", build((s) => turnover(s) < 2e9, WIDE_CACHE)],
];
/**
 * 株価500円未満と、10%を超えるギャップは除く。低位株は1ティックが大きく（8円の株は1円で12.5%）、大きなギャップは
 * 特別気配やストップ安で寄り値では買えないことが多い。除かないと「安く寄って大きく戻った」日が大量に混ざり、成績が良く出すぎる。
 */
const gd = (r: Rec) => r.gap <= -0.01 && r.gap > -0.1 && r.px >= 500;
const c1 = (r: Rec) => gd(r) && r.pRet <= -0.02;
for (const [name, u] of GROUPS) {
  const T = tester(u);
  console.log(`\n=== ${name}（株価500円以上・ギャップ10%以内、${new Set(u.recs.map((r) => r.s)).size}銘柄、${u.days[0]}〜）`);
  T("毎日 寄り→引け（比較用）", "intra", () => true);
  T("1%以上安く寄った", "intra", gd);
  T("前日2%以上下げ、1%以上安く寄った", "intra", c1);
  T("相場全体は安くないのに1%以上安く寄った", "intra", (r) => gd(r) && r.mktGap > -0.003);
  T("VIX15未満 & 1%以上安く寄った", "intra", (r) => gd(r) && r.vix < 15);
  T("毎晩持ち越し（比較用）", "on", () => true);
  T("月曜の引け→火曜の寄り", "on", (r) => r.dowP === 1);
  T("木曜の引け→金曜の寄り", "on", (r) => r.dowP === 4);
  T("場中に2%以上上げた日の持ち越し", "on", (r) => r.pIntra >= 0.02);
  for (const [label, cand] of [["安寄り買い（条件なし）", gd], ["候補1", c1]] as const) for (const fine of [true, false]) {
    const rets: [string, number][] = [];
    for (const d of u.days) {
      const c = u.byDay.get(d)!.filter(cand);
      if (!c.length) continue;
      const r = c.reduce((a, b) => (b.gap < a.gap ? b : a)), o = r.px * (1 + r.gap);
      rets.push([d, r.lowPct <= -0.005 ? -0.005 - tickSize(o, fine) / o : r.intra]);
    }
    const a = stat(rets.map((x) => x[1]));
    const per = PERIODS.map(([lo, hi]) => { const p = stat(rets.filter(([d]) => d >= lo && d < hi).map((x) => x[1])); return `${f(p.m)}/${f(p.t, 5, 2)}`; }).join(" |");
    const m = new Map<string, number>();
    for (const [d, v] of rets) m.set(d.slice(0, 7), (m.get(d.slice(0, 7)) ?? 0) + v * 500000);
    const mv = [...m.values()].sort((x, y) => x - y);
    console.log(`  1日1銘柄 ${label.padEnd(14)} ${fine ? "細かい呼値" : "通常の呼値"} d${String(a.n).padStart(5)} bp${f(a.m)} t${f(a.t, 6, 2)} 勝率${f((rets.filter((x) => x[1] > 0).length / Math.max(a.n, 1)) * 100, 4, 0)}% |${per} | 月平均${f(mean(mv), 7, 0)}円 +月${f((mv.filter((v) => v > 0).length / mv.length) * 100, 4, 0)}% 最悪${f(mv[0], 8, 0)}`);
  }
}
