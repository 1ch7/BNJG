import React, { useState, useEffect, useRef } from "react";
import {
  LayoutDashboard, UploadCloud, AlertTriangle, BarChart2,
  LogOut, Settings, ChevronRight, X, User, Lock, Save,
  Eye, EyeOff, Check, Store,
} from "lucide-react";
import LogoBNJG from "@/assets/LogoBNJG.png";
import type { View } from "./types";
import { supabase } from "@/lib/supabase";

export type { View };

const C = {
  bg: "#0D1520", card: "#111D2E", card2: "#152338", border: "rgba(62,217,196,0.09)",
  cyan: "#3ED9C4", green: "#4DECD8", yellow: "#F5A623",
  text: "#EEF5F8", muted: "rgba(200,225,235,0.50)",
};

interface SidebarProps {
  activeView: View;
  onNavigate: (view: View) => void;
  onLogout: () => void;
}

const NAV_ITEMS: { id: View; label: string; icon: React.ElementType }[] = [
  { id: "dashboard",  label: "Dashboard",          icon: LayoutDashboard },
  { id: "sales",      label: "Daily Sales",         icon: UploadCloud },
  { id: "alerts",     label: "Inventory Alerts",    icon: AlertTriangle },
  { id: "analytics",  label: "Analytics & Trends",  icon: BarChart2 },
];

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?";
}

export function Sidebar({ activeView, onNavigate, onLogout }: SidebarProps) {
  const [alertCount, setAlertCount]     = useState(0);
  const [restaurantName, setRestaurantName] = useState("");
  const [email, setEmail]               = useState("");
  const [showSettings, setShowSettings] = useState(false);

  // settings form state
  const [editName, setEditName]         = useState("");
  const [nameMsg, setNameMsg]           = useState<{ ok: boolean; txt: string } | null>(null);
  const [savingName, setSavingName]     = useState(false);

  const [newPw, setNewPw]               = useState("");
  const [confirmPw, setConfirmPw]       = useState("");
  const [showPw, setShowPw]             = useState(false);
  const [pwMsg, setPwMsg]               = useState<{ ok: boolean; txt: string } | null>(null);
  const [savingPw, setSavingPw]         = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);

  // ── fetch profile ──────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setEmail(session.user.email ?? "");
      const { data } = await supabase
        .from("managers")
        .select("restaurant_name")
        .eq("id", session.user.id)
        .single();
      const name = data?.restaurant_name ?? "";
      setRestaurantName(name);
      setEditName(name);
    })();
  }, []);

  // ── alert badge ───────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { count } = await supabase
        .from("overstock_alerts")
        .select("*", { count: "exact", head: true })
        .eq("manager_id", session.user.id)
        .neq("status", "dismissed");
      setAlertCount(count ?? 0);
    })();
  }, [activeView]);

  // ── close on outside click or Esc ─────────────────────────────────────────
  useEffect(() => {
    if (!showSettings) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowSettings(false); };
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setShowSettings(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onClick); };
  }, [showSettings]);

  // ── save restaurant name ───────────────────────────────────────────────────
  async function saveName() {
    const name = editName.trim();
    if (!name) return;
    setSavingName(true); setNameMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not signed in");
      const { error } = await supabase
        .from("managers")
        .update({ restaurant_name: name })
        .eq("id", session.user.id);
      if (error) throw error;
      setRestaurantName(name);
      setNameMsg({ ok: true, txt: "Saved!" });
    } catch (e) {
      setNameMsg({ ok: false, txt: e instanceof Error ? e.message : "Error" });
    } finally {
      setSavingName(false);
    }
  }

  // ── change password ────────────────────────────────────────────────────────
  async function changePassword() {
    if (newPw.length < 6) { setPwMsg({ ok: false, txt: "At least 6 characters" }); return; }
    if (newPw !== confirmPw) { setPwMsg({ ok: false, txt: "Passwords don't match" }); return; }
    setSavingPw(true); setPwMsg(null);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) throw error;
      setNewPw(""); setConfirmPw("");
      setPwMsg({ ok: true, txt: "Password updated!" });
    } catch (e) {
      setPwMsg({ ok: false, txt: e instanceof Error ? e.message : "Error" });
    } finally {
      setSavingPw(false);
    }
  }

  const inp: React.CSSProperties = {
    width: "100%", padding: "0.5rem 0.75rem", borderRadius: "0.625rem",
    background: C.bg, border: `1px solid ${C.border}`, color: C.text,
    fontSize: "0.8rem", outline: "none",
  };

  return (
    <aside className="flex flex-col w-60 shrink-0 h-full" style={{ background: C.card, borderRight: `1px solid ${C.border}`, position: "relative" }}>

      {/* ── Logo ─────────────────────────────────────────────────────────── */}
      <div className="px-5 py-5" style={{ borderBottom: `1px solid ${C.border}` }}>
        <div className="flex items-center gap-2.5">
          <img src={LogoBNJG} alt="BNJG" style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover" }} />
          <div>
            <p className="leading-none" style={{ color: C.text, fontWeight: 700, fontSize: "0.8rem" }}>BNJGFood</p>
            <p className="leading-none mt-0.5" style={{ color: C.muted, fontSize: "0.65rem" }}>Solutions</p>
          </div>
        </div>
      </div>

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <p className="px-3 mb-2 uppercase tracking-wider" style={{ color: C.muted, fontSize: "0.6rem", fontWeight: 600 }}>Main Menu</p>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          const badge = item.id === "alerts" && alertCount > 0 ? alertCount : null;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left"
              style={{
                background: isActive ? "rgba(62,217,196,0.12)" : "transparent",
                color: isActive ? C.cyan : C.muted,
                border: isActive ? `1px solid rgba(62,217,196,0.25)` : "1px solid transparent",
              }}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="flex-1 text-sm" style={{ fontWeight: isActive ? 600 : 400 }}>{item.label}</span>
              {badge && !isActive && (
                <span className="flex items-center justify-center w-5 h-5 rounded-full shrink-0"
                  style={{ background: C.yellow, color: C.bg, fontSize: "0.6rem", fontWeight: 700 }}>
                  {badge}
                </span>
              )}
              {isActive && <ChevronRight className="w-3.5 h-3.5 opacity-70 shrink-0" />}
            </button>
          );
        })}
      </nav>

      {/* ── Bottom ───────────────────────────────────────────────────────── */}
      <div className="px-3 py-4 space-y-1" style={{ borderTop: `1px solid ${C.border}` }}>
        <button
          onClick={() => { setShowSettings(v => !v); setNameMsg(null); setPwMsg(null); }}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left"
          style={{
            background: showSettings ? "rgba(62,217,196,0.10)" : "none",
            color: showSettings ? C.cyan : C.muted,
            border: showSettings ? `1px solid rgba(62,217,196,0.22)` : "1px solid transparent",
          }}
        >
          <Settings className="w-4 h-4" />
          <span className="text-sm">Settings</span>
        </button>

        <div className="flex items-center gap-3 px-3 py-3 rounded-xl mt-2" style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}` }}>
          <div className="w-8 h-8 rounded-xl flex items-center justify-center text-xs shrink-0"
            style={{ background: `linear-gradient(135deg, ${C.cyan}, ${C.green})`, color: C.bg, fontWeight: 700 }}>
            {initials(restaurantName)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs truncate" style={{ color: C.text, fontWeight: 600 }}>{restaurantName || "My Restaurant"}</p>
            <p className="text-xs truncate" style={{ color: C.muted }}>{email}</p>
          </div>
          <button onClick={onLogout} className="shrink-0 transition-colors"
            style={{ background: "none", border: "none", color: C.muted }}>
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Settings panel (slides up from bottom) ───────────────────────── */}
      {showSettings && (
        <div
          ref={panelRef}
          style={{
            position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 50,
            background: C.card2, borderTop: `1px solid ${C.border}`,
            borderRadius: "1rem 1rem 0 0",
            boxShadow: "0 -8px 32px rgba(0,0,0,0.45)",
            maxHeight: "80vh", overflowY: "auto",
          }}
        >
          {/* header */}
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${C.border}` }}>
            <span style={{ color: C.text, fontWeight: 600, fontSize: "0.85rem" }}>Settings</span>
            <button onClick={() => setShowSettings(false)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}>
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="px-4 py-4 space-y-5">

            {/* ── Account ─────────────────────────────────────────────── */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Store className="w-3.5 h-3.5" style={{ color: C.cyan }} />
                <span style={{ color: C.muted, fontSize: "0.65rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>Account</span>
              </div>

              <div className="space-y-2">
                <label style={{ color: C.muted, fontSize: "0.72rem" }}>Restaurant Name</label>
                <div className="flex gap-2">
                  <input
                    value={editName}
                    onChange={e => { setEditName(e.target.value); setNameMsg(null); }}
                    onKeyDown={e => e.key === "Enter" && saveName()}
                    placeholder="Your restaurant name"
                    style={inp}
                    onFocus={e => (e.target.style.borderColor = C.cyan)}
                    onBlur={e => (e.target.style.borderColor = C.border)}
                  />
                  <button
                    onClick={saveName}
                    disabled={savingName || editName.trim() === restaurantName}
                    style={{
                      padding: "0.5rem 0.75rem", borderRadius: "0.625rem",
                      background: "rgba(62,217,196,0.15)", border: `1px solid rgba(62,217,196,0.25)`,
                      color: C.cyan, cursor: "pointer", flexShrink: 0,
                      opacity: savingName || editName.trim() === restaurantName ? 0.5 : 1,
                    }}
                  >
                    <Save className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div style={{ color: C.muted, fontSize: "0.72rem" }}>Email</div>
                <div style={{ ...inp, color: C.muted, cursor: "default", background: "rgba(255,255,255,0.03)" }}>{email}</div>

                {nameMsg && (
                  <p style={{ fontSize: "0.72rem", color: nameMsg.ok ? C.cyan : "#FF6B6B", display: "flex", alignItems: "center", gap: 4 }}>
                    {nameMsg.ok ? <Check className="w-3 h-3" /> : null}{nameMsg.txt}
                  </p>
                )}
              </div>
            </section>

            <div style={{ height: 1, background: C.border }} />

            {/* ── Security ────────────────────────────────────────────── */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Lock className="w-3.5 h-3.5" style={{ color: C.cyan }} />
                <span style={{ color: C.muted, fontSize: "0.65rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>Security</span>
              </div>

              <div className="space-y-2">
                <label style={{ color: C.muted, fontSize: "0.72rem" }}>New Password</label>
                <div className="relative">
                  <input
                    type={showPw ? "text" : "password"}
                    value={newPw}
                    onChange={e => { setNewPw(e.target.value); setPwMsg(null); }}
                    placeholder="Min. 6 characters"
                    style={{ ...inp, paddingRight: "2.25rem" }}
                    onFocus={e => (e.target.style.borderColor = C.cyan)}
                    onBlur={e => (e.target.style.borderColor = C.border)}
                  />
                  <button type="button" onClick={() => setShowPw(v => !v)}
                    style={{ position: "absolute", right: "0.6rem", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: C.muted, cursor: "pointer" }}>
                    {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>

                <label style={{ color: C.muted, fontSize: "0.72rem" }}>Confirm Password</label>
                <input
                  type={showPw ? "text" : "password"}
                  value={confirmPw}
                  onChange={e => { setConfirmPw(e.target.value); setPwMsg(null); }}
                  placeholder="Repeat new password"
                  style={inp}
                  onFocus={e => (e.target.style.borderColor = C.cyan)}
                  onBlur={e => (e.target.style.borderColor = C.border)}
                />

                <button
                  onClick={changePassword}
                  disabled={savingPw || !newPw}
                  style={{
                    width: "100%", padding: "0.55rem", borderRadius: "0.625rem",
                    background: "rgba(62,217,196,0.12)", border: `1px solid rgba(62,217,196,0.25)`,
                    color: C.cyan, fontWeight: 600, fontSize: "0.8rem", cursor: "pointer",
                    opacity: savingPw || !newPw ? 0.5 : 1,
                  }}
                >
                  {savingPw ? "Updating…" : "Update Password"}
                </button>

                {pwMsg && (
                  <p style={{ fontSize: "0.72rem", color: pwMsg.ok ? C.cyan : "#FF6B6B", display: "flex", alignItems: "center", gap: 4 }}>
                    {pwMsg.ok ? <Check className="w-3 h-3" /> : null}{pwMsg.txt}
                  </p>
                )}
              </div>
            </section>

            <div style={{ height: 1, background: C.border }} />

            {/* ── Sign out ─────────────────────────────────────────────── */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <User className="w-3.5 h-3.5" style={{ color: C.cyan }} />
                <span style={{ color: C.muted, fontSize: "0.65rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>Session</span>
              </div>
              <button
                onClick={() => { setShowSettings(false); onLogout(); }}
                style={{
                  width: "100%", padding: "0.55rem", borderRadius: "0.625rem",
                  background: "rgba(255,107,107,0.08)", border: "1px solid rgba(255,107,107,0.22)",
                  color: "#FF6B6B", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem",
                }}
              >
                <LogOut className="w-3.5 h-3.5" /> Sign Out
              </button>
            </section>

          </div>
        </div>
      )}
    </aside>
  );
}
