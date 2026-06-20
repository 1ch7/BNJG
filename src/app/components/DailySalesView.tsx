import { useState, useEffect, useRef } from "react";
import { UploadCloud, CheckCircle, TrendingUp, Package, Minus, Plus, Download, Edit3, Check, X, Calendar, ClipboardList } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";

const C = {
  bg: "rgba(13,21,32,0.92)", card: "rgba(17,29,46,0.88)", card2: "rgba(21,35,56,0.88)", border: "rgba(62,217,196,0.09)",
  cyan: "#3ED9C4", green: "#4DECD8", yellow: "#F5A623",
  text: "#EEF5F8", muted: "rgba(200,225,235,0.50)", dim: "rgba(150,195,215,0.28)",
};

type DayStatus = "uploaded" | "pending" | "future";

const WEEK_DAYS = [
  { label: "Monday",    short: "Mon" },
  { label: "Tuesday",   short: "Tue" },
  { label: "Wednesday", short: "Wed" },
  { label: "Thursday",  short: "Thu" },
  { label: "Friday",    short: "Fri" },
  { label: "Saturday",  short: "Sat" },
  { label: "Sunday",    short: "Sun" },
];

interface Suggestion {
  ingredient: string;
  ingredientId: string;
  unit: string;
  rawUnit: string;
  currentStock: number;
  aiAvgUsage: number;
  aiSuggested: number;
  reason: string;
  direction: "up" | "down" | "hold" | null;
}

function getWeekBounds(offset = 0) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dow = today.getDay();
  const daysFromMonday = dow === 0 ? 6 : dow - 1;
  const monday = new Date(today);
  monday.setDate(today.getDate() - daysFromMonday + offset * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { monday, sunday, today };
}

function fmtShort(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return `${d.toLocaleString("default", { month: "short" })} ${d.getDate()}`;
}

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ─── Order List helpers ───────────────────────────────────────────────────────
const SHELF_LIFE: [RegExp, number][] = [
  [/beef|tenderloin|steak|ribeye/, 4],
  [/chicken/, 3],
  [/fish|dory|salmon|tuna|seafood/, 2],
  [/pork|pancetta|bacon/, 4],
  [/basil/, 7],
  [/parsley/, 5],
  [/rosemary|thyme|mint/, 10],
  [/cherry.?tomato|tomato/, 10],
  [/mushroom/, 7],
  [/lettuce|romaine/, 7],
  [/mango.?chunk/, 5],
  [/mango.?puree/, 7],
  [/lemon|lime/, 14],
  [/potato/, 21],
  [/onion/, 30],
  [/garlic/, 60],
  [/mascarpone/, 7],
  [/mozzarella/, 5],
  [/parmesan|pecorino|romano/, 30],
  [/butter/, 21],
  [/cream|full.?cream.?milk|milk/, 7],
  [/egg/, 28],
  [/pizza.?dough|dough/, 3],
  [/sourdough|bread/, 5],
  [/savoiardi|biscuit/, 30],
  [/crouton/, 14],
  [/flour/, 180],
  [/pasta|spaghetti|rigatoni/, 365],
  [/salt|sugar/, 730],
  [/black.?pepper|chilli|spice/, 365],
  [/olive.?oil|sesame.?oil|cooking.?oil|oil/, 180],
  [/soy.?sauce|oyster.?sauce|caesar.?dressing/, 180],
  [/red.?wine|wine/, 4],
  [/lemon.?juice|juice/, 7],
  [/sucrose.?syrup|syrup/, 180],
  [/chicken.?stock|stock/, 4],
  [/black.?tea|tea/, 5],
  [/espresso/, 3],
  [/sparkling.?water|water/, 365],
];

function getShelfLifeDays(name: string): number {
  const lower = name.toLowerCase();
  for (const [pattern, days] of SHELF_LIFE) {
    if (pattern.test(lower)) return days;
  }
  return 14;
}

function convertQty(value: number, from: string, to: string): number {
  const f = from.toLowerCase().trim();
  const t = to.toLowerCase().trim();
  if (f === t) return value;
  if (f === "g" && t === "kg") return value / 1000;
  if (f === "kg" && t === "g") return value * 1000;
  if (f === "ml" && t === "l") return value / 1000;
  if (f === "l" && t === "ml") return value * 1000;
  return value;
}

export function DailySalesView() {
  const [days, setDays] = useState<{ label: string; short: string; status: DayStatus; dateStr: string }[]>([]);
  const [selectedDayIdx, setSelectedDayIdx] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef    = useRef<HTMLInputElement>(null);
  const orderRef   = useRef<HTMLInputElement>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [orderUploading, setOrderUploading] = useState(false);
  const [orderMsg, setOrderMsg]             = useState<{ text: string; ok: boolean } | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [avgUsage, setAvgUsage] = useState<Record<string, number>>({});
  const [editingQty, setEditingQty] = useState<string | null>(null);
  const [editingAvg, setEditingAvg] = useState<string | null>(null);
  const [tempVal, setTempVal] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploadDone, setUploadDone] = useState<string | null>(null);
  const [weekConfirmed, setWeekConfirmed] = useState(false);
  const [confirmingWeek, setConfirmingWeek] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);

  const uploadedCount = days.filter(d => d.status === "uploaded").length;

  const fetchWeekStatus = async (offset: number) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { monday, sunday, today } = getWeekBounds(offset);
    const weekStart = toDateStr(monday);
    const todayStr  = toDateStr(today);

    // Check if this week is already confirmed
    const { data: summaryRow } = await supabase
      .from("weekly_summaries")
      .select("id")
      .eq("manager_id", session.user.id)
      .eq("week_start", weekStart)
      .maybeSingle();
    setWeekConfirmed(!!summaryRow);

    const { data } = await supabase
      .from("daily_sales")
      .select("sale_date")
      .eq("manager_id", session.user.id)
      .gte("sale_date", weekStart)
      .lte("sale_date", toDateStr(sunday));

    const uploadedDates = new Set((data ?? []).map((r: { sale_date: string }) => r.sale_date));

    const built = WEEK_DAYS.map((day, i) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      const dateStr = toDateStr(date);
      let status: DayStatus = "future";
      if (uploadedDates.has(dateStr)) status = "uploaded";
      else if (dateStr <= todayStr) status = "pending";
      return { ...day, status, dateStr };
    });

    setDays(built);

    // Auto-select first non-uploaded day, or Monday if all uploaded
    const firstOpen = built.findIndex(d => d.status !== "uploaded");
    setSelectedDayIdx(firstOpen >= 0 ? firstOpen : 0);
  };

  // Computes avg weekly use from actual uploaded daily_sales × recipes.
  // Order qty = max(avgWeekly − currentStock, 0) × 1.15 (15% buffer).
  // Shows 0 for both columns if no sales have been uploaded yet.
  const generateAIOrderQtys = async (sug: Suggestion[]) => {
    if (sug.length === 0) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const normVal = (val: number, rawUnit: string) =>
        rawUnit === "g" || rawUnit === "ml" ? val / 1000 : val;

      const toWeekMon = (dateStr: string): string => {
        const d = new Date(dateStr + "T12:00:00");
        const dow = d.getDay();
        const mon = new Date(d);
        mon.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
        return mon.toISOString().slice(0, 10);
      };

      // Fetch 4 weeks of uploaded sales + menus + recipes
      const since = new Date();
      since.setDate(since.getDate() - 28);
      const sinceStr = since.toISOString().slice(0, 10);

      const [{ data: sales }, { data: menus }] = await Promise.all([
        supabase
          .from("daily_sales")
          .select("menu_id, quantity_sold, sale_date")
          .eq("manager_id", session.user.id)
          .gte("sale_date", sinceStr),
        supabase
          .from("menus")
          .select("id, name")
          .eq("manager_id", session.user.id),
      ]);

      // No sales uploaded yet → leave everything at 0
      if (!sales || sales.length === 0) return;

      const menuIds = (menus ?? []).map((m: { id: string }) => m.id);

      const { data: recipes } = menuIds.length > 0
        ? await supabase
            .from("recipes")
            .select("menu_id, ingredient_id, quantity_used")
            .in("menu_id", menuIds)
        : { data: [] as { menu_id: string; ingredient_id: string; quantity_used: number }[] };

      // No recipes → can't map sales to ingredients
      if (!recipes || recipes.length === 0) return;

      const recipesByMenu = new Map<string, { ingredient_id: string; quantity_used: number }[]>();
      for (const r of recipes) {
        if (!recipesByMenu.has(r.menu_id)) recipesByMenu.set(r.menu_id, []);
        recipesByMenu.get(r.menu_id)!.push(r);
      }

      // ingredient_id → week_monday → raw total consumed
      const weekIngMap = new Map<string, Map<string, number>>();
      for (const sale of sales) {
        const wk = toWeekMon(sale.sale_date);
        for (const r of recipesByMenu.get(sale.menu_id) ?? []) {
          const amt = sale.quantity_sold * r.quantity_used;
          if (!weekIngMap.has(r.ingredient_id)) weekIngMap.set(r.ingredient_id, new Map());
          weekIngMap.get(r.ingredient_id)!.set(wk, (weekIngMap.get(r.ingredient_id)!.get(wk) ?? 0) + amt);
        }
      }

      // Compute real avg weekly use per ingredient and apply formula for order qty
      const updatedSug = sug.map(s => {
        const wkMap = weekIngMap.get(s.ingredientId);
        if (!wkMap || wkMap.size === 0) return s; // ingredient not sold → leave as 0
        const vals = Array.from(wkMap.values()).map(v => normVal(v, s.rawUnit));
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        return { ...s, aiAvgUsage: avg };
      });

      setSuggestions(updatedSug);
      setAvgUsage(Object.fromEntries(updatedSug.map(s => [s.ingredient, s.aiAvgUsage])));

      // Order qty: max(avgWeekly − currentStock, 0) + 15% buffer
      setQuantities(() => {
        const result: Record<string, number> = {};
        for (const s of updatedSug) {
          const gap = Math.max(s.aiAvgUsage - s.currentStock, 0);
          result[s.ingredient] = parseFloat((gap * 1.15).toFixed(2));
        }
        return result;
      });
    } catch {
      // silently leave values as 0 on any error
    }
  };

  const fetchSuggestions = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data } = await supabase
      .from("stock_suggestions")
      .select("*, ingredients!ingredient_id(name, unit, current_stock)")
      .eq("manager_id", session.user.id)
      .order("generated_at", { ascending: false });

    if (data && data.length > 0) {
      const normalizeUnit = (unit: string) =>
        unit === "g" ? "kg" : unit === "ml" ? "L" : unit;
      const normalizeVal = (val: number, unit: string) =>
        unit === "g" ? val / 1000 : unit === "ml" ? val / 1000 : val;

      const mapped: Suggestion[] = data.map((row: {
        ingredient_id: string;
        ingredients: { name: string; unit: string; current_stock: number };
        current_stock: number;
        weekly_use: number;
        suggested_order: number;
        reasoning: string;
        direction: string;
      }) => {
        const rawUnit = row.ingredients.unit;
        const unit = normalizeUnit(rawUnit);
        return {
          ingredient: row.ingredients.name,
          ingredientId: row.ingredient_id,
          unit,
          rawUnit,
          currentStock: normalizeVal(row.ingredients.current_stock ?? 0, rawUnit),
          aiAvgUsage: normalizeVal(row.weekly_use ?? 0, rawUnit),
          aiSuggested: normalizeVal(row.suggested_order ?? 0, rawUnit),
          reason: row.reasoning ?? "",
          direction: (row.direction as "up" | "down" | "hold") ?? null,
        };
      });
      setSuggestions(mapped);
      setQuantities(Object.fromEntries(mapped.map(s => [s.ingredient, s.aiSuggested])));
      setAvgUsage(Object.fromEntries(mapped.map(s => [s.ingredient, s.aiAvgUsage])));
      generateAIOrderQtys(mapped);
    }
  };

  // Re-fetches week status (pills + confirmed flag) whenever the viewed week changes
  useEffect(() => {
    fetchWeekStatus(weekOffset);
  }, [weekOffset]); // eslint-disable-line react-hooks/exhaustive-deps

  // One-time init: run AI analysis and load stock suggestions
  useEffect(() => {
    fetchSuggestions();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return;
      supabase.functions
        .invoke("generate_analysis", { body: { manager_id: session.user.id } })
        .then(() => fetchSuggestions());
    });
  }, []);

  const confirmWeek = async () => {
    setConfirmingWeek(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { monday, sunday } = getWeekBounds(weekOffset);
      const weekStart = toDateStr(monday);

      const { data: txs } = await supabase
        .from("sales_transactions")
        .select("sale_date, menu_name, quantity, total_price, customer_type")
        .eq("manager_id", session.user.id)
        .gte("sale_date", weekStart)
        .lte("sale_date", toDateStr(sunday));

      const rows = (txs ?? []) as { sale_date: string; menu_name: string | null; quantity: number; total_price: number | null; customer_type: string | null }[];
      const totalCovers = rows.reduce((s, r) => s + r.quantity, 0);
      const totalRevenue = rows.reduce((s, r) => s + (r.total_price ?? 0), 0);

      const dayMap = new Map<string, number>();
      for (const r of rows) dayMap.set(r.sale_date, (dayMap.get(r.sale_date) ?? 0) + r.quantity);
      const peakEntry = [...dayMap.entries()].sort((a, b) => b[1] - a[1])[0];
      const peakDay = peakEntry
        ? new Date(peakEntry[0] + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" })
        : "";
      const peakDayCovers = peakEntry?.[1] ?? 0;

      const itemMap = new Map<string, number>();
      for (const r of rows) if (r.menu_name) itemMap.set(r.menu_name, (itemMap.get(r.menu_name) ?? 0) + r.quantity);
      const topItem = [...itemMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

      const fam = rows.filter(r => r.customer_type?.toLowerCase().includes("family")).reduce((s, r) => s + r.quantity, 0);
      const grp = rows.filter(r => r.customer_type?.toLowerCase().includes("group")).reduce((s, r) => s + r.quantity, 0);
      const familyPct = totalCovers > 0 ? Math.round(fam / totalCovers * 100) : 0;
      const groupPct  = totalCovers > 0 ? Math.round(grp / totalCovers * 100) : 0;

      const { data: suggs } = await supabase
        .from("stock_suggestions")
        .select("direction")
        .eq("manager_id", session.user.id);
      const overstockCount = (suggs ?? []).filter((s: { direction: string }) => s.direction === "down").length;
      const lowStockCount  = (suggs ?? []).filter((s: { direction: string }) => s.direction === "up").length;

      await supabase.from("weekly_summaries").upsert({
        manager_id: session.user.id,
        week_start: weekStart,
        total_covers: totalCovers,
        total_revenue: +totalRevenue.toFixed(2),
        avg_daily_covers: +(totalCovers / 7).toFixed(1),
        peak_day: peakDay,
        peak_day_covers: peakDayCovers,
        top_item: topItem,
        family_pct: familyPct,
        individual_pct: 100 - familyPct - groupPct,
        group_pct: groupPct,
        overstock_count: overstockCount,
        low_stock_count: lowStockCount,
        confirmed_at: new Date().toISOString(),
      }, { onConflict: "manager_id,week_start" });

      setUploadDone("Week confirmed! Advancing to next week — ready for new uploads.");
      setWeekOffset(prev => prev + 1); // advances week; useEffect re-fetches & resets pills
    } finally {
      setConfirmingWeek(false);
    }
  };

  const processFile = async (file: File) => {
    setUploading(true);
    setUploadError("");
    setUploadDone(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not signed in");
      const userId = session.user.id;

      // The selected day's date is the authoritative key for the daily_sales marker (pill).
      // sales_transactions keeps the file's exact dates for analytics accuracy.
      const selectedDateStr = days[selectedDayIdx ?? 0]?.dateStr ?? toDateStr(new Date());
      const fallbackDate = selectedDateStr;

      // Parse file
      const arrayBuffer = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: "array", cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];

      // Find header row — replace underscores with spaces for matching
      const allRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
      const cellStr = (c: unknown) => String(c ?? "").trim().replace(/_/g, " ");
      const hasName = (cells: string[]) => cells.some(c => /\b(menu\s*item|item\s*name|dish|item|menu)\b/i.test(c));
      const hasQty  = (cells: string[]) => cells.some(c => /\b(qty|quantity|sold|count)\b/i.test(c));

      const headerRowIdx = allRows.findIndex(row => {
        if (!Array.isArray(row)) return false;
        const cells = row.map(cellStr);
        return hasName(cells) && hasQty(cells);
      });

      if (headerRowIdx === -1) throw new Error("Could not detect a header row with a menu-name and quantity column.");

      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        raw: false, cellDates: true, range: headerRowIdx,
      });
      if (rawRows.length === 0) throw new Error("No data rows found below the header.");

      const headers = Object.keys(rawRows[0]);
      const findCol = (patterns: RegExp) => headers.find(h => patterns.test(h.replace(/_/g, " ")));

      const nameCol     = findCol(/\b(menu\s*item|item\s*name|dish|item|menu)\b/i);
      const qtyCol      = findCol(/\b(qty|quantity|sold|count)\b/i);
      const dateCol     = findCol(/\bdate\b/i);
      const timeCol     = findCol(/\btime\b/i);
      const weatherCol  = findCol(/\bweather\b/i);
      const custTypeCol = findCol(/\bcustomer[\s_]?type\b/i);
      const unitPriceCol= findCol(/\bunit[\s_]?price\b/i);
      const totalCol    = findCol(/\btotal[\s_]?price\b/i);

      if (!nameCol) throw new Error(`No menu name column found. Headers: ${headers.join(", ")}`);
      if (!qtyCol)  throw new Error(`No quantity column found. Headers: ${headers.join(", ")}`);

      // Fetch menus for name → id lookup
      const { data: menus } = await supabase
        .from("menus").select("id, name").eq("manager_id", userId);
      if (!menus?.length) throw new Error("No menus found — upload your cookbook first.");

      const menuByLower = new Map(menus.map(m => [m.name.toLowerCase().trim(), m.id]));

      // Accumulate daily_sales (aggregated) + full transactions
      const dailySalesMap = new Map<string, Map<string, number>>(); // date → menuId → qty
      const txRows: {
        manager_id: string; sale_date: string; sale_time: string | null;
        weather: string | null; customer_type: string | null;
        menu_id: string | null; menu_name: string;
        quantity: number; unit_price: number | null; total_price: number | null;
      }[] = [];

      let matched = 0;

      for (const row of rawRows) {
        const rawName = String(row[nameCol] ?? "").trim();
        const rawQty  = parseFloat(String(row[qtyCol] ?? "0").replace(/[^0-9.]/g, ""));
        if (!rawName || isNaN(rawQty) || rawQty <= 0) continue;

        // Date detection — use local toDateStr to avoid UTC timezone shift
        let saleDate = fallbackDate;
        if (dateCol && row[dateCol]) {
          const v = row[dateCol];
          if (v instanceof Date) {
            saleDate = toDateStr(v);
          } else {
            const str = String(v).trim();
            if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
              saleDate = str.slice(0, 10); // ISO string — use directly, no Date() conversion
            } else {
              const parsed = new Date(str);
              if (!isNaN(parsed.getTime())) saleDate = toDateStr(parsed);
            }
          }
        }

        const menuId = menuByLower.get(rawName.toLowerCase()) ?? null;

        // daily_sales always uses the selected day's date so the correct pill is marked.
        // sales_transactions keeps the file's exact date for accurate analytics.
        if (menuId) {
          if (!dailySalesMap.has(selectedDateStr)) dailySalesMap.set(selectedDateStr, new Map());
          const dm = dailySalesMap.get(selectedDateStr)!;
          dm.set(menuId, (dm.get(menuId) ?? 0) + rawQty);
        }

        // Store full transaction regardless (menu_id may be null for unknown items)
        // Normalize sale_time to HH:MM:SS — Excel time cells arrive as Date objects (cellDates:true)
        // and AM/PM strings also need conversion; anything unrecognized is safely nulled.
        let saleTime: string | null = null;
        if (timeCol && row[timeCol] != null) {
          const tv = row[timeCol];
          if (tv instanceof Date) {
            saleTime = `${String(tv.getHours()).padStart(2, '0')}:${String(tv.getMinutes()).padStart(2, '0')}:00`;
          } else {
            const tStr = String(tv).trim();
            const m = tStr.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM?|PM?)?$/i);
            if (m) {
              let h = parseInt(m[1], 10);
              const min = m[2], sec = m[3] ?? '00', mer = m[4]?.toUpperCase();
              if (mer?.startsWith('P') && h !== 12) h += 12;
              if (mer?.startsWith('A') && h === 12) h = 0;
              saleTime = `${String(h).padStart(2, '0')}:${min}:${sec}`;
            }
            // Unrecognized format → null (prevents Postgres time-type rejection)
          }
        }
        const weather  = weatherCol && row[weatherCol] ? String(row[weatherCol]).trim() : null;
        const custType = custTypeCol && row[custTypeCol] ? String(row[custTypeCol]).trim() : null;
        const parsePx  = (v: unknown) => { const n = parseFloat(String(v ?? "").replace(/[^0-9.]/g, "")); return isNaN(n) ? null : n; };
        const unitPx   = unitPriceCol && row[unitPriceCol] ? parsePx(row[unitPriceCol]) : null;
        const totalPx  = totalCol && row[totalCol] ? parsePx(row[totalCol]) : null;

        txRows.push({
          manager_id: userId, sale_date: saleDate,
          sale_time: saleTime, weather, customer_type: custType,
          menu_id: menuId, menu_name: rawName,
          quantity: Math.round(rawQty),
          unit_price: unitPx, total_price: totalPx,
        });
        matched++;
      }

      if (matched === 0) throw new Error("No data rows could be parsed from this file.");

      const datesInFile = [...new Set(txRows.map(r => r.sale_date))];

      // Clear the selected day from daily_sales (removes stale data from old buggy uploads)
      // and clear file dates from sales_transactions before re-inserting.
      await supabase.from("daily_sales")
        .delete().eq("manager_id", userId).eq("sale_date", selectedDateStr);

      for (const saleDate of datesInFile) {
        await supabase.from("sales_transactions")
          .delete().eq("manager_id", userId).eq("sale_date", saleDate);
      }

      // Insert transactions
      if (txRows.length > 0) {
        const { error: txErr } = await supabase.from("sales_transactions").insert(txRows);
        if (txErr) throw new Error(`Analytics data failed to save: ${txErr.message}`);
      }

      // Insert aggregated daily_sales
      const insertRows: { manager_id: string; menu_id: string; quantity_sold: number; sale_date: string }[] = [];
      for (const [saleDate, dayMap] of dailySalesMap) {
        for (const [menuId, qty] of dayMap) {
          insertRows.push({ manager_id: userId, menu_id: menuId, quantity_sold: Math.round(qty), sale_date: saleDate });
        }
      }
      if (insertRows.length > 0) {
        const { error: dsErr } = await supabase.from("daily_sales").insert(insertRows);
        if (dsErr) throw dsErr;
      }

      // Deduct ingredient stock based on recipes × quantities sold
      const menuQtyMap = new Map<string, number>();
      for (const tx of txRows) {
        if (tx.menu_id) menuQtyMap.set(tx.menu_id, (menuQtyMap.get(tx.menu_id) ?? 0) + tx.quantity);
      }
      if (menuQtyMap.size > 0) {
        const { data: recipes } = await supabase
          .from("recipes")
          .select("menu_id, ingredient_id, quantity_used")
          .in("menu_id", [...menuQtyMap.keys()]);

        if (recipes && recipes.length > 0) {
          const deductions = new Map<string, number>();
          for (const r of recipes as { menu_id: string; ingredient_id: string; quantity_used: number }[]) {
            const sold = menuQtyMap.get(r.menu_id) ?? 0;
            deductions.set(r.ingredient_id, (deductions.get(r.ingredient_id) ?? 0) + sold * r.quantity_used);
          }

          const { data: ingStocks } = await supabase
            .from("ingredients")
            .select("id, current_stock")
            .eq("manager_id", userId)
            .in("id", [...deductions.keys()]);

          for (const ing of ingStocks ?? [] as { id: string; current_stock: number }[]) {
            const deduct = deductions.get(ing.id) ?? 0;
            const newStock = Math.max(0, +(Number(ing.current_stock) - deduct).toFixed(4));
            await supabase.from("ingredients")
              .update({ current_stock: newStock })
              .eq("id", ing.id)
              .eq("manager_id", userId);
          }
        }
      }

      // Re-run analysis to update stock suggestions and alerts
      await supabase.functions.invoke("generate_analysis", { body: { manager_id: userId } });

      const dayLabel = datesInFile.length === 1
        ? (days.find(d => d.dateStr === datesInFile[0])?.label ?? datesInFile[0])
        : datesInFile.join(", ");

      setUploadDone(`${dayLabel} uploaded — ${txRows.length} transactions processed.`);
      await fetchWeekStatus(weekOffset);
      await fetchSuggestions();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setUploadError(msg);
    } finally {
      setUploading(false);
    }
  };

  const adjustQty = (ing: string, delta: number) =>
    setQuantities(prev => ({ ...prev, [ing]: Math.max(0, (prev[ing] ?? 0) + delta) }));

  const commitEdit = (field: "qty" | "avg", ing: string) => {
    const num = parseFloat(tempVal);
    if (!isNaN(num) && num >= 0) {
      if (field === "qty") setQuantities(p => ({ ...p, [ing]: num }));
      else setAvgUsage(p => ({ ...p, [ing]: num }));
    }
    setEditingQty(null); setEditingAvg(null); setTempVal("");
  };

  const processOrderList = async (file: File) => {
    setOrderUploading(true);
    setOrderMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not signed in");
      const uid = session.user.id;

      const ab = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(ab), { type: "array" });

      const orderItems: { name: string; fileUnit: string; qty: number }[] = [];

      for (const sheetName of wb.SheetNames) {
        if (/summary/i.test(sheetName)) continue;
        const sheet = wb.Sheets[sheetName];
        const allRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

        // Find the header row containing "Ingredient" and "Qty" / "Ordered"
        const hIdx = allRows.findIndex(row => {
          if (!Array.isArray(row)) return false;
          const cells = row.map(c => String(c ?? "").trim().toLowerCase());
          return cells.some(c => c === "ingredient") &&
                 cells.some(c => c.includes("qty") || c.includes("ordered"));
        });
        if (hIdx === -1) continue;

        const headers = (allRows[hIdx] as unknown[]).map(c => String(c ?? "").trim());
        const ingIdx  = headers.findIndex(h => h.toLowerCase() === "ingredient");
        const unitIdx = headers.findIndex(h => h.toLowerCase() === "unit");
        const qtyIdx  = headers.findIndex(h => /qty\s*ordered|qty ordered/i.test(h) || h.toLowerCase() === "qty ordered");
        // fallback: any column with "qty" or "ordered"
        const qIdx = qtyIdx >= 0 ? qtyIdx : headers.findIndex(h => /qty|ordered/i.test(h));

        if (ingIdx === -1 || qIdx === -1) continue;

        for (let i = hIdx + 1; i < allRows.length; i++) {
          const row = allRows[i] as unknown[];
          if (!row?.length) continue;
          const first = String(row[0] ?? "").trim().toUpperCase();
          if (/^(order total|atlas|yieldpredict)/i.test(first)) break;
          const name    = String(row[ingIdx] ?? "").trim();
          const fileUnit = unitIdx >= 0 ? String(row[unitIdx] ?? "g").trim() : "g";
          const qty     = parseFloat(String(row[qIdx] ?? "0"));
          if (name && !isNaN(qty) && qty > 0) orderItems.push({ name, fileUnit, qty });
        }
      }

      if (orderItems.length === 0) throw new Error("No ingredient rows found in the order list.");

      const { data: ingredients } = await supabase
        .from("ingredients").select("id, name, unit, current_stock")
        .eq("manager_id", uid);
      if (!ingredients?.length) throw new Error("No ingredients found in your cookbook.");

      const byName = new Map(ingredients.map(i => [i.name.toLowerCase().trim(), i]));
      const today  = new Date();
      let updated  = 0;
      let skipped  = 0;

      for (const item of orderItems) {
        const ing = byName.get(item.name.toLowerCase().trim());
        if (!ing) { skipped++; continue; }

        const addedQty   = convertQty(item.qty, item.fileUnit, ing.unit);
        const newStock   = (ing.current_stock ?? 0) + addedQty;
        const shelfLife  = getShelfLifeDays(item.name);
        const expiryDate = new Date(today);
        expiryDate.setDate(today.getDate() + shelfLife);

        await supabase.from("ingredients")
          .update({ current_stock: Math.round(newStock * 1000) / 1000, expiry_date: toDateStr(expiryDate) })
          .eq("id", ing.id);
        updated++;
      }

      setOrderMsg({ text: `✓ ${updated} ingredient${updated !== 1 ? "s" : ""} updated with new stock + expiry date${skipped ? ` · ${skipped} unmatched` : ""}.`, ok: true });
      await fetchSuggestions();
    } catch (err) {
      setOrderMsg({ text: `Error: ${err instanceof Error ? err.message : "Upload failed"}`, ok: false });
    } finally {
      setOrderUploading(false);
    }
  };

  const exportCSV = () => {
    const header = ["Ingredient", "Unit", "Current Stock", "Avg Weekly Use", "Order Qty", "AI Reasoning"];
    const rows = suggestions.map(row => [
      row.ingredient, row.unit, Number(row.currentStock).toFixed(2),
      Number(avgUsage[row.ingredient] ?? row.aiAvgUsage).toFixed(2),
      Number(quantities[row.ingredient] ?? row.aiSuggested).toFixed(2),
      `"${row.reason}"`,
    ]);
    const csv = [header, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `stock-order-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const selectedDay = selectedDayIdx !== null ? days[selectedDayIdx] : null;

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: "transparent" }}>
      <div className="sticky top-0 z-10 px-7 py-4" style={{ background: "rgba(13,21,32,0.80)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", borderBottom: `1px solid ${C.border}` }}>
        <h2 style={{ color: C.text, fontSize: "1.25rem", fontWeight: 700 }}>Daily Sales Report</h2>
        <p className="text-sm" style={{ color: C.muted }}>Upload any day's sales file — pick the day first, then drop the file</p>
      </div>

      <div className="p-7 space-y-5">
        {/* Week Progress */}
        <div className="rounded-2xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <p style={{ color: C.text, fontWeight: 600, fontSize: "0.95rem" }}>Week Progress</p>
              {days.length === 7 && (
                <p className="text-xs mt-0.5" style={{ color: C.cyan, fontWeight: 600 }}>
                  {fmtShort(days[0].dateStr)} – {fmtShort(days[6].dateStr)}
                  {weekOffset !== 0 && <span style={{ color: C.muted, fontWeight: 400 }}> · {weekOffset > 0 ? `+${weekOffset}w` : `${weekOffset}w`}</span>}
                </p>
              )}
              <p className="text-xs mt-0.5" style={{ color: C.muted }}>
                {weekConfirmed ? "This week is confirmed — showing next week" : "Click any day to select it as the upload target"}
              </p>
            </div>
            <span className="px-3 py-1.5 rounded-xl text-sm" style={{ background: "rgba(77,236,216,0.1)", border: "1px solid rgba(77,236,216,0.25)", color: C.green, fontWeight: 700 }}>
              {uploadedCount}/7 uploaded
            </span>
          </div>
          <div className="w-full rounded-full h-2 mb-5 overflow-hidden" style={{ background: "rgba(62,217,196,0.06)" }}>
            <div className="h-2 rounded-full transition-all duration-500"
              style={{ width: `${(uploadedCount / 7) * 100}%`, background: `linear-gradient(90deg, ${C.cyan}, ${C.green})` }} />
          </div>
          <div className="grid grid-cols-7 gap-2">
            {days.map((day, idx) => {
              const isSelected = selectedDayIdx === idx;
              const isUploaded = day.status === "uploaded";
              return (
                <button
                  key={day.label}
                  onClick={() => setSelectedDayIdx(idx)}
                  className="flex flex-col items-center gap-1.5 p-2.5 rounded-xl border text-center transition-all"
                  style={{
                    background: isSelected && !isUploaded
                      ? "rgba(62,217,196,0.1)"
                      : isUploaded ? "rgba(77,236,216,0.08)" : "rgba(255,255,255,0.03)",
                    borderColor: isSelected && !isUploaded
                      ? C.cyan
                      : isUploaded ? "rgba(77,236,216,0.25)" : C.border,
                    cursor: isUploaded ? "default" : "pointer",
                  }}>
                  <span className="text-xs" style={{ color: C.muted, fontWeight: 500 }}>{day.short}</span>
                  {isUploaded ? (
                    <CheckCircle className="w-4 h-4" style={{ color: C.green }} />
                  ) : isSelected ? (
                    <Calendar className="w-4 h-4" style={{ color: C.cyan }} />
                  ) : (
                    <div className="w-4 h-4 rounded-full" style={{ background: "rgba(255,255,255,0.15)" }} />
                  )}
                  <span className="text-xs" style={{ color: C.dim, fontSize: "0.55rem" }}>
                    {day.dateStr.slice(5)} {/* MM-DD */}
                  </span>
                  <span className="text-xs" style={{
                    color: isUploaded ? C.green : isSelected ? C.cyan : C.dim,
                    fontWeight: isSelected || isUploaded ? 600 : 400,
                    fontSize: "0.55rem",
                  }}>
                    {isUploaded ? "✓ Done" : isSelected ? "▶ Upload" : "—"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Upload Zone */}
        <div className="rounded-2xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="flex items-center justify-between mb-4">
            <p style={{ color: C.text, fontWeight: 600, fontSize: "0.95rem" }}>
              {selectedDay && selectedDay.status !== "uploaded"
                ? `Upload ${selectedDay.label}'s Sales File`
                : "Upload Sales File"}
            </p>
            {selectedDay && (
              <span className="text-xs px-2.5 py-1 rounded-lg" style={{
                background: selectedDay.status === "uploaded" ? "rgba(77,236,216,0.1)" : "rgba(62,217,196,0.1)",
                border: `1px solid ${selectedDay.status === "uploaded" ? "rgba(77,236,216,0.25)" : "rgba(62,217,196,0.25)"}`,
                color: selectedDay.status === "uploaded" ? C.green : C.cyan,
                fontWeight: 600,
              }}>
                {selectedDay.label} · {selectedDay.dateStr}
              </span>
            )}
          </div>

          <div
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={e => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) processFile(f); }}
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all"
            style={{ borderColor: isDragging ? C.cyan : "rgba(62,217,196,0.2)", background: isDragging ? "rgba(62,217,196,0.05)" : "transparent" }}>
            {uploading ? (
              <>
                <div className="w-8 h-8 mx-auto mb-2 rounded-full border-2 animate-spin"
                  style={{ borderColor: `${C.cyan} transparent transparent transparent` }} />
                <p className="text-sm" style={{ color: C.text, fontWeight: 500 }}>Parsing and uploading…</p>
                <p className="text-xs mt-1" style={{ color: C.muted }}>Processing transactions and running AI analysis</p>
              </>
            ) : (
              <>
                <UploadCloud className="w-8 h-8 mx-auto mb-2" style={{ color: C.cyan }} />
                <p className="text-sm" style={{ color: C.text, fontWeight: 500 }}>
                  Drop your sales CSV or XLSX, or click to browse
                </p>
                <p className="text-xs mt-1" style={{ color: C.muted }}>
                  Supports: <span style={{ color: C.cyan }}>Menu_Item · Quantity · Date · Time · Weather · Customer_Type</span>
                </p>
              </>
            )}
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) { e.target.value = ""; processFile(f); } }} />
          </div>

          {uploadError && <p className="text-xs mt-3 text-center" style={{ color: "#ff6b6b" }}>{uploadError}</p>}
          {uploadDone && !uploadError && <p className="text-xs mt-3 text-center" style={{ color: C.green }}>{uploadDone}</p>}
        </div>

        {/* AI Stock Suggestions Table */}
        {suggestions.length > 0 && (
          <div className="rounded-2xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="px-5 py-4 flex items-center gap-3" style={{ borderBottom: `1px solid ${C.border}` }}>
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "rgba(62,217,196,0.1)" }}>
                <TrendingUp className="w-4 h-4" style={{ color: C.cyan }} />
              </div>
              <div className="flex-1">
                <p style={{ color: C.text, fontWeight: 600, fontSize: "0.95rem" }}>AI Stock Suggestions</p>
                <p className="text-xs" style={{ color: C.muted }}>{suggestions.length} ingredients · based on uploaded sales data</p>
              </div>

              {/* Upload Order List */}
              <div className="flex flex-col items-end gap-1">
                <button
                  onClick={() => { setOrderMsg(null); orderRef.current?.click(); }}
                  disabled={orderUploading}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm transition-all hover:opacity-90"
                  style={{ background: "rgba(245,166,35,0.1)", border: "1px solid rgba(245,166,35,0.25)", color: C.yellow, fontWeight: 600, opacity: orderUploading ? 0.7 : 1 }}>
                  {orderUploading
                    ? <><div className="w-3.5 h-3.5 rounded-full border-2 animate-spin" style={{ borderColor: `${C.yellow} transparent transparent transparent` }} /> Updating…</>
                    : <><ClipboardList className="w-4 h-4" /> Upload Order List</>
                  }
                </button>
                {orderMsg && (
                  <p className="text-xs" style={{ color: orderMsg.ok ? C.green : "#ff6b6b", maxWidth: "260px", textAlign: "right" }}>
                    {orderMsg.text}
                  </p>
                )}
                <input ref={orderRef} type="file" accept=".xlsx,.xls" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) { e.target.value = ""; processOrderList(f); } }} />
              </div>

              <button onClick={exportCSV}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm transition-all hover:opacity-90"
                style={{ background: `linear-gradient(135deg, ${C.cyan}, ${C.green})`, color: C.bg, fontWeight: 700 }}>
                <Download className="w-4 h-4" /> Export CSV
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ background: "rgba(255,255,255,0.02)", borderBottom: `1px solid ${C.border}` }}>
                    {["Ingredient", "Current Stock", "Avg Weekly Use ✏", "Order Qty ✏", "AI Reasoning"].map(h => (
                      <th key={h} className="px-5 py-3 text-left text-xs uppercase tracking-wide" style={{ color: C.muted, fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {suggestions.map(row => {
                    const qty = quantities[row.ingredient] ?? row.aiSuggested;
                    const avg = avgUsage[row.ingredient] ?? row.aiAvgUsage;
                    return (
                      <tr key={row.ingredient} className="transition-colors" style={{ borderBottom: `1px solid rgba(255,255,255,0.03)` }}
                        onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            <Package className="w-3.5 h-3.5 shrink-0" style={{ color: C.dim }} />
                            <span className="text-sm" style={{ color: C.text, fontWeight: 500 }}>{row.ingredient}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-sm" style={{ color: C.muted }}>{Number(row.currentStock).toFixed(2)} {row.unit}</td>
                        <td className="px-5 py-3.5">
                          {editingAvg === row.ingredient ? (
                            <div className="flex items-center gap-1">
                              <input autoFocus type="number" value={tempVal} onChange={e => setTempVal(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") commitEdit("avg", row.ingredient); if (e.key === "Escape") { setEditingAvg(null); setTempVal(""); } }}
                                className="w-16 px-2 py-1 rounded-lg text-sm text-center outline-none"
                                style={{ background: C.card2, border: `1px solid ${C.cyan}`, color: C.text, fontWeight: 600 }} />
                              <button onClick={() => commitEdit("avg", row.ingredient)} style={{ background: "none", border: "none" }}><Check className="w-3.5 h-3.5" style={{ color: C.green }} /></button>
                              <button onClick={() => { setEditingAvg(null); setTempVal(""); }} style={{ background: "none", border: "none" }}><X className="w-3.5 h-3.5" style={{ color: C.muted }} /></button>
                            </div>
                          ) : (
                            <button onClick={() => { setEditingAvg(row.ingredient); setTempVal(String(avg)); }}
                              className="flex items-center gap-1.5 group" style={{ background: "none", border: "none" }}>
                              <span className="text-sm" style={{ color: C.muted }}>{Number(avg).toFixed(2)} {row.unit}</span>
                              <Edit3 className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: C.cyan }} />
                            </button>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          {editingQty === row.ingredient ? (
                            <div className="flex items-center gap-1">
                              <input autoFocus type="number" value={tempVal} onChange={e => setTempVal(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") commitEdit("qty", row.ingredient); if (e.key === "Escape") { setEditingQty(null); setTempVal(""); } }}
                                className="w-16 px-2 py-1 rounded-lg text-sm text-center outline-none"
                                style={{ background: C.card2, border: `1px solid ${C.green}`, color: C.text, fontWeight: 700 }} />
                              <button onClick={() => commitEdit("qty", row.ingredient)} style={{ background: "none", border: "none" }}><Check className="w-3.5 h-3.5" style={{ color: C.green }} /></button>
                              <button onClick={() => { setEditingQty(null); setTempVal(""); }} style={{ background: "none", border: "none" }}><X className="w-3.5 h-3.5" style={{ color: C.muted }} /></button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <button onClick={() => adjustQty(row.ingredient, -1)}
                                className="w-6 h-6 rounded-lg flex items-center justify-center"
                                style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${C.border}`, color: C.muted }}>
                                <Minus className="w-3 h-3" />
                              </button>
                              <button onClick={() => { setEditingQty(row.ingredient); setTempVal(String(qty)); }}
                                className="min-w-[3.5rem] text-center text-sm group flex items-center gap-1 justify-center"
                                style={{ background: "none", border: "none", color: qty === 0 ? C.dim : C.green, fontWeight: 700 }}>
                                {Number(qty).toFixed(2)} {row.unit}
                                <Edit3 className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: C.cyan }} />
                              </button>
                              <button onClick={() => adjustQty(row.ingredient, 1)}
                                className="w-6 h-6 rounded-lg flex items-center justify-center"
                                style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${C.border}`, color: C.muted }}>
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="text-xs" style={{ color: C.dim }}>{row.reason}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="px-5 py-4 flex items-center justify-between gap-3" style={{ borderTop: `1px solid ${C.border}` }}>
              <div className="flex items-center gap-3 min-w-0">
                <p className="text-xs shrink-0" style={{ color: C.dim }}>{uploadedCount}/7 days uploaded · {suggestions.length} ingredients tracked</p>
                {uploadedCount >= 7 && (
                  weekConfirmed ? (
                    <span className="flex items-center gap-1 text-xs shrink-0" style={{ color: C.green, fontWeight: 600 }}>
                      <Check className="w-3 h-3" /> Week confirmed
                    </span>
                  ) : (
                    <button
                      onClick={confirmWeek}
                      disabled={confirmingWeek}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs hover:opacity-90 disabled:opacity-50 shrink-0"
                      style={{ background: `${C.green}18`, border: `1px solid ${C.green}55`, color: C.green, fontWeight: 700 }}>
                      {confirmingWeek ? "Saving…" : "✓ Confirm This Week"}
                    </button>
                  )
                )}
              </div>
              <button onClick={exportCSV}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm hover:opacity-90 shrink-0"
                style={{ background: "rgba(62,217,196,0.1)", border: `1px solid rgba(62,217,196,0.25)`, color: C.cyan, fontWeight: 600 }}>
                <Download className="w-3.5 h-3.5" /> Export Order List
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
