# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## About

BNJGFoodSolutions is a hackathon project — a dashboard for restaurant managers to reduce food waste using AI-driven inventory analysis. The app is fully client-side React; all inventory/sales data is mocked. The Claude API (`claude-sonnet-4-6` or similar) is called client-side for LLM features (AI narrative, stock suggestions, discount recommendations).

Original Figma Make design: `figma.com/design/moEtX5VQTHJdu1JMDhZUvx`. Original prompt: `src/imports/bnjgfoodsolutions-dashboard-prompt.md`.

## Commands

```bash
pnpm install   # or: npm i
pnpm dev       # start dev server
pnpm build     # production build
```

No test runner configured.

## App flow

Top-level state machine in `src/app/App.tsx` with `AppState`:

1. **`login`** — Login + Register tabs. After auth → transitions to `app`.
2. **`app`** — `Sidebar` + active view. No onboarding step; stock editing lives inside Analytics.

`View` type (`src/app/components/types.ts`): `"dashboard" | "sales" | "alerts" | "analytics"`

## Views — detailed spec

### Dashboard (`DashboardOverview`)

- **6 KPI cards:** Stock Efficiency, Recovered Value, Waste Cost Avoided, Active Alerts, Items at Risk, Items Tracked
- **Weekly Revenue chart** — bar chart, this week vs last week (recharts)
- **Stock Burn Rate vs Ordered** — horizontal bar chart, ingredient utilisation %
- **Recent Inventory Alerts** — top 4 list rows (mirrors Alerts view style)
- **Performance mini-card** — stock used / orders fulfilled / waste rate
- **Upload Today's Sales CTA card** — links to Daily Sales view

### Daily Sales (`DailySalesView`)

- **3 pill states** per day: `uploaded` / `pending` (today) / `future`
- **Drag-and-drop upload zone** (react-dnd)
- **Stock Suggestions table** — columns: Ingredient, Avg Weekly Use (inline editable), Current Stock, Order Qty (+/- buttons + direct edit)
- **Export CSV** — real blob download (`URL.createObjectURL`)

### Inventory Alerts (`InventoryAlertsView`)

Layout: list rows with left-border accent colour (not 2-column cards).

Each row shows: emoji + item name, storage note, Stock | Threshold | Excess columns, Dismiss (×) button.

Expandable **Menu Usage** sub-table per row: Dish | Qty per Serving.

**4 fixed alert items:**
| Item | Severity | Expires |
|---|---|---|
| Fresh Basil | critical | 1 day |
| Tomatoes | critical | 2 days |
| Mozzarella | high | 4 days |
| Pizza Dough | medium | 3 days |

Clicking an alert opens a **modal** with:
- Recommended Action (e.g., "Offer 15% off Margherita Pizza")
- Projected Impact: additional sales estimate + stock moved estimate

### Analytics (`AnalyticsView`)

**5 charts (recharts):**
1. Covers Week-over-Week — bar
2. Order Type Mix — pie
3. Peak Hours — bar by hour
4. Customer Type by Day — stacked bar
5. Temperature vs Volume — line, 12-day

**Weekly Business Recap** (replaces old LLM Insights card):
- Summary KPIs row: total covers, vs last week %, daily avg, peak day
- Day-by-day table: Day | Date | Conditions | Covers | vs LW | Peak Hour | Customer Mix | Top Item
- 4-section AI narrative (via Claude API): Overall Performance, Customer Behaviour, Weather & Sales, Stock Implications
- 10 Recommended Actions checklist — grouped by narrative section; each action has status toggle (`pending` / `in_progress` / `done`) and expandable detail

**Current Stock Levels panel** (collapsible, at bottom of Analytics):
- Editable stock values — changes feed into LLM context for Claude API calls
- Export CSV button (blob download)
- This is the only place stock is edited; there is no separate Stock Management screen

## Claude API integration

LLM features call the Claude API directly from the browser. API key should be read from an environment variable (`VITE_ANTHROPIC_API_KEY`). Affected features:
- Analytics: AI narrative generation (4 sections) and Recommended Actions
- Inventory Alerts: discount initiative suggestions in the modal
- Daily Sales: AI stock order suggestions

Use streaming responses where latency is user-visible. Pass current stock levels (from the Analytics collapsible panel state) as context in the system prompt.

## Component layout

```
src/app/
  App.tsx                    # State machine (login → app)
  components/
    types.ts                 # View type
    Sidebar.tsx
    LoginScreen.tsx          # Login + Register tabs
    DashboardOverview.tsx
    DailySalesView.tsx
    InventoryAlertsView.tsx
    AnalyticsView.tsx        # Includes Weekly Business Recap + Current Stock Levels panel
    figma/
      ImageWithFallback.tsx  # Resolves figma:asset/ imports
    ui/                      # shadcn/ui components (Radix-based)
```

## Styling

- **Tailwind CSS v4** via `@tailwindcss/vite` — no `tailwind.config.*` file; config is in `vite.config.ts`.
- Design tokens in `src/styles/theme.css`, mapped via `@theme inline`. Follow shadcn token naming (`--background`, `--primary`, `--muted`, etc.).
- Palette intent: greens for efficiency/health, amber/red for overstock alerts, slate grays for neutral UI.

## Key libraries

| Purpose | Library |
|---|---|
| UI primitives | Radix UI (`src/app/components/ui/`) |
| Charts | `recharts` |
| Icons | `lucide-react` |
| Animations | `motion` |
| Drag and drop | `react-dnd` + `react-dnd-html5-backend` |
| Toasts | `sonner` |
| LLM | Anthropic Claude API (client-side, `VITE_ANTHROPIC_API_KEY`) |

## Vite notes

- `figmaAssetResolver` plugin maps `figma:asset/<filename>` → `src/assets/<filename>`
- `@` alias → `src/`
- Raw asset types: `.svg`, `.csv` only — never add `.css`, `.tsx`, `.ts`
