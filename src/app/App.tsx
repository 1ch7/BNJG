import { useState, useEffect, useRef } from "react";
import { Toaster } from "@/app/components/ui/sonner";
import { supabase } from "@/lib/supabase";
import { LoginScreen } from "./components/LoginScreen";
import { OnboardingUpload } from "./components/OnboardingUpload";
import { Sidebar } from "./components/Sidebar";
import { DashboardOverview } from "./components/DashboardOverview";
import { DailySalesView } from "./components/DailySalesView";
import { InventoryAlertsView } from "./components/InventoryAlertsView";
import { AnalyticsView } from "./components/AnalyticsView";
import type { View } from "./components/types";

type AppState = "login" | "onboarding" | "app";

// ─── Interactive dot-grid background ─────────────────────────────────────────
function AppBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouse     = useRef({ x: -9999, y: -9999 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    let W = 0, H = 0, raf = 0, tick = 0;

    // ── grid dots ──────────────────────────────────────────────────────────
    const GAP = 40; // spacing between dots in px
    type Dot = { hx: number; hy: number; x: number; y: number };
    let dots: Dot[] = [];

    function buildGrid() {
      dots = [];
      const cols = Math.ceil(W / GAP) + 2;
      const rows = Math.ceil(H / GAP) + 2;
      for (let r = 0; r <= rows; r++)
        for (let c = 0; c <= cols; c++)
          dots.push({ hx: c * GAP, hy: r * GAP, x: c * GAP, y: r * GAP });
    }

    function resize() {
      W = canvas.width  = window.innerWidth;
      H = canvas.height = window.innerHeight;
      buildGrid();
    }
    resize();

    const REPEL   = 180;  // radius of mouse repulsion
    const MAX_D   = 55;   // max displacement (px)
    const LERP    = 0.13; // smoothing toward target position
    const SCAN_PERIOD = 300; // frames per full scan cycle

    function draw() {
      ctx.clearRect(0, 0, W, H);
      tick++;

      const mx = mouse.current.x;
      const my = mouse.current.y;

      // ── sweeping scan line (vertical bar, repeats every SCAN_PERIOD frames) ──
      const scanX = ((tick % SCAN_PERIOD) / SCAN_PERIOD) * (W + 120) - 60;

      // ── ambient breathing factor ────────────────────────────────────────
      const breath = 0.5 + 0.5 * Math.sin(tick * 0.018);

      for (const d of dots) {
        // ── repulsion from mouse ──────────────────────────────────────────
        const dx = d.hx - mx, dy = d.hy - my;
        const dist = Math.hypot(dx, dy);
        let repX = 0, repY = 0, mouseFactor = 0;
        if (dist < REPEL && dist > 0.5) {
          mouseFactor = 1 - dist / REPEL;
          const strength = Math.pow(mouseFactor, 1.6) * MAX_D;
          repX = (dx / dist) * strength;
          repY = (dy / dist) * strength;
        }

        // lerp current position → (home + repulsion)
        const tx = d.hx + repX;
        const ty = d.hy + repY;
        d.x += (tx - d.x) * LERP;
        d.y += (ty - d.y) * LERP;

        // ── scan-line brightening ─────────────────────────────────────────
        const scanDist = Math.abs(d.hx - scanX);
        const scanFactor = scanDist < 55 ? Math.pow(1 - scanDist / 55, 2) * 0.55 : 0;

        // ── final alpha & radius ──────────────────────────────────────────
        const alpha = Math.min(0.90, 0.14 + mouseFactor * 0.65 + scanFactor + breath * 0.05);
        const r     = 1.5 + mouseFactor * 2.5 + scanFactor * 1.5;

        // wide soft glow for dots strongly affected by mouse
        if (mouseFactor > 0.4) {
          ctx.beginPath();
          ctx.arc(d.x, d.y, r * 4, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(62,217,196,${mouseFactor * 0.10})`;
          ctx.fill();
        }

        // inner solid dot
        ctx.beginPath();
        ctx.arc(d.x, d.y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(62,217,196,${alpha})`;
        ctx.fill();
      }

      // ── large radial glow around cursor ─────────────────────────────────
      if (mx > -100 && mx < W + 100) {
        const g = ctx.createRadialGradient(mx, my, 0, mx, my, 220);
        g.addColorStop(0,   "rgba(62,217,196,0.09)");
        g.addColorStop(0.5, "rgba(27,63,122,0.04)");
        g.addColorStop(1,   "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }

      raf = requestAnimationFrame(draw);
    }

    draw();

    const onResize = () => resize();
    const onMove   = (e: MouseEvent) => { mouse.current = { x: e.clientX, y: e.clientY }; };
    const onLeave  = () => { mouse.current = { x: -9999, y: -9999 }; };
    window.addEventListener("resize", onResize);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseleave", onLeave);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed", inset: 0, width: "100%", height: "100%",
        zIndex: 0, background: "#0D1520", pointerEvents: "none",
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [appState, setAppState] = useState<AppState>("login");
  const [activeView, setActiveView] = useState<View>("dashboard");

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;
      const { count } = await supabase
        .from("menus")
        .select("id", { count: "exact", head: true })
        .eq("manager_id", session.user.id);
      setAppState(count && count > 0 ? "app" : "onboarding");
    });
  }, []);

  if (appState === "login") {
    return <LoginScreen onLogin={(hasCookbook) => setAppState(hasCookbook ? "app" : "onboarding")} />;
  }

  if (appState === "onboarding") {
    return <OnboardingUpload onComplete={() => setAppState("app")} />;
  }

  return (
    <>
      <Toaster position="bottom-right" theme="dark" richColors />
      <AppBackground />
      <div className="flex h-screen overflow-hidden" style={{ position: "relative", zIndex: 1 }}>
        <Sidebar
          activeView={activeView}
          onNavigate={setActiveView}
          onLogout={async () => {
            await supabase.auth.signOut();
            setAppState("login");
            setActiveView("dashboard");
          }}
        />
        {activeView === "dashboard" && <DashboardOverview onNavigate={setActiveView} />}
        {activeView === "sales" && <DailySalesView />}
        {activeView === "alerts" && <InventoryAlertsView />}
        {activeView === "analytics" && <AnalyticsView />}
      </div>
    </>
  );
}
