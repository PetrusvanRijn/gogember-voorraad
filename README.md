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

The fixtures are a sanitized StockItUp export for seller 38. Customer names and addresses were removed before they were committed. `data/sample-orders.json` is 13,403 orders updated in the last 30 days. Some of those orders were placed as far back as 2024; usage only counts a shipped parcel whose Johannesburg day falls inside the selected period. Live mode reads the same order fields: `product_sku`, `product_title`, `quantity_ordered`, `quantity_canceled`, and `parcels[]`.

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

Checked against `data/sample-products.json` and `data/sample-orders.json` (stock snapshot around 08:53 Johannesburg on 9 November 2026). The 7-day average is 2–8 November. 9 November is still morning and is left out.

- Physical stock: gember 28,150 (about 17.3 days, orange); appel-citroen 4,809 (about 13.4 days, red); granaatappel 17,138; shot glasses 1,223 (about 6.3 days, red); coasters 4 (about 1.5 days, red).
- Box 12: 10,810 in stock, 1,176 used, 168 per day, about 64.3 days of cover. Separator 12 matches that usage (25,090 in stock, about 149.3 days).
- The extract’s first orders are 23 October, so 28 days and half a year are not a full period. Over the 17 days that are present, box 12 usage is 3,935 (about 231 per day).
- Lines with an empty SKU and title (about 1% of items) are skipped. One parcel in the 7-day window has two tracking codes and is counted as unknown, with no guessed box.
- A handful of cancelled orders still have a label and tracking code. Those parcels count.
- StockItUp’s virtual stock for `Gember32` divides by 32. Shipped bottles are counted as 16, matching the product title.
- Tape is one unit per parcel, so its cover is about 2 days. Ignore that row if the stock is stored in rolls.
