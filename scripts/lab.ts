/**
 * ルール探しの作業台。日足（.cachev に保存したもの）から銘柄×日の特徴量を作り、条件ごとに
 * 「日ごとの平均」の成績、相場全体（同じ日の全銘柄の平均）に対する上乗せ、3つの期間ごとの t値を出す。
 * 本番のルールにする前の当たりを付けるためのもので、約定の細かい扱い（呼値、滑り）は入れていない。
 *   npx tsx scripts/lab-fetch.ts     # 日足を取得（出来高つき、ETF・米国指数・VIX・ドル円も）
 *   npx tsx scripts/lab-round2.ts    # 条件をまとめて試す
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { DailyBar } from "../src/core/gapstudy";

export const CACHE = ".cachev";
export const ETFS = ["1306.T", "1321.T", "1570.T", "1357.T", "1343.T", "2516.T"];
export interface Rec {
  s: string; d: string; pd: string;
  /** 当日: 寄りのギャップ、場中、前日終値→終値、安値・高値の始値比 */
  gap: number; intra: number; c2c: number; lowPct: number; highPct: number;
  mktGap: number; mktIntra: number; mktC2c: number; gapRank: number; n: number;
  /** 前日の終値までで分かるもの（p = 前日） */
  pRet: number; pIntra: number; pLoc: number; r5: number; r20: number; ma20: number; ma200: number; atr: number; hi20: boolean; lo20: boolean;
  pVol: number; pIntraRank: number; mktPIntra: number; mktPRet: number;
  dowP: number; dow: number; calGap: number; dom: number; monthEndP: boolean; div: number; px: number;
  /** 当日の寄り付き前に終わっている直近の米国市場など（us = S&P500 の前日比、vix = 水準、jpy = ドル円の前日比） */
  us: number; usP: number; vix: number; vixP: number; jpy: number; sox: number;
  next?: Rec;
}
const ok = (b: DailyBar) => b.o > 0 && b.h >= Math.max(b.o, b.c) && b.l <= Math.min(b.o, b.c);
export const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const load = (name: string) => JSON.parse(readFileSync(`${CACHE}/${name}-1d-10y.json`, "utf8")) as DailyBar[];

/** 日付 d より前の直近の値を返す関数を作る（米国の D 日の引けは、日本の D+1 日の寄り付き前） */
function before(name: string, f: (bars: DailyBar[], i: number) => number): (d: string) => number {
  if (!existsSync(`${CACHE}/${name}-1d-10y.json`)) return () => NaN;
  const bars = load(name);
  const dates = bars.map((b) => b.date);
  return (d) => {
    let lo = 0, hi = dates.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (dates[m] < d) lo = m + 1; else hi = m; }
    return lo >= 2 ? f(bars, lo - 1) : NaN;
  };
}
const chg = (bars: DailyBar[], i: number) => bars[i].c / bars[i - 1].c - 1;
const usAt = before("_GSPC", chg), vixAt = before("_VIX", (b, i) => b[i].c), jpyAt = before("JPY_X", chg), soxAt = before("_SOX", chg);

export function build(symbols: (s: string) => boolean): { recs: Rec[]; byDay: Map<string, Rec[]>; days: string[] } {
  const recs: Rec[] = [];
  for (const f of readdirSync(CACHE).filter((f) => /^\w{4}\.T-1d-10y\.json$/.test(f))) {
    const s = f.split("-")[0];
    if (!symbols(s)) continue;
    const bars = load(s);
    let prev: Rec | undefined;
    for (let i = 201; i < bars.length; i++) {
      const b = bars[i], p = bars[i - 1];
      if (!ok(b) || !ok(p) || !ok(bars[i - 2])) { prev = undefined; continue; }
      const pc = p.c - (b.dividend ?? 0);
      const gap = (b.o - pc) / pc;
      if (Math.abs(gap) > 0.25) { prev = undefined; continue; }
      const ppc = bars[i - 2].c - (p.dividend ?? 0);
      let s20 = 0, s200 = 0, tr = 0, h20 = -1e9, l20 = 1e9, v20 = 0;
      for (let k = 1; k <= 200; k++) {
        s200 += bars[i - k].c;
        if (k <= 20) { s20 += bars[i - k].c; if (k > 1) { h20 = Math.max(h20, bars[i - k].c); l20 = Math.min(l20, bars[i - k].c); } }
        if (k >= 2 && k <= 21) v20 += bars[i - k].v ?? 0;
        if (k <= 14) tr += (Math.max(bars[i - k].h, bars[i - k - 1].c) - Math.min(bars[i - k].l, bars[i - k - 1].c)) / bars[i - k - 1].c;
      }
      const r: Rec = {
        s, d: b.date, pd: p.date, gap, intra: (b.c - b.o) / b.o, c2c: (b.c - pc) / pc, lowPct: (b.l - b.o) / b.o, highPct: (b.h - b.o) / b.o,
        mktGap: 0, mktIntra: 0, mktC2c: 0, gapRank: 0, n: 0,
        pRet: (p.c - ppc) / ppc, pIntra: (p.c - p.o) / p.o, pLoc: p.h > p.l ? (p.c - p.l) / (p.h - p.l) : 0.5, r5: p.c / bars[i - 6].c - 1, r20: p.c / bars[i - 21].c - 1,
        ma20: p.c / (s20 / 20) - 1, ma200: p.c / (s200 / 200) - 1, atr: tr / 14, hi20: p.c > h20, lo20: p.c < l20,
        pVol: v20 > 0 ? (p.v ?? 0) / (v20 / 20) : NaN, pIntraRank: 0, mktPIntra: 0, mktPRet: 0,
        dowP: new Date(`${p.date}T00:00:00Z`).getUTCDay(), dow: new Date(`${b.date}T00:00:00Z`).getUTCDay(), calGap: (Date.parse(b.date) - Date.parse(p.date)) / 864e5,
        dom: Number(b.date.slice(8)), monthEndP: p.date.slice(0, 7) !== b.date.slice(0, 7), div: b.dividend ?? 0, px: p.c,
        us: usAt(b.date), usP: usAt(p.date), vix: vixAt(b.date), vixP: vixAt(p.date), jpy: jpyAt(b.date), sox: soxAt(b.date),
      };
      if (prev && prev.d === p.date) prev.next = r;
      prev = r;
      recs.push(r);
    }
  }
  const byDay = new Map<string, Rec[]>();
  for (const r of recs) { const a = byDay.get(r.d); if (a) a.push(r); else byDay.set(r.d, [r]); }
  for (const rs of byDay.values()) {
    const mg = mean(rs.map((r) => r.gap)), mi = mean(rs.map((r) => r.intra)), mc = mean(rs.map((r) => r.c2c)), mpi = mean(rs.map((r) => r.pIntra)), mpr = mean(rs.map((r) => r.pRet));
    [...rs].sort((a, b) => a.gap - b.gap).forEach((r, k) => (r.gapRank = k + 1));
    [...rs].sort((a, b) => b.pIntra - a.pIntra).forEach((r, k) => (r.pIntraRank = k + 1));
    for (const r of rs) { r.mktGap = mg; r.mktIntra = mi; r.mktC2c = mc; r.mktPIntra = mpi; r.mktPRet = mpr; r.n = rs.length; }
  }
  return { recs, byDay, days: [...byDay.keys()].sort() };
}

export const PERIODS: [string, string][] = [["2017", "2020"], ["2020", "2023"], ["2023", "2099"]];
export function stat(x: number[]) {
  const n = x.length;
  if (n < 2) return { m: 0, t: 0, n };
  const m = mean(x);
  const sd = Math.sqrt(x.reduce((a, v) => a + (v - m) ** 2, 0) / (n - 1));
  return { m: m * 1e4, t: sd > 0 ? m / (sd / Math.sqrt(n)) : 0, n };
}
export const f = (n: number, w = 6, d = 1) => n.toFixed(d).padStart(w);

/** n 日先の終値まで持ったときの損益率（r の前日終値で買う）。途中で足が切れたら null */
export function hold(r: Rec, n: number, key: "c2c" | "mktC2c" = "c2c"): number | null {
  let x = 1, cur: Rec | undefined = r;
  for (let k = 0; k < n; k++) { if (!cur) return null; x *= 1 + cur[key]; cur = cur.next; }
  return x - 1;
}

export type Ret = "intra" | "on" | "c2c" | ((r: Rec) => [ret: number, base: number] | null);
/**
 * 条件 pick に合う銘柄×日を、日ごとに平均して成績を出す。on は前日の引け→当日の寄り（p の付く特徴量だけで判断すること）。
 * 出力: 取引数、日数、1取引平均bp、日平均bp と t値、相場平均に対する上乗せ bp と t値、期間ごとの「日平均bp/t値 x上乗せt値」
 */
export function tester(u: ReturnType<typeof build>) {
  return (name: string, kind: Ret, pick: (r: Rec) => boolean) => {
    const get = (r: Rec): [number, number] | null => (typeof kind === "function" ? kind(r) : kind === "intra" ? [r.intra, r.mktIntra] : kind === "on" ? [r.gap, r.mktGap] : [r.c2c, r.mktC2c]);
    const raw: [string, number][] = [], exc: [string, number][] = [];
    let nt = 0, sum = 0;
    for (const d of u.days) {
      const v = u.byDay.get(d)!.filter(pick).map(get).filter((x): x is [number, number] => x != null);
      if (!v.length) continue;
      nt += v.length; sum += v.reduce((a, x) => a + x[0], 0);
      raw.push([d, mean(v.map((x) => x[0]))]); exc.push([d, mean(v.map((x) => x[0] - x[1]))]);
    }
    const a = stat(raw.map((x) => x[1])), e = stat(exc.map((x) => x[1]));
    const per = PERIODS.map(([lo, hi]) => { const p = stat(raw.filter(([d]) => d >= lo && d < hi).map((x) => x[1])), q = stat(exc.filter(([d]) => d >= lo && d < hi).map((x) => x[1])); return `${f(p.m)}/${f(p.t, 5, 2)} x${f(q.t, 5, 2)}`; }).join(" |");
    const label = typeof kind === "function" ? "cust" : kind;
    console.log(`${name.padEnd(42)} ${label.padEnd(5)} tr${String(nt).padStart(7)} d${String(a.n).padStart(5)} trBp${f((sum / Math.max(nt, 1)) * 1e4)} dayBp${f(a.m)} t${f(a.t, 6, 2)} exc${f(e.m)} t${f(e.t, 6, 2)} |${per}`);
  };
}
