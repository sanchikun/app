/**
 * TOPIX500（細かい呼値の対象）のうち、これまでの260銘柄に入っていない銘柄の日足を .cachet に保存する。
 * 銘柄の一覧は data/topix500.json（J-Quants の銘柄情報から作ったもの。作った日付はファイルの asOf）。
 */
import { readFileSync } from "node:fs";
import { loadDaily, universe } from "./universe";
export const TOPIX_CACHE = ".cachet";
const all = (JSON.parse(readFileSync("data/topix500.json", "utf8")) as { stocks: { code: string }[] }).stocks.map((x) => x.code);
const have = new Set(universe("all"));
const list = all.filter((c) => !have.has(c)).map((c) => `${c}.T`);
console.log(`${list.length}銘柄`);
console.log(`done ${(await loadDaily(list, "10y", TOPIX_CACHE)).length}`);
