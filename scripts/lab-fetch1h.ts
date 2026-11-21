/** 1時間足 × 730日を .cachev に保存する（寄り付き後の1時間とそれ以降を、2年分で分けて見るため） */
import { existsSync, writeFileSync } from "node:fs";
import { CACHE } from "./lab";
import { universe } from "./universe";
for (const s of universe("all").map((x) => `${x}.T`)) {
  const file = `${CACHE}/${s}-1h-730d.json`;
  if (existsSync(file)) continue;
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${s}?interval=60m&range=730d`, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const r = ((await res.json()) as { chart: { result?: { timestamp?: number[]; indicators: { quote: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }[] } }[] } }).chart.result?.[0];
    const q = r?.indicators.quote[0];
    const bars = (r?.timestamp ?? []).map((t, i) => ({ t, o: q?.open?.[i], h: q?.high?.[i], l: q?.low?.[i], c: q?.close?.[i], v: q?.volume?.[i] ?? 0 })).filter((b) => b.o != null && b.h != null && b.l != null && b.c != null);
    writeFileSync(file, JSON.stringify(bars));
  } catch (e) { console.log("fail", s, String(e)); }
  await new Promise((r) => setTimeout(r, 250));
}
console.log("done");
