import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function getMondayOfWeek(d: Date): string {
  const date = new Date(d);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayOfWeek = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const manager_id: string = body?.manager_id;
    if (!manager_id) {
      return new Response(JSON.stringify({ error: "manager_id is required" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── 1. Load all data for this manager ─────────────────────────────────────

    const [ingredientsRes, menusRes, salesRes] = await Promise.all([
      supabase
        .from("ingredients")
        .select("id, name, unit, initial_stock, current_stock")
        .eq("manager_id", manager_id),
      supabase
        .from("menus")
        .select("id, name")
        .eq("manager_id", manager_id),
      supabase
        .from("daily_sales")
        .select("menu_id, quantity_sold, sale_date")
        .eq("manager_id", manager_id),
    ]);

    if (ingredientsRes.error) throw ingredientsRes.error;
    if (menusRes.error) throw menusRes.error;
    if (salesRes.error) throw salesRes.error;

    const ingredients = ingredientsRes.data ?? [];
    const menus = menusRes.data ?? [];
    const sales = salesRes.data ?? [];
    const menuIds = menus.map((m) => m.id);

    // Recipes filtered to this manager's menus only
    const recipesRes = menuIds.length > 0
      ? await supabase
          .from("recipes")
          .select("menu_id, ingredient_id, quantity_used")
          .in("menu_id", menuIds)
      : { data: [] as { menu_id: string; ingredient_id: string; quantity_used: number }[], error: null };
    if (recipesRes.error) throw recipesRes.error;
    const recipes = recipesRes.data ?? [];

    // ── 2. Build lookup maps ───────────────────────────────────────────────────

    // menu_id → [{ ingredient_id, quantity_used }]
    const recipesByMenu = new Map<string, Array<{ ingredient_id: string; quantity_used: number }>>();
    for (const r of recipes) {
      if (!recipesByMenu.has(r.menu_id)) recipesByMenu.set(r.menu_id, []);
      recipesByMenu.get(r.menu_id)!.push({ ingredient_id: r.ingredient_id, quantity_used: r.quantity_used });
    }

    // ingredient_id → [{ menu_id, quantity_used }] sorted desc — first entry = top menu
    const recipesByIngredient = new Map<string, Array<{ menu_id: string; quantity_used: number }>>();
    for (const r of recipes) {
      if (!recipesByIngredient.has(r.ingredient_id)) recipesByIngredient.set(r.ingredient_id, []);
      recipesByIngredient.get(r.ingredient_id)!.push({ menu_id: r.menu_id, quantity_used: r.quantity_used });
    }
    for (const list of recipesByIngredient.values()) {
      list.sort((a, b) => b.quantity_used - a.quantity_used);
    }

    const menuNameMap = new Map(menus.map((m) => [m.id, m.name]));

    // ── 3. Compute per-ingredient weekly consumption ───────────────────────────

    // weekKey → ingredient_id → total consumed that week
    const weeklyConsumption = new Map<string, Map<string, number>>();

    for (const sale of sales) {
      const entries = recipesByMenu.get(sale.menu_id) ?? [];
      const weekKey = isoWeekKey(new Date(sale.sale_date));
      if (!weeklyConsumption.has(weekKey)) weeklyConsumption.set(weekKey, new Map());
      const weekMap = weeklyConsumption.get(weekKey)!;
      for (const entry of entries) {
        const prev = weekMap.get(entry.ingredient_id) ?? 0;
        weekMap.set(entry.ingredient_id, prev + sale.quantity_sold * entry.quantity_used);
      }
    }

    // Last 4 ISO weeks with any data (sorted descending)
    const sortedWeeks = Array.from(weeklyConsumption.keys()).sort().reverse().slice(0, 4);

    // Total consumption per ingredient across all sales (for deriving current_stock when not set)
    const totalConsumedByIngredient = new Map<string, number>();
    for (const weekMap of weeklyConsumption.values()) {
      for (const [ingId, amt] of weekMap) {
        totalConsumedByIngredient.set(ingId, (totalConsumedByIngredient.get(ingId) ?? 0) + amt);
      }
    }

    // ── 4 & 5. Build suggestion and alert rows ─────────────────────────────────

    const week_start = getMondayOfWeek(new Date());
    const now = new Date().toISOString();

    const suggestionRows: Record<string, unknown>[] = [];
    const alertRows: Record<string, unknown>[] = [];

    for (const ing of ingredients) {
      // Avg weekly use across last 4 weeks (include zero-consumption weeks in divisor)
      let weeklySum = 0;
      for (const wk of sortedWeeks) {
        weeklySum += weeklyConsumption.get(wk)?.get(ing.id) ?? 0;
      }
      const avgWeeklyUse = sortedWeeks.length > 0 ? weeklySum / sortedWeeks.length : 0;

      // current_stock: only use the explicit DB value — set via stock upload or manual edit
      const currentStock = Number(ing.current_stock ?? 0);

      const suggestedOrder = Math.max(avgWeeklyUse - currentStock, 0);

      let direction: "up" | "down" | "hold";
      if (suggestedOrder > 0) {
        direction = "up";
      } else if (avgWeeklyUse > 0 && currentStock > 1.5 * avgWeeklyUse) {
        direction = "down";
      } else {
        direction = "hold";
      }

      const reasoning =
        direction === "up"
          ? `Avg weekly use ${avgWeeklyUse.toFixed(1)} ${ing.unit}, ${currentStock.toFixed(1)} ${ing.unit} on hand — order ${suggestedOrder.toFixed(1)} ${ing.unit} to cover next week.`
          : direction === "down"
          ? `Avg weekly use ${avgWeeklyUse.toFixed(1)} ${ing.unit}, ${currentStock.toFixed(1)} ${ing.unit} on hand — overstock, reduce next order.`
          : `Avg weekly use ${avgWeeklyUse.toFixed(1)} ${ing.unit}, ${currentStock.toFixed(1)} ${ing.unit} on hand — stock level optimal.`;

      suggestionRows.push({
        manager_id,
        ingredient_id: ing.id,
        current_stock: currentStock,
        suggested_order: suggestedOrder,
        direction,
        reasoning,
        week_start,
        generated_at: now,
      });

      // Overstock alert: current > avg weekly use
      if (avgWeeklyUse > 0 && currentStock > avgWeeklyUse) {
        const surplus = currentStock - avgWeeklyUse;

        let severity: "critical" | "high" | "medium";
        let daysToSpoil: number;
        let discountPct: number;

        if (currentStock > 2 * avgWeeklyUse) {
          severity = "critical";
          daysToSpoil = 2;
          discountPct = 20;
        } else if (currentStock > 1.5 * avgWeeklyUse) {
          severity = "high";
          daysToSpoil = 4;
          discountPct = 15;
        } else {
          severity = "medium";
          daysToSpoil = 5;
          discountPct = 10;
        }

        const topMenuEntry = recipesByIngredient.get(ing.id)?.[0];
        const menuName = topMenuEntry
          ? (menuNameMap.get(topMenuEntry.menu_id) ?? "best-selling dish")
          : "best-selling dish";

        alertRows.push({
          manager_id,
          ingredient_id: ing.id,
          menu_id: topMenuEntry?.menu_id ?? null,
          current_stock: currentStock,
          weekly_use: avgWeeklyUse,
          surplus_qty: surplus,
          spoils_in: `${daysToSpoil} day${daysToSpoil !== 1 ? "s" : ""}`,
          severity,
          discount_pct: discountPct,
          discount_note: `Offer ${discountPct}% off ${menuName} to move ${surplus.toFixed(1)} ${ing.unit} of ${ing.name}.`,
          status: "pending",
          generated_at: now,
        });
      }
    }

    // ── Write stock_suggestions: delete this week's rows then insert fresh ─────

    const { error: delSuggErr } = await supabase
      .from("stock_suggestions")
      .delete()
      .eq("manager_id", manager_id)
      .eq("week_start", week_start);
    if (delSuggErr) throw delSuggErr;

    if (suggestionRows.length > 0) {
      const { error: suggErr } = await supabase
        .from("stock_suggestions")
        .insert(suggestionRows);
      if (suggErr) throw suggErr;
    }

    // ── Write overstock_alerts: delete pending then insert fresh ──────────────

    const { error: delAlertErr } = await supabase
      .from("overstock_alerts")
      .delete()
      .eq("manager_id", manager_id)
      .eq("status", "pending");
    if (delAlertErr) throw delAlertErr;

    if (alertRows.length > 0) {
      const { error: alertErr } = await supabase
        .from("overstock_alerts")
        .insert(alertRows);
      if (alertErr) throw alertErr;
    }

    // ── 7. Return summary ──────────────────────────────────────────────────────

    return new Response(
      JSON.stringify({
        suggestions_count: suggestionRows.length,
        alerts_count: alertRows.length,
        week_start,
      }),
      {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      },
    );
  } catch (err: unknown) {
    console.error("generate_analysis error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
