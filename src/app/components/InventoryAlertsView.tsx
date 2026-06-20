import { useState, useEffect, useRef } from "react";
import { X, Tag, TrendingDown, Package, Zap, CheckCircle, ChevronDown, ChevronUp, Calendar, AlertTriangle, Leaf, Flame, Wheat, Droplets, Milk, Egg, Fish, Sprout, Coffee } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { groqStream } from "@/lib/groq";
import { toast } from "sonner";

const C = {
  bg: "rgba(13,21,32,0.92)", card: "rgba(17,29,46,0.88)", card2: "rgba(21,35,56,0.88)", border: "rgba(62,217,196,0.09)",
  cyan: "#3ED9C4", green: "#4DECD8", yellow: "#F5A623",
  text: "#EEF5F8", muted: "rgba(200,225,235,0.50)", dim: "rgba(150,195,215,0.28)",
};

type AlertLevel = "critical" | "high" | "medium";
type AlertType = "overstock" | "expiry";

interface UnifiedAlert {
  id: string;
  type: AlertType;
  item: string;
  unit: string;
  level: AlertLevel;
  currentStock: string;
  // overstock fields
  threshold?: string;
  excessQty?: string;
  surplusRaw?: number;
  storageNote: string;
  menuName: string;
  discount: { dish: string; percent: number; rationale: string };
  daysToSpoil: number;
  // expiry fields
  expiryDate?: string;
  daysToExpiry?: number;
}

type IngredientCategory = { icon: LucideIcon; color: string; bg: string };

function ingredientCategory(name: string): IngredientCategory {
  const n = name.toLowerCase();
  if (/basil|herb|mint|parsley|coriander|rosemary|thyme/.test(n))
    return { icon: Leaf,     color: "#4DECD8", bg: "rgba(77,236,216,0.12)" };
  if (/tomato|lettuce|romaine|mushroom|potato|mango|cherry|salad|vegetable/.test(n))
    return { icon: Sprout,   color: "#F5A623", bg: "rgba(245,166,35,0.11)" };
  if (/cheese|mozzarella|parmesan|pecorino|mascarpone|cheddar/.test(n))
    return { icon: Milk,     color: "#3ED9C4", bg: "rgba(62,217,196,0.11)" };
  if (/cream|butter|milk/.test(n))
    return { icon: Milk,     color: "#3ED9C4", bg: "rgba(62,217,196,0.11)" };
  if (/chicken|beef|steak|tenderloin|pork|pancetta|lamb|meat/.test(n))
    return { icon: Flame,    color: "#FF6B6B", bg: "rgba(255,107,107,0.11)" };
  if (/fish|dory|salmon|tuna|seafood/.test(n))
    return { icon: Fish,     color: "#3ED9C4", bg: "rgba(62,217,196,0.11)" };
  if (/flour|dough|pasta|bread|wheat|grain|rigatoni|spaghetti|sourdough/.test(n))
    return { icon: Wheat,    color: "#D4A853", bg: "rgba(212,168,83,0.11)" };
  if (/oil|olive|sauce|dressing|syrup|juice/.test(n))
    return { icon: Droplets, color: "#88AAFF", bg: "rgba(136,170,255,0.11)" };
  if (/wine|water|espresso|lemon.?juice|stock/.test(n))
    return { icon: Droplets, color: "#88AAFF", bg: "rgba(136,170,255,0.11)" };
  if (/salt|pepper|spice|chilli/.test(n))
    return { icon: Zap,      color: "#FF8C42", bg: "rgba(255,140,66,0.11)" };
  if (/egg/.test(n))
    return { icon: Egg,      color: "#FFDD88", bg: "rgba(255,221,136,0.11)" };
  if (/onion|garlic/.test(n))
    return { icon: Sprout,   color: "#F5A623", bg: "rgba(245,166,35,0.11)" };
  if (/tea|coffee|espresso/.test(n))
    return { icon: Coffee,   color: "#C8956C", bg: "rgba(200,149,108,0.11)" };
  return { icon: Package, color: "rgba(255,255,255,0.45)", bg: "rgba(255,255,255,0.06)" };
}

function IngredientIcon({ name }: { name: string }) {
  const { icon: Icon, color, bg } = ingredientCategory(name);
  return (
    <div style={{
      width: 38, height: 38, borderRadius: 10,
      background: bg, border: `1px solid ${color}33`,
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
    }}>
      <Icon size={16} color={color} />
    </div>
  );
}

function parseDays(s: string): number { return parseInt(s) || 0; }

function daysUntil(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const exp = new Date(dateStr + "T12:00:00");
  return Math.ceil((exp.getTime() - today.getTime()) / 86400000);
}

function overstockStorageNote(severity: AlertLevel): string {
  if (severity === "critical") return "Overstock — use immediately, high spoilage risk";
  if (severity === "high") return "Overstock — action needed within 2 days";
  return "Overstock — within manageable range, plan usage";
}

function expiryStorageNote(days: number): string {
  if (days <= 0) return "⚠️ Expired — remove from service immediately";
  if (days === 1) return "Expires tomorrow — promote immediately";
  if (days <= 3) return `Expires in ${days} days — run a discount now`;
  return `Expires in ${days} days — plan usage or promotion`;
}

const levelLabel: Record<AlertLevel, string> = { critical: "Critical", high: "High", medium: "Medium" };
const spoilLabel = (days: number) => {
  if (days <= 0) return "Expires today";
  if (days === 1) return "Expires tomorrow";
  return `Expires in ${days} days`;
};

export function InventoryAlertsView() {
  const [alerts, setAlerts]       = useState<UnifiedAlert[]>([]);
  const [loading, setLoading]     = useState(true);
  const [modalAlert, setModalAlert] = useState<UnifiedAlert | null>(null);
  const [resolved, setResolved]   = useState<Set<string>>(new Set());
  const [expanded, setExpanded]   = useState<string | null>(null);
  const [aiText, setAiText]       = useState("");
  const [aiStreaming, setAiStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }
      const uid = session.user.id;

      // Expiry threshold: 7 days from now
      const threshold = new Date(); threshold.setDate(threshold.getDate() + 7);
      const thresholdStr = threshold.toISOString().slice(0, 10);

      const [{ data: overstockRows, error: e1 }, { data: expiryRows, error: e2 }] = await Promise.all([
        supabase
          .from("overstock_alerts")
          .select("*, ingredients!ingredient_id(name, unit), menus!menu_id(name)")
          .eq("manager_id", uid)
          .neq("status", "dismissed"),
        supabase
          .from("ingredients")
          .select("id, name, unit, current_stock, expiry_date")
          .eq("manager_id", uid)
          .not("expiry_date", "is", null)
          .lte("expiry_date", thresholdStr)
          .gt("current_stock", 0)
          .order("expiry_date"),
      ]);

      if (e1) console.error("overstock query:", e1);
      if (e2) console.error("expiry query:", e2);

      const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2 };

      // Map overstock alerts
      const overstockAlerts: UnifiedAlert[] = (overstockRows ?? [])
        .sort((a: { severity: string; spoils_in: string }, b: { severity: string; spoils_in: string }) =>
          (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3) ||
          parseDays(a.spoils_in) - parseDays(b.spoils_in)
        )
        .map((row: {
          id: string; current_stock: number; weekly_use: number; surplus_qty: number;
          spoils_in: string; severity: AlertLevel; discount_pct: number; discount_note: string;
          ingredients: { name: string; unit: string }; menus: { name: string } | null;
        }) => {
          const { name, unit } = row.ingredients;
          const fmt = (n: number) => Number(n).toFixed(2);
          return {
            id: row.id,
            type: "overstock" as AlertType,
            item: name,
            unit,
            level: row.severity,
            currentStock: `${fmt(row.current_stock)} ${unit}`,
            threshold: `${fmt(row.weekly_use)} ${unit}/wk`,
            excessQty: `${fmt(row.surplus_qty)} ${unit}`,
            surplusRaw: row.surplus_qty,
            storageNote: overstockStorageNote(row.severity),
            menuName: row.menus?.name ?? "best-selling dish",
            discount: {
              dish: row.menus?.name ?? "best-selling dish",
              percent: row.discount_pct,
              rationale: row.discount_note,
            },
            daysToSpoil: parseDays(row.spoils_in),
          };
        });

      // Map expiry alerts — avoid duplicating items already in overstock alerts
      const overstockItemIds = new Set(overstockRows?.map((r: { ingredient_id: string }) => r.ingredient_id) ?? []);
      const expiryAlerts: UnifiedAlert[] = (expiryRows ?? [])
        .filter((row: { id: string }) => !overstockItemIds.has(row.id))
        .map((row: { id: string; name: string; unit: string; current_stock: number; expiry_date: string }) => {
          const days = daysUntil(row.expiry_date);
          const level: AlertLevel = days <= 1 ? "critical" : days <= 3 ? "high" : "medium";
          const fmt = (n: number) => Number(n).toFixed(2);
          return {
            id: `expiry-${row.id}`,
            type: "expiry" as AlertType,
            item: row.name,
            unit: row.unit,
            level,
            currentStock: `${fmt(row.current_stock)} ${row.unit}`,
            storageNote: expiryStorageNote(days),
            menuName: "any dish using " + row.name,
            discount: { dish: "dishes using " + row.name, percent: days <= 1 ? 20 : days <= 3 ? 15 : 10, rationale: "" },
            daysToSpoil: days,
            expiryDate: row.expiry_date,
            daysToExpiry: days,
            _ingredientId: row.id,
          } as UnifiedAlert & { _ingredientId: string };
        });

      const allAlerts = [...overstockAlerts, ...expiryAlerts];
      setAlerts(allAlerts);
      setLoading(false);

      // Fire alert email if any critical or high items exist (rate-limited server-side to once/12 h)
      const hasCritical = allAlerts.some(a => a.level === "critical" || a.level === "high");
      if (hasCritical) {
        try {
          const { data: result } = await supabase.functions.invoke("send-alert-email");
          if (result?.sent) {
            toast.warning(
              `⚠️ Critical alert email sent to ${session.user.email}`,
              { description: "Reminder to create a discount initiative for flagged items.", duration: 7000 }
            );
          }
        } catch {
          // silent — email failure never blocks the UI
        }
      }
    })();
  }, []);

  // Groq stream on modal open
  useEffect(() => {
    if (!modalAlert) {
      abortRef.current?.abort();
      setAiText(""); setAiStreaming(false);
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setAiText(""); setAiStreaming(true);

    const isExpiry = modalAlert.type === "expiry";
    const userPrompt = isExpiry
      ? `Near-expiry alert:
- Ingredient: ${modalAlert.item}
- Current stock: ${modalAlert.currentStock}
- Expires: ${spoilLabel(modalAlert.daysToSpoil)}
- Urgency: ${modalAlert.level}

Suggest a specific dish promotion or discount to clear this stock before it expires. Name the dish, the discount %, timing, and expected stock cleared. Under 80 words.`
      : `Excess inventory alert:
- Ingredient: ${modalAlert.item}
- Current stock: ${modalAlert.currentStock}
- Avg weekly use: ${modalAlert.threshold}
- Surplus: ${modalAlert.excessQty}
- Spoils: ${spoilLabel(modalAlert.daysToSpoil)}
- Used in: ${modalAlert.menuName}

What discount should we run to clear this stock? Under 80 words.`;

    (async () => {
      try {
        const stream = groqStream(
          [
            { role: "system", content: "You are a restaurant food waste reduction AI. Give one concise, actionable discount recommendation to move excess or near-expiry inventory. Be specific: name the dish, the discount %, the best time window, and the expected stock cleared." },
            { role: "user", content: userPrompt },
          ],
          { max_tokens: 160, signal: ctrl.signal }
        );
        for await (const delta of stream) setAiText(prev => prev + delta);
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          setAiText(modalAlert.discount.rationale || "Unable to generate suggestion — check API key.");
        }
      } finally {
        setAiStreaming(false);
      }
    })();

    return () => ctrl.abort();
  }, [modalAlert]);

  const dismiss = async (alert: UnifiedAlert) => {
    if (alert.type === "overstock") {
      await supabase.from("overstock_alerts").update({ status: "dismissed" }).eq("id", alert.id);
    }
    // For expiry alerts we just remove from UI (no DB record to dismiss)
    setAlerts(prev => prev.filter(a => a.id !== alert.id));
    if (modalAlert?.id === alert.id) setModalAlert(null);
  };

  const overstockCount = alerts.filter(a => a.type === "overstock").length;
  const expiryCount    = alerts.filter(a => a.type === "expiry").length;
  const criticalCount  = alerts.filter(a => a.level === "critical").length;

  const borderColor = (alert: UnifiedAlert) => {
    if (alert.type === "expiry") {
      const d = alert.daysToExpiry ?? 99;
      return d <= 1 ? "#FF6B6B" : d <= 3 ? C.yellow : C.cyan;
    }
    return alert.daysToSpoil <= 1 ? "#FF6B6B" : alert.daysToSpoil <= 2 ? C.yellow : alert.daysToSpoil <= 4 ? "rgba(255,255,255,0.2)" : C.border;
  };

  const urgentColor = (alert: UnifiedAlert) => {
    if (alert.type === "expiry") {
      const d = alert.daysToExpiry ?? 99;
      return d <= 1 ? "#FF6B6B" : d <= 3 ? C.yellow : C.cyan;
    }
    return alert.daysToSpoil <= 1 ? "#FF6B6B" : alert.daysToSpoil <= 2 ? C.yellow : C.muted;
  };

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: "transparent" }}>
      {/* Header */}
      <div className="sticky top-0 z-10 px-7 py-4 flex items-center justify-between"
        style={{ background: "rgba(13,21,32,0.80)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", borderBottom: `1px solid ${C.border}` }}>
        <div>
          <h2 style={{ color: C.text, fontSize: "1.25rem", fontWeight: 700 }}>Inventory Alerts</h2>
          <p className="text-sm" style={{ color: C.muted }}>Overstock &amp; near-expiry · AI discount suggestions</p>
        </div>
        <div className="flex items-center gap-4 text-xs">
          {criticalCount > 0 && <span style={{ color: "#FF6B6B", fontWeight: 600 }}>{criticalCount} critical</span>}
          {overstockCount > 0 && (
            <span className="flex items-center gap-1" style={{ color: C.yellow }}>
              <AlertTriangle className="w-3 h-3" />{overstockCount} overstock
            </span>
          )}
          {expiryCount > 0 && (
            <span className="flex items-center gap-1" style={{ color: C.cyan }}>
              <Calendar className="w-3 h-3" />{expiryCount} expiring
            </span>
          )}
        </div>
      </div>

      <div className="p-7">
        {loading ? (
          <div className="text-center py-16">
            <div className="w-8 h-8 mx-auto mb-3 rounded-full border-2 animate-spin"
              style={{ borderColor: `${C.cyan} transparent transparent transparent` }} />
            <p className="text-sm" style={{ color: C.muted }}>Loading alerts…</p>
          </div>
        ) : alerts.length === 0 ? (
          <div className="text-center py-16">
            <CheckCircle className="w-10 h-10 mx-auto mb-3" style={{ color: C.green }} />
            <p style={{ color: C.text, fontWeight: 600 }}>All clear</p>
            <p className="text-sm mt-1" style={{ color: C.muted }}>No overstock or near-expiry items detected.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {alerts.map((alert) => {
              const isResolved  = resolved.has(alert.id);
              const isExpanded  = expanded === alert.id;
              const uColor      = urgentColor(alert);
              const bColor      = borderColor(alert);

              return (
                <div key={alert.id} className="rounded-xl overflow-hidden"
                  style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${bColor}` }}>
                  {/* Main row */}
                  <div className="flex items-center gap-4 px-5 py-4">
                    <IngredientIcon name={alert.item} />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm" style={{ color: C.text, fontWeight: 600 }}>{alert.item}</span>
                        <span className="text-xs" style={{ color: C.dim }}>·</span>
                        {alert.type === "expiry" ? (
                          <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded"
                            style={{ background: "rgba(62,217,196,0.1)", border: "1px solid rgba(62,217,196,0.2)", color: C.cyan, fontWeight: 600 }}>
                            <Calendar className="w-3 h-3" /> Expiry Alert
                          </span>
                        ) : (
                          <span className="text-xs" style={{ color: C.muted }}>
                            {levelLabel[alert.level]} overstock
                          </span>
                        )}
                        <span className="text-xs" style={{ color: C.dim }}>·</span>
                        <span className="text-xs" style={{ color: uColor, fontWeight: 600 }}>
                          {alert.type === "expiry"
                            ? spoilLabel(alert.daysToExpiry ?? 0)
                            : spoilLabel(alert.daysToSpoil)}
                        </span>
                      </div>
                      <p className="text-xs mt-0.5" style={{ color: C.dim }}>{alert.storageNote}</p>
                    </div>

                    {/* Stock numbers */}
                    <div className="flex items-center gap-6 shrink-0 text-center">
                      {alert.type === "overstock" ? (
                        <>
                          {[
                            { label: "Stock",    value: alert.currentStock, color: C.text },
                            { label: "Avg/Week", value: alert.threshold!,    color: C.muted },
                            { label: "Excess",   value: alert.excessQty!,    color: uColor },
                          ].map(s => (
                            <div key={s.label}>
                              <p className="text-xs uppercase tracking-wide mb-0.5" style={{ color: C.dim, fontSize: "0.6rem" }}>{s.label}</p>
                              <p className="text-sm" style={{ color: s.color, fontWeight: 700 }}>{s.value}</p>
                            </div>
                          ))}
                        </>
                      ) : (
                        <>
                          {[
                            { label: "Stock",   value: alert.currentStock, color: C.text },
                            { label: "Expires", value: alert.expiryDate!, color: uColor },
                          ].map(s => (
                            <div key={s.label}>
                              <p className="text-xs uppercase tracking-wide mb-0.5" style={{ color: C.dim, fontSize: "0.6rem" }}>{s.label}</p>
                              <p className="text-sm" style={{ color: s.color, fontWeight: 700 }}>{s.value}</p>
                            </div>
                          ))}
                        </>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => setExpanded(isExpanded ? null : alert.id)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs transition-colors"
                        style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${C.border}`, color: C.muted }}>
                        AI suggestion
                        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>

                      {isResolved ? (
                        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
                          style={{ background: "rgba(77,236,216,0.08)", border: "1px solid rgba(77,236,216,0.2)", color: C.green, fontWeight: 600 }}>
                          <CheckCircle className="w-3.5 h-3.5" /> Activated
                        </span>
                      ) : (
                        <button onClick={() => setModalAlert(alert)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors hover:opacity-90"
                          style={{ background: "rgba(62,217,196,0.1)", border: `1px solid rgba(62,217,196,0.25)`, color: C.cyan, fontWeight: 600 }}>
                          <Zap className="w-3.5 h-3.5" /> Discount
                        </button>
                      )}

                      <button onClick={() => dismiss(alert)}
                        className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
                        style={{ background: "none", border: `1px solid ${C.border}`, color: C.dim }}>
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Expanded: inline AI suggestion */}
                  {isExpanded && (
                    <div className="px-5 pb-4" style={{ borderTop: `1px solid rgba(255,255,255,0.04)` }}>
                      <p className="text-xs uppercase tracking-wide mt-3 mb-2" style={{ color: C.dim, fontWeight: 600 }}>
                        {alert.type === "expiry" ? "Suggested Promotion" : "Suggested Action"}
                      </p>
                      <p className="text-sm leading-relaxed" style={{ color: C.muted }}>
                        {alert.discount.rationale || `Click "Discount" to generate an AI recommendation for ${alert.item}.`}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Discount Modal */}
      {modalAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: "rgba(0,0,0,0.65)" }}
          onClick={e => { if (e.target === e.currentTarget) setModalAlert(null); }}>
          <div className="rounded-2xl w-full max-w-md overflow-hidden"
            style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="px-6 py-5 flex items-center justify-between"
              style={{ borderBottom: `1px solid ${C.border}` }}>
              <div>
                <p className="text-xs uppercase tracking-wide mb-1" style={{ color: C.dim, fontWeight: 600 }}>
                  {modalAlert.type === "expiry" ? "Near-Expiry Promotion" : "Discount Initiative"}
                </p>
                <p style={{ color: C.text, fontWeight: 700 }}>{modalAlert.item}</p>
                {modalAlert.type === "expiry" && (
                  <p className="text-xs mt-0.5" style={{ color: urgentColor(modalAlert) }}>
                    {spoilLabel(modalAlert.daysToExpiry ?? 0)}
                  </p>
                )}
              </div>
              <button onClick={() => setModalAlert(null)}
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${C.border}`, color: C.muted }}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <p className="text-xs uppercase tracking-wide mb-2" style={{ color: C.dim, fontWeight: 600 }}>
                  Recommended Action
                </p>
                <div className="flex items-start gap-3 p-4 rounded-xl"
                  style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}` }}>
                  <Tag className="w-4 h-4 mt-0.5 shrink-0" style={{ color: C.cyan }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm mb-2" style={{ color: C.text, fontWeight: 600 }}>
                      {modalAlert.discount.percent}% discount on {modalAlert.discount.dish}
                    </p>
                    {aiStreaming && !aiText ? (
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full border-2 animate-spin shrink-0"
                          style={{ borderColor: `${C.cyan} transparent transparent transparent` }} />
                        <span className="text-xs" style={{ color: C.dim }}>Generating recommendation…</span>
                      </div>
                    ) : (
                      <p className="text-sm leading-relaxed" style={{ color: C.muted }}>
                        {aiText || modalAlert.discount.rationale}
                        {aiStreaming && (
                          <span className="inline-block w-0.5 h-4 ml-0.5 align-middle animate-pulse"
                            style={{ background: C.cyan }} />
                        )}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide mb-2" style={{ color: C.dim, fontWeight: 600 }}>
                  Projected Impact
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {(modalAlert.type === "overstock"
                    ? [
                        { icon: Package,     label: "Surplus to clear", value: modalAlert.excessQty! },
                        { icon: TrendingDown, label: "Discount offer",   value: `${modalAlert.discount.percent}% off` },
                      ]
                    : [
                        { icon: Package,     label: "Stock to clear",    value: modalAlert.currentStock },
                        { icon: Calendar,    label: "Expiry",             value: modalAlert.expiryDate! },
                      ]
                  ).map(s => {
                    const Icon = s.icon;
                    return (
                      <div key={s.label} className="flex items-center gap-3 p-3 rounded-xl"
                        style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}` }}>
                        <Icon className="w-4 h-4 shrink-0" style={{ color: C.muted }} />
                        <div>
                          <p className="text-sm" style={{ color: C.text, fontWeight: 700 }}>{s.value}</p>
                          <p className="text-xs" style={{ color: C.dim }}>{s.label}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-3 pt-1">
                <button onClick={() => setModalAlert(null)}
                  className="flex-1 py-3 rounded-xl text-sm"
                  style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, color: C.muted, fontWeight: 500 }}>
                  Dismiss
                </button>
                <button
                  onClick={() => { setResolved(prev => new Set([...prev, modalAlert.id])); setModalAlert(null); }}
                  className="flex-1 py-3 rounded-xl text-sm hover:opacity-90"
                  style={{ background: `linear-gradient(135deg, ${C.cyan}, ${C.green})`, color: C.bg, fontWeight: 700 }}>
                  Activate Promotion
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
