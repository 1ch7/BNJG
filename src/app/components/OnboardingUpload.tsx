import { useState, useRef } from "react";
import { Upload, FileText, CheckCircle, Leaf, ChefHat, Loader } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";

const C = {
  bg: "#0D1520", card: "#111D2E", border: "rgba(62,217,196,0.09)",
  cyan: "#3ED9C4", green: "#4DECD8", yellow: "#F5A623",
  text: "#EEF5F8", muted: "rgba(200,225,235,0.50)", input: "#152338",
};

interface OnboardingUploadProps {
  onComplete: () => void;
}

type UploadState = "idle" | "dragging" | "uploading" | "analyzing" | "done";

interface ImportRow {
  menu_item: string;
  category: string;
  ingredient: string;
  quantity: number;
  unit: string;
}

interface MasterRow {
  ingredient: string;
  unit: string;
  initial_stock: number;
  reorder_level: number;
}

export function OnboardingUpload({ onComplete }: OnboardingUploadProps) {
  const [state, setState] = useState<UploadState>("idle");
  const [fileName, setFileName] = useState("");
  const [progress, setProgress] = useState(0);
  const [extracted, setExtracted] = useState<{ dish: string; ingredients: string[] }[]>([]);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    setFileName(file.name);
    setState("uploading");
    setProgress(0);
    setError("");

    try {
      const arrayBuffer = await file.arrayBuffer();
      setProgress(35);

      const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });

      console.log("[Cookbook] Sheet names found:", wb.SheetNames);

      // ── flexible sheet matching (case-insensitive) ────────────────────────
      const findSheet = (target: string) =>
        wb.SheetNames.find(n => n.toLowerCase().includes(target.toLowerCase())) ?? null;

      const importSheetName     = findSheet("Import") ?? findSheet("Data") ?? wb.SheetNames[0] ?? null;
      const ingredientSheetName = findSheet("Ingredient") ?? findSheet("Master") ?? wb.SheetNames[1] ?? null;

      if (!importSheetName || !wb.Sheets[importSheetName]) {
        throw new Error(`Cannot find import sheet. Sheets in file: ${wb.SheetNames.join(", ") || "(none)"}`);
      }
      if (!ingredientSheetName || !wb.Sheets[ingredientSheetName]) {
        throw new Error(`Cannot find ingredients sheet. Sheets in file: ${wb.SheetNames.join(", ") || "(none)"}`);
      }

      // ── scan raw rows to find the actual header row ───────────────────────
      // Returns the row index where the most keywords appear (scans first 20 rows)
      function findHeaderRow(sheet: XLSX.WorkSheet, keywords: string[]): number {
        const raw = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" });
        let best = 0, bestScore = 0;
        for (let i = 0; i < Math.min(raw.length, 20); i++) {
          const rowStr = raw[i].map(c => String(c).toLowerCase().replace(/[\s_\-/()]+/g, "")).join("|");
          const score = keywords.filter(k => rowStr.includes(k)).length;
          if (score > bestScore) { bestScore = score; best = i; }
        }
        return best;
      }

      // ── normalize column name → standard key ─────────────────────────────
      // Maps whatever is in the file's header row to the keys we need
      function normalizeKey(raw: string): string {
        return raw.toLowerCase().replace(/[\s_\-/()]+/g, "");
      }
      const IMPORT_COL: Record<string, keyof ImportRow> = {
        menuitem: "menu_item", menu: "menu_item", dish: "menu_item", item: "menu_item", dishname: "menu_item", recipe: "menu_item",
        category: "category", type: "category",
        ingredient: "ingredient", ingredients: "ingredient", ingredientname: "ingredient",
        quantity: "quantity", qty: "quantity", amount: "quantity", quantityperserving: "quantity", quantityused: "quantity",
        unit: "unit", uom: "unit", measurementunit: "unit",
      };
      const MASTER_COL: Record<string, keyof MasterRow> = {
        ingredient: "ingredient", ingredientname: "ingredient", name: "ingredient", itemname: "ingredient",
        unit: "unit", uom: "unit", measurementunit: "unit",
        initialstock: "initial_stock", openingstock: "initial_stock", stock: "initial_stock", currentstock: "initial_stock",
        reorderlevel: "reorder_level", reorder: "reorder_level", minstock: "reorder_level",
      };

      function parseSheet<T extends object>(
        sheet: XLSX.WorkSheet,
        colMap: Record<string, keyof T>,
        keywords: string[]
      ): T[] {
        const headerRow = findHeaderRow(sheet, keywords);
        const raw = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" });
        const headers = (raw[headerRow] ?? []).map(h => normalizeKey(String(h)));
        const results: T[] = [];
        for (let i = headerRow + 1; i < raw.length; i++) {
          const cells = raw[i] as unknown[];
          const obj: Partial<T> = {};
          headers.forEach((h, idx) => {
            const mapped = colMap[h];
            if (mapped !== undefined && cells[idx] !== "" && cells[idx] !== undefined) {
              (obj as Record<string, unknown>)[mapped as string] = cells[idx];
            }
          });
          results.push(obj as T);
        }
        return results;
      }

      const importRows = parseSheet<ImportRow>(
        wb.Sheets[importSheetName],
        IMPORT_COL,
        ["menu", "ingredient", "quantity", "unit"]
      ).filter(r => r.menu_item && String(r.menu_item).trim() !== "");

      const masterRows = parseSheet<MasterRow>(
        wb.Sheets[ingredientSheetName],
        MASTER_COL,
        ["ingredient", "unit", "stock"]
      ).filter(r => r.ingredient && r.unit && String(r.ingredient).trim() !== "");

      console.log("[Cookbook] importRows:", importRows.length, importRows.slice(0, 3));
      console.log("[Cookbook] masterRows:", masterRows.length, masterRows.slice(0, 3));

      if (importRows.length === 0) {
        const raw = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[importSheetName], { header: 1, defval: "" });
        throw new Error(
          `Parsed 0 rows from "${importSheetName}". ` +
          `Could not match columns — header row found: ${JSON.stringify(raw[findHeaderRow(wb.Sheets[importSheetName], ["menu","ingredient","quantity"])] ?? [])}`
        );
      }
      if (masterRows.length === 0) {
        const raw = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[ingredientSheetName], { header: 1, defval: "" });
        throw new Error(
          `Parsed 0 rows from "${ingredientSheetName}". ` +
          `Could not match columns — header row found: ${JSON.stringify(raw[findHeaderRow(wb.Sheets[ingredientSheetName], ["ingredient","unit","stock"])] ?? [])}`
        );
      }

      setProgress(100);
      setState("analyzing");

      const { data: { session } } = await supabase.auth.getSession();
      const userId = session!.user.id;

      // Ensure the managers row exists — the signup insert can silently fail
      // (e.g. email-confirmation pending, RLS timing) which breaks the FK on menus.
      const fallbackName = (session!.user.email ?? "").split("@")[0] || "My Restaurant";
      const { error: mgrErr } = await supabase
        .from("managers")
        .upsert(
          { id: userId, email: session!.user.email, restaurant_name: fallbackName },
          { onConflict: "id", ignoreDuplicates: true }
        );
      if (mgrErr) throw mgrErr;

      // Insert unique menus
      const uniqueMenus = Array.from(
        new Map(importRows.map(r => [r.menu_item, { name: r.menu_item, category: r.category }])).values()
      );
      const { data: menuData, error: menuError } = await supabase
        .from("menus")
        .insert(uniqueMenus.map(m => ({ manager_id: userId, name: m.name, category: m.category })))
        .select("id, name");
      if (menuError) throw menuError;
      const menuMap = new Map(menuData!.map(m => [m.name, m.id]));

      // Insert ingredients
      const { data: ingData, error: ingError } = await supabase
        .from("ingredients")
        .insert(masterRows.map(r => ({
          manager_id: userId,
          name: r.ingredient,
          unit: r.unit,
          initial_stock: r.initial_stock ?? 0,
          current_stock: 0,
          reorder_level: r.reorder_level ?? 0,
        })))
        .select("id, name");
      if (ingError) throw ingError;
      const ingMap = new Map(ingData!.map(i => [i.name, i.id]));

      // Insert recipes
      const recipes = importRows
        .filter(r => menuMap.has(r.menu_item) && ingMap.has(r.ingredient))
        .map(r => ({
          menu_id: menuMap.get(r.menu_item)!,
          ingredient_id: ingMap.get(r.ingredient)!,
          quantity_used: r.quantity,
        }));
      const { error: recipeError } = await supabase.from("recipes").insert(recipes);
      if (recipeError) throw recipeError;

      // Build display data grouped by menu item
      const grouped = new Map<string, string[]>();
      for (const row of importRows) {
        if (!grouped.has(row.menu_item)) grouped.set(row.menu_item, []);
        grouped.get(row.menu_item)!.push(row.ingredient);
      }
      setExtracted(Array.from(grouped.entries()).map(([dish, ingredients]) => ({ dish, ingredients })));

      setState("done");
    } catch (err: unknown) {
      console.error("Cookbook upload error:", err);
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : "Upload failed";
      setError(message);
      setState("idle");
    }
  };

  const uniqueIngredientCount = new Set(extracted.flatMap(e => e.ingredients)).size;

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: C.bg }}>
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-4" style={{ background: "rgba(62,217,196,0.1)", border: `1px solid rgba(62,217,196,0.25)` }}>
            <Leaf className="w-3.5 h-3.5" style={{ color: C.cyan }} />
            <span className="text-xs" style={{ color: C.cyan, fontWeight: 600 }}>Step 2 of 2 — Onboarding</span>
          </div>
          <h1 style={{ color: C.text, fontSize: "1.75rem", fontWeight: 700 }}>Upload Your Cookbook (SOP)</h1>
          <p style={{ color: C.muted, fontSize: "0.875rem", marginTop: "0.5rem" }}>
            Our AI extracts all ingredients per menu item to track your stock usage.
          </p>
        </div>

        <div className="rounded-2xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          {state === "idle" || state === "dragging" ? (
            <div className="p-8">
              <div
                onDragOver={(e) => { e.preventDefault(); setState("dragging"); }}
                onDragLeave={() => setState("idle")}
                onDrop={(e) => { e.preventDefault(); setState("idle"); const f = e.dataTransfer.files[0]; if (f) processFile(f); }}
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all"
                style={{
                  borderColor: state === "dragging" ? C.cyan : "rgba(62,217,196,0.25)",
                  background: state === "dragging" ? "rgba(62,217,196,0.05)" : "transparent",
                }}
              >
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{ background: "rgba(62,217,196,0.1)" }}>
                  <Upload className="w-7 h-7" style={{ color: C.cyan }} />
                </div>
                <p style={{ color: C.text, fontWeight: 600 }}>{state === "dragging" ? "Drop your file here" : "Drag & drop your cookbook"}</p>
                <p style={{ color: C.muted, fontSize: "0.875rem" }}>PDF, DOCX, or XLSX accepted</p>
                <input ref={fileRef} type="file" accept=".pdf,.docx,.xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); }} />
              </div>
              {error && (
                <p className="text-center text-xs mt-4" style={{ color: "#ff6b6b" }}>{error}</p>
              )}
            </div>
          ) : state === "uploading" ? (
            <div className="p-8 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{ background: "rgba(62,217,196,0.1)" }}>
                <FileText className="w-7 h-7" style={{ color: C.cyan }} />
              </div>
              <p style={{ color: C.text, fontWeight: 600 }}>{fileName}</p>
              <p style={{ color: C.muted, fontSize: "0.875rem", marginBottom: "1.5rem" }}>Uploading file…</p>
              <div className="w-full rounded-full h-2 mb-2 overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                <div className="h-2 rounded-full transition-all duration-200" style={{ width: `${progress}%`, background: `linear-gradient(90deg, ${C.cyan}, ${C.green})` }} />
              </div>
              <p style={{ color: C.muted, fontSize: "0.75rem" }}>{Math.round(progress)}%</p>
            </div>
          ) : state === "analyzing" ? (
            <div className="p-8 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{ background: "rgba(77,236,216,0.1)" }}>
                <Loader className="w-7 h-7 animate-spin" style={{ color: C.green }} />
              </div>
              <p style={{ color: C.text, fontWeight: 600 }}>Analyzing Cookbook…</p>
              <p style={{ color: C.muted, fontSize: "0.875rem" }}>AI is extracting ingredients from your menu items</p>
            </div>
          ) : (
            <div className="p-8">
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{ background: "rgba(77,236,216,0.1)" }}>
                  <CheckCircle className="w-7 h-7" style={{ color: C.green }} />
                </div>
                <p style={{ color: C.text, fontWeight: 600 }}>Cookbook Analyzed Successfully!</p>
                <p style={{ color: C.muted, fontSize: "0.875rem" }}>
                  Found <span style={{ color: C.cyan, fontWeight: 700 }}>{extracted.length} menu items</span> with <span style={{ color: C.green, fontWeight: 700 }}>{uniqueIngredientCount} unique ingredients</span>
                </p>
              </div>
              <div className="space-y-2 mb-6">
                {extracted.map((item) => (
                  <div key={item.dish} className="flex items-start gap-3 p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}` }}>
                    <ChefHat className="w-4 h-4 mt-0.5 shrink-0" style={{ color: C.cyan }} />
                    <div className="min-w-0">
                      <p className="text-sm" style={{ color: C.text, fontWeight: 600 }}>{item.dish}</p>
                      <p className="text-xs mt-0.5" style={{ color: C.muted }}>{item.ingredients.join(" · ")}</p>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={onComplete}
                className="w-full py-3.5 rounded-xl text-sm transition-all hover:opacity-90"
                style={{ background: `linear-gradient(135deg, ${C.cyan}, ${C.green})`, color: C.bg, fontWeight: 700 }}
              >
                Go to Dashboard →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
