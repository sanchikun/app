import { CACHE, ETFS } from "./lab";
import { loadDaily, universe } from "./universe";
import { yahooDaily } from "../src/data/provider";
import { writeFileSync, existsSync } from "node:fs";
await loadDaily([...universe("all").map((s) => `${s}.T`), ...ETFS], "10y", CACHE);
for (const s of ["^GSPC", "^VIX", "JPY=X", "^N225", "^IXIC", "^SOX"]) { const f = `${CACHE}/${s.replace(/[\^=]/g, "_")}-1d-10y.json`; if (!existsSync(f)) { try { writeFileSync(f, JSON.stringify(await yahooDaily(s, "10y"))); } catch (e) { console.log("fail", s, String(e)); } await new Promise((r) => setTimeout(r, 400)); } }
console.log("done");
