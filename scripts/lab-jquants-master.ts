/**
 * 東証の公式の銘柄一覧（J-Quants API）で、検証に使っている銘柄が TOPIX500（細かい呼値の対象）か、貸借銘柄かを確かめる。
 *   curl -sS -H "x-api-key: proxy-injected" https://api.jquants.com/v2/equities/master -o master.json
 *   npx tsx scripts/lab-jquants-master.ts master.json
 * 無料プランは12週間遅れなので、直近の入れ替えは反映されていない。
 */
import { readFileSync } from "node:fs";
import { DEFAULT_SYMBOLS, WIDE_SYMBOLS } from "./universe";
const j = JSON.parse(readFileSync(process.argv[2], "utf8"));
const rows = j.data as { Code: string; CoName: string; ScaleCat: string; MktNm: string; MrgnNm: string }[];
console.log("件数", rows.length, "pagination_key" in j ? "続きあり" : "", "日付", (rows[0] as any).Date);
const by = new Map(rows.filter((r) => r.Code.endsWith("0")).map((r) => [r.Code.slice(0, 4), r]));
const fine = (c: string) => ["TOPIX Core30", "TOPIX Large70", "TOPIX Mid400"].includes(by.get(c)?.ScaleCat ?? "");
for (const [name, list] of [["既定の50銘柄", DEFAULT_SYMBOLS], ["あとから足した銘柄", WIDE_SYMBOLS]] as const) {
  const u = [...new Set(list)];
  const cat = new Map<string, number>(); for (const c of u) cat.set(by.get(c)?.ScaleCat ?? "（見つからない）", (cat.get(by.get(c)?.ScaleCat ?? "（見つからない）") ?? 0) + 1);
  console.log(`${name} ${u.length}: `, Object.fromEntries(cat));
  const not = u.filter((c) => !fine(c));
  console.log(`  TOPIX500 でない ${not.length}銘柄: ${not.map((c) => `${c} ${by.get(c)?.CoName ?? "?"}(${by.get(c)?.ScaleCat ?? "?"})`).join("、")}`);
  console.log(`  貸借銘柄でない: ${u.filter((c) => by.get(c) && by.get(c)!.MrgnNm !== "貸借").map((c) => `${c}(${by.get(c)!.MrgnNm})`).join(" ") || "なし"}`);
}
const all = rows.filter((r) => ["TOPIX Core30", "TOPIX Large70", "TOPIX Mid400"].includes(r.ScaleCat));
console.log("TOPIX500 の銘柄数", all.length, " うち今の260に入っていない", all.filter((r) => ![...DEFAULT_SYMBOLS, ...WIDE_SYMBOLS].includes(r.Code.slice(0, 4))).length);
