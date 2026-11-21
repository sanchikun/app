/**
 * 銘柄を広げた検証用の日足を .cachew に保存する。lab-probe.ts の結果から、株式で、直近の売買代金が1日5億円以上、
 * 株価3万円以下、これまでの260銘柄に入っていないものを選ぶ（今の売買代金で選ぶので、最近伸びた銘柄に寄る点に注意）。
 */
import { readFileSync } from "node:fs";
import { CACHE } from "./lab";
import { loadDaily, universe } from "./universe";
export const WIDE_CACHE = ".cachew";
const probe = JSON.parse(readFileSync(`${CACHE}/probe.json`, "utf8")) as Record<string, [number, number, string] | null>;
const have = new Set(universe("all"));
const list = Object.entries(probe).filter(([c, v]) => v && v[2] === "EQUITY" && v[1] >= 5e8 && v[0] <= 30000 && !have.has(c)).map(([c]) => `${c}.T`);
console.log(`${list.length}銘柄`);
const data = await loadDaily(list, "10y", WIDE_CACHE);
console.log(`done ${data.length}`);
