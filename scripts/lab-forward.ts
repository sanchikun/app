/**
 * 候補ルールの「見つけたあと」の成績。ルールと境目は FROZEN の日に固定してあり、それより後の日足だけで数える。
 * 過去の検証は条件を選んだ分だけ良く見えるので、ここでの成績が本当の答え合わせになる。
 *   npx tsx scripts/lab-fetch.ts && npx tsx scripts/lab-forward.ts     # .cachev を消してから取得し直すと最新になる
 *   npx tsx scripts/lab-forward.ts --since 2026-01-01                  # 動作確認用に、固定日より前から数える
 */
import { ETFS, build, f, stat } from "./lab";
import type { Rec } from "./lab";

const FROZEN = "2026-11-19";
const arg = process.argv.indexOf("--since");
const since = arg >= 0 ? process.argv[arg + 1] : FROZEN;
const stocks = build((s) => !ETFS.includes(s));
const one = (s: string) => new Map(build((x) => x === s).recs.map((r) => [r.d, r]));
const topix = one("1306.T"), inv = one("1357.T"), lev = one("1570.T");
/** あとから足した候補は、足した日（FROZEN2）より後だけを数える。先に固定した候補の日付と中身は変えない */
const FROZEN2 = "2026-11-21";
const days = stocks.days.filter((d) => d > since);

/** 安寄り買い: 条件に合う銘柄のうちギャップ最大の1銘柄、寄りで買い、0.5%で損切り、引けで売る */
const gapOpen = (cond: (r: Rec) => boolean) => (d: string): number | null => {
  const c = stocks.byDay.get(d)!.filter((r) => r.gap <= -0.01 && cond(r));
  if (!c.length) return null;
  const r = c.reduce((a, b) => (b.gap < a.gap ? b : a));
  return r.lowPct <= -0.005 ? -0.0053 : r.intra;
};
/** 安寄り買いを n 銘柄に分ける: ギャップの大きい順に、1銘柄 budget 円に収まる株数（100株単位）を買う。損益率は n×budget に対する割合 */
const gapOpenMulti = (n: number, budget: number) => (d: string): number | null => {
  const c = stocks.byDay.get(d)!.filter((r) => r.gap <= -0.01).sort((a, b) => a.gap - b.gap);
  let pnl = 0, k = 0;
  for (const r of c) {
    if (k >= n) break;
    const open = r.px * (1 + r.gap), shares = Math.floor(budget / (open * 100)) * 100;
    if (shares <= 0) continue;
    k++;
    pnl += shares * open * (r.lowPct <= -0.005 ? -0.0053 : r.intra);
  }
  return k ? pnl / (n * budget) : null;
};
const RULES: [string, number, (d: string) => number | null, string?][] = [
  ["現行の比較用：安寄り買い（条件なし）", 500000, gapOpen(() => true)],
  ["候補1：前日2%以上下げた安寄り", 500000, gapOpen((r) => r.pRet <= -0.02)],
  ["候補1b：候補1 かつ VIX 15以上", 500000, gapOpen((r) => r.pRet <= -0.02 && r.vix >= 15)],
  ["候補2：1306 を月曜の引けで買い翌朝売る", 280000, (d) => { const r = topix.get(d); return r && r.dowP === 1 ? r.gap : null; }],
  ["候補3a：米国+1.5%以上の翌日、1357 を寄りで買い引けで売る", 300000, (d) => { const r = inv.get(d); return r && r.us >= 0.015 ? r.intra : null; }],
  ["候補3b：米国-2%以下の翌日、1570 を寄りで買い引けで売る", 300000, (d) => { const r = lev.get(d); return r && r.us <= -0.02 ? r.intra : null; }],
  ["候補5（11/21〜）：安寄り買いを2銘柄×25万円に分ける（条件なし）", 500000, gapOpenMulti(2, 250000), FROZEN2],
  ["候補5b（11/21〜）：3銘柄×50万円に分ける（条件なし）", 1500000, gapOpenMulti(3, 500000), FROZEN2],
];
console.log(`${since} より後の ${days.length} 営業日（${days[0] ?? "-"}〜${days[days.length - 1] ?? "-"}）`);
for (const [name, notional, rule, from] of RULES) {
  const rets = days.filter((d) => arg >= 0 || !from || d > from).map(rule).filter((x): x is number => x != null);
  const st = stat(rets);
  const total = rets.reduce((a, x) => a + x, 0) * notional;
  console.log(`${name}\n    ${rets.length}回  平均 ${rets.length ? f((total / notional / rets.length) * 1e4) : "     -"}bp  t値 ${f(st.t, 5, 2)}  勝率 ${rets.length ? f((rets.filter((x) => x > 0).length / rets.length) * 100, 4, 0) : "   -"}%  合計 ${Math.round(total).toLocaleString("ja-JP")}円（1回 ${notional.toLocaleString("ja-JP")}円）`);
}
