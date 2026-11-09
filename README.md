# Go Gember stock dashboard

Dutch stock dashboard for [Go Gember](https://gogember.com/). Fulfilment runs at [Brandhouse Partners](https://brandhousepartners.nl/). Luuk opens it to see what to reorder. It shows physical stock, average daily usage and days of cover. It does not show prices, customers or orders.

## Run it locally

```bash
cp .env.example .env.local
# Put a password in DASHBOARD_PASSWORD. Leave USE_SAMPLE_DATA=1.
npm install
npm run dev
```

Open http://localhost:3000 and sign in. Sample mode reads the committed fixtures in `data/` and does not call StockItUp.

```bash
npm test
npm run build
```

## Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `DASHBOARD_PASSWORD` | yes | Login password. The session is an httpOnly cookie. |
| `USE_SAMPLE_DATA` | no | `1` reads `data/sample-products.json` and `data/sample-orders.json`. Anything else uses the live API. |
| `GOGEMBER_STOCKITUP_CLIENT_ID` | live mode | HTTP Basic user. Server-side only. |
| `GOGEMBER_STOCKITUP_CLIENT_SECRET` | live mode | HTTP Basic password. Server-side only. |
| `GOGEMBER_STOCKITUP_SELLER_ID` | no | Defaults to `38`. |

Never commit real credentials and never expose them to the browser. `.env.local` is gitignored.

The fixtures are a sanitized StockItUp export for seller 38. Customer fields were removed before they were committed. Order lines in that export only kept `status` (no SKU, quantity or title), so sample mode can show stock and parcels but not bottle usage. Live mode reads the full objects.

## StockItUp

Base URL: `https://his.stockitup.nl/api/v1/`

- `GET /sellers/{id}/products/?page_size=100&id_gt=`
- `GET /sellers/{id}/orders/?page_size=100&id_gt=&updated_since=`

`updated_since` is milliseconds since the epoch. Pages advance with `id_gt` until a short page comes back. Responses are cached for 15 minutes. Only the order window for the selected period is requested (plus one day of margin).

`created_since` is supported by the API but not sent. A parcel shipped this week often belongs to an order placed earlier, and combining both filters would drop it.

Stock is the `OPSLAG` field on the single-bottle SKUs (`Gember`, `appelgember1`, `Granaatappel1`), plus `Shotglaasje` and `Onderzetter`. Bundle SKUs are virtual stock derived from those singles and are not shown as stock.

## Deploy on Vercel

1. Push this repository to GitHub.
2. In Vercel, import the project. Framework preset: Next.js. No extra build settings.
3. Add the environment variables above for Production (and Preview, if you want it locked there too).
4. For a first look without API keys, set `USE_SAMPLE_DATA=1` and `DASHBOARD_PASSWORD`.
5. For live stock, set `USE_SAMPLE_DATA=0` and the two StockItUp variables. Redeploy after changing them.
6. Open the deployment URL and sign in.

The app uses the Node.js runtime. Do not set the Edge runtime.

## How the numbers work

Days of cover = current stock / average daily usage. Red is under 14 days, orange under 30. The thresholds live in `lib/config.ts`.

Usage counts a parcel when it has a PDF label and a tracking code. The day is `created_at` in Africa/Johannesburg. Orders that share a pickorder, or the same tracking code, are one parcel. The current Johannesburg day is left out of the average until 18:00, and it still appears on the chart.

Box rule: 1–6 bottles box 6 from 5 November 2026 (box 12 before that), 7–12 box 12, 13–30 box 30, 31–48 box 48. One separator of the same size per box. Shot glasses and coasters take no slot. More than 48 bottles, or an SKU that is not in `lib/sku.ts`, is counted as unknown and gets no guessed box.

SKU digits are not the bottle count. `Gember1` is 3 bottles, `Gember32` is 16, `Gember8` is 8 (5+3). Combo splits are in `lib/sku.ts`.

Tape is counted as one per shipped parcel. If the tape stock is stored as rolls rather than one unit per parcel, ignore that row.

## Sample-data limits

Checked against `data/sample-products.json` and `data/sample-orders.json` (stock snapshot around 08:53 Johannesburg on 9 November 2026):

- Physical stock is real: gember 28,150; appel-citroen 4,809; granaatappel 17,138; shot glasses 1,223; coasters 4.
- Packaging stock is real, including separators for 30 and 48 and box 6 (1,980). An older note that those separators were missing is out of date.
- The order file has 1,754 unique shipped parcels. Order lines do not include SKU or quantity, so bottle, box and separator usage stays “geen data” in sample mode.
- Over the last 7 complete days (2–8 November) there are 1,463 parcels, 209 per day. Tape cover is about 2.0 days if one tape unit is used per parcel.
- 9 November only runs to about 09:00 and is excluded from the average (36 parcels that morning).
- Volume before 1 November is much lower than the first week of November. A 28-day or half-year average in this file only has 17 complete days (23 October–8 November) and should not be read as a full month.
- Five cancelled orders still carry a label and tracking code. They are included, because the parcel went out. None of them fall in the 7-day window above.
- StockItUp’s virtual stock for `Gember32` divides by 32. Shipped bottles are counted as 16, matching the product title.
