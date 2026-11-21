/**
 * 安く寄った理由が決算かどうかで、場中の戻り方が違うか。J-Quants の開示日（2024年9月〜2026年8月の約2年分）で分ける。
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/lab-jquants-fins.ts && npx tsx scripts/lab-earnings.ts
 * 日の分け方（寄り付きの時点で分かるもの）:
 *   引け後の開示の翌朝 … 前の営業日の大引けより後（または当日の寄り前）に開示があった日。寄りのギャップは開示への反応。
 *   場中の開示の翌朝   … 前の営業日の取引時間中に開示があった日（反応は前日の場中に始まっている）。
 *   当日の場中に開示   … その日の取引時間中に開示がある日（寄りの時点では中身は分からないが、予定日は分かる）。
 *   どれでもない日
 */
import { existsSync, readFileSync } from "node:fs";
import { tickSize } from "../src/core/market";
import { CACHE, ETFS, build, f, mean, stat } from "./lab";
import type { Rec } from "./lab";

// --from / --to で期間を変えられる。答え合わせは `--from 2026-11-24`（候補8を決めた日より後）で見る。
// 無料プランの開示日は12週間遅れなので、直近の期間は時間がたってから .cachev/jq-fins-*.json を取り直す必要がある
const arg = (name: string, def: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; };
const FROM = arg("from", "2024-09-02"), TO = arg("to", "2026-08-28");
const u = build((s) => !ETFS.includes(s));
type Kind = "after" | "afterIntra" | "today" | "none";
interface Disc { d: string; t: string; type: string }
const fins = new Map<string, Disc[]>();
let have = 0;
for (const s of new Set(u.recs.map((r) => r.s))) {
  const file = `${CACHE}/jq-fins-${s.slice(0, 4)}.json`;
  if (!existsSync(file)) continue;
  have++;
  fins.set(s, JSON.parse(readFileSync(file, "utf8")) as Disc[]);
}
/** 決算短信など（業績予想の修正などは含めない） */
const isEarnings = (x: Disc) => x.type.includes("FinancialStatements");
function kindOf(r: Rec, onlyEarnings: boolean): Kind {
  const list = (fins.get(r.s) ?? []).filter((x) => !onlyEarnings || isEarnings(x));
  // 大引けは 2024-11-05 から 15:30、それより前は 15:00
  const close = (d: string) => (d >= "2024-11-05" ? "15:30:00" : "15:00:00");
  let k: Kind = "none";
  for (const x of list) {
    if ((x.d === r.pd && x.t >= close(r.pd)) || (x.d > r.pd && x.d < r.d) || (x.d === r.d && x.t < "09:00:00")) return "after";
    if (x.d === r.pd && x.t >= "09:00:00" && x.t < close(r.pd)) k = "afterIntra";
    else if (x.d === r.d && x.t >= "09:00:00" && x.t < close(r.d) && k === "none") k = "today";
  }
  return k;
}
const recs = u.recs.filter((r) => r.d >= FROM && r.d <= TO && fins.has(r.s));
const days = [...new Set(recs.map((r) => r.d))].sort();
const NAMES: Record<Kind, string> = { after: "引け後の開示の翌朝", afterIntra: "場中の開示の翌朝", today: "当日の場中に開示", none: "どれでもない日" };
console.log(`開示日を取得できた ${have}銘柄、${days.length}日（${days[0]}〜${days[days.length - 1]}）`);
const withStop = (r: Rec, dir: 1 | -1) => { const o = r.px * (1 + r.gap), adv = dir === 1 ? -r.lowPct : r.highPct; return adv >= 0.005 ? -0.005 - tickSize(o, true) / o : dir * r.intra; };
function report(name: string, list: Rec[], fn: (r: Rec) => number) {
  const byDay = new Map<string, number[]>();
  for (const r of list) { const a = byDay.get(r.d); if (a) a.push(fn(r)); else byDay.set(r.d, [fn(r)]); }
  const st = stat([...byDay.values()].map(mean)), all = list.map(fn);
  console.log(`  ${name.padEnd(22)} ${String(list.length).padStart(5)}件 ${String(st.n).padStart(3)}日  1件平均${f(mean(all.length ? all : [0]) * 1e4, 7)}bp  日平均${f(st.m, 7)}bp  t${f(st.t, 6, 2)}  勝ち${f((all.filter((x) => x > 0).length / Math.max(all.length, 1)) * 100, 4, 0)}%`);
}
for (const onlyEarnings of [true, false]) {
  const kind = new Map(recs.map((r) => [r, kindOf(r, onlyEarnings)]));
  console.log(`\n######## ${onlyEarnings ? "決算短信だけで分ける" : "業績予想の修正なども含めて分ける"}`);
  console.log("  日の内訳: " + (Object.keys(NAMES) as Kind[]).map((k) => `${NAMES[k]} ${recs.filter((r) => kind.get(r) === k).length}件`).join("、"));
  for (const [title, cond, dir] of [["1%以上安く寄った銘柄を買う（損切り0.5%、引けで売る）", (r: Rec) => r.gap <= -0.01, 1], ["3%以上安く寄った銘柄を買う", (r: Rec) => r.gap <= -0.03, 1], ["1%以上高く寄った銘柄を売る（損切り0.5%）", (r: Rec) => r.gap >= 0.01, -1], ["3%以上高く寄った銘柄を売る", (r: Rec) => r.gap >= 0.03, -1]] as const) {
    console.log(`=== ${title}`);
    for (const k of Object.keys(NAMES) as Kind[]) report(NAMES[k], recs.filter((r) => cond(r) && kind.get(r) === k), (r) => withStop(r, dir));
    console.log("  （損切りなしで引けまで持った場合）");
    for (const k of ["after", "none"] as Kind[]) report(NAMES[k], recs.filter((r) => cond(r) && kind.get(r) === k), (r) => dir * r.intra);
  }
  // 上位2銘柄×25万円: 決算の翌朝の銘柄を避ける／だけにする
  console.log("=== ギャップの大きい順に2銘柄×25万円（買い、損切り0.5%、円、2年）");
  for (const [name, ok] of [["そのまま", () => true], ["引け後の開示の翌朝の銘柄は避ける", (r: Rec) => kind.get(r) !== "after"], ["開示がからむ銘柄はすべて避ける", (r: Rec) => kind.get(r) === "none"], ["引け後の開示の翌朝の銘柄だけ", (r: Rec) => kind.get(r) === "after"]] as const) {
    const dl: number[] = [];
    let n = 0;
    for (const d of days) {
      let pnl = 0;
      for (const r of u.byDay.get(d)!.filter((x) => fins.has(x.s) && x.gap <= -0.01 && ok(x) && x.px * (1 + x.gap) * 100 <= 250000).sort((a, b) => a.gap - b.gap).slice(0, 2)) { const o = r.px * (1 + r.gap); pnl += Math.floor(250000 / (o * 100)) * 100 * o * withStop(r, 1); n++; }
      dl.push(pnl);
    }
    let peak = 0, cum = 0, dd = 0;
    for (const v of dl) { cum += v; peak = Math.max(peak, cum); dd = Math.min(dd, cum - peak); }
    console.log(`  ${name.padEnd(22)} ${String(n).padStart(4)}回  合計 ${Math.round(cum).toLocaleString("ja-JP").padStart(9)}円  t${f(stat(dl.filter((x) => x !== 0)).t, 5, 2)}  最大の落ち込み ${Math.round(dd).toLocaleString("ja-JP").padStart(8)}`);
  }
}
