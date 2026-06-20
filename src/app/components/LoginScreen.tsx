import { useState, useEffect } from "react";
import { Mail, Lock, User, Eye, EyeOff } from "lucide-react";
import LogoBNJG from "@/assets/LogoBNJG.png";
import { supabase } from "@/lib/supabase";

const C = {
  bg: "#0D1520",
  card: "#111D2E",
  border: "rgba(62,217,196,0.09)",
  cyan: "#3ED9C4",
  green: "#4DECD8",
  yellow: "#F5A623",
  text: "#EEF5F8",
  muted: "rgba(200,225,235,0.50)",
  input: "#152338",
};

// ─── Constellation ────────────────────────────────────────────────────────────
// Nodes in a 160×90 coordinate space (matches 16:9 viewBox)
const NODES = [
  { x: 10,  y: 8,  r: 1.2, dur: 3.5, del: 0.0 },
  { x: 35,  y: 4,  r: 1.8, dur: 4.2, del: 0.8 },
  { x: 62,  y: 10, r: 1.2, dur: 3.8, del: 1.5 },
  { x: 88,  y: 5,  r: 2.8, dur: 5.0, del: 0.3 }, // hub
  { x: 114, y: 10, r: 1.5, dur: 3.6, del: 2.1 },
  { x: 140, y: 4,  r: 1.8, dur: 4.5, del: 0.6 },
  { x: 156, y: 13, r: 1.0, dur: 3.2, del: 1.9 },
  { x: 5,   y: 27, r: 1.2, dur: 4.0, del: 1.8 },
  { x: 24,  y: 32, r: 1.5, dur: 3.7, del: 0.4 },
  { x: 50,  y: 26, r: 2.0, dur: 4.8, del: 2.0 },
  { x: 72,  y: 33, r: 1.2, dur: 3.4, del: 1.2 },
  { x: 98,  y: 26, r: 2.8, dur: 5.5, del: 0.9 }, // hub
  { x: 124, y: 33, r: 1.5, dur: 3.9, del: 2.5 },
  { x: 150, y: 27, r: 1.2, dur: 4.3, del: 1.0 },
  { x: 16,  y: 50, r: 1.5, dur: 3.6, del: 2.2 },
  { x: 40,  y: 54, r: 1.8, dur: 4.1, del: 0.5 },
  { x: 66,  y: 48, r: 1.2, dur: 3.3, del: 1.7 },
  { x: 90,  y: 54, r: 2.8, dur: 5.2, del: 0.2 }, // hub
  { x: 112, y: 48, r: 1.5, dur: 4.0, del: 2.8 },
  { x: 136, y: 54, r: 1.8, dur: 3.8, del: 1.4 },
  { x: 158, y: 48, r: 1.0, dur: 4.6, del: 0.7 },
  { x: 22,  y: 72, r: 1.5, dur: 4.2, del: 1.6 },
  { x: 50,  y: 77, r: 1.2, dur: 3.5, del: 0.3 },
  { x: 78,  y: 72, r: 1.8, dur: 4.8, del: 2.0 },
  { x: 108, y: 77, r: 1.2, dur: 3.7, del: 1.1 },
  { x: 136, y: 72, r: 1.5, dur: 4.4, del: 0.5 },
  { x: 155, y: 77, r: 1.0, dur: 3.9, del: 2.3 },
];

const EDGES: [number, number][] = [
  // row 0
  [0,1],[1,2],[2,3],[3,4],[4,5],[5,6],
  // row 1
  [7,8],[8,9],[9,10],[10,11],[11,12],[12,13],
  // row 2
  [14,15],[15,16],[16,17],[17,18],[18,19],[19,20],
  // row 3
  [21,22],[22,23],[23,24],[24,25],[25,26],
  // row 0→1
  [0,7],[0,8],[1,8],[1,9],[2,9],[2,10],[3,10],[3,11],[4,11],[4,12],[5,12],[5,13],[6,13],
  // row 1→2
  [7,14],[8,14],[8,15],[9,15],[9,16],[10,16],[11,17],[11,16],[12,18],[12,19],[13,19],[13,20],
  // row 2→3
  [14,21],[15,21],[15,22],[16,22],[16,23],[17,23],[17,24],[18,24],[18,25],[19,25],[20,26],
  // diagonals for richness
  [1,9],[3,10],[5,12],[8,16],[11,18],[3,11],[10,17],[16,23],[18,25],
];

// ─── Rotating facts ────────────────────────────────────────────────────────────
const FACTS = [
  "1 in 3 ingredients ordered never reaches a customer's plate",
  "Reducing waste by 20% can save a kitchen over $1,200 per month",
  "AI-tracked kitchens cut spoilage by up to 35% per week",
  "Smart stock alerts reduce your busiest night's waste by 40%",
  "The average data-driven kitchen saves 2.4 kg of food every day",
  "Precise ordering eliminates over-buying by up to one third",
];

const LOADING_MSGS = [
  "Firing up the kitchen…",
  "Checking your stock levels…",
  "Prepping your dashboard…",
  "Plating your analytics…",
  "Almost ready to serve…",
];

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

interface LoginScreenProps {
  onLogin: (hasCookbook: boolean) => void;
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState(LOADING_MSGS[0]);
  const [error, setError] = useState("");
  const [factIdx, setFactIdx] = useState(0);
  const [factVisible, setFactVisible] = useState(true);

  const [ph] = useState(() => ({
    restaurant: randomFrom(["Trattoria Verde", "Casa Mia", "The Salty Spoon", "Bella Cucina"]),
    email: randomFrom(["chef@trattoria.com", "manager@casemia.com", "hello@kitchen.io"]),
  }));

  useEffect(() => {
    const id = setInterval(() => {
      setFactVisible(false);
      setTimeout(() => { setFactIdx(i => (i + 1) % FACTS.length); setFactVisible(true); }, 380);
    }, 4200);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!loading) return;
    let i = 0;
    const id = setInterval(() => { i = (i + 1) % LOADING_MSGS.length; setLoadingMsg(LOADING_MSGS[i]); }, 900);
    return () => clearInterval(id);
  }, [loading]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    setLoadingMsg(LOADING_MSGS[0]);
    try {
      if (tab === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.user) {
          const { error: ie } = await supabase
            .from("managers")
            .insert({ id: data.user.id, email, restaurant_name: name });
          if (ie) throw ie;
        }
      }
      const { data: { session: s } } = await supabase.auth.getSession();
      const { count } = await supabase
        .from("menus").select("id", { count: "exact", head: true })
        .eq("manager_id", s!.user.id);
      onLogin(count != null && count > 0);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message
        : typeof err === "object" && err !== null && "message" in err
        ? String((err as { message: unknown }).message)
        : JSON.stringify(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  const inputStyle = {
    background: C.input,
    border: `1px solid ${C.border}`,
    color: C.text,
    width: "100%",
    padding: "0.75rem 1rem 0.75rem 2.5rem",
    borderRadius: "0.75rem",
    fontSize: "0.875rem",
    outline: "none",
  };

  return (
    <>
      <style>{`
        @keyframes nodeBreath {
          0%, 100% { opacity: var(--lo, 0.10); }
          50%       { opacity: var(--hi, 0.65); }
        }
        @keyframes haloBreath {
          0%, 100% { opacity: 0; }
          50%       { opacity: 0.07; }
        }
        @keyframes lineBreath {
          0%, 100% { opacity: 0.03; }
          50%       { opacity: 0.13; }
        }
        @keyframes cardIn {
          from { opacity: 0; transform: translateY(20px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0)   scale(1);    }
        }
        @keyframes logoPulse {
          0%, 100% { box-shadow: 0 0  0px  0px rgba(62,217,196,0.00); }
          50%       { box-shadow: 0 0 30px 12px rgba(62,217,196,0.38), 0 0 60px 24px rgba(27,63,122,0.22); }
        }
        @keyframes gradShift {
          0%   { background-position: 0%   50%; }
          50%  { background-position: 100% 50%; }
          100% { background-position: 0%   50%; }
        }
        @keyframes orbDrift {
          0%, 100% { transform: translate(0, 0); }
          33%       { transform: translate(18px, -14px); }
          66%       { transform: translate(-12px, 10px); }
        }
        .login-card  { animation: cardIn 0.55s cubic-bezier(.22,.68,0,1.25) both; }
        .login-logo  { animation: logoPulse 3.5s ease-in-out infinite; }
        .login-btn {
          background: linear-gradient(120deg, ${C.cyan}, #5AEAFF, ${C.green}, ${C.cyan});
          background-size: 300% 100%;
          animation: gradShift 4s ease infinite;
          transition: transform .15s, box-shadow .15s;
        }
        .login-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(62,217,196,0.28);
        }
        .login-btn:active:not(:disabled) { transform: scale(0.98); }
        .fact-text { transition: opacity 0.35s ease; }
        .login-tab {
          flex: 1; padding: 1rem; font-size: .875rem; background: none; border: none;
          border-bottom: 2px solid transparent; cursor: pointer; transition: color .2s, border-color .2s;
        }
      `}</style>

      <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden"
        style={{ background: C.bg }}>

        {/* ── constellation SVG ──────────────────────────────────────────── */}
        <svg
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
          viewBox="0 0 160 90"
          preserveAspectRatio="xMidYMid slice"
        >
          {/* Connection lines */}
          {EDGES.map(([a, b], i) => (
            <line
              key={i}
              x1={NODES[a].x} y1={NODES[a].y}
              x2={NODES[b].x} y2={NODES[b].y}
              stroke={C.cyan} strokeWidth="0.25"
              style={{ animationDuration: `${3.2 + (i % 7) * 0.6}s`, animationDelay: `${(i % 11) * 0.3}s`, animationTimingFunction: "ease-in-out", animationIterationCount: "infinite", animationName: "lineBreath" }}
            />
          ))}

          {/* Nodes */}
          {NODES.map((n, i) => (
            <g key={i}>
              {/* soft halo for hub nodes */}
              {n.r >= 2 && (
                <circle
                  cx={n.x} cy={n.y} r={n.r * 4}
                  fill={C.cyan}
                  style={{ animationName: "haloBreath", animationDuration: `${n.dur}s`, animationDelay: `${n.del}s`, animationTimingFunction: "ease-in-out", animationIterationCount: "infinite" }}
                />
              )}
              <circle
                cx={n.x} cy={n.y} r={n.r}
                fill={n.r >= 2 ? C.cyan : "rgba(91,238,252,0.9)"}
                style={{
                  ["--lo" as string]: n.r >= 2 ? "0.2" : "0.08",
                  ["--hi" as string]: n.r >= 2 ? "0.85" : "0.55",
                  animationName: "nodeBreath",
                  animationDuration: `${n.dur}s`,
                  animationDelay: `${n.del}s`,
                  animationTimingFunction: "ease-in-out",
                  animationIterationCount: "infinite",
                }}
              />
            </g>
          ))}
        </svg>

        {/* ── ambient glow orbs ──────────────────────────────────────────── */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: "12%", left: "48%", width: 560, height: 340, transform: "translateX(-50%)", background: `radial-gradient(ellipse, rgba(62,217,196,0.07) 0%, transparent 68%)`, filter: "blur(18px)", animation: "orbDrift 12s ease-in-out infinite" }} />
          <div style={{ position: "absolute", bottom: "18%", left: "22%", width: 380, height: 260, background: `radial-gradient(ellipse, rgba(27,63,122,0.18) 0%, transparent 68%)`, filter: "blur(24px)", animation: "orbDrift 16s ease-in-out 4s infinite" }} />
          <div style={{ position: "absolute", top: "45%", right: "12%", width: 300, height: 220, background: `radial-gradient(ellipse, rgba(62,217,196,0.05) 0%, transparent 68%)`, filter: "blur(18px)", animation: "orbDrift 14s ease-in-out 8s infinite" }} />
        </div>

        {/* ── page content ───────────────────────────────────────────────── */}
        <div className="w-full max-w-md" style={{ position: "relative", zIndex: 1 }}>

          {/* logo + title */}
          <div className="text-center mb-8">
            <img
              src={LogoBNJG}
              alt="BNJG"
              className="login-logo inline-block mb-4"
              style={{ width: 72, height: 72, borderRadius: 16, objectFit: "cover" }}
            />
            <h1 style={{
              fontSize: "1.75rem", fontWeight: 700,
              background: `linear-gradient(110deg, ${C.cyan} 0%, #5AEAFF 50%, ${C.green} 100%)`,
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
            }}>
              BNJGFoodSolutions
            </h1>
            <p style={{ color: C.muted, fontSize: "0.875rem", marginTop: "0.25rem" }}>
              AI-powered food waste reduction for restaurants
            </p>
          </div>

          {/* card */}
          <div className="login-card rounded-2xl overflow-hidden"
            style={{ background: C.card, border: `1px solid ${C.border}` }}>

            {/* tabs */}
            <div className="flex" style={{ borderBottom: `1px solid ${C.border}` }}>
              {(["login", "signup"] as const).map((t) => (
                <button
                  key={t}
                  className="login-tab"
                  onClick={() => { setTab(t); setError(""); }}
                  style={{
                    color: tab === t ? C.cyan : C.muted,
                    borderBottomColor: tab === t ? C.cyan : "transparent",
                    fontWeight: tab === t ? 600 : 400,
                  }}
                >
                  {t === "login" ? "Sign In" : "Create Account"}
                </button>
              ))}
            </div>

            {/* form */}
            <div className="p-8">
              <form onSubmit={handleSubmit} className="space-y-5">

                {tab === "signup" && (
                  <div>
                    <label className="block text-sm mb-1.5" style={{ color: C.muted, fontWeight: 500 }}>
                      Restaurant Name
                    </label>
                    <div className="relative">
                      <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: C.muted }} />
                      <input
                        type="text" placeholder={ph.restaurant} value={name}
                        onChange={e => setName(e.target.value)}
                        style={{ ...inputStyle, paddingLeft: "2.5rem" }}
                        onFocus={e => (e.target.style.borderColor = C.cyan)}
                        onBlur={e => (e.target.style.borderColor = C.border)}
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm mb-1.5" style={{ color: C.muted, fontWeight: 500 }}>
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: C.muted }} />
                    <input
                      type="email" placeholder={ph.email} value={email}
                      onChange={e => setEmail(e.target.value)}
                      style={{ ...inputStyle, paddingLeft: "2.5rem" }}
                      onFocus={e => (e.target.style.borderColor = C.cyan)}
                      onBlur={e => (e.target.style.borderColor = C.border)}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm mb-1.5" style={{ color: C.muted, fontWeight: 500 }}>
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: C.muted }} />
                    <input
                      type={showPassword ? "text" : "password"} placeholder="••••••••" value={password}
                      onChange={e => setPassword(e.target.value)}
                      style={{ ...inputStyle, paddingLeft: "2.5rem", paddingRight: "2.75rem" }}
                      onFocus={e => (e.target.style.borderColor = C.cyan)}
                      onBlur={e => (e.target.style.borderColor = C.border)}
                    />
                    <button type="button" onClick={() => setShowPassword(v => !v)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 transition-colors"
                      style={{ background: "none", border: "none", color: C.muted }}>
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="login-btn w-full py-3.5 rounded-xl text-sm disabled:opacity-60"
                  style={{ color: C.bg, fontWeight: 700, border: "none", cursor: loading ? "not-allowed" : "pointer" }}
                >
                  {loading ? loadingMsg : tab === "login" ? "Sign In to Dashboard" : "Create Account"}
                </button>
              </form>

              <p
                className="fact-text text-center text-xs mt-6"
                style={{ color: "rgba(255,255,255,0.27)", opacity: error ? 0 : factVisible ? 1 : 0, minHeight: "1.25rem" }}
              >
                {FACTS[factIdx]}
              </p>
              {error && (
                <p className="text-center text-xs mt-6" style={{ color: "#ff6b6b" }}>{error}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
