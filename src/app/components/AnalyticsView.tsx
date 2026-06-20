import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { groqStream } from "@/lib/groq";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import { Brain, Thermometer, ChevronDown, ChevronUp, Check, ArrowUpRight, ArrowDownRight, CloudRain, ShoppingCart, Calendar } from "lucide-react";

const C = {
  bg: "rgba(13,21,32,0.92)", card: "rgba(17,29,46,0.88)", card2: "rgba(21,35,56,0.88)", border: "rgba(62,217,196,0.09)",
  cyan: "#3ED9C4", green: "#4DECD8", yellow: "#F5A623",
  text: "#EEF5F8", muted: "rgba(200,225,235,0.50)", dim: "rgba(150,195,215,0.28)",
};

// ─── Empty chart skeletons (used when no sales data uploaded yet) ─────────────

const WEEK_SHORT  = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const HOUR_LABELS = ["11am","12pm","1pm","2pm","3pm","4pm","5pm","6pm","7pm","8pm","9pm","10pm"];

const emptyThisWeek  = WEEK_SHORT.map(day => ({ day, thisWeek: 0, lastWeek: 0 }));
const emptyPeakHours = HOUR_LABELS.map(hour => ({ hour, orders: 0 }));
const emptyCustomer  = WEEK_SHORT.map(day => ({ day, family: 0, individual: 0, group: 0 }));

const NARRATIVE_SECTIONS = [
  "Overall Performance",
  "Customer Behaviour Patterns",
  "Weather & Sales Correlation",
  "Stock Implications for Next Week",
] as const;

type NarrativeSection = typeof NARRATIVE_SECTIONS[number];

type ActionStatus = "pending" | "in_progress" | "done";

interface ActionItem {
  id: string;
  source: string;
  priority: "high" | "medium" | "low";
  icon: "rain" | "cart";
  title: string;
  detail: string;
  timing: string;
}

interface Transaction {
  sale_date: string;
  sale_time: string | null;
  weather: string | null;
  customer_type: string | null;
  menu_name: string | null;
  quantity: number;
  total_price: number | null;
}

interface WeeklySummary {
  week_start: string;
  total_covers: number;
  total_revenue: number;
  avg_daily_covers: number;
  peak_day: string;
  peak_day_covers: number;
  top_item: string;
  family_pct: number;
  individual_pct: number;
  group_pct: number;
  overstock_count: number;
  low_stock_count: number;
  confirmed_at: string;
}

const WEATHER_TEMP: Record<string, number> = {
  Sunny: 28, Clear: 28,
  "Partly Cloudy": 23, "Partly cloudy": 23, Cloudy: 19, Overcast: 19,
  Rain: 15, Rainy: 15, Stormy: 12,
};

const WEEK_START_OFFSETS = [0, 1, 2, 3, 4, 5, 6]; // Mon=0 … Sun=6

function getMondayOfWeek() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dow = today.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(today); mon.setDate(today.getDate() + diff);
  return mon;
}

// Returns the Monday of whichever calendar week has the most distinct uploaded dates.
// On a tie, prefers the more recent week. Falls back to current calendar Monday if
// there are no transactions.
function getActiveWeekMonday(txs: Transaction[]): Date {
  const calendarMonday = getMondayOfWeek();
  if (txs.length === 0) return calendarMonday;

  // Build a set of distinct dates per week, keyed by that week's Monday string
  const weekDateSets = new Map<string, Set<string>>();
  for (const tx of txs) {
    const d = new Date(tx.sale_date + "T12:00:00"); // noon avoids DST ambiguity
    const dow = d.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    const mon = new Date(d);
    mon.setDate(d.getDate() + diff);
    const monStr = toDateStr(mon);
    if (!weekDateSets.has(monStr)) weekDateSets.set(monStr, new Set());
    weekDateSets.get(monStr)!.add(tx.sale_date);
  }

  // Pick the week with the most distinct uploaded dates; prefer more recent on ties
  let bestMonStr = "";
  let bestCount = 0;
  for (const [monStr, dates] of weekDateSets) {
    if (dates.size > bestCount || (dates.size === bestCount && monStr > bestMonStr)) {
      bestCount = dates.size;
      bestMonStr = monStr;
    }
  }

  if (!bestMonStr) return calendarMonday;
  const [y, m, day] = bestMonStr.split("-").map(Number);
  const d = new Date(y, m - 1, day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseHour(t: string | null): number | null {
  if (!t) return null;
  const h = parseInt(t.split(":")[0], 10);
  return isNaN(h) ? null : h;
}

function computeCharts(txs: Transaction[], fallbackWeeklyRows: { lastWeek: number }[]) {
  if (txs.length === 0) return null;

  const monday = getActiveWeekMonday(txs);
  const weekDays = WEEK_START_OFFSETS.map(i => {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    const dateStr = toDateStr(d);
    const dateLabel = d.toLocaleString("default", { month: "short", day: "numeric" });
    const dow = d.getDay();
    const shortLabels = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const longLabels = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    return { dateStr, dateLabel, short: shortLabels[dow], long: longLabels[dow] };
  });

  // Group transactions by date
  const byDate = new Map<string, Transaction[]>();
  for (const tx of txs) {
    if (!byDate.has(tx.sale_date)) byDate.set(tx.sale_date, []);
    byDate.get(tx.sale_date)!.push(tx);
  }

  // Peak hours (all days combined)
  const HOUR_BUCKETS = [11,12,13,14,15,16,17,18,19,20,21,22];
  const HOUR_LABELS  = ["11am","12pm","1pm","2pm","3pm","4pm","5pm","6pm","7pm","8pm","9pm","10pm"];
  const hourMap = new Map<number, number>();
  for (const tx of txs) { const h = parseHour(tx.sale_time); if (h !== null) hourMap.set(h, (hourMap.get(h) ?? 0) + tx.quantity); }
  const peakHours = HOUR_BUCKETS.map((h, i) => ({ hour: HOUR_LABELS[i], orders: hourMap.get(h) ?? 0 }));

  // Customer type percentages by day
  const customerType = weekDays.map(({ short, dateStr }) => {
    const day = byDate.get(dateStr) ?? [];
    const total = day.reduce((s, t) => s + t.quantity, 0);
    if (total === 0) return { day: short, family: 0, individual: 0, group: 0 };
    const fam  = day.filter(t => t.customer_type?.toLowerCase().includes("family")).reduce((s, t) => s + t.quantity, 0);
    const grp  = day.filter(t => t.customer_type?.toLowerCase().includes("group")).reduce((s, t) => s + t.quantity, 0);
    const ind  = total - fam - grp;
    return { day: short, family: Math.round(fam/total*100), individual: Math.round(ind/total*100), group: Math.round(grp/total*100) };
  });

  // Last-week date strings (7 days prior)
  const lastMonday = new Date(monday);
  lastMonday.setDate(monday.getDate() - 7);
  const lastWeekDateStrs = WEEK_START_OFFSETS.map(i => {
    const d = new Date(lastMonday);
    d.setDate(lastMonday.getDate() + i);
    return toDateStr(d);
  });

  // This-week covers — use real last-week transactions when available
  const thisWeek = weekDays.map(({ short, dateStr }, i) => {
    const lw = (byDate.get(lastWeekDateStrs[i]) ?? []).reduce((s, t) => s + t.quantity, 0);
    return {
      day: short,
      thisWeek: (byDate.get(dateStr) ?? []).reduce((s, t) => s + t.quantity, 0),
      lastWeek: lw || (fallbackWeeklyRows[i]?.lastWeek ?? 0),
    };
  });

  // Weather/temp vs volume — group all uploaded dates
  const allDates = [...new Set(txs.map(t => t.sale_date))].sort();
  const weatherSales = allDates.map(dateStr => {
    const day = byDate.get(dateStr) ?? [];
    const covers = day.reduce((s, t) => s + t.quantity, 0);
    const wmap = new Map<string, number>();
    for (const t of day) if (t.weather) wmap.set(t.weather, (wmap.get(t.weather) ?? 0) + 1);
    const w = [...wmap.entries()].sort((a,b) => b[1]-a[1])[0]?.[0] ?? "Sunny";
    const d = new Date(dateStr);
    const label = `${d.toLocaleString("default",{month:"short"})} ${d.getDate()}`;
    return { day: label, temp: WEATHER_TEMP[w] ?? 22, customers: covers };
  });

  // Order-type pie (overall)
  const totalQty = txs.reduce((s, t) => s + t.quantity, 0);
  const famTotal = txs.filter(t => t.customer_type?.toLowerCase().includes("family")).reduce((s, t) => s + t.quantity, 0);
  const grpTotal = txs.filter(t => t.customer_type?.toLowerCase().includes("group")).reduce((s, t) => s + t.quantity, 0);
  const indTotal = totalQty - famTotal - grpTotal;
  const orderPie = totalQty > 0 ? [
    { name: "Individual", value: Math.round(indTotal/totalQty*100), color: C.cyan },
    { name: "Family (2–4)", value: Math.round(famTotal/totalQty*100), color: C.green },
    { name: "Group (5+)", value: Math.round(grpTotal/totalQty*100), color: C.yellow },
  ] : orderTypePie;

  // Weekly rows table
  const computedRows = weekDays.map(({ long, dateStr, dateLabel }, i) => {
    const day = byDate.get(dateStr) ?? [];
    const covers = day.reduce((s, t) => s + t.quantity, 0);
    const lwReal = (byDate.get(lastWeekDateStrs[i]) ?? []).reduce((s, t) => s + t.quantity, 0);
    const lw = lwReal || (fallbackWeeklyRows[i]?.lastWeek ?? 0);

    if (covers === 0) {
      return { day: long, date: dateLabel, conditions: "—", covers: 0, lastWeek: lw, peak: "—", indiv: 0, family: 0, group: 0, topItem: "—", forecast: true };
    }

    const wmap = new Map<string, number>();
    for (const t of day) if (t.weather) wmap.set(t.weather, (wmap.get(t.weather) ?? 0) + 1);
    const w = [...wmap.entries()].sort((a,b) => b[1]-a[1])[0]?.[0] ?? "—";
    const temp = WEATHER_TEMP[w];

    const hmap = new Map<number, number>();
    for (const t of day) { const h = parseHour(t.sale_time); if (h !== null) hmap.set(h, (hmap.get(h) ?? 0) + t.quantity); }
    const ph = [...hmap.entries()].sort((a,b) => b[1]-a[1])[0]?.[0];
    const peakLabel = ph !== undefined ? (ph === 12 ? "12:00 pm" : ph > 12 ? `${ph-12}:00 pm` : `${ph}:00 am`) : "—";

    const fam = day.filter(t => t.customer_type?.toLowerCase().includes("family")).reduce((s, t) => s + t.quantity, 0);
    const grp = day.filter(t => t.customer_type?.toLowerCase().includes("group")).reduce((s, t) => s + t.quantity, 0);
    const ind = covers - fam - grp;

    const imap = new Map<string, number>();
    for (const t of day) if (t.menu_name) imap.set(t.menu_name, (imap.get(t.menu_name) ?? 0) + t.quantity);
    const topItem = [...imap.entries()].sort((a,b) => b[1]-a[1])[0]?.[0] ?? "—";

    return {
      day: long, date: dateLabel,
      conditions: temp !== undefined ? `${w}, ${temp}°C` : w,
      covers, lastWeek: lw, peak: peakLabel,
      indiv: Math.round(ind/covers*100), family: Math.round(fam/covers*100), group: Math.round(grp/covers*100),
      topItem, forecast: false,
    };
  });

  return { thisWeek, peakHours, customerType, weatherSales, orderPie, weeklyRows: computedRows, monday };
}

interface StockRow {
  id: string;
  name: string;
  current_stock: number;
  unit: string;
  direction: "up" | "down" | "hold" | null;
  reasoning: string;
}

function efficiencySignal(direction: StockRow["direction"]): { label: string; color: string } {
  if (direction === "down") return { label: "Overstock — reduce next order", color: "#FF6B6B" };
  if (direction === "up")   return { label: "Low — consider increasing order", color: C.cyan };
  if (direction === "hold") return { label: "Optimal — no action needed", color: C.green };
  return { label: "No signal yet", color: C.dim };
}

const DarkTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-xl p-3" style={{ background: "#252D36", border: `1px solid ${C.border}` }}>
        <p className="text-xs mb-1.5" style={{ color: C.muted, fontWeight: 600 }}>{label}</p>
        {payload.map((p: any) => (
          <p key={p.dataKey} className="text-xs" style={{ color: p.color ?? C.text, fontWeight: 600 }}>
            {p.name}: {p.value}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

const actionIcon = (icon: ActionItem["icon"]) => {
  if (icon === "rain") return <CloudRain className="w-4 h-4" />;
  return <ShoppingCart className="w-4 h-4" />;
};

const priorityConfig = {
  high:   { label: "High",   color: "#FF6B6B" },
  medium: { label: "Medium", color: C.yellow   },
  low:    { label: "Low",    color: C.muted    },
} as const;

export function AnalyticsView() {
  const [stockRows, setStockRows] = useState<StockRow[]>([]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const [{ data: ings }, { data: suggs }] = await Promise.all([
        supabase.from("ingredients").select("id, name, current_stock, unit")
          .eq("manager_id", session.user.id).order("name"),
        supabase.from("stock_suggestions").select("ingredient_id, direction, reasoning")
          .eq("manager_id", session.user.id),
      ]);

      const suggMap = Object.fromEntries(
        (suggs ?? []).map((s: { ingredient_id: string; direction: string; reasoning: string }) => [s.ingredient_id, s])
      );

      setStockRows((ings ?? []).map((ing: { id: string; name: string; current_stock: number; unit: string }) => ({
        id: ing.id,
        name: ing.name,
        current_stock: ing.current_stock,
        unit: ing.unit,
        direction: (suggMap[ing.id]?.direction as StockRow["direction"]) ?? null,
        reasoning: suggMap[ing.id]?.reasoning ?? "",
      })));
    })();
  }, []);

  // ─── Transaction-driven chart data ────────────────────────────────────────
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txLoading, setTxLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setTxLoading(false); return; }

      const since = new Date(); since.setDate(since.getDate() - 60);
      const sinceStr = toDateStr(since);

      // Primary source: sales_transactions (rich — has time, weather, customer_type)
      const { data: txData, error: fetchErr } = await supabase
        .from("sales_transactions")
        .select("sale_date, sale_time, weather, customer_type, menu_name, quantity, total_price")
        .eq("manager_id", session.user.id)
        .gte("sale_date", sinceStr)
        .order("sale_date");

      if (fetchErr) console.error("[Analytics] sales_transactions fetch error:", fetchErr);

      if (txData && txData.length > 0) {
        setTransactions(txData as Transaction[]);
        setTxLoading(false);
        return;
      }

      // Fallback: build synthetic transactions from daily_sales + menus.
      // daily_sales is always populated when a file is uploaded (it drives the green pills).
      // Two separate queries then joined client-side to avoid PostgREST join syntax issues.
      const [{ data: dsData, error: dsErr }, { data: menuData }] = await Promise.all([
        supabase
          .from("daily_sales")
          .select("sale_date, quantity_sold, menu_id")
          .eq("manager_id", session.user.id)
          .gte("sale_date", sinceStr)
          .order("sale_date"),
        supabase
          .from("menus")
          .select("id, name")
          .eq("manager_id", session.user.id),
      ]);

      if (dsErr) console.error("[Analytics] daily_sales fallback error:", dsErr);

      if (dsData && dsData.length > 0) {
        const menuMap = new Map<string, string>(
          (menuData ?? []).map((m: { id: string; name: string }) => [m.id, m.name])
        );
        const synthetic: Transaction[] = (dsData as {
          sale_date: string;
          quantity_sold: number;
          menu_id: string | null;
        }[]).map(ds => ({
          sale_date: ds.sale_date,
          sale_time: null,
          weather: null,
          customer_type: null,
          menu_name: ds.menu_id ? (menuMap.get(ds.menu_id) ?? null) : null,
          quantity: ds.quantity_sold ?? 1,
          total_price: null,
        }));
        setTransactions(synthetic);
      }

      setTxLoading(false);
    })();
  }, []);

  const [weeklySummaries, setWeeklySummaries] = useState<WeeklySummary[]>([]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data } = await supabase
        .from("weekly_summaries")
        .select("*")
        .eq("manager_id", session.user.id)
        .order("week_start", { ascending: false })
        .limit(12);
      if (data) setWeeklySummaries(data as WeeklySummary[]);
    })();
  }, []);

  const computed = useMemo(() => computeCharts(transactions, []), [transactions]);

  const noData = !txLoading && transactions.length === 0;

  const activeThisWeek   = computed?.thisWeek    ?? emptyThisWeek;
  const activePeakHours  = computed?.peakHours   ?? emptyPeakHours;
  const activeCustomer   = computed?.customerType ?? emptyCustomer;
  const activeWeather    = computed?.weatherSales ?? [];
  const activeOrderPie   = computed?.orderPie     ?? [];
  const activeWeeklyRows = computed?.weeklyRows   ?? [];

  // Group confirmed weeks by calendar month for the Upload History tracker
  const monthGroups = useMemo(() => {
    if (weeklySummaries.length === 0) return [];
    const groups = new Map<string, { weekStart: string; weekNum: number; label: string }[]>();
    for (const s of weeklySummaries) {
      const d = new Date(s.week_start + "T12:00:00");
      const monthKey = d.toLocaleString("default", { month: "long", year: "numeric" });
      const weekNum = Math.ceil(d.getDate() / 7);
      const sun = new Date(d); sun.setDate(d.getDate() + 6);
      const label = `${d.toLocaleString("default", { month: "short" })} ${d.getDate()} – ${sun.toLocaleString("default", { month: "short" })} ${sun.getDate()}`;
      if (!groups.has(monthKey)) groups.set(monthKey, []);
      groups.get(monthKey)!.push({ weekStart: s.week_start, weekNum, label });
    }
    return [...groups.entries()]
      .sort((a, b) => b[0].localeCompare(a[0])) // most recent month first
      .map(([month, weeks]) => ({
        month,
        weeks: weeks.sort((a, b) => a.weekStart.localeCompare(b.weekStart)),
      }));
  }, [weeklySummaries]);

  const [narratives, setNarratives] = useState<Record<NarrativeSection, string>>({
    "Overall Performance": "",
    "Customer Behaviour Patterns": "",
    "Weather & Sales Correlation": "",
    "Stock Implications for Next Week": "",
  });
  const [narrativeLoading, setNarrativeLoading] = useState(false);
  const [narrativeGenerated, setNarrativeGenerated] = useState(false);

  const generateNarrative = async () => {
    setNarrativeLoading(true);
    setNarrativeGenerated(false);
    setNarratives({
      "Overall Performance": "",
      "Customer Behaviour Patterns": "",
      "Weather & Sales Correlation": "",
      "Stock Implications for Next Week": "",
    });

    // ── Compile ALL chart data into a single rich context block ──────────────
    const overstocked = stockRows.filter(r => r.direction === "down")
      .map(r => `${r.name} (${r.current_stock} ${r.unit} on hand)`).slice(0, 8).join(", ") || "none flagged";
    const understock = stockRows.filter(r => r.direction === "up")
      .map(r => r.name).slice(0, 6).join(", ") || "none flagged";
    const optimalStock = stockRows.filter(r => r.direction === "hold")
      .map(r => r.name).slice(0, 4).join(", ") || "none";

    const revenueStr = thisWeekRevenue > 0
      ? `$${thisWeekRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
      : "not recorded";

    const dayDetail = confirmedDays.length > 0
      ? confirmedDays.map(r =>
          `  ${r.day} (${r.date}): ${r.covers} covers (last week: ${r.lastWeek}), ` +
          `${r.conditions}, peak at ${r.peak}, ` +
          `customer mix: ${r.indiv}% individual / ${r.family}% family / ${r.group}% group, ` +
          `top item: ${r.topItem}`
        ).join("\n")
      : "  No confirmed sales data yet this week";

    const peakHoursDetail = activePeakHours.some(h => h.orders > 0)
      ? activePeakHours.filter(h => h.orders > 0).map(h => `${h.hour}: ${h.orders} orders`).join(", ")
      : "No data";

    const orderMixDetail = activeOrderPie.length > 0
      ? activeOrderPie.map(p => `${p.name}: ${p.value}%`).join(", ")
      : "No data";

    const weatherTrend = activeWeather.length > 0
      ? activeWeather.map(w => `${w.day} (${w.temp}°C) → ${w.customers} covers`).join("; ")
      : "No weather data";

    const fullContext = [
      `WEEKLY SUMMARY:`,
      `  Total covers: ${confirmedCovers} (${Number(pctVsLW) >= 0 ? "+" : ""}${pctVsLW}% vs same days last week)`,
      `  Revenue: ${revenueStr}`,
      `  Daily average: ${avgDaily} covers | Peak day: ${bestDay.day} with ${bestDay.covers} covers`,
      `  Days with data: ${confirmedDays.length} of 7`,
      ``,
      `DAY-BY-DAY BREAKDOWN:`,
      dayDetail,
      ``,
      `PEAK HOURS (cumulative orders across all uploaded days):`,
      `  ${peakHoursDetail}`,
      ``,
      `ORDER TYPE MIX (weekly totals):`,
      `  ${orderMixDetail}`,
      ``,
      `WEATHER vs COVERS (12-day rolling chart):`,
      `  ${weatherTrend}`,
      ``,
      `STOCK STATUS:`,
      `  Overstocked / use up urgently: ${overstocked}`,
      `  Running low / reorder now: ${understock}`,
      `  At optimal levels: ${optimalStock}`,
    ].join("\n");

    const sectionPrompts: Record<NarrativeSection, string> = {
      "Overall Performance":
        `You are a restaurant analytics expert. Using ONLY the real data provided below, write a 130–160 word performance summary for the restaurant manager. ` +
        `You MUST: cite the actual cover numbers and % change, call out the specific best and worst days by name and their figures, ` +
        `mention the top-selling items by name, reference revenue if available, and state one clear forecast for the coming days. ` +
        `Do NOT use generic phrases. No intro sentence.\n\n${fullContext}`,

      "Customer Behaviour Patterns":
        `You are a restaurant analytics expert. Using ONLY the real data provided below, write a 130–160 word customer behaviour analysis. ` +
        `You MUST: describe the individual/family/group split by day using the actual percentages, ` +
        `identify which hour(s) had the highest order volume from the peak hours data, ` +
        `note any days where the mix was unusual and explain the likely cause, ` +
        `and give 2 specific staffing or menu recommendations tied directly to the data. No intro sentence.\n\n${fullContext}`,

      "Weather & Sales Correlation":
        `You are a restaurant analytics expert. Using ONLY the real data provided below, write a 130–160 word weather and sales correlation analysis. ` +
        `You MUST: identify the specific days where weather clearly impacted covers (cite both conditions and cover numbers), ` +
        `describe the pattern visible in the 12-day rolling weather chart, ` +
        `flag which overstocked perishables are most at risk given recent weather, ` +
        `and recommend specific weather-contingent prep actions for the next 3 days. No intro sentence.\n\n${fullContext}`,

      "Stock Implications for Next Week":
        `You are a restaurant analytics expert. Using ONLY the real data provided below, write a 130–160 word stock ordering recommendation. ` +
        `You MUST: name each overstocked item with its current quantity and suggest a specific use-up strategy, ` +
        `name each understock item and recommend an order quantity based on this week's cover volume, ` +
        `tie ordering decisions to the peak days and top items from the weekly data, ` +
        `and suggest one menu promotion that would help clear excess stock. No intro sentence.\n\n${fullContext}`,
    };

    await Promise.all(
      NARRATIVE_SECTIONS.map(async (section) => {
        try {
          const stream = groqStream(
            [
              {
                role: "system",
                content:
                  "You are an expert restaurant analytics AI. Your job is to write sharp, data-specific insights for restaurant managers. " +
                  "Always quote real numbers from the data. Never write advice that could apply to any restaurant — every sentence must reference this specific restaurant's actual figures.",
              },
              { role: "user", content: sectionPrompts[section] },
            ],
            { max_tokens: 300 }
          );
          for await (const delta of stream) {
            setNarratives(prev => ({ ...prev, [section]: prev[section] + delta }));
          }
        } catch (err) {
          console.error(`Narrative error [${section}]:`, err);
          const msg = err instanceof Error ? err.message : String(err);
          setNarratives(prev => ({ ...prev, [section]: `Error: ${msg}` }));
        }
      })
    );

    setNarrativeLoading(false);
    setNarrativeGenerated(true);
  };
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [actionsLoading, setActionsLoading] = useState(false);
  const [actionsGenerated, setActionsGenerated] = useState(false);
  const [actionStatuses, setActionStatuses] = useState<Record<string, ActionStatus>>({});
  const [expandedAction, setExpandedAction] = useState<string | null>(null);
  const actionsTriggeredRef = useRef(false);

  const cycleStatus = (id: string) => {
    setActionStatuses((prev) => {
      const next: Record<ActionStatus, ActionStatus> = { pending: "in_progress", in_progress: "done", done: "pending" };
      return { ...prev, [id]: next[prev[id]] };
    });
  };

  const confirmedDays = activeWeeklyRows.filter((r) => !r.forecast);
  const confirmedCovers = confirmedDays.reduce((s, r) => s + r.covers, 0);
  const lastWeekTotal = confirmedDays.reduce((s, r) => s + r.lastWeek, 0);
  const pctVsLW = lastWeekTotal > 0 ? (((confirmedCovers - lastWeekTotal) / lastWeekTotal) * 100).toFixed(1) : "0.0";
  const bestDay = confirmedDays.length > 0 ? [...confirmedDays].sort((a, b) => b.covers - a.covers)[0] : { day: "—", covers: 0, date: "", lastWeek: 0, conditions: "", peak: "—", indiv: 0, family: 0, group: 0, topItem: "—", forecast: false };
  const avgDaily = confirmedDays.length > 0 ? Math.round(confirmedCovers / confirmedDays.length) : 0;

  const thisWeekRevenue = useMemo(() => {
    const monday = computed?.monday ?? getMondayOfWeek();
    const mondayStr = toDateStr(monday);
    const sundayStr = toDateStr(new Date(monday.getTime() + 6 * 86400000));
    return transactions
      .filter(t => t.sale_date >= mondayStr && t.sale_date <= sundayStr)
      .reduce((s, t) => s + (t.total_price ?? 0), 0);
  }, [transactions, computed]);

  const { weekComplete, uploadedDaysCount } = useMemo(() => {
    const monday = computed?.monday ?? getMondayOfWeek();
    const uploadedDates = new Set(transactions.map(t => t.sale_date));
    let count = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      if (uploadedDates.has(toDateStr(d))) count++;
    }
    return { weekComplete: count >= 7, uploadedDaysCount: count };
  }, [transactions, computed]);

  const generateActions = async () => {
    setActionsLoading(true);
    setActionsGenerated(false);
    setActionItems([]);

    const daySummary = activeWeeklyRows.map(r =>
      r.covers > 0
        ? `${r.day}: ${r.covers} covers, ${r.conditions}, peak at ${r.peak}, top item: ${r.topItem}, customer mix: ${r.indiv}% individual / ${r.family}% family / ${r.group}% group`
        : `${r.day}: no data`
    ).join("\n");

    const overstocked = stockRows.filter(r => r.direction === "down")
      .map(r => `${r.name} (${r.current_stock} ${r.unit} on hand)`).join(", ") || "none";
    const understocked = stockRows.filter(r => r.direction === "up")
      .map(r => r.name).join(", ") || "none";

    const weekSummaryStr = `${confirmedCovers} total covers, ${Number(pctVsLW) >= 0 ? "+" : ""}${pctVsLW}% vs last week, daily avg ${avgDaily}, peak day ${bestDay.day} with ${bestDay.covers} covers.`;

    const prompt = `You are a restaurant analytics AI. Based on the full week of data below, generate exactly 8–10 specific, actionable recommended actions for the restaurant manager. Each action must be grounded in the actual data.

WEEKLY DATA:
${daySummary}

STOCK STATUS:
Overstocked (reduce or use up): ${overstocked}
Understocked (need to order more): ${understocked}

WEEK SUMMARY: ${weekSummaryStr}

Return ONLY a valid JSON array. No markdown, no explanation. Each object must have exactly these fields:
- "source": one of "Overall Performance", "Customer Behaviour Patterns", "Weather & Sales Correlation", "Stock Implications for Next Week"
- "priority": "high", "medium", or "low"
- "icon": "cart" for ordering/prep actions, "rain" for weather/spoilage actions
- "title": concise action title (max 12 words, include specific quantities where relevant)
- "detail": 50–80 word explanation grounded in the specific data above
- "timing": specific timing (e.g. "Friday morning", "Before Saturday service", "This week")

Distribute actions across all 4 source categories. Return only the JSON array.`;

    let raw = "";
    try {
      const stream = groqStream(
        [
          { role: "system", content: "You are a restaurant analytics AI. Return only valid JSON arrays, no markdown or explanation." },
          { role: "user", content: prompt },
        ],
        { max_tokens: 2000 }
      );
      for await (const delta of stream) raw += delta;

      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      const parsed: Omit<ActionItem, "id">[] = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
      const items: ActionItem[] = parsed.map((a, i) => ({ ...a, id: `ai-${i}` }));
      setActionItems(items);
      setActionStatuses(Object.fromEntries(items.map(a => [a.id, "pending" as ActionStatus])));
      setActionsGenerated(true);
    } catch (err) {
      console.error("generateActions error:", err);
    } finally {
      setActionsLoading(false);
    }
  };

  useEffect(() => {
    if (weekComplete && !actionsTriggeredRef.current) {
      actionsTriggeredRef.current = true;
      generateActions();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekComplete]);

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: "transparent" }}>
      <div className="sticky top-0 z-10 px-7 py-4" style={{ background: "rgba(13,21,32,0.80)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", borderBottom: `1px solid ${C.border}` }}>
        <h2 style={{ color: C.text, fontSize: "1.25rem", fontWeight: 700 }}>Analytics & Trends</h2>
        <p className="text-sm" style={{ color: C.muted }}>Weekly performance · Chart data · Customer behaviour</p>
      </div>

      <div className="p-7 space-y-5">

        {/* Empty-state notice — shown only before any sales data is uploaded */}
        {noData && (
          <div className="rounded-2xl p-5 flex items-center gap-4" style={{ background: C.card, border: `1px dashed rgba(62,217,196,0.25)` }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(62,217,196,0.08)" }}>
              <ArrowUpRight className="w-5 h-5" style={{ color: C.cyan }} />
            </div>
            <div>
              <p style={{ color: C.text, fontWeight: 600, fontSize: "0.9rem" }}>No sales data yet</p>
              <p className="text-sm mt-0.5" style={{ color: C.muted }}>Upload daily sales reports in the Daily Sales view — charts and analytics will populate automatically as you add data.</p>
            </div>
          </div>
        )}

        {/* Upload History tracker — shows confirmed weeks grouped by month */}
        {monthGroups.length > 0 && (
          <div className="rounded-2xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(62,217,196,0.1)" }}>
                <Calendar className="w-3.5 h-3.5" style={{ color: C.cyan }} />
              </div>
              <p style={{ color: C.text, fontWeight: 600, fontSize: "0.9rem" }}>Upload History</p>
              <span className="ml-auto text-xs px-2 py-0.5 rounded-lg" style={{ background: "rgba(77,236,216,0.08)", color: C.green, fontWeight: 600 }}>
                {weeklySummaries.length} week{weeklySummaries.length !== 1 ? "s" : ""} confirmed
              </span>
            </div>
            <div className="space-y-4">
              {monthGroups.map(({ month, weeks }) => (
                <div key={month}>
                  <p className="text-xs mb-2" style={{ color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{month}</p>
                  <div className="flex flex-wrap gap-2">
                    {weeks.map(w => (
                      <div key={w.weekStart} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl"
                        style={{ background: "rgba(77,236,216,0.07)", border: "1px solid rgba(77,236,216,0.18)" }}>
                        <Check className="w-3 h-3 shrink-0" style={{ color: C.green }} />
                        <span className="text-xs" style={{ color: C.green, fontWeight: 700 }}>Week {w.weekNum}</span>
                        <span className="text-xs" style={{ color: C.muted }}>{w.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Row 1: This Week vs Last + Pie */}
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 rounded-2xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="flex items-center justify-between mb-1">
              <p style={{ color: C.text, fontWeight: 600, fontSize: "0.9rem" }}>Covers: This Week vs Last Week</p>
              <div className="flex gap-3 text-xs">
                <span style={{ color: C.cyan }}>● This week</span>
                <span style={{ color: C.dim }}>● Last week</span>
              </div>
            </div>
            <p className="text-xs mb-4" style={{ color: C.muted }}>Daily customer covers comparison</p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={activeThisWeek} margin={{ top: 0, right: 0, left: -25, bottom: 0 }} barGap={3}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: C.muted }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 9, fill: C.muted }} tickLine={false} axisLine={false} />
                <Tooltip content={<DarkTooltip />} cursor={{ fill: "rgba(255,255,255,0.02)" }} />
                <Bar dataKey="thisWeek" name="This Week" fill={C.cyan} radius={[4, 4, 0, 0]} fillOpacity={0.85} />
                <Bar dataKey="lastWeek" name="Last Week" fill="rgba(255,255,255,0.14)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-2xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <p style={{ color: C.text, fontWeight: 600, fontSize: "0.9rem" }}>Order Type Mix</p>
            <p className="text-xs mb-3" style={{ color: C.muted }}>Weekly avg by party size</p>
            <div className="flex justify-center">
              <PieChart width={150} height={150}>
                <Pie data={activeOrderPie} cx={70} cy={70} innerRadius={40} outerRadius={62} paddingAngle={3} dataKey="value">
                  {activeOrderPie.map((e, i) => <Cell key={`c-${i}`} fill={e.color} fillOpacity={0.85} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "#252D36", border: `1px solid ${C.border}`, borderRadius: "10px", fontSize: "11px" }} />
              </PieChart>
            </div>
            <div className="space-y-2">
              {activeOrderPie.map((d) => (
                <div key={d.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: d.color }} />
                    <span className="text-xs" style={{ color: C.muted }}>{d.name}</span>
                  </div>
                  <span className="text-xs" style={{ color: d.color, fontWeight: 700 }}>{d.value}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Row 2: Peak Hours + Customer Type */}
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-2xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <p style={{ color: C.text, fontWeight: 600, fontSize: "0.9rem" }}>Peak Hours Analysis</p>
            <p className="text-xs mb-4" style={{ color: C.muted }}>Order volume by hour — weekly average</p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={activePeakHours} margin={{ top: 0, right: 0, left: -25, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="hour" tick={{ fontSize: 9, fill: C.muted }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 9, fill: C.muted }} tickLine={false} axisLine={false} />
                <Tooltip content={<DarkTooltip />} cursor={{ fill: "rgba(255,255,255,0.02)" }} />
                <Bar dataKey="orders" name="Orders" fill={C.green} radius={[3, 3, 0, 0]} fillOpacity={0.85} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-2xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <p style={{ color: C.text, fontWeight: 600, fontSize: "0.9rem" }}>Customer Type by Day</p>
            <p className="text-xs mb-4" style={{ color: C.muted }}>Family / Individual / Group breakdown (%)</p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={activeCustomer} margin={{ top: 0, right: 0, left: -25, bottom: 0 }} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 9, fill: C.muted }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 9, fill: C.muted }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                <Tooltip content={<DarkTooltip />} cursor={{ fill: "rgba(255,255,255,0.02)" }} />
                <Bar dataKey="family" name="Family" stackId="a" fill={C.green} fillOpacity={0.8} />
                <Bar dataKey="individual" name="Individual" stackId="a" fill={C.cyan} fillOpacity={0.7} />
                <Bar dataKey="group" name="Group (5+)" stackId="a" fill={C.yellow} fillOpacity={0.8} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Row 3: Weather */}
        <div className="rounded-2xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="flex items-center gap-2 mb-1">
            <Thermometer className="w-4 h-4" style={{ color: C.yellow }} />
            <p style={{ color: C.text, fontWeight: 600, fontSize: "0.9rem" }}>Temperature vs. Customer Volume</p>
          </div>
          <p className="text-xs mb-4" style={{ color: C.muted }}>12-day rolling view — warmer weather correlates with higher covers</p>
          <ResponsiveContainer width="100%" height={170}>
            <LineChart data={activeWeather} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="day" tick={{ fontSize: 9, fill: C.muted }} tickLine={false} axisLine={false} />
              <YAxis yAxisId="l" tick={{ fontSize: 9, fill: C.muted }} tickLine={false} axisLine={false} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 9, fill: C.muted }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}°`} />
              <Tooltip content={<DarkTooltip />} />
              <Line yAxisId="l" type="monotone" dataKey="customers" name="Customers" stroke={C.cyan} strokeWidth={2.5} dot={{ r: 3, fill: C.cyan }} />
              <Line yAxisId="r" type="monotone" dataKey="temp" name="Temp (°C)" stroke={C.yellow} strokeWidth={2} strokeDasharray="5 3" dot={{ r: 2, fill: C.yellow }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* ─── Week-over-Week Performance ───────────────────────────────── */}
        <div className="rounded-2xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="px-6 py-5 flex items-center justify-between" style={{ borderBottom: `1px solid ${C.border}` }}>
            <div>
              <p style={{ color: C.text, fontWeight: 700, fontSize: "0.95rem" }}>Week-over-Week Performance</p>
              <p className="text-xs" style={{ color: C.muted }}>Confirmed weeks · Covers, revenue & stock efficiency trend</p>
            </div>
            {weeklySummaries.length > 0 && (
              <span className="text-xs px-3 py-1 rounded-md" style={{ background: "rgba(77,236,216,0.1)", color: C.green, fontWeight: 600 }}>
                {weeklySummaries.length} week{weeklySummaries.length !== 1 ? "s" : ""} confirmed
              </span>
            )}
          </div>

          {weeklySummaries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <ArrowUpRight className="w-8 h-8" style={{ color: C.dim }} />
              <p className="text-sm" style={{ color: C.muted }}>No confirmed weeks yet</p>
              <p className="text-xs" style={{ color: C.dim }}>Upload all 7 days in Daily Sales and click "Confirm This Week" to start tracking trends</p>
            </div>
          ) : (
            <div className="p-6 space-y-6">

              {/* KPI comparison: current in-progress week vs last confirmed */}
              {(() => {
                const last = weeklySummaries[0];
                const prev = weeklySummaries[1];
                const coversChg = last.total_covers > 0 && prev
                  ? ((last.total_covers - prev.total_covers) / prev.total_covers * 100).toFixed(1)
                  : null;
                const revChg = last.total_revenue > 0 && prev?.total_revenue > 0
                  ? ((last.total_revenue - prev.total_revenue) / prev.total_revenue * 100).toFixed(1)
                  : null;
                const weekLabel = (s: WeeklySummary) => {
                  const d = new Date(s.week_start + "T12:00:00");
                  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                };
                return (
                  <div>
                    <p className="text-xs uppercase tracking-widest mb-3" style={{ color: C.dim, fontWeight: 600 }}>
                      Latest Confirmed Week {prev ? `— vs wk of ${weekLabel(prev)}` : ""}
                    </p>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {[
                        {
                          label: "Total Covers",
                          value: last.total_covers.toLocaleString(),
                          sub: coversChg !== null
                            ? { text: `${Number(coversChg) >= 0 ? "+" : ""}${coversChg}% vs prev week`, up: Number(coversChg) >= 0 }
                            : { text: "No prior week", up: null },
                        },
                        {
                          label: "Revenue",
                          value: last.total_revenue > 0 ? `$${last.total_revenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—",
                          sub: revChg !== null
                            ? { text: `${Number(revChg) >= 0 ? "+" : ""}${revChg}% vs prev week`, up: Number(revChg) >= 0 }
                            : { text: "No prior week", up: null },
                        },
                        {
                          label: "Avg Daily Covers",
                          value: Math.round(Number(last.avg_daily_covers)).toString(),
                          sub: { text: `Peak: ${last.peak_day || "—"} (${last.peak_day_covers})`, up: null },
                        },
                        {
                          label: "Overstock Items",
                          value: last.overstock_count.toString(),
                          sub: prev
                            ? { text: `${last.overstock_count <= prev.overstock_count ? "Improved" : "More waste risk"} vs prev`, up: last.overstock_count <= prev.overstock_count }
                            : { text: `${last.low_stock_count} items low stock`, up: null },
                        },
                      ].map((kpi, i) => (
                        <div key={i} className="rounded-xl p-4" style={{ background: C.card2, border: `1px solid ${C.border}` }}>
                          <p className="text-xs uppercase tracking-wide mb-1" style={{ color: C.dim, fontWeight: 600 }}>{kpi.label}</p>
                          <p style={{ color: C.text, fontSize: "1.4rem", fontWeight: 700, lineHeight: 1.1 }}>{kpi.value}</p>
                          <div className="flex items-center gap-1 mt-1">
                            {kpi.sub.up === true && <ArrowUpRight className="w-3 h-3 shrink-0" style={{ color: C.green }} />}
                            {kpi.sub.up === false && <ArrowDownRight className="w-3 h-3 shrink-0" style={{ color: "#FF6B6B" }} />}
                            <p className="text-xs" style={{ color: kpi.sub.up === true ? C.green : kpi.sub.up === false ? "#FF6B6B" : C.dim }}>
                              {kpi.sub.text}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Covers trend bar chart */}
              {weeklySummaries.length >= 2 && (
                <div>
                  <p className="text-xs uppercase tracking-widest mb-3" style={{ color: C.dim, fontWeight: 600 }}>Weekly Covers Trend</p>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart
                      data={[...weeklySummaries].reverse().map(s => ({
                        week: new Date(s.week_start + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }),
                        covers: s.total_covers,
                        overstock: s.overstock_count,
                      }))}
                      margin={{ top: 5, right: 10, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                      <XAxis dataKey="week" tick={{ fontSize: 9, fill: C.muted }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 9, fill: C.muted }} tickLine={false} axisLine={false} />
                      <Tooltip content={<DarkTooltip />} cursor={{ fill: "rgba(255,255,255,0.02)" }} />
                      <Bar dataKey="covers" name="Total Covers" fill={C.cyan} radius={[3, 3, 0, 0]} fillOpacity={0.85} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Revenue trend */}
              {weeklySummaries.length >= 2 && weeklySummaries.some(s => s.total_revenue > 0) && (
                <div>
                  <p className="text-xs uppercase tracking-widest mb-3" style={{ color: C.dim, fontWeight: 600 }}>Revenue Trend</p>
                  <ResponsiveContainer width="100%" height={150}>
                    <LineChart
                      data={[...weeklySummaries].reverse().map(s => ({
                        week: new Date(s.week_start + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }),
                        revenue: +s.total_revenue.toFixed(0),
                      }))}
                      margin={{ top: 5, right: 10, left: -10, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                      <XAxis dataKey="week" tick={{ fontSize: 9, fill: C.muted }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 9, fill: C.muted }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                      <Tooltip content={<DarkTooltip />} />
                      <Line type="monotone" dataKey="revenue" name="Revenue ($)" stroke={C.green} strokeWidth={2.5} dot={{ r: 4, fill: C.green }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Week history table */}
              {weeklySummaries.length >= 2 && (
                <div>
                  <p className="text-xs uppercase tracking-widest mb-3" style={{ color: C.dim, fontWeight: 600 }}>Week History</p>
                  <div className="overflow-x-auto rounded-xl" style={{ border: `1px solid ${C.border}` }}>
                    <table className="w-full">
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                          {["Week of", "Covers", "Revenue", "Avg/Day", "Peak Day", "Top Item", "Overstock"].map(h => (
                            <th key={h} className="px-4 py-2.5 text-left text-xs uppercase tracking-wide whitespace-nowrap" style={{ color: C.dim, fontWeight: 600, background: "rgba(255,255,255,0.02)" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[...weeklySummaries].map((s, idx) => {
                          const next = weeklySummaries[idx + 1];
                          const coversUp = next ? s.total_covers >= next.total_covers : null;
                          const weekOf = new Date(s.week_start + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
                          return (
                            <tr key={s.week_start} style={{ borderBottom: idx < weeklySummaries.length - 1 ? `1px solid rgba(255,255,255,0.03)` : "none" }}>
                              <td className="px-4 py-3 text-sm" style={{ color: C.muted, fontWeight: 500 }}>{weekOf}</td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-1">
                                  <span className="text-sm" style={{ color: C.text, fontWeight: 600 }}>{s.total_covers.toLocaleString()}</span>
                                  {coversUp === true && <ArrowUpRight className="w-3 h-3" style={{ color: C.green }} />}
                                  {coversUp === false && <ArrowDownRight className="w-3 h-3" style={{ color: "#FF6B6B" }} />}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-sm" style={{ color: C.muted }}>
                                {s.total_revenue > 0 ? `$${s.total_revenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—"}
                              </td>
                              <td className="px-4 py-3 text-sm" style={{ color: C.muted }}>{Math.round(Number(s.avg_daily_covers))}</td>
                              <td className="px-4 py-3 text-sm" style={{ color: C.muted }}>{s.peak_day || "—"} {s.peak_day_covers > 0 ? `(${s.peak_day_covers})` : ""}</td>
                              <td className="px-4 py-3 text-sm" style={{ color: C.muted, maxWidth: "140px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.top_item || "—"}</td>
                              <td className="px-4 py-3">
                                <span className="text-xs px-2 py-0.5 rounded" style={{
                                  background: s.overstock_count === 0 ? `${C.green}18` : s.overstock_count <= 2 ? `${C.yellow}18` : "rgba(255,107,107,0.12)",
                                  color: s.overstock_count === 0 ? C.green : s.overstock_count <= 2 ? C.yellow : "#FF6B6B",
                                  fontWeight: 600,
                                }}>
                                  {s.overstock_count} items
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Current in-progress week comparison hint */}
              {thisWeekRevenue > 0 || confirmedCovers > 0 ? (
                <div className="rounded-xl p-4 flex items-center gap-4" style={{ background: "rgba(62,217,196,0.05)", border: `1px solid rgba(62,217,196,0.15)` }}>
                  <div className="flex-1">
                    <p className="text-xs uppercase tracking-wide mb-0.5" style={{ color: C.cyan, fontWeight: 600 }}>This Week (In Progress)</p>
                    <p className="text-sm" style={{ color: C.muted }}>
                      {confirmedCovers} covers so far
                      {thisWeekRevenue > 0 ? ` · $${thisWeekRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })} revenue` : ""}
                      {weeklySummaries[0] && weeklySummaries[0].total_covers > 0
                        ? ` · ${((confirmedCovers / weeklySummaries[0].total_covers - 1) * 100).toFixed(1)}% vs last confirmed week`
                        : ""}
                    </p>
                  </div>
                  <p className="text-xs" style={{ color: C.dim }}>Confirm week in Daily Sales to lock in results</p>
                </div>
              ) : null}

            </div>
          )}
        </div>

        {/* ─── Weekly Business Recap ────────────────────────────────────── */}
        <div className="rounded-2xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          {/* Header */}
          <div className="px-6 py-5 flex items-center justify-between" style={{ borderBottom: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(62,217,196,0.1)" }}>
                <Brain className="w-4 h-4" style={{ color: C.cyan }} />
              </div>
              <div>
                <p style={{ color: C.text, fontWeight: 700, fontSize: "0.95rem" }}>Weekly Business Recap</p>
                <p className="text-xs" style={{ color: C.muted }}>AI-generated analysis · Week of June 16–22, 2026</p>
              </div>
            </div>
            <span className="px-3 py-1 rounded-md text-xs" style={{ background: "rgba(255,255,255,0.05)", color: C.dim, fontWeight: 500 }}>
              Updated 2h ago
            </span>
          </div>

          {/* Summary KPIs */}
          <div className="grid grid-cols-4 divide-x" style={{ borderBottom: `1px solid ${C.border}`, divideColor: C.border }}>
            {[
              { label: "Confirmed Covers", value: confirmedCovers.toLocaleString(), note: "Mon–Fri" },
              {
                label: "vs. Last Week",
                value: `${Number(pctVsLW) >= 0 ? "+" : ""}${pctVsLW}%`,
                note: "same days LW",
                color: Number(pctVsLW) >= 0 ? C.green : "#FF6B6B",
              },
              { label: "Daily Average", value: avgDaily.toString(), note: "confirmed days" },
              { label: "Peak Day", value: bestDay.day.slice(0, 3), note: `${bestDay.covers} covers`, color: C.cyan },
            ].map((s, i) => (
              <div key={i} className="px-5 py-4" style={{ borderRight: i < 3 ? `1px solid ${C.border}` : "none" }}>
                <p className="text-xs uppercase tracking-wide mb-1" style={{ color: C.dim, fontWeight: 600 }}>{s.label}</p>
                <p style={{ color: s.color ?? C.text, fontSize: "1.4rem", fontWeight: 700, lineHeight: 1.1 }}>{s.value}</p>
                <p className="text-xs mt-0.5" style={{ color: C.dim }}>{s.note}</p>
              </div>
            ))}
          </div>

          {/* Day-by-day table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {["Day", "Date", "Conditions", "Covers", "vs LW", "Peak Hour", "Customer Mix", "Top Item"].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-xs uppercase tracking-wide whitespace-nowrap" style={{ color: C.dim, fontWeight: 600, background: "rgba(255,255,255,0.02)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeWeeklyRows.map((row) => {
                  const delta = row.covers > 0 ? ((row.covers - row.lastWeek) / row.lastWeek * 100) : null;
                  const isUp = delta !== null && delta >= 0;
                  return (
                    <tr key={row.day} style={{ borderBottom: `1px solid rgba(255,255,255,0.03)`, opacity: row.forecast ? 0.5 : 1 }}>
                      <td className="px-5 py-3.5">
                        <span className="text-sm" style={{ color: C.text, fontWeight: 600 }}>{row.day}</span>
                        {row.forecast && (
                          <span className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.06)", color: C.dim, fontWeight: 500 }}>forecast</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-sm whitespace-nowrap" style={{ color: C.muted }}>{row.date}</td>
                      <td className="px-5 py-3.5 text-sm whitespace-nowrap" style={{ color: C.muted }}>{row.conditions}</td>
                      <td className="px-5 py-3.5">
                        <span className="text-sm" style={{ color: row.covers > 0 ? C.text : C.dim, fontWeight: row.covers > 0 ? 700 : 400 }}>
                          {row.covers > 0 ? row.covers : "—"}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        {delta !== null ? (
                          <span className="flex items-center gap-0.5 text-xs whitespace-nowrap" style={{ color: isUp ? C.green : "#FF6B6B", fontWeight: 700 }}>
                            {isUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                            {Math.abs(delta).toFixed(1)}%
                          </span>
                        ) : (
                          <span style={{ color: C.dim }}>—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-sm" style={{ color: C.muted }}>{row.peak}</td>
                      <td className="px-5 py-3.5">
                        {row.covers > 0 ? (
                          <span className="text-xs" style={{ color: C.muted }}>
                            <span style={{ color: C.cyan }}>{row.indiv}%</span> ind ·{" "}
                            <span style={{ color: C.green }}>{row.family}%</span> fam ·{" "}
                            <span style={{ color: C.yellow }}>{row.group}%</span> grp
                          </span>
                        ) : <span style={{ color: C.dim }}>—</span>}
                      </td>
                      <td className="px-5 py-3.5 text-sm" style={{ color: row.topItem === "—" ? C.dim : C.muted }}>{row.topItem}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* AI Narrative */}
          <div className="px-6 py-5 space-y-4" style={{ borderTop: `1px solid ${C.border}` }}>
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-widest" style={{ color: C.dim, fontWeight: 600 }}>AI Analysis</p>
              <button
                onClick={generateNarrative}
                disabled={narrativeLoading}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs transition-all hover:opacity-90 disabled:opacity-50"
                style={{ background: "rgba(62,217,196,0.1)", border: `1px solid rgba(62,217,196,0.25)`, color: C.cyan, fontWeight: 600 }}>
                <Brain className="w-3.5 h-3.5" />
                {narrativeLoading ? "Generating…" : narrativeGenerated ? "Regenerate" : "Generate AI Recap"}
              </button>
            </div>

            {!narrativeGenerated && !narrativeLoading && (
              <div className="flex items-center justify-center py-8 rounded-xl" style={{ border: `1px dashed rgba(255,255,255,0.1)` }}>
                <div className="text-center">
                  <Brain className="w-8 h-8 mx-auto mb-2" style={{ color: C.dim }} />
                  <p className="text-sm" style={{ color: C.dim }}>Click "Generate AI Recap" to get a live analysis</p>
                  <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.15)" }}>Uses your real stock levels and weekly cover data</p>
                </div>
              </div>
            )}

            {(narrativeLoading || narrativeGenerated) && (
              <div className="grid grid-cols-2 gap-5">
                {NARRATIVE_SECTIONS.map((section) => (
                  <div key={section}>
                    <p className="text-sm mb-2" style={{ color: C.text, fontWeight: 600 }}>{section}</p>
                    {narratives[section] ? (
                      <p className="text-sm leading-relaxed" style={{ color: C.muted }}>
                        {narratives[section]}
                        {narrativeLoading && narratives[section].length > 0 && (
                          <span className="inline-block w-0.5 h-4 ml-0.5 align-middle animate-pulse" style={{ background: C.cyan }} />
                        )}
                      </p>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-full border-2 animate-spin shrink-0"
                          style={{ borderColor: `${C.cyan} transparent transparent transparent` }} />
                        <span className="text-xs" style={{ color: C.dim }}>Generating…</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Action Plan ─────────────────────────────────────────────── */}
          <div style={{ borderTop: `1px solid ${C.border}` }}>
            {/* Section header */}
            <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${C.border}` }}>
              <div>
                <p className="text-xs uppercase tracking-widest mb-0.5" style={{ color: C.dim, fontWeight: 600 }}>Recommended Actions</p>
                <p className="text-sm" style={{ color: C.text, fontWeight: 600 }}>
                  {actionsGenerated
                    ? `${actionItems.length} actions derived from this week's data`
                    : weekComplete
                    ? actionsLoading ? "Generating AI recommendations…" : "AI-powered action plan"
                    : `${uploadedDaysCount}/7 days uploaded — upload all days to unlock`}
                </p>
              </div>
              <div className="flex items-center gap-4 text-xs" style={{ color: C.dim }}>
                {actionsGenerated && (["pending", "in_progress", "done"] as ActionStatus[]).map((s) => {
                  const count = Object.values(actionStatuses).filter((v) => v === s).length;
                  const labels: Record<ActionStatus, string> = { pending: "Pending", in_progress: "In Progress", done: "Done" };
                  const colors: Record<ActionStatus, string> = { pending: C.dim, in_progress: C.yellow, done: C.green };
                  return <span key={s} style={{ color: colors[s] }}>{count} {labels[s]}</span>;
                })}
                {weekComplete && actionsGenerated && !actionsLoading && (
                  <button
                    onClick={() => { actionsTriggeredRef.current = false; generateActions(); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs hover:opacity-90"
                    style={{ background: "rgba(62,217,196,0.08)", border: `1px solid rgba(62,217,196,0.2)`, color: C.cyan, fontWeight: 600 }}>
                    <Brain className="w-3 h-3" /> Regenerate
                  </button>
                )}
              </div>
            </div>

            {/* Locked: not all days uploaded yet */}
            {!weekComplete && (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <div className="flex items-center gap-1.5 mb-1">
                  {Array.from({ length: 7 }, (_, i) => (
                    <div key={i} className="w-6 h-6 rounded-full flex items-center justify-center text-xs"
                      style={{
                        background: i < uploadedDaysCount ? `${C.green}22` : "rgba(255,255,255,0.05)",
                        border: `1.5px solid ${i < uploadedDaysCount ? C.green : "rgba(255,255,255,0.12)"}`,
                        color: i < uploadedDaysCount ? C.green : C.dim,
                        fontWeight: 700,
                        fontSize: "0.6rem",
                      }}>
                      {i < uploadedDaysCount ? "✓" : i + 1}
                    </div>
                  ))}
                </div>
                <p className="text-sm" style={{ color: C.muted }}>Upload all 7 days to unlock AI recommendations</p>
                <p className="text-xs" style={{ color: C.dim }}>{uploadedDaysCount} of 7 days uploaded this week</p>
              </div>
            )}

            {/* Loading: generating */}
            {weekComplete && actionsLoading && (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <div className="w-8 h-8 rounded-full border-2 animate-spin" style={{ borderColor: `${C.cyan} transparent transparent transparent` }} />
                <p className="text-sm" style={{ color: C.muted }}>Analysing your full week's data…</p>
                <p className="text-xs" style={{ color: C.dim }}>Generating personalised recommendations</p>
              </div>
            )}

            {/* Generated: show checklist */}
            {weekComplete && actionsGenerated && !actionsLoading && (
              NARRATIVE_SECTIONS.map((section) => {
                const items = actionItems.filter((a) => a.source === section);
                if (items.length === 0) return null;
                return (
                  <div key={section} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <div className="px-6 py-3 flex items-center gap-2" style={{ background: "rgba(255,255,255,0.015)" }}>
                      <span className="text-xs uppercase tracking-wide" style={{ color: C.dim, fontWeight: 600 }}>
                        From: {section}
                      </span>
                      <span className="text-xs" style={{ color: C.dim }}>·</span>
                      <span className="text-xs" style={{ color: C.dim }}>{items.length} actions</span>
                    </div>
                    <div>
                      {items.map((action, idx) => {
                        const status = actionStatuses[action.id] ?? "pending";
                        const pri = priorityConfig[action.priority] ?? priorityConfig.medium;
                        const isExpanded = expandedAction === action.id;
                        const isDone = status === "done";
                        return (
                          <div key={action.id} style={{
                            borderTop: idx > 0 ? `1px solid rgba(255,255,255,0.03)` : "none",
                            opacity: isDone ? 0.55 : 1,
                            transition: "opacity 0.2s",
                          }}>
                            <div className="flex items-center gap-4 px-6 py-3.5">
                              <button
                                onClick={() => cycleStatus(action.id)}
                                className="w-5 h-5 rounded flex items-center justify-center shrink-0 transition-all"
                                style={{
                                  background: isDone ? `${C.green}20` : status === "in_progress" ? `${C.yellow}15` : "rgba(255,255,255,0.05)",
                                  border: `1.5px solid ${isDone ? C.green : status === "in_progress" ? C.yellow : "rgba(255,255,255,0.15)"}`,
                                }}>
                                {isDone && <Check className="w-3 h-3" style={{ color: C.green }} />}
                                {status === "in_progress" && <div className="w-2 h-2 rounded-full" style={{ background: C.yellow }} />}
                              </button>
                              <span style={{ color: isDone ? C.dim : C.muted }}>{actionIcon(action.icon)}</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm" style={{ color: isDone ? C.dim : C.text, fontWeight: 500, textDecoration: isDone ? "line-through" : "none" }}>
                                  {action.title}
                                </p>
                                <p className="text-xs mt-0.5" style={{ color: C.dim }}>{action.timing}</p>
                              </div>
                              <span className="text-xs shrink-0" style={{ color: pri.color, fontWeight: 600 }}>{pri.label}</span>
                              <span className="text-xs w-20 text-right shrink-0" style={{
                                color: isDone ? C.green : status === "in_progress" ? C.yellow : C.dim,
                                fontWeight: status !== "pending" ? 600 : 400,
                              }}>
                                {status === "in_progress" ? "In progress" : status === "done" ? "Done" : "Pending"}
                              </span>
                              <button
                                onClick={() => setExpandedAction(isExpanded ? null : action.id)}
                                className="shrink-0" style={{ background: "none", border: "none", color: C.dim }}>
                                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </button>
                            </div>
                            {isExpanded && (
                              <div className="px-6 pb-4" style={{ borderTop: `1px solid rgba(255,255,255,0.04)` }}>
                                <p className="text-sm leading-relaxed pt-3" style={{ color: C.muted }}>{action.detail}</p>
                                <div className="flex items-center gap-3 mt-3">
                                  {status !== "done" && (
                                    <button onClick={() => cycleStatus(action.id)}
                                      className="px-4 py-1.5 rounded-lg text-xs transition-all hover:opacity-90"
                                      style={{
                                        background: status === "pending" ? "rgba(62,217,196,0.1)" : `${C.green}18`,
                                        border: `1px solid ${status === "pending" ? "rgba(62,217,196,0.25)" : `${C.green}40`}`,
                                        color: status === "pending" ? C.cyan : C.green, fontWeight: 600,
                                      }}>
                                      {status === "pending" ? "Mark as In Progress" : "Mark as Done"}
                                    </button>
                                  )}
                                  {status === "done" && (
                                    <button onClick={() => cycleStatus(action.id)}
                                      className="px-4 py-1.5 rounded-lg text-xs"
                                      style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, color: C.dim }}>
                                      Reopen
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>

        </div>

      </div>
    </div>
  );
}
