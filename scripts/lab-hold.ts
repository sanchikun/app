/**
 * 持ち続ける（月に1回だけ入れ替える）場合の選び方と、指数を持つ／降りるの切り替え。
 *   npx tsx scripts/lab-fetch.ts && npx tsx scripts/lab-fetch-wide.ts && npx tsx scripts/lab-fetch-topix.ts && npx tsx scripts/lab-hold.ts
 * A) 月末に指標で銘柄を並べ、上位2割を同じ金額ずつ1か月持つ。全銘柄を同じ金額ずつ持った場合との差を見る（配当込み、入れ替えの費用は片道0.1%）
 * B) 指数ETFを「200日平均より上のときだけ持つ」と、持ち続けるの比較
 * 注意: 銘柄は「今」選んだもの（今も上場していて売買が多い銘柄）なので、10年前には選べなかった銘柄が入っている。
 * 全銘柄平均そのものが実際より良く出るので、見るのは全銘柄平均との「差」。
 */
import { readFileSync, readdirSync } from "node:fs";
import type { DailyBar } from "../src/core/gapstudy";
import { CACHE, f, mean, stat } from "./lab";

const COST = 0.001;
const PER: [string, string][] = [["2017", "2020"], ["2020", "2023"], ["2023", "2099"]];
const load = (dir: string, s: string) => (JSON.parse(readFileSync(`${dir}/${s}-1d-10y.json`, "utf8")) as DailyBar[]).filter((b) => b.c > 0);
interface Row { s: string; next: number; sig: Record<string, number> }
function monthly(dir: string) {
  const cal = load(CACHE, "1306.T").map((b) => b.date);
  const ends = cal.filter((d, i) => i + 1 < cal.length && cal[i + 1].slice(0, 7) !== d.slice(0, 7));
  const out = new Map<string, Row[]>();
  for (const file of readdirSync(dir).filter((x) => /^\w{4}\.T-1d-10y\.json$/.test(x))) {
    const s = file.split("-")[0];
    if (/^(13|15|25)\d\d\.T$/.test(s)) continue;
    const b = load(dir, s), idx = new Map(b.map((x, i) => [x.date, i]));
    for (let m = 12; m + 1 < ends.length; m++) {
      const i = idx.get(ends[m]), j = idx.get(ends[m + 1]), i1 = idx.get(ends[m - 1]), i6 = idx.get(ends[m - 6]), i12 = idx.get(ends[m - 12]);
      if (i == null || j == null || i1 == null || i6 == null || i12 == null || i < 250) continue;
      let div = 0; for (let k = i + 1; k <= j; k++) div += b[k].dividend ?? 0;
      const next = (b[j].c + div) / b[i].c - 1;
      if (Math.abs(next) > 0.8) continue;
      let d12 = 0, hi = 0; const rets: number[] = [];
      for (let k = i12 + 1; k <= i; k++) d12 += b[k].dividend ?? 0;
      for (let k = i - 249; k <= i; k++) hi = Math.max(hi, b[k].c);
      for (let k = i - 59; k <= i; k++) rets.push(b[k].c / b[k - 1].c - 1);
      const mu = mean(rets), vol = Math.sqrt(mean(rets.map((x) => (x - mu) ** 2)));
      if (rets.some((x) => Math.abs(x) > 0.35)) continue;
      const row: Row = { s, next, sig: { "12か月の上げ（直近1か月を除く）": b[i1].c / b[i12].c - 1, "6か月の上げ": b[i].c / b[i6].c - 1, "直近1か月に下げた": -(b[i].c / b[i1].c - 1), "値動きが小さい（60日）": -vol, "配当利回りが高い（過去12か月）": d12 / b[i].c, "1年の高値に近い": b[i].c / hi, "12か月に下げた（逆張り）": -(b[i1].c / b[i12].c - 1) } };
      const a = out.get(ends[m]); if (a) a.push(row); else out.set(ends[m], [row]);
    }
  }
  return out;
}
function dd(rets: number[]) { let c = 1, p = 1, m = 0; for (const r of rets) { c *= 1 + r; p = Math.max(p, c); m = Math.min(m, c / p - 1); } return { total: c, dd: m }; }
const cagr = (total: number, months: number) => (total ** (12 / months) - 1) * 100;
for (const [name, dir] of [["作業台の260銘柄", CACHE], ["売買の多い561銘柄", ".cachew"], ["TOPIX500 の残り235銘柄", ".cachet"]] as const) {
  const data = monthly(dir), months = [...data.keys()].sort();
  const base = months.map((m) => mean(data.get(m)!.map((r) => r.next)));
  const b = dd(base);
  console.log(`\n=== A) ${name}（${months[0]}〜${months[months.length - 1]}、${months.length}か月、月平均${Math.round(mean(months.map((m) => data.get(m)!.length)))}銘柄）`);
  console.log(`  全銘柄を同じ金額ずつ          年率${f(cagr(b.total, months.length), 6)}%  最大の落ち込み${f(b.dd * 100, 6)}%`);
  for (const key of Object.keys(data.get(months[0])![0].sig)) {
    for (const [label, pickN] of [["上位2割", 0], ["上位10銘柄", 10]] as const) {
      const rets: number[] = [], exc: [string, number][] = [];
      let prev = new Set<string>(), turn = 0;
      for (const m of months) {
        const rs = [...data.get(m)!].filter((r) => Number.isFinite(r.sig[key])).sort((x, y) => y.sig[key] - x.sig[key]);
        const top = rs.slice(0, pickN || Math.floor(rs.length / 5));
        const names = new Set(top.map((r) => r.s));
        const changed = [...names].filter((s) => !prev.has(s)).length / names.size;
        turn += changed; prev = names;
        const r = mean(top.map((x) => x.next)) - changed * 2 * COST;
        rets.push(r); exc.push([m, r - mean(data.get(m)!.map((x) => x.next))]);
      }
      const d = dd(rets), e = stat(exc.map((x) => x[1]));
      const per = PER.map(([lo, hi]) => { const q = stat(exc.filter(([m]) => m >= lo && m < hi).map((x) => x[1])); return `${f(q.m * 12 / 100, 6)}%/t${f(q.t, 5, 2)}`; }).join(" |");
      console.log(`  ${(key + " " + label).padEnd(30)} 年率${f(cagr(d.total, months.length), 6)}%  落ち込み${f(d.dd * 100, 6)}%  差 年${f(e.m * 12 / 100, 6)}% t${f(e.t, 5, 2)}  入替 月${f((turn / months.length) * 100, 4, 0)}% |${per}`);
    }
  }
}
console.log("\n=== B) 指数ETF: 前日の終値が N 日平均より上なら持つ、下なら現金（判断は引け、売買は翌日の引け、切り替えのたびに0.1%）。配当は入れていない");
for (const s of ["1306.T", "1321.T", "1570.T", "_GSPC"]) {
  // 桁の違う壊れた足（1306 の 2026-03-30/31 など）は、直前に残した足から30%以上離れていたら捨てる
  const b: DailyBar[] = [];
  for (const x of load(CACHE, s)) if (!b.length || Math.abs(x.c / b[b.length - 1].c - 1) < 0.3) b.push(x);
  const start = 250, hold = b.slice(start + 1).map((x, k) => x.c / b[start + k].c - 1), h = dd(hold), yrs = hold.length / 245;
  console.log(`  ${s.padEnd(7)} 持ち続ける          年率${f((h.total ** (1 / yrs) - 1) * 100, 6)}%  最大の落ち込み${f(h.dd * 100, 6)}%`);
  for (const n of [50, 100, 200]) {
    const rets: number[] = []; let inPos = false, sw = 0, daysIn = 0;
    for (let i = start; i + 1 < b.length; i++) {
      // i-1 の引けで判断 → i の引けで売買 → i→i+1 の値動きを受ける
      let sum = 0; for (let k = i - n; k < i; k++) sum += b[k].c;
      const want = b[i - 1].c > sum / n;
      let r = 0;
      if (want !== inPos) { r -= COST; sw++; inPos = want; }
      if (inPos) { r += b[i + 1].c / b[i].c - 1; daysIn++; }
      rets.push(r);
    }
    const d = dd(rets);
    console.log(`  ${s.padEnd(7)} ${String(n).padStart(3)}日平均より上だけ   年率${f((d.total ** (1 / yrs) - 1) * 100, 6)}%  最大の落ち込み${f(d.dd * 100, 6)}%  持っている日${f((daysIn / rets.length) * 100, 4, 0)}%  切り替え${sw}回`);
  }
}
