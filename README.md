# デイトレ検証

月間でプラスになるかを確かめる、株デイトレードの検証アプリです。過去データでのバックテストと、実際の値動きを使った仮想売買（ペーパートレード）ができます。**実際の発注は行いません。**

> 利益を保証するものではありません。バックテストやペーパートレードの成績が良くても、実際の取引で同じ結果になるとは限りません。

## 主な機能

- **バックテスト**：過去の分足で戦略を走らせ、日次損益、目標達成日数、勝率、最大ドローダウンなどを出します。
- **ペーパートレード**：場中に毎分動き、新しく確定した1分足で仮想売買して結果を記録します。
- **安全ルール**：日次損失上限で停止、取引回数の上限、大引け前の強制決済、同時保有は1ポジションまで。
- **画面**：今月の損益、今日の損益、月次・日次損益、取引履歴、バックテストの実行、開始・停止。

## 使用技術

| 分類 | 技術 |
| --- | --- |
| 言語 | TypeScript |
| API・定期実行 | Cloudflare Workers（Hono、Cron Triggers） |
| データベース | Cloudflare D1 |
| 画面 | 静的HTML（Worker に同梱） |
| 株価データ | Yahoo Finance の非公式チャートAPI |
| テスト | Vitest |

## セットアップ

Node.js 22 以上が必要です。

```bash
npm install
npm run db:migrate:local
npm run dev            # http://localhost:8787
```

実データを使わずに試すときは、合成データで起動します。

```bash
npx wrangler dev --var DATA_SOURCE:synthetic
```

### デプロイ

```bash
npx wrangler d1 create daytrade     # 出力された database_id と自分の account_id を wrangler.jsonc に書く
npm run db:migrate:remote
npx wrangler secret put API_TOKEN   # 更新系APIを保護するトークン（設定を推奨）
npm run deploy
```

## 使い方

### コマンドラインでバックテスト

```bash
npm run backtest -- 7203                                  # 5分足 × 60日、寄り付きレンジ突破
npm run backtest -- 7203 --strategy vwap --slippage 0
npm run backtest -- 7203 --interval 1m --range 7d
npm run backtest -- 7203 --strategy gapfade --loss-limit 3000   # 戦略は orb / vwap / momentum / gapfade / pullback
npm run backtest -- 7203 --entry limit --limit-wait 3     # 新規を指値にする
npm run backtest -- 7203 --synthetic                      # 合成データ（動作確認用）
```

### 銘柄選びの検証

複数銘柄でバックテストを回し、寄り付きレンジが確定した時点で分かる指標（ギャップ、出来高比、レンジ値幅など）とその日の損益の関係を集計します。境界は期間の前半で3等分して決め、後半にもそのまま当てはめるので、指標の選別力が続くかどうかを見られます。

```bash
npm run screen                                    # 既定の50銘柄、5分足 × 60日、寄り付きレンジ突破
npm run screen -- --symbols 7203,6758,9984        # 銘柄を指定
npm run screen -- --loss-limit 3000 --max-stop-fit 1   # 損切りが損失枠で狭められる日を集計から外す
npm run screen -- --cache .cache --csv out.csv    # 取得した足を保存して再利用、銘柄×日の明細を書き出す
```

既定の銘柄はすべて TOPIX500 構成銘柄（細かい呼値）として計算します。株価が呼値の刻みに乗らない日（株式分割より前の調整済みの値など）は自動で除きます。

### ペーパートレード

画面の「開始する」を押すか `POST /api/bot/start` を呼ぶと、平日 9:00〜16:59（JST）に毎分動きます。対象銘柄や金額は `PUT /api/settings` で変えます。

### API

| エンドポイント | 内容 |
| --- | --- |
| `GET /api/status` | 今日と今月の損益、稼働状態、保有ポジション |
| `GET /api/positions` | 保有中のポジション |
| `GET /api/trades?date=YYYY-MM-DD` | 取引履歴（日付なしで直近200件） |
| `GET /api/pnl/daily` | 日次損益 |
| `GET /api/pnl/monthly` | 月次損益 |
| `GET /api/settings`、`PUT /api/settings` | 設定の取得と部分更新 |
| `POST /api/bot/start`、`POST /api/bot/stop` | ペーパートレードの開始と停止 |
| `POST /api/paper/tick` | 定期実行と同じ処理を手動で1回動かす |
| `POST /api/backtest` | バックテスト。`{ "symbol": "7203", "interval": "5m", "range": "60d", "settings": { ... } }` |

`API_TOKEN` を設定すると、GET 以外は `Authorization: Bearer <token>` が必要になります。

### 設定項目

| 項目 | 既定値 | 内容 |
| --- | --- | --- |
| `symbols` | `["7203.T"]` | 対象銘柄（最大5つ） |
| `fineTickSymbols` | `["7203.T"]` | 細かい呼値で取引される銘柄（TOPIX500 構成銘柄）。ここにない銘柄は通常の呼値で計算する |
| `strategy` | `orb` | `orb`（寄り付きレンジ突破）、`vwap`（VWAP逆張り）、`momentum`（後場順張り）、`gapfade`（ギャップ埋め）、`pullback`（VWAP押し目買い） |
| `shares` | 100 | 1回の株数 |
| `dailyTargetYen` | 0 | 確定益がこの額に届いたらその日は終了。0 なら利益の上限なし |
| `dailyLossLimitYen` | 1000 | 確定損がこの額に届いたらその日は終了。損切り幅もこの枠に収まるよう狭める |
| `maxTradesPerDay` | 3 | 1日の取引回数の上限 |
| `slippageTicks` | 1 | 成行注文に加える不利な滑り（ティック数） |
| `commissionPerOrderYen` | 0 | 1注文あたりの手数料 |
| `entryOrder`、`limitWaitBars` | `market`、3 | 新規の出し方（`market` は成行、`limit` は指値）、指値が約定しないとき何本の足で取り消すか |
| `allowShort` | false | 空売りを使うか |
| `noEntryAfter` | 14:30 | これ以降は新規発注しない |
| `forceCloseAt` | 15:20 | これ以降の足の始値で強制決済する |
| `orbMinutes`、`orbRewardRisk` | 15、1 | レンジの長さ（分）、損切り幅に対する利確幅の倍率 |
| `vwapK`、`vwapMinBars` | 2、12 | 逆張りする乖離（標準偏差の倍数）、判定に必要な足数 |
| `momMinPct` | 0.5 | 後場順張りで入るのに必要な前場の騰落率（%） |
| `gapMinPct` | 1 | ギャップ埋めで入るのに必要な前日終値からのギャップ（%） |

## 約定の考え方

バックテストとペーパートレードは同じエンジン（`src/core/engine.ts`）を使います。

- シグナルは足の確定時に出て、**次の足の始値**で約定します。未来の値は見ません。
- 損切りと利確は足の高値・安値で判定します。同じ足で両方に届いたときは損切りを優先します。
- 新規・損切り・強制決済は成行として滑りを加えます。利確は指値として滑りなしです。
- `entryOrder` を `limit` にすると、新規はシグナルが出た足の終値に指値を置きます。以降の足がその値を1ティックでも抜けたら指値の値段で約定とみなし、同値に触れただけでは約定としません。約定した足では利確を判定しません。
- 板の厚さや約定の順番待ちは再現していません。実際より有利に出ることがあります。

## 注意点

- 株価は Yahoo Finance の非公式APIから取ります。東証の値は約20分遅れで、予告なく使えなくなることがあります。ペーパートレードは遅れた足を順に処理するので、結果は記録として正しくても表示は約20分遅れます。
- 取得できる期間は、1分足が直近7日、5分足・15分足が直近60日までです。
- 呼値の刻みは銘柄で違います。TOPIX500 構成銘柄は `fineTickSymbols` に入れてください（例：3,000円超〜10,000円は通常5円または10円刻み、TOPIX500 は1円刻み）。設定が合っていないと滑りと損切り幅がずれるので、バックテストは刻みが合わないときに注意を出します。
- 祝日の判定はしていません。足が来なければ何もしません。

## ディレクトリ構成

```
src/core/      売買エンジン、戦略、バックテスト、市場の時刻・呼値
src/data/      株価データの取得（Yahoo、合成）
src/worker/    API と定期実行、D1 への保存、画面（index.html）
scripts/       コマンドライン用バックテスト、銘柄選びの検証
migrations/    D1 のスキーマ
test/          テスト
```

## テスト

```bash
npm test
npm run typecheck
```
