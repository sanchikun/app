/**
 * 空売りのルール。高く寄った銘柄を寄りで売り、0.5%上で損切り、引けで買い戻す（安寄り買いの裏返し）。
 * 2銘柄×25万円、100株単位。これまでの260銘柄と、ルール選びに使っていない561銘柄（株価500円以上）の両方で見る。
 * 貸株料・逆日歩・空売りの規制（前日比10%以上下げた銘柄の成行売り禁止など）、売れる銘柄かどうかは入れていない。
 *   npx tsx scripts/lab-short.ts
 */
import { tickSize } from "../src/core/market";
import { ETFS, PERIODS, build, f, stat } from "./lab";
import type { Rec } from "./lab";

const U: [string, ReturnType<typeof build>, (r: Rec) => boolean][] = [["260", build((s) => !ETFS.includes(s)), () => true], ["561", build(() => true, ".cachew"), (r) => r.px >= 500]];
interface Opt { side?: "short" | "long"; n?: number; budget?: number; min?: number; cap?: number; stop?: number | null; pick?: (c: Rec[], n: number) => Rec[]; filter?: (r: Rec) => boolean; slip?: number }
const yen = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n / 1000)}`.padStart(6);
function daily(u: ReturnType<typeof build>, base: (r: Rec) => boolean, o: Opt): [string, number][] {
  const side = o.side ?? "short", dir = side === "short" ? -1 : 1;
  const n = o.n ?? 2, budget = o.budget ?? 250000, min = o.min ?? 0.01, cap = o.cap ?? 0.25, stop = o.stop === undefined ? 0.005 : o.stop;
  const out: [string, number][] = [];
  for (const d of u.days) {
    // dir * gap が小さいほど不利に寄った銘柄（売りなら高く寄った銘柄）
    const c = u.byDay.get(d)!.filter((r) => base(r) && -dir * r.gap >= min && -dir * r.gap < cap && (o.filter?.(r) ?? true) && r.px * (1 + r.gap) * 100 <= budget).sort((a, b) => dir * (a.gap - b.gap));
    let pnl = 0;
    for (const r of o.pick ? o.pick(c, n) : c.slice(0, n)) {
      const open = r.px * (1 + r.gap), shares = Math.floor(budget / (open * 100)) * 100;
      const adverse = side === "short" ? r.highPct : -r.lowPct;
      const ret = stop != null && adverse >= stop ? -stop - ((o.slip ?? 1) * tickSize(open, true)) / open : dir * r.intra;
      pnl += shares * open * ret;
    }
    out.push([d, pnl]);
  }
  return out;
}
function summary(dl: [string, number][]): string {
  const m = new Map<string, number>();
  for (const [d, v] of dl) m.set(d.slice(0, 7), (m.get(d.slice(0, 7)) ?? 0) + v);
  const mv = [...m.values()].sort((a, b) => a - b);
  let peak = 0, cum = 0, dd = 0;
  for (const [, v] of dl) { cum += v; peak = Math.max(peak, cum); dd = Math.min(dd, cum - peak); }
  return `合計${yen(cum)} t${f(stat(dl.filter((x) => x[1] !== 0).map((x) => x[1])).t, 5, 2)} +月${f((mv.filter((v) => v > 0).length / mv.length) * 100, 3, 0)}% 最悪月${yen(mv[0])} 落込${yen(dd)} 期間[${PERIODS.map(([lo, hi]) => yen(dl.filter(([d]) => d >= lo && d < hi).reduce((a, x) => a + x[1], 0))).join("")}]`;
}
const line = (name: string, o: Opt) => console.log(`${name.padEnd(32)} ${U.map(([label, u, base]) => `${label}: ${summary(daily(u, base, o))}`).join("  ‖  ")}`);
console.log("金額は千円。合計・最悪の月・最大の落ち込み・期間ごとの合計（2017–19 / 2020–22 / 2023–）");
line("比較用：安寄り買い2銘柄", { side: "long" });
line("基準：高く寄った上位2銘柄を売る", {});
console.log("--- 選び方・銘柄数");
line("2〜3番目に高く寄った", { pick: (c, n) => c.slice(1, 1 + n) });
line("3〜4番目", { pick: (c, n) => c.slice(2, 2 + n) });
line("ギャップが小さい2銘柄", { pick: (c, n) => c.slice(-n) });
line("1銘柄×50万円", { n: 1, budget: 500000 });
line("4銘柄×12.5万円", { n: 4, budget: 125000 });
console.log("--- ギャップの範囲");
for (const x of [0.005, 0.02, 0.03, 0.05]) line(`${x * 100}%以上高く寄った`, { min: x });
for (const x of [0.1, 0.05, 0.03]) line(`${x * 100}%より大きいギャップは除く`, { cap: x });
console.log("--- 損切り幅");
for (const x of [0.003, 0.0075, 0.01, 0.02, null]) line(x == null ? "損切りなし" : `損切り ${x * 100}%`, { stop: x });
line("損切り0.5%・滑り3ティック", { slip: 3 });
console.log("--- 絞り込み");
line("200日線より下", { filter: (r) => r.ma200 <= 0 });
line("200日線より上", { filter: (r) => r.ma200 > 0 });
line("20日線より下", { filter: (r) => r.ma20 <= 0 });
line("前日2%以上上げ（2日続けて高い）", { filter: (r) => r.pRet >= 0.02 });
line("前日は下げ", { filter: (r) => r.pRet < 0 });
line("5日で5%以上上げ", { filter: (r) => r.r5 >= 0.05 });
line("5日で下げている", { filter: (r) => r.r5 < 0 });
line("20日高値を更新していた", { filter: (r) => r.hi20 });
line("相場全体は高くない（平均 < +0.3%）", { filter: (r) => r.mktGap < 0.003 });
line("相場全体が高い（平均 >= +0.3%）", { filter: (r) => r.mktGap >= 0.003 });
line("相場全体が1%以上高い", { filter: (r) => r.mktGap >= 0.01 });
line("米国が前日下げ", { filter: (r) => r.us < 0 });
line("米国が前日+1%以上", { filter: (r) => r.us >= 0.01 });
line("前日の出来高が2倍以上", { filter: (r) => r.pVol >= 2 });
line("VIX 20以上", { filter: (r) => r.vix >= 20 });
line("VIX 15未満", { filter: (r) => r.vix < 15 });
for (const [w, name] of [[1, "月"], [2, "火"], [3, "水"], [4, "木"], [5, "金"]] as const) line(`${name}曜だけ`, { filter: (r) => r.dow === w });
console.log("--- 買いと売りを両方（各2銘柄×25万円）");
for (const [label, u, base] of U) {
  const L = daily(u, base, { side: "long" }), S = daily(u, base, {});
  const both = L.map(([d, v], i) => [d, v + S[i][1]] as [string, number]);
  const ml = L.reduce((a, x) => a + x[1], 0) / L.length, ms = S.reduce((a, x) => a + x[1], 0) / S.length;
  const cov = L.reduce((a, x, i) => a + (x[1] - ml) * (S[i][1] - ms), 0), vl = L.reduce((a, x) => a + (x[1] - ml) ** 2, 0), vs = S.reduce((a, x) => a + (x[1] - ms) ** 2, 0);
  console.log(`${label}: 買いだけ ${summary(L)}\n     売りだけ ${summary(S)}\n     両方     ${summary(both)}  （日々の損益の相関 ${f(cov / Math.sqrt(vl * vs), 5, 2)}）`);
}
