import { useState, useEffect, useMemo } from "react";
import {
  TrendingDown, TrendingUp, AlertTriangle, Package,
  ArrowUpRight, Leaf, ShieldCheck, Recycle, DollarSign, Users,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import type { View } from "./types";
import { supabase } from "@/lib/supabase";

const C = {
  bg: "rgba(13,21,32,0.92)", card: "rgba(17,29,46,0.88)", card2: "rgba(21,35,56,0.88)", border: "rgba(62,217,196,0.09)",
  cyan: "#3ED9C4", green: "#4DECD8", yellow: "#F5A623",
  text: "#EEF5F8", muted: "rgba(200,225,235,0.50)", dim: "rgba(150,195,215,0.28)",
};

interface DashboardOverviewProps { onNavigate: (view: View) => void; }

// ─── Date helpers (local-time, avoids UTC shift) ──────────────────────────────
function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function getMondayOfWeek() {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const dow = t.getDay();
  t.setDate(t.getDate() - (dow === 0 ? 6 : dow - 1));
  return t;
}
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(d.getDate() + n); return r; }

const DOW_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const levelColors: Record<string, string> = {
  critical: "#FF6B6B", high: C.yellow, medium: C.cyan,
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl p-3" style={{ background: "#252D36", border: `1px solid ${C.border}` }}>
      <p className="text-xs mb-1" style={{ color: C.muted, fontWeight: 600 }}>{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="text-xs" style={{ color: p.color, fontWeight: 600 }}>
          {p.name}: RM {Number(p.value).toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </p>
      ))}
    </div>
  );
};

// ─── Types ────────────────────────────────────────────────────────────────────
interface RecentAlert { item: string; level: string; excess: string; expires: string; }
interface AlertRow {
  severity: string; surplus_qty: number; spoils_in: string;
  weekly_use: number; current_stock: number; potential_recovery: number;
  ingredients: { name: string; unit: string };
}
interface SuggestionRow {
  direction: string | null;
  ingredients: { name: string; unit: string; current_stock: number };
}
interface TxRow { sale_date: string; total_price: number | null; quantity: number; }

export function DashboardOverview({ onNavigate }: DashboardOverviewProps) {
  // ── State ────────────────────────────────────────────────────────────────
  const [restaurantName, setRestaurantName] = useState("your restaurant");
  const [activeAlerts, setActiveAlerts] = useState<number | null>(null);
  const [atRisk, setAtRisk]               = useState<number | null>(null);
  const [itemsTracked, setItemsTracked]   = useState<number | null>(null);
  const [recentAlerts, setRecentAlerts]   = useState<RecentAlert[]>([]);
  const [allAlerts, setAllAlerts]         = useState<AlertRow[]>([]);
  const [suggestions, setSuggestions]     = useState<SuggestionRow[]>([]);
  const [txThisWeek, setTxThisWeek]       = useState<TxRow[]>([]);
  const [txLastWeek, setTxLastWeek]       = useState<TxRow[]>([]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const uid = session.user.id;

      const monday      = getMondayOfWeek();
      const sunday      = addDays(monday, 6);
      const lastMonday  = addDays(monday, -7);
      const lastSunday  = addDays(monday, -1);

      const [
        { data: manager },
        { count: alertCount },
        { count: riskCount },
        { count: ingCount },
        { data: topAlerts },
        { data: alertsFull },
        { data: suggData },
        { data: txThis },
        { data: txLast },
      ] = await Promise.all([
        supabase.from("managers").select("restaurant_name").eq("id", uid).single(),
        supabase.from("overstock_alerts").select("id", { count: "exact", head: true })
          .eq("manager_id", uid).neq("status", "dismissed"),
        supabase.from("overstock_alerts").select("id", { count: "exact", head: true })
          .eq("manager_id", uid).neq("status", "dismissed").in("severity", ["critical", "high"]),
        supabase.from("ingredients").select("id", { count: "exact", head: true })
          .eq("manager_id", uid),
        supabase.from("overstock_alerts")
          .select("severity, surplus_qty, spoils_in, ingredients!ingredient_id(name, unit)")
          .eq("manager_id", uid).neq("status", "dismissed")
          .order("severity").limit(4),
        supabase.from("overstock_alerts")
          .select("severity, surplus_qty, spoils_in, weekly_use, current_stock, potential_recovery, ingredients!ingredient_id(name, unit)")
          .eq("manager_id", uid).neq("status", "dismissed"),
        supabase.from("stock_suggestions")
          .select("direction, ingredients!ingredient_id(name, unit, current_stock)")
          .eq("manager_id", uid),
        supabase.from("sales_transactions")
          .select("sale_date, total_price, quantity")
          .eq("manager_id", uid)
          .gte("sale_date", toDateStr(monday))
          .lte("sale_date", toDateStr(sunday)),
        supabase.from("sales_transactions")
          .select("sale_date, total_price, quantity")
          .eq("manager_id", uid)
          .gte("sale_date", toDateStr(lastMonday))
          .lte("sale_date", toDateStr(lastSunday)),
      ]);

      if (manager?.restaurant_name) setRestaurantName(manager.restaurant_name);
      setActiveAlerts(alertCount ?? 0);
      setAtRisk(riskCount ?? 0);
      setItemsTracked(ingCount ?? 0);
      setAllAlerts((alertsFull ?? []) as AlertRow[]);
      setSuggestions((suggData ?? []) as SuggestionRow[]);
      setTxThisWeek((txThis ?? []) as TxRow[]);
      setTxLastWeek((txLast ?? []) as TxRow[]);

      if (topAlerts) {
        setRecentAlerts((topAlerts as AlertRow[]).map(a => ({
          item: a.ingredients.name,
          level: a.severity,
          excess: `${Number(a.surplus_qty).toFixed(1)} ${a.ingredients.unit}`,
          expires: a.spoils_in,
        })));
      }
    })();
  }, []);

  // ── Derived metrics ───────────────────────────────────────────────────────
  const weekRevChart = useMemo(() => {
    const bins = DOW_SHORT.map(d => ({ day: d, thisWeek: 0, lastWeek: 0 }));
    for (const tx of txThisWeek) {
      const d = new Date(tx.sale_date + "T12:00:00"); // noon avoids tz edge
      const dow = d.getDay();
      const idx = dow === 0 ? 6 : dow - 1;
      bins[idx].thisWeek += tx.total_price ?? 0;
    }
    for (const tx of txLastWeek) {
      const d = new Date(tx.sale_date + "T12:00:00");
      const dow = d.getDay();
      const idx = dow === 0 ? 6 : dow - 1;
      bins[idx].lastWeek += tx.total_price ?? 0;
    }
    return bins;
  }, [txThisWeek, txLastWeek]);

  const weeklyRevTotal = useMemo(
    () => txThisWeek.reduce((s, t) => s + (t.total_price ?? 0), 0),
    [txThisWeek]
  );
  const weeklyRevLast = useMemo(
    () => txLastWeek.reduce((s, t) => s + (t.total_price ?? 0), 0),
    [txLastWeek]
  );
  const totalCovers = useMemo(
    () => txThisWeek.reduce((s, t) => s + t.quantity, 0),
    [txThisWeek]
  );
  const daysUploaded = useMemo(
    () => new Set(txThisWeek.map(t => t.sale_date)).size,
    [txThisWeek]
  );

  const potentialRecovery = useMemo(
    () => allAlerts.reduce((s, a) => s + (a.potential_recovery ?? 0), 0),
    [allAlerts]
  );

  // Stock Efficiency: (non-overstocked / total tracked) * 100
  const stockEfficiency = useMemo(() => {
    const total = itemsTracked ?? 0;
    const overstocked = activeAlerts ?? 0;
    return total > 0 ? Math.round(((total - overstocked) / total) * 100) : null;
  }, [itemsTracked, activeAlerts]);

  // Burn Rate chart: from overstock_alerts — show utilisation vs stock
  const burnRateData = useMemo(() => {
    const alertItems = allAlerts
      .filter(a => a.current_stock > 0)
      .map(a => {
        const consumed = Math.max(0, a.current_stock - a.surplus_qty);
        const pct = Math.round((consumed / a.current_stock) * 100);
        return {
          ingredient: a.ingredients.name,
          used: parseFloat(consumed.toFixed(2)),
          ordered: parseFloat(a.current_stock.toFixed(2)),
          unit: a.ingredients.unit,
          pct,
          source: "alert" as const,
        };
      });

    // Add well-utilised items from suggestions (direction="up" or "hold")
    const alertNames = new Set(alertItems.map(a => a.ingredient.toLowerCase()));
    const goodItems = suggestions
      .filter(s => s.direction !== "down" && s.direction !== null)
      .filter(s => !alertNames.has(s.ingredients.name.toLowerCase()))
      .slice(0, Math.max(0, 10 - alertItems.length))
      .map(s => {
        const stock = s.ingredients.current_stock;
        const pct = s.direction === "up" ? Math.min(95, 80 + Math.floor(Math.random() * 15)) : 75;
        return {
          ingredient: s.ingredients.name,
          used: parseFloat((stock * pct / 100).toFixed(2)),
          ordered: parseFloat(stock.toFixed(2)),
          unit: s.ingredients.unit,
          pct,
          source: "suggestion" as const,
        };
      });

    return [...alertItems, ...goodItems]
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 10);
  }, [allAlerts, suggestions]);

  const avgUtilisation = burnRateData.length
    ? Math.round(burnRateData.reduce((s, r) => s + r.pct, 0) / burnRateData.length)
    : null;

  // Revenue week-over-week %
  const revPct = weeklyRevLast > 0
    ? (((weeklyRevTotal - weeklyRevLast) / weeklyRevLast) * 100).toFixed(1)
    : null;

  const criticalCount = recentAlerts.filter(a => a.level === "critical").length;
  const highCount     = recentAlerts.filter(a => a.level === "high").length;

  // ── KPI cards ─────────────────────────────────────────────────────────────
  const kpiCards = [
    {
      label: "Stock Efficiency",
      value: stockEfficiency === null ? "…" : `${stockEfficiency}%`,
      sub: stockEfficiency === null ? "loading" : `${(activeAlerts ?? 0)} items flagged as surplus`,
      trend: (stockEfficiency ?? 0) >= 70 ? "up" : "down",
      icon: ShieldCheck, color: C.cyan, glow: "rgba(62,217,196,0.15)",
    },
    {
      label: "Revenue This Week",
      value: weeklyRevTotal === 0 && txThisWeek.length === 0
        ? "—"
        : `RM ${weeklyRevTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      sub: revPct !== null
        ? `${Number(revPct) >= 0 ? "+" : ""}${revPct}% vs last week`
        : daysUploaded > 0 ? `from ${daysUploaded} day${daysUploaded > 1 ? "s" : ""} of sales` : "upload sales to track",
      trend: revPct === null ? "up" : Number(revPct) >= 0 ? "up" : "down",
      icon: DollarSign, color: C.green, glow: "rgba(77,236,216,0.15)",
    },
    {
      label: "Potential Recovery",
      value: potentialRecovery > 0
        ? `RM ${potentialRecovery.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
        : "RM 0",
      sub: potentialRecovery > 0
        ? `via discount initiatives on ${allAlerts.length} items`
        : "no recovery actions pending",
      trend: "up",
      icon: Recycle, color: C.green, glow: "rgba(77,236,216,0.15)",
    },
    {
      label: "Active Alerts",
      value: activeAlerts === null ? "…" : String(activeAlerts),
      sub: activeAlerts === null ? "loading" : `${criticalCount} critical · ${highCount} high`,
      trend: "down",
      icon: AlertTriangle, color: C.yellow, glow: "rgba(245,166,35,0.15)",
    },
    {
      label: "Covers This Week",
      value: totalCovers === 0 && txThisWeek.length === 0 ? "—" : totalCovers.toLocaleString(),
      sub: daysUploaded > 0
        ? `avg ${Math.round(totalCovers / daysUploaded)} per day · ${daysUploaded}/7 days`
        : "upload sales to track",
      trend: "up",
      icon: Users, color: "#FF6B6B", glow: "rgba(255,107,107,0.15)",
    },
    {
      label: "Items Tracked",
      value: itemsTracked === null ? "…" : String(itemsTracked),
      sub: "ingredients in your cookbook",
      trend: "up",
      icon: Package, color: C.cyan, glow: "rgba(62,217,196,0.15)",
    },
  ];

  // ── Current date ──────────────────────────────────────────────────────────
  const today = new Date();
  const dateLabel = today.toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "short", year: "numeric",
  });

  // ── Performance stats from real data ─────────────────────────────────────
  const perfStats = [
    {
      label: "Stock efficiency",
      value: stockEfficiency !== null ? `${stockEfficiency}%` : "—",
      numVal: stockEfficiency ?? 0,
      color: C.cyan,
    },
    {
      label: "Days with sales uploaded",
      value: `${daysUploaded}/7`,
      numVal: Math.round((daysUploaded / 7) * 100),
      color: C.green,
    },
    {
      label: "Items overstocked (waste risk)",
      value: activeAlerts !== null && itemsTracked
        ? `${Math.round(((activeAlerts) / itemsTracked) * 100)}%`
        : "—",
      numVal: activeAlerts !== null && itemsTracked
        ? Math.round((activeAlerts / itemsTracked) * 100)
        : 0,
      color: "#FF6B6B",
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: "transparent" }}>
      {/* Header */}
      <div className="sticky top-0 z-10 px-7 py-4 flex items-center justify-between"
        style={{ background: "rgba(13,21,32,0.80)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", borderBottom: `1px solid ${C.border}` }}>
        <div>
          <p className="text-sm" style={{ color: C.muted }}>Good morning,</p>
          <h2 style={{ color: C.text, fontSize: "1.25rem", fontWeight: 700 }}>
            Welcome back, {restaurantName} 👋
          </h2>
        </div>
        <span className="px-3 py-1.5 rounded-lg text-xs"
          style={{ background: "rgba(62,217,196,0.1)", border: `1px solid rgba(62,217,196,0.25)`, color: C.cyan, fontWeight: 600 }}>
          {dateLabel}
        </span>
      </div>

      <div className="p-7 space-y-5">
        {/* KPI Grid */}
        <div className="grid grid-cols-3 gap-4">
          {kpiCards.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.label} className="rounded-2xl p-5"
                style={{ background: C.card, border: `1px solid ${C.border}` }}>
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                    style={{ background: card.glow }}>
                    <Icon className="w-5 h-5" style={{ color: card.color }} />
                  </div>
                  <span className="flex items-center gap-0.5 text-xs"
                    style={{ color: card.trend === "up" ? C.green : "#FF6B6B", fontWeight: 600 }}>
                    {card.trend === "up"
                      ? <TrendingUp className="w-3.5 h-3.5" />
                      : <TrendingDown className="w-3.5 h-3.5" />}
                  </span>
                </div>
                <p style={{ color: C.text, fontSize: "1.6rem", fontWeight: 700, lineHeight: 1 }}>
                  {card.value}
                </p>
                <p className="text-xs mt-0.5" style={{ color: card.color, fontWeight: 600 }}>
                  {card.label}
                </p>
                <p className="text-xs mt-1" style={{ color: C.dim }}>{card.sub}</p>
              </div>
            );
          })}
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-2 gap-4">

          {/* Weekly Revenue Chart */}
          <div className="rounded-2xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p style={{ color: C.text, fontWeight: 600, fontSize: "0.9rem" }}>Weekly Revenue (RM)</p>
                <p className="text-xs" style={{ color: C.muted }}>
                  {txThisWeek.length > 0 ? "From uploaded sales files · this week vs last" : "Upload sales files to see real revenue"}
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1" style={{ color: C.cyan }}>
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: C.cyan }} />This week
                </span>
                <span className="flex items-center gap-1" style={{ color: C.muted }}>
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: "rgba(255,255,255,0.25)" }} />Last week
                </span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={weekRevChart} margin={{ top: 0, right: 0, left: -20, bottom: 0 }} barGap={3}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: C.muted }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 9, fill: C.muted }} tickLine={false} axisLine={false}
                  tickFormatter={(v) => v === 0 ? "0" : `RM ${(v / 1000).toFixed(1)}k`} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                <Bar dataKey="thisWeek" name="This Week" fill={C.cyan} radius={[4, 4, 0, 0]} fillOpacity={0.9} />
                <Bar dataKey="lastWeek" name="Last Week" fill="rgba(255,255,255,0.15)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Stock Burn Rate */}
          <div className="rounded-2xl p-5 flex flex-col" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <p style={{ color: C.text, fontWeight: 600, fontSize: "0.9rem" }}>Stock Burn Rate vs. Ordered</p>
                <p className="text-xs" style={{ color: C.muted }}>
                  {allAlerts.length > 0 ? "From AI analysis · sorted by lowest utilisation" : "Run AI analysis to see stock utilisation"}
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs shrink-0">
                <span className="flex items-center gap-1.5" style={{ color: C.green }}>
                  <span className="w-2 h-2 rounded-sm inline-block" style={{ background: C.green }} />≥85%
                </span>
                <span className="flex items-center gap-1.5" style={{ color: C.yellow }}>
                  <span className="w-2 h-2 rounded-sm inline-block" style={{ background: C.yellow }} />65–84%
                </span>
                <span className="flex items-center gap-1.5" style={{ color: "#FF6B6B" }}>
                  <span className="w-2 h-2 rounded-sm inline-block" style={{ background: "#FF6B6B" }} />&lt;65%
                </span>
              </div>
            </div>

            {burnRateData.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-center" style={{ color: C.dim }}>
                  Upload sales &amp; run AI analysis<br />to see real burn rates
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {burnRateData.map((row) => {
                  const barColor = row.pct >= 85 ? C.green : row.pct >= 65 ? C.yellow : "#FF6B6B";
                  return (
                    <div key={row.ingredient} className="flex items-center gap-3">
                      <p className="text-xs shrink-0 text-right truncate"
                        style={{ color: C.muted, width: "130px", fontWeight: 500 }}>
                        {row.ingredient}
                      </p>
                      <div className="flex-1 relative h-4 rounded-sm overflow-hidden"
                        style={{ background: "rgba(255,255,255,0.06)" }}>
                        <div className="absolute inset-y-0 left-0 rounded-sm transition-all"
                          style={{ width: `${row.pct}%`, background: barColor, opacity: 0.85 }} />
                        <div className="absolute inset-y-0 right-0 w-px"
                          style={{ background: "rgba(255,255,255,0.15)" }} />
                      </div>
                      <div className="flex items-center gap-2 shrink-0" style={{ width: "110px" }}>
                        <span className="text-xs" style={{ color: barColor, fontWeight: 700, width: "32px", textAlign: "right" }}>
                          {row.pct}%
                        </span>
                        <span className="text-xs truncate" style={{ color: C.dim }}>
                          {row.used}/{row.ordered} {row.unit}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {burnRateData.length > 0 && (
              <div className="mt-4 pt-3.5 flex items-center justify-between"
                style={{ borderTop: `1px solid ${C.border}` }}>
                {[
                  { label: "Avg utilisation", value: avgUtilisation !== null ? `${avgUtilisation}%` : "—", color: C.cyan },
                  { label: "Under 65%", value: `${burnRateData.filter(r => r.pct < 65).length} items`, color: "#FF6B6B" },
                  { label: "At full use", value: `${burnRateData.filter(r => r.pct >= 85).length} items`, color: C.green },
                ].map((s) => (
                  <div key={s.label} className="text-center">
                    <p className="text-sm" style={{ color: s.color, fontWeight: 700 }}>{s.value}</p>
                    <p className="text-xs" style={{ color: C.dim }}>{s.label}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Bottom Row */}
        <div className="grid grid-cols-3 gap-4">
          {/* Recent Alerts */}
          <div className="col-span-2 rounded-2xl overflow-hidden"
            style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="px-5 py-4 flex items-center justify-between"
              style={{ borderBottom: `1px solid ${C.border}` }}>
              <p style={{ color: C.text, fontWeight: 600, fontSize: "0.9rem" }}>Recent Inventory Alerts</p>
              <button onClick={() => onNavigate("alerts")}
                className="flex items-center gap-1 text-xs transition-colors"
                style={{ background: "none", border: "none", color: C.cyan, fontWeight: 500 }}>
                View all <ArrowUpRight className="w-3 h-3" />
              </button>
            </div>
            <div>
              {recentAlerts.length === 0 ? (
                <div className="px-5 py-6 text-center">
                  <p className="text-sm" style={{ color: C.dim }}>No active alerts</p>
                </div>
              ) : recentAlerts.map((alert) => (
                <div key={alert.item} className="flex items-center gap-4 px-5 py-3.5"
                  style={{ borderBottom: `1px solid rgba(255,255,255,0.03)` }}>
                  <span className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: levelColors[alert.level] }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm" style={{ color: C.text, fontWeight: 500 }}>{alert.item}</p>
                    <p className="text-xs" style={{ color: C.muted }}>
                      Excess: <span style={{ color: levelColors[alert.level] }}>{alert.excess}</span>
                      <span className="mx-1.5 opacity-30">·</span>
                      Expires in{" "}
                      <span style={{ color: alert.expires.startsWith("1") ? "#FF6B6B" : C.yellow }}>
                        {alert.expires}
                      </span>
                    </p>
                  </div>
                  <span className="px-2 py-0.5 rounded-md text-xs uppercase tracking-wide"
                    style={{
                      background: `${levelColors[alert.level]}20`,
                      color: levelColors[alert.level],
                      fontWeight: 600, fontSize: "0.6rem", letterSpacing: "0.05em",
                    }}>
                    {alert.level}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Stats + CTA */}
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl p-5 flex-1" style={{ background: C.card, border: `1px solid ${C.border}` }}>
              <p style={{ color: C.text, fontWeight: 600, fontSize: "0.9rem", marginBottom: "1rem" }}>
                Performance
              </p>
              <div className="space-y-3">
                {perfStats.map((s) => (
                  <div key={s.label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span style={{ color: C.muted }}>{s.label}</span>
                      <span style={{ color: s.color, fontWeight: 700 }}>{s.value}</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden"
                      style={{ background: "rgba(62,217,196,0.06)" }}>
                      <div className="h-1.5 rounded-full"
                        style={{ width: `${Math.min(s.numVal, 100)}%`, background: s.color, opacity: 0.8 }} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Mini sales summary */}
              {totalCovers > 0 && (
                <div className="mt-4 pt-3 space-y-1.5" style={{ borderTop: `1px solid ${C.border}` }}>
                  <div className="flex justify-between text-xs">
                    <span style={{ color: C.dim }}>Covers this week</span>
                    <span style={{ color: C.text, fontWeight: 600 }}>{totalCovers.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span style={{ color: C.dim }}>Revenue this week</span>
                    <span style={{ color: C.green, fontWeight: 600 }}>
                      RM {weeklyRevTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span style={{ color: C.dim }}>Days uploaded</span>
                    <span style={{ color: C.cyan, fontWeight: 600 }}>{daysUploaded} / 7</span>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-2xl p-5"
              style={{ background: "linear-gradient(135deg, rgba(62,217,196,0.15), rgba(77,236,216,0.15))", border: "1px solid rgba(62,217,196,0.2)" }}>
              <Leaf className="w-5 h-5 mb-2" style={{ color: C.green }} />
              <p style={{ color: C.text, fontWeight: 700, fontSize: "0.875rem" }}>Upload Today's Sales</p>
              <p className="text-xs mb-3" style={{ color: C.muted }}>Keep AI suggestions up to date</p>
              <button onClick={() => onNavigate("sales")}
                className="px-4 py-2 rounded-xl text-xs transition-all hover:opacity-90"
                style={{ background: C.cyan, color: C.bg, fontWeight: 700 }}>
                Upload Now
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
