/** 4巡目: 米国が大きく動いた翌日の「逆張り」（上げた翌日はインバースETF、下げた翌日はレバレッジETFを寄りで買い引けで売る）を年ごとに */
import { build, f, mean, stat } from "./lab";
const inv = build((s) => s === "1357.T"), lev = build((s) => s === "1570.T"), top = build((s) => s === "1306.T");
const at = (u: typeof inv) => new Map(u.recs.map((r) => [r.d, r]));
const I = at(inv), L = at(lev), TP = at(top);
function run(name: string, up: number, down: number, longLeg: Map<string, typeof inv.recs[0]>, notional = 300000) {
  const rows: [string, number, string][] = [];
  for (const d of [...I.keys()].sort()) {
    const a = I.get(d)!, b = longLeg.get(d);
    if (a.us >= up) rows.push([d, a.intra, "inv"]);
    else if (b && b.us <= -down) rows.push([d, b.intra, "long"]);
  }
  const st = stat(rows.map((r) => r[1]));
  const wins = rows.filter((r) => r[1] > 0).length / rows.length;
  const sorted = rows.map((r) => r[1]).sort((x, y) => x - y);
  console.log(`${name}: ${st.n}回 平均${f(st.m)}bp t${f(st.t, 5, 2)} 勝率${f(wins * 100, 5, 0)}% 最悪${f(sorted[0] * 100, 6, 2)}% 下位5%${f(sorted[Math.floor(sorted.length * 0.05)] * 100, 6, 2)}% 最良${f(sorted[sorted.length - 1] * 100, 6, 2)}%  (上げ翌日 ${rows.filter((r) => r[2] === "inv").length}回 ${f(mean(rows.filter((r) => r[2] === "inv").map((r) => r[1])) * 1e4)}bp / 下げ翌日 ${rows.filter((r) => r[2] === "long").length}回 ${f(mean(rows.filter((r) => r[2] === "long").map((r) => r[1]).concat(rows.some((r) => r[2] === "long") ? [] : [0])) * 1e4)}bp)`);
  const ys = new Map<string, number[]>();
  for (const [d, v] of rows) ys.set(d.slice(0, 4), [...(ys.get(d.slice(0, 4)) ?? []), v]);
  console.log("   " + [...ys].map(([y, v]) => `${y}:${v.length}回 ${Math.round(v.reduce((x, z) => x + z, 0) * notional).toLocaleString()}円`).join("  "));
}
for (const up of [0.01, 0.0125, 0.015, 0.02]) run(`米国+${up * 100}%以上→1357のみ`, up, 9, L);
for (const dn of [0.01, 0.015, 0.02, 0.025]) run(`米国-${dn * 100}%以下→1570のみ`, 9, dn, L);
for (const dn of [0.015, 0.02]) run(`米国-${dn * 100}%以下→1306のみ`, 9, dn, TP);
run("両方（+1.5%→1357、-2%→1570）", 0.015, 0.02, L);
run("両方（+1.5%→1357、-1.5%→1570）", 0.015, 0.015, L);
run("両方（+1%→1357、-1%→1570）", 0.01, 0.01, L);
