/**
 * 銘柄を広げるための下調べ。4桁の証券コードを順に Yahoo Finance に問い合わせ、直近5日の売買代金を調べて
 * .cachev/probe.json に保存する（途中で止めても続きから再開する）。手で選んだ銘柄リストの偏りを避けるために使う。
 *   npx tsx scripts/lab-probe.ts            # 1700〜9999 を調べる（30分ほど）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { CACHE } from "./lab";

const FILE = `${CACHE}/probe.json`;
mkdirSync(CACHE, { recursive: true });
/** code → [直近の終値, 1日の売買代金の平均（円）, 種類]。上場していないコードは null */
const seen: Record<string, [number, number, string] | null> = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};
const codes: string[] = [];
for (let c = 1700; c <= 9999; c++) if (!(String(c) in seen)) codes.push(String(c));
let fails = 0;
async function probe(code: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${code}.T?interval=1d&range=5d`, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
    if (res.status === 404) { seen[code] = null; return; }
    if (!res.ok) { fails++; await new Promise((r) => setTimeout(r, 3000 * (attempt + 1))); continue; }
    const r = ((await res.json()) as { chart: { result?: { meta: { instrumentType?: string }; indicators: { quote: { close?: (number | null)[]; volume?: (number | null)[] }[] } }[] } }).chart.result?.[0];
    const q = r?.indicators.quote[0];
    const rows = (q?.close ?? []).map((c, i) => [c, q?.volume?.[i]] as const).filter((x): x is readonly [number, number] => x[0] != null && x[1] != null);
    seen[code] = rows.length ? [rows[rows.length - 1][0], rows.reduce((a, x) => a + x[0] * x[1], 0) / rows.length, r?.meta.instrumentType ?? ""] : null;
    return;
  }
}
const WORKERS = 4;
let next = 0, done = 0;
await Promise.all(Array.from({ length: WORKERS }, async () => {
  while (next < codes.length) {
    const code = codes[next++];
    try { await probe(code); } catch { fails++; }
    if (++done % 200 === 0) { writeFileSync(FILE, JSON.stringify(seen)); console.log(`${done}/${codes.length} 失敗${fails}`); }
    await new Promise((r) => setTimeout(r, 120));
  }
}));
writeFileSync(FILE, JSON.stringify(seen));
const live = Object.values(seen).filter((v) => v != null).length;
console.log(`done 上場 ${live} / 調べた ${Object.keys(seen).length} 失敗 ${fails}`);
