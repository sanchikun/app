import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { DailyBar } from "../src/core/gapstudy";
import { jstDate } from "../src/core/market";
import { yahooDaily } from "../src/data/provider";

/** 売買代金の大きい TOPIX500 構成銘柄（手作業のリスト。入れ替えは --symbols で） */
export const DEFAULT_SYMBOLS = [
  "7203", "6758", "9984", "8306", "8316", "8411", "6861", "6501", "8035", "6857",
  "9983", "7974", "6098", "4063", "8058", "8031", "8001", "9432", "9433", "9434",
  "7267", "6902", "7011", "7012", "7013", "6146", "6920", "4502", "4568", "6367",
  "6981", "6954", "6273", "7741", "4661", "8766", "6503", "6702", "6701", "5803",
  "7751", "2914", "9101", "9104", "8053", "6723", "4519", "6752", "7201", "5401",
];

/** 日足を銘柄ごとに取得する。cacheDir があれば保存して次回はそれを使う。取引の途中かもしれない当日の足は除く */
export async function loadDaily(symbols: string[], range: string, cacheDir?: string): Promise<[string, DailyBar[]][]> {
  const today = jstDate(Math.floor(Date.now() / 1000));
  const data: [string, DailyBar[]][] = [];
  for (const symbol of symbols) {
    const file = cacheDir ? `${cacheDir}/${symbol}-1d-${range}.json` : null;
    try {
      let bars: DailyBar[];
      if (file && existsSync(file)) bars = JSON.parse(readFileSync(file, "utf8")) as DailyBar[];
      else {
        bars = await yahooDaily(symbol, range);
        if (file) {
          mkdirSync(cacheDir!, { recursive: true });
          writeFileSync(file, JSON.stringify(bars));
        }
        // 連続アクセスで制限されないよう少し待つ
        await new Promise((r) => setTimeout(r, 300));
      }
      data.push([symbol, bars.filter((b) => b.date < today)]);
    } catch (e) {
      console.log(`取得失敗 ${symbol}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return data;
}
