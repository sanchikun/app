/**
 * 日足で検証できる「当日中に手仕舞う」ルールをまとめて試す。
 *   npm run dailystudy                         # 既定の50銘柄、10年
 *   npm run dailystudy -- --universe wide      # 既定の50銘柄以外の約200銘柄（all で両方）
 *   npm run dailystudy -- --split 2022         # 前半・後半の境目の年（既定 2022）
 *   npm run dailystudy -- --detail fade-low    # 1つのルールを年ごと・同時に入った銘柄数ごとに見る
 *   npm run dailystudy -- --range 5y --symbols 7203,6758 --cache .cache
 *
 * 多くのルールを一度に試すと、どれかは偶然よく見える。前半と後半の両方で t値が大きいものだけを残す。
 */
import { DAILY_RULES, marketGaps, runRule } from "../src/core/dailystudy";
import type { DailyTrade } from "../src/core/dailystudy";
import { summarize } from "../src/core/gapstudy";
import { normalizeSymbol } from "../src/core/types";
import { loadDaily, universe } from "./universe";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const symbols = (flag("symbols")?.split(",") ?? universe(flag("universe"))).map((s: string) => normalizeSymbol(s.trim()));
const range = flag("range") ?? "10y";
const split = flag("split") ?? "2022";
const notional = Number(flag("notional") ?? 300000);
const data = await loadDaily(symbols, range, flag("cache"));
if (data.length === 0) process.exit(1);
const market = marketGaps(data);

const bp = (n: number | null) => (n == null ? "-" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}`);
const t2 = (n: number | null) => (n == null ? "-" : n.toFixed(2));
const pct = (n: number | null) => (n == null ? "-" : `${(n * 100).toFixed(1)}%`);
// 全角文字は2桁分の幅として数える
const width = (s: string) => [...s].reduce((a, ch) => a + (ch.charCodeAt(0) > 0xff ? 2 : 1), 0);
const pad = (s: string, w: number, left = false) => (left ? s + " ".repeat(Math.max(0, w - width(s))) : " ".repeat(Math.max(0, w - width(s))) + s);
const W = [34, 4, 7, 6, 7, 5, 8, 8, 6, 8, 6, 8, 6];
const row = (c: string[]) => c.map((x, i) => pad(x, W[i], i === 0)).join(" ");

const dates = [...market.keys()].sort();
console.log(`日足の検証  ${data.length}銘柄  ${dates[0]}〜${dates[dates.length - 1]}  寄り付きで入り大引けで決済（滑りなし。逆指値で入るルールは1ティック）`);
console.log(`日平均は同じ日の取引を1つにまとめた平均（bp = 0.01%）。t値はその日平均から計算。前半は ${split} 年より前、後半は ${split} 年以降`);
console.log(`\n${row(["ルール", "売買", "取引", "日数", "勝率", "PF", "平均bp", "日平均bp", "t値", "前半bp", "前半t", "後半bp", "後半t"])}`);

const results = DAILY_RULES.map((rule) => ({ rule, trades: data.flatMap(([symbol, bars]) => runRule(rule, symbol, bars, market)) }));
const line = (label: string, side: string, trades: DailyTrade[]) => {
  const s = summarize(trades);
  const a = summarize(trades.filter((t) => t.date < split));
  const b = summarize(trades.filter((t) => t.date >= split));
  return row([label, side, String(s.trades), String(s.days), pct(s.winRate), s.profitFactor == null ? "-" : s.profitFactor.toFixed(2), bp(s.avgBp), bp(s.avgDayBp), t2(s.tStat), bp(a.avgDayBp), t2(a.tStat), bp(b.avgDayBp), t2(b.tStat)]);
};
for (const { rule, trades } of results) console.log(line(rule.label, rule.side === "long" ? "買" : "売", trades));

// 曜日と月の変わり目（毎日寄りで買って引けで売った場合）
const base = results[0].trades;
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const monthFirst = new Set(dates.filter((d, i) => i === 0 || dates[i - 1].slice(0, 7) !== d.slice(0, 7)));
const monthLast = new Set(dates.filter((d, i) => i === dates.length - 1 || dates[i + 1].slice(0, 7) !== d.slice(0, 7)));
console.log(`\n${row(["時期（毎日寄りで買い引けで売る）", "売買", "取引", "日数", "勝率", "PF", "平均bp", "日平均bp", "t値", "前半bp", "前半t", "後半bp", "後半t"])}`);
for (const [i, name] of ["月曜", "火曜", "水曜", "木曜", "金曜"].entries()) console.log(line(name, "買", base.filter((t) => dow(t.date) === i + 1)));
console.log(line("月の最初の営業日", "買", base.filter((t) => monthFirst.has(t.date))));
console.log(line("月の最後の営業日", "買", base.filter((t) => monthLast.has(t.date))));

const detail = flag("detail");
const picked = results.find((r) => r.rule.key === detail);
if (detail && !picked) console.log(`\n--detail に指定できるのは: ${DAILY_RULES.map((r) => r.key).join(", ")}`);
if (picked) {
  const { rule, trades } = picked;
  const side = rule.side === "long" ? "買" : "売";
  const head = (title: string) => console.log(`\n${row([title, "売買", "取引", "日数", "勝率", "PF", "平均bp", "日平均bp", "t値", "前半bp", "前半t", "後半bp", "後半t"])}`);
  head(`${rule.label}：年ごと`);
  for (const y of [...new Set(trades.map((t) => t.date.slice(0, 4)))].sort()) console.log(line(y, side, trades.filter((t) => t.date.startsWith(y))));
  const perDay = new Map<string, number>();
  for (const t of trades) perDay.set(t.date, (perDay.get(t.date) ?? 0) + 1);
  const n = (t: DailyTrade) => perDay.get(t.date)!;
  head(`${rule.label}：同じ日に入った銘柄数`);
  for (const [label, lo, hi] of [["1〜3銘柄", 1, 3], ["4〜10銘柄", 4, 10], ["11〜25銘柄", 11, 25], ["26銘柄以上", 26, 1e9]] as const) console.log(line(label, side, trades.filter((t) => n(t) >= lo && n(t) <= hi)));
  // 寄り付きの時点で分かる相場全体の強弱で分ける
  const mg = (t: DailyTrade) => market.get(t.date)!;
  head(`${rule.label}：相場全体の寄り付き`);
  for (const [label, lo, hi] of [["1%以上安い", -1e9, -1], ["0〜1%安い", -1, 0], ["0〜1%高い", 0, 1], ["1%以上高い", 1, 1e9]] as const) console.log(line(label, side, trades.filter((t) => mg(t) > lo && mg(t) <= hi)));

  // 損切りを入れた場合と、1日1銘柄だけ取引する人の月次。月次は、その日のシグナルから無作為に1つ選ぶのを繰り返して平均する
  const stops: [string, DailyTrade[]][] = [["なし", trades], ...[0.5, 1, 2, 3].map((p): [string, DailyTrade[]] => [`${p}%`, data.flatMap(([symbol, bars]) => runRule(rule, symbol, bars, market, 1, p))])];
  const stoppable = stops[1][1].some((t, i) => t.ret !== trades[i].ret);
  if (stoppable) {
    head(`${rule.label}：損切り`);
    for (const [label, tr] of stops) console.log(line(label, side, tr));
  }
  const yen = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString("ja-JP")}円`;
  const RUNS = 300;
  console.log(`\n1日1銘柄を無作為に選び、1回 ${notional.toLocaleString("ja-JP")}円 分を取引した場合の月次（${RUNS}通りの平均）`);
  for (const [label, tr] of stoppable ? stops : stops.slice(0, 1)) {
    const byDay = new Map<string, number[]>();
    for (const t of tr) byDay.set(t.date, [...(byDay.get(t.date) ?? []), t.ret]);
    const days = [...byDay].sort(([a], [b]) => a.localeCompare(b));
    let seed = 12345;
    const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    let months = 0;
    let plus = 0;
    let sum = 0;
    let worst = 0;
    const all: number[] = [];
    for (let r = 0; r < RUNS; r++) {
      const m = new Map<string, number>();
      for (const [d, rets] of days) m.set(d.slice(0, 7), (m.get(d.slice(0, 7)) ?? 0) + rets[Math.floor(rand() * rets.length)] * notional);
      for (const v of m.values()) {
        months++;
        sum += v;
        if (v > 0) plus++;
        worst = Math.min(worst, v);
        all.push(v);
      }
    }
    all.sort((a, b) => a - b);
    const worstTrade = tr.reduce((a, t) => Math.min(a, t.ret), 0) * notional;
    console.log(`  損切り ${pad(label, 4)}  月の平均 ${pad(yen(sum / months), 9)}  プラスの月 ${pct(plus / months)}  下位5%の月 ${pad(yen(all[Math.floor(all.length * 0.05)]), 10)}  最悪の月 ${pad(yen(worst), 10)}  1回の最大損失 ${yen(worstTrade)}`);
  }

  const rets = trades.map((t) => t.ret).sort((a, b) => a - b);
  const q = (p: number) => `${(rets[Math.min(rets.length - 1, Math.floor(rets.length * p))] * 100).toFixed(2)}%`;
  console.log(`\n1取引の損益率の分布  最悪 ${q(0)}  下位1% ${q(0.01)}  下位5% ${q(0.05)}  中央 ${q(0.5)}  上位5% ${q(0.95)}  最良 ${q(1)}`);
}
