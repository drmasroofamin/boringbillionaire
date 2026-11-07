import React, { useState, useEffect, useCallback, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Bell,
  Search,
  SlidersHorizontal,
  ChevronDown,
  ChevronRight,
  X,
  Plus,
  Check,
  CheckCircle2,
  ShieldCheck,
  Wallet,
  LayoutDashboard,
  Heart,
  History,
  HelpCircle,
  LogOut,
  Zap,
  GraduationCap,
  Stethoscope,
  House,
  Smartphone,
  HandCoins,
  MapPin,
  Clock3,
  Sparkles,
  TrendingUp,
  Menu,
  Upload,
  FileText,
  LockKeyhole,
  CircleDollarSign,
  Globe,
  Users,
  Settings,
  LoaderCircle,
  Copy,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import "./styles.css";

type Role = "donor" | "general" | "admin";
type User = {
  id: number;
  name: string;
  email: string;
  mobile: string;
  role: Role;
  approved: number;
  kyc_status: string;
  location: string;
};
type Bill = {
  id: number;
  title: string;
  bill_type: string;
  amount: number;
  funded: number;
  due_date: string;
  biller: string;
  note: string;
  location: string;
  status: string;
  urgent: number;
  beneficiary: string;
  kyc_status: string;
  files: { id: number; content_type: string }[];
  preview_id: number | null;
  created_at: string;
};
type Tx = {
  id: string;
  bill_id: number | null;
  kind: string;
  amount: number;
  status: string;
  provider_id: string;
  created_at: string;
};
type WalletData = {
  balance: number;
  impact: number;
  bills_helped: number;
  demo_mode: boolean;
};
const money = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: n % 100 ? 2 : 0,
  }).format(n / 100);
const kinds: Record<
  string,
  { icon: LucideIcon; color: string; label: string }
> = {
  electricity: { icon: Zap, color: "amber", label: "Electricity" },
  "school fees": { icon: GraduationCap, color: "blue", label: "Education" },
  medical: { icon: Stethoscope, color: "rose", label: "Medical" },
  rent: { icon: House, color: "purple", label: "Rent" },
  "loan EMI": { icon: HandCoins, color: "mint", label: "Loan EMI" },
  phone: { icon: Smartphone, color: "sky", label: "Phone" },
  other: { icon: FileText, color: "slate", label: "Other" },
};
const initialToken = sessionStorage.getItem("bb-token") || "";
async function request(
  path: string,
  token: string = "",
  options: RequestInit = {},
) {
  const headers: Record<string, string> = {
    ...(!(options.body instanceof FormData)
      ? { "Content-Type": "application/json" }
      : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((options.headers as Record<string, string>) || {}),
  };
  const r = await fetch(`/api${path}`, { ...options, headers });
  if (!r.ok) {
    let data;
    try {
      data = await r.json();
    } catch {
      data = { detail: "The server is unavailable. Please try again." };
    }
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : "Please check the information you entered.",
    );
  }
  return r.json();
}
function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={`brand ${light ? "light" : ""}`}>
      <span className="brand-mark">
        <span>bb</span>
        <i />
      </span>
      <div>
        boring
        <span>
          billionaire<span className="brand-dot">.</span>
        </span>
      </div>
    </div>
  );
}
function App() {
  const [token, setToken] = useState(initialToken),
    [user, setUser] = useState<User | null>(null),
    [page, setPage] = useState("feed"),
    [bills, setBills] = useState<Bill[]>([]),
    [wallet, setWallet] = useState<WalletData>({
      balance: 0,
      impact: 0,
      bills_helped: 0,
      demo_mode: true,
    }),
    [txs, setTxs] = useState<Tx[]>([]),
    [notifications, setNotifications] = useState<
      { id: number; message: string }[]
    >([]),
    [adminUsers, setAdminUsers] = useState<User[]>([]),
    [disputes, setDisputes] = useState<
      { id: number; reason: string; transaction_id: string; status: string }[]
    >([]);
  const [selected, setSelected] = useState<Bill | null>(null),
    [modal, setModal] = useState(""),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [mobileNav, setMobileNav] = useState(false),
    [filter, setFilter] = useState("all"),
    [sort, setSort] = useState("recommended"),
    [query, setQuery] = useState(""),
    [location, setLocation] = useState("all"),
    [urgent, setUrgent] = useState(false),
    [newIds, setNewIds] = useState<number[]>([]),
    [connected, setConnected] = useState(false),
    [landing, setLanding] = useState(false),
    [authRole, setAuthRole] = useState<Role>("donor"),
    [signup, setSignup] = useState(false),
    [emailLogin, setEmailLogin] = useState(false),
    [otpStep, setOtpStep] = useState(false),
    [demoOTP, setDemoOTP] = useState(""),
    [mobile, setMobile] = useState(""),
    [topAmount, setTopAmount] = useState("10000"),
    [payAmount, setPayAmount] = useState(""),
    [paySuccess, setPaySuccess] = useState(false),
    [payoutAccount, setPayoutAccount] = useState<{
      status: string;
      provider: string;
      is_demo: boolean;
      reference: string | null;
    } | null>(null),
    [readiness, setReadiness] = useState<{
      ready_for_real_money: boolean;
      checks: { id: string; passed: boolean; requirement: string }[];
    } | null>(null);
  const notify = (s: string) => {
    setToast(s);
    setTimeout(() => setToast(""), 5000);
  };
  const refresh = useCallback(async () => {
    if (!token) return;
    const [u, b, w, t, n] = await Promise.all([
      request("/me", token),
      request("/bills", token),
      request("/wallet", token),
      request("/transactions", token),
      request("/notifications", token),
    ]);
    setUser(u);
    setPage((p) =>
      [
        "profile",
        "history",
        ...(u.role === "donor"
          ? ["feed", "impact", "wallet"]
          : u.role === "general"
            ? ["dashboard"]
            : ["admin", "members", "disputes", "readiness"]),
      ].includes(p)
        ? p
        : u.role === "donor"
          ? "feed"
          : u.role === "general"
            ? "dashboard"
            : "admin",
    );
    setBills((prev) => {
      if (prev.length) {
        const ids = b
          .filter((x: Bill) => !prev.some((p) => p.id === x.id))
          .map((x: Bill) => x.id);
        if (ids.length) {
          setNewIds(ids);
          setTimeout(() => setNewIds([]), 8000);
        }
      }
      return b;
    });
    setWallet(w);
    setTxs(t);
    setNotifications(n);
    if (u.role === "general")
      setPayoutAccount(await request("/payout-account", token));
    if (u.role === "admin") {
      setReadiness(await request("/admin/readiness", token));
      setAdminUsers(await request("/admin/users", token));
      setDisputes(await request("/admin/disputes", token));
    }
  }, [token]);
  useEffect(() => {
    if (token) {
      setLoading(true);
      refresh()
        .catch((e) => {
          setError(e.message);
          if (e.message.includes("Session")) logout();
        })
        .finally(() => setLoading(false));
    }
  }, [token, refresh]);
  useEffect(() => {
    if (!token) return;
    let ws: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout>;
    let alive = true;
    let heartbeat: ReturnType<typeof setInterval>;
    const connect = async () => {
      try {
        const { ticket } = await request("/realtime-ticket", token, {
          method: "POST",
        });
        if (!alive) return;
        ws = new WebSocket(
          `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/api/ws`,
        );
        ws.onopen = () => {
          ws!.send(JSON.stringify({ ticket }));
          setConnected(true);
          heartbeat = setInterval(() => {
            if (ws?.readyState === 1) ws.send("ping");
          }, 25000);
        };
        ws.onmessage = () => {
          refresh().catch(() => {});
        };
        ws.onclose = () => {
          setConnected(false);
          clearInterval(heartbeat);
          if (alive) retry = setTimeout(connect, 4000);
        };
        ws.onerror = () => ws?.close();
      } catch {
        if (alive) retry = setTimeout(connect, 5000);
      }
    };
    connect();
    return () => {
      alive = false;
      clearTimeout(retry);
      clearInterval(heartbeat);
      ws?.close();
    };
  }, [token, refresh]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>("[role=dialog]");
    const selector = "button:not(:disabled),input,textarea,select,[href]";
    const first = dialog?.querySelector<HTMLElement>(selector);
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setModal("");
        setError("");
      }
      if (e.key === "Tab" && dialog) {
        const items = [...dialog.querySelectorAll<HTMLElement>(selector)];
        const start = items[0],
          end = items[items.length - 1];
        if (e.shiftKey && document.activeElement === start) {
          e.preventDefault();
          end?.focus();
        } else if (!e.shiftKey && document.activeElement === end) {
          e.preventDefault();
          start?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [modal]);
  function logout() {
    setToken("");
    setUser(null);
    sessionStorage.removeItem("bb-token");
    setModal("");
    setPage("feed");
  }
  function go(p: string) {
    setPage(p);
    setMobileNav(false);
    setQuery("");
  }
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      if (signup) {
        const r = await request("/auth/signup", "", {
          method: "POST",
          body: JSON.stringify({
            name: f.get("name"),
            email: f.get("email"),
            password: f.get("password"),
            mobile: f.get("mobile") || null,
            role: authRole,
          }),
        });
        if (r.totp_uri) {
          setDemoOTP(r.totp_uri);
          notify("Account created. Save the authenticator setup URI below.");
        } else {
          setSignup(false);
          notify(r.message);
        }
        return;
      }
      if (authRole === "general" && !emailLogin) {
        if (!otpStep) {
          const r = await request("/auth/otp", "", {
            method: "POST",
            body: JSON.stringify({ mobile }),
          });
          setDemoOTP(r.demo_code || "");
          setOtpStep(true);
          return;
        }
        const r = await request("/auth/otp/verify", "", {
          method: "POST",
          body: JSON.stringify({
            mobile,
            code: f.get("code"),
            name: f.get("name") || "New member",
          }),
        });
        sessionStorage.setItem("bb-token", r.access_token);
        setToken(r.access_token);
        setUser(r.user);
      } else {
        const r = await request("/auth/login", "", {
          method: "POST",
          body: JSON.stringify({
            email: f.get("email"),
            password: f.get("password"),
            role: authRole,
            code: f.get("code") || "",
          }),
        });
        sessionStorage.setItem("bb-token", r.access_token);
        setToken(r.access_token);
        setUser(r.user);
      }
      setPage(
        authRole === "donor"
          ? "feed"
          : authRole === "general"
            ? "dashboard"
            : "admin",
      );
      setDemoOTP("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function demoLogin(role: Role) {
    setBusy(true);
    setError("");
    try {
      const r = await request("/auth/login", "", {
        method: "POST",
        body: JSON.stringify({
          email:
            role === "donor"
              ? "donor@example.com"
              : role === "admin"
                ? "admin@example.com"
                : "user@example.com",
          password: "DemoPass123!",
          role,
        }),
      });
      sessionStorage.setItem("bb-token", r.access_token);
      setToken(r.access_token);
      setUser(r.user);
      setPage(
        role === "donor" ? "feed" : role === "general" ? "dashboard" : "admin",
      );
      setLanding(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function action(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
      notify(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const displayed = bills
    .filter(
      (b) =>
        (page === "feed" ? b.status === "Live" : true) &&
        (filter === "all" || b.bill_type === filter) &&
        (!urgent || !!b.urgent) &&
        (location === "all" || b.location === location) &&
        (!query ||
          `${b.title} ${b.location} ${b.biller}`
            .toLowerCase()
            .includes(query.toLowerCase())),
    )
    .sort((a, b) =>
      sort === "low"
        ? a.amount - a.funded - (b.amount - b.funded)
        : sort === "high"
          ? b.amount - b.funded - (a.amount - a.funded)
          : sort === "due"
            ? a.due_date.localeCompare(b.due_date)
            : sort === "newest"
              ? b.id - a.id
              : b.urgent - a.urgent || a.id - b.id,
    );
  const liveCount = bills.filter((b) => b.status === "Live").length;
  function openBill(b: Bill) {
    setSelected(b);
    setPayAmount(String((b.amount - b.funded) / 100));
    setPaySuccess(false);
    setError("");
    setModal("bill");
  }
  function closeModal() {
    setModal("");
    setSelected(null);
    setError("");
  }
  async function makePayment() {
    if (!selected) return;
    const amount = Math.round(Number(payAmount) * 100);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a valid amount");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await request(`/bills/${selected.id}/pay`, token, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ amount }),
      });
      await refresh();
      setPaySuccess(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function uploadBill(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const file = data.get("file") as File;
    if (!file?.size) {
      setError("Please attach your bill document.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      let id = selected?.id;
      if (!id) {
        const b = await request("/bills", token, {
          method: "POST",
          body: JSON.stringify({
            title: data.get("title"),
            bill_type: data.get("bill_type"),
            amount: Math.round(Number(data.get("amount")) * 100),
            due_date: data.get("due_date"),
            biller: data.get("biller"),
            note: data.get("note"),
            location: data.get("location"),
          }),
        });
        id = b.id;
        setSelected(b);
      }
      const fd = new FormData();
      fd.append("file", file);
      await request(`/bills/${id}/file`, token, { method: "POST", body: fd });
      closeModal();
      await refresh();
      notify("Your bill was submitted for review.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function showDocument(id: number) {
    try {
      const r = await fetch(`/api/files/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error("Document unavailable");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      notify((e as Error).message);
    }
  }

  if (!token || !user) {
    return (
      <div className="auth-shell">
        <header className="public-header">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setLanding(true);
            }}
          >
            <Brand />
          </a>
          <div className="public-links">
            <button onClick={() => setLanding(true)}>Our mission</button>
            <span className="secure-tag">
              <ShieldCheck size={15} /> Built on kindness. Backed by trust.
            </span>
          </div>
        </header>
        {landing ? (
          <main className="landing">
            <div className="eyebrow">
              <Sparkles size={15} /> SMALL ACTS. EXTRAORDINARY IMPACT.
            </div>
            <h1>
              Being a billionaire
              <br />
              just got a little <em>less boring.</em>
            </h1>
            <p>
              Real people. Everyday bills. One less worry.
              <br />
              Turn your generosity into someone’s fresh start.
            </p>
            <div className="landing-buttons">
              <button
                className="btn gold"
                onClick={() => {
                  setLanding(false);
                  setAuthRole("donor");
                }}
              >
                Make someone’s day <ArrowUpRight size={18} />
              </button>
              <button
                className="btn white"
                onClick={() => {
                  setLanding(false);
                  setAuthRole("general");
                }}
              >
                I need a little help <ArrowRight size={18} />
              </button>
            </div>
            <div className="landing-grid">
              {[
                {
                  icon: FileText,
                  title: "A real bill. A real story.",
                  text: "Every request is reviewed before it reaches the community.",
                },
                {
                  icon: ShieldCheck,
                  title: "Kindness, with confidence.",
                  text: "Verified members, protected details, and a clear payment history.",
                },
                {
                  icon: Heart,
                  title: "A little goes a long way.",
                  text: "Cover a bill, or contribute what you can. Every rupee matters.",
                },
              ].map((x) => (
                <article key={x.title}>
                  <x.icon />
                  <h3>{x.title}</h3>
                  <p>{x.text}</p>
                </article>
              ))}
            </div>
            <div className="demo-notice">
              Interactive demo · No real money is transferred
            </div>
          </main>
        ) : (
          <main className="auth-layout">
            <section className="auth-story">
              <div className="eyebrow">
                <span className="tiny-star">✦</span> A LITTLE KINDNESS. A BIG
                DIFFERENCE.
              </div>
              <h1>
                Extraordinary people.
                <br />
                Perfectly ordinary
                <br />
                <em>bills.</em>
              </h1>
              <p>
                Help turn someone’s “how will I pay this?”
                <br />
                into “it’s taken care of.”
              </p>
              <div className="story-receipt">
                <div className="receipt-top">
                  <div className="category-icon amber">
                    <Zap size={24} />
                  </div>
                  <span className="badge green">
                    <CheckCircle2 size={13} /> A little lighter
                  </span>
                </div>
                <h3>
                  One less bill.
                  <br />
                  One more reason to smile.
                </h3>
                <div className="receipt-line" />
                <div className="receipt-bottom">
                  <span>A family’s electricity bill</span>
                  <strong>
                    ₹2,450 <CheckCircle2 size={17} />
                  </strong>
                </div>
              </div>
              <div className="story-footer">
                <ShieldCheck size={17} /> Verified bills. Private details. Real
                impact.
              </div>
            </section>
            <section className="auth-card">
              <span className="eyebrow">WELCOME TO THE GOOD SIDE</span>
              <h2>
                {signup ? "Let’s get you started." : "Good to have you here."}
              </h2>
              <p>
                {signup
                  ? "A few details. A world of possibility."
                  : "A little generosity looks good on you."}
              </p>
              <div className="role-tabs">
                {(["donor", "general", "admin"] as Role[]).map((r) => (
                  <button
                    className={authRole === r ? "active" : ""}
                    key={r}
                    onClick={() => {
                      setAuthRole(r);
                      setError("");
                      setOtpStep(false);
                      setSignup(false);
                      setDemoOTP("");
                    }}
                  >
                    {r === "donor"
                      ? "Billionaire"
                      : r === "general"
                        ? "General user"
                        : "Admin"}
                  </button>
                ))}
              </div>
              <form onSubmit={login}>
                {signup && (
                  <label>
                    Your name
                    <input name="name" required placeholder="Your full name" />
                  </label>
                )}
                {authRole === "general" && !signup && !emailLogin ? (
                  <>
                    <label>
                      Mobile number
                      <input
                        name="mobile"
                        value={mobile}
                        onChange={(e) => setMobile(e.target.value)}
                        pattern="[0-9]{10}"
                        maxLength={10}
                        required
                        placeholder="10-digit mobile number"
                      />
                    </label>
                    {otpStep && (
                      <>
                        <label>
                          Your name
                          <input
                            name="name"
                            placeholder="Your full name"
                            required
                          />
                        </label>
                        <label>
                          One-time password
                          <input
                            name="code"
                            required
                            placeholder="6-digit OTP"
                            pattern="[0-9]{6}"
                          />
                        </label>
                        {demoOTP && (
                          <div className="info-box">
                            Demo only — your OTP is <strong>{demoOTP}</strong>.
                            No SMS was sent.
                          </div>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <label>
                      Email address
                      <input
                        name="email"
                        type="email"
                        required
                        placeholder="you@example.com"
                      />
                    </label>
                    <label>
                      Password
                      <input
                        name="password"
                        type="password"
                        required
                        minLength={signup ? 10 : 1}
                        placeholder="Enter your password"
                      />
                    </label>
                    {signup && authRole === "general" && (
                      <label>
                        Mobile number
                        <input
                          name="mobile"
                          pattern="[0-9]{10}"
                          placeholder="10-digit number"
                        />
                      </label>
                    )}
                    {!signup && authRole === "donor" && (
                      <label>
                        Authenticator code{" "}
                        <small>(for accounts with 2FA)</small>
                        <input
                          name="code"
                          inputMode="numeric"
                          placeholder="6-digit code"
                        />
                      </label>
                    )}
                  </>
                )}
                {error && <div className="error-box">{error}</div>}
                {signup && demoOTP.startsWith("otpauth:") && (
                  <div className="info-box uri">
                    Save this secret URI in your authenticator app:
                    <code>{demoOTP}</code>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(demoOTP)}
                    >
                      Copy setup URI <Copy size={13} />
                    </button>
                  </div>
                )}
                <button disabled={busy} className="btn primary full">
                  {busy ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : signup ? (
                    "Create account"
                  ) : authRole === "general" && !emailLogin ? (
                    otpStep ? (
                      "Verify & sign in"
                    ) : (
                      "Send OTP"
                    )
                  ) : (
                    "Sign in"
                  )}
                  <ArrowRight size={17} />
                </button>
              </form>
              {authRole === "general" && !signup && (
                <p className="auth-switch">
                  <button
                    onClick={() => {
                      setEmailLogin(!emailLogin);
                      setError("");
                    }}
                  >
                    {emailLogin
                      ? "Use mobile + OTP instead"
                      : "Use email & password instead"}
                  </button>
                </p>
              )}
              {authRole !== "admin" && (
                <p className="auth-switch">
                  {signup ? "Already part of the good?" : "New around here?"}{" "}
                  <button
                    onClick={() => {
                      setSignup(!signup);
                      setError("");
                      setDemoOTP("");
                    }}
                  >
                    {signup ? "Sign in" : "Create an account"}
                  </button>
                </p>
              )}
              <div className="demo-divider">
                <span>EXPLORE THE DEMO</span>
              </div>
              <div className="demo-buttons">
                <button disabled={busy} onClick={() => demoLogin("donor")}>
                  <Heart size={15} /> Billionaire
                </button>
                <button disabled={busy} onClick={() => demoLogin("general")}>
                  <Users size={15} /> General user
                </button>
                <button disabled={busy} onClick={() => demoLogin("admin")}>
                  <ShieldCheck size={15} /> Admin
                </button>
              </div>
              <p className="demo-caption">
                Test accounts, simulated payments. No real money moves.
              </p>
            </section>
          </main>
        )}
        <footer className="public-footer">
          © {new Date().getFullYear()} Boring Billionaire. A little less
          boring. A lot more human.
          <span>
            Made for a kinder world <Heart size={12} />
          </span>
        </footer>
        {toast && (
          <div className="toast">
            <CheckCircle2 size={18} />
            {toast}
          </div>
        )}
      </div>
    );
  }
  const nav =
    user.role === "donor"
      ? [
          { key: "feed", label: "Live bills", icon: LayoutDashboard },
          { key: "impact", label: "My impact", icon: Heart },
          { key: "wallet", label: "My wallet", icon: Wallet },
          { key: "history", label: "Transactions", icon: History },
        ]
      : user.role === "general"
        ? [
            { key: "dashboard", label: "My dashboard", icon: LayoutDashboard },
            { key: "history", label: "Payment history", icon: History },
            { key: "profile", label: "My profile", icon: Users },
          ]
        : [
            { key: "admin", label: "Review bills", icon: LayoutDashboard },
            { key: "members", label: "Members & KYC", icon: Users },
            { key: "history", label: "All transactions", icon: History },
            { key: "disputes", label: "Disputes", icon: ShieldCheck },
            { key: "readiness", label: "Payment readiness", icon: LockKeyhole },
          ];
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <a
          className="brand-link"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go(
              user.role === "donor"
                ? "feed"
                : user.role === "general"
                  ? "dashboard"
                  : "admin",
            );
          }}
        >
          <Brand />
        </a>
        <div className="workspace-label">
          {user.role === "donor"
            ? "THE GOOD YOU CAN DO"
            : user.role === "general"
              ? "YOUR FRESH START"
              : "TRUST & SAFETY"}
        </div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.key}
              className={page === n.key ? "active" : ""}
              onClick={() => go(n.key)}
            >
              <n.icon size={19} />
              <span>{n.label}</span>
              {n.key === "feed" && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="kindness-card">
            <span>✦</span>
            <h4>
              Wealth is better
              <br />
              when it’s shared.
            </h4>
            <p>
              Big heart. Small gestures.
              <br />
              That’s the billionaire way.
            </p>
            <div className="mini-line" />
          </div>
          <button
            className="help-link"
            onClick={() => {
              setModal("help");
              setError("");
            }}
          >
            <HelpCircle size={18} /> A little help?
          </button>
          <button className="side-user" onClick={() => go("profile")}>
            <div className="avatar">
              {user.name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")}
            </div>
            <div>
              <strong>{user.name}</strong>
              <span>
                {user.role === "donor"
                  ? "Billionaire member"
                  : user.role === "general"
                    ? "Community member"
                    : "Administrator"}{" "}
                <ShieldCheck size={11} />
              </span>
            </div>
            <ChevronDown size={14} />
          </button>
        </div>
      </aside>
      {mobileNav && (
        <div className="nav-overlay" onClick={() => setMobileNav(false)} />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu icon-button"
              onClick={() => setMobileNav(!mobileNav)}
              aria-label="Open navigation"
            >
              <Menu size={22} />
            </button>
            <span className="breadcrumb">
              Your little corner of good <span>/</span>
              <strong>
                {nav.find((n) => n.key === page)?.label || "My profile"}
              </strong>
            </span>
          </div>
          <div className="topbar-right">
            <span className="demo-pill">DEMO MODE</span>
            <div
              className="header-wallet"
              onClick={() => go(user.role === "donor" ? "wallet" : "profile")}
            >
              {user.role === "donor" ? (
                <>
                  <Wallet size={15} />
                  <span>{money(wallet.balance)}</span>
                </>
              ) : (
                <>
                  <ShieldCheck size={15} />
                  <span>
                    {user.kyc_status === "verified"
                      ? "Verified member"
                      : "KYC pending"}
                  </span>
                </>
              )}
            </div>
            <div className="top-divider" />
            <button
              className="icon-button notification-button"
              aria-label="Notifications"
              onClick={() => setModal("notifications")}
            >
              <Bell size={19} />
              {notifications.length > 0 && <i />}
            </button>
            <button
              className="avatar small"
              onClick={() => go("profile")}
              aria-label="Open profile"
            >
              {user.name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")}
            </button>
          </div>
        </header>
        <main className="main-content">
          {error && !modal && (
            <div className="error-box">
              {error}
              <button
                onClick={() => {
                  setError("");
                  refresh().catch((e) => setError(e.message));
                }}
              >
                Retry
              </button>
            </div>
          )}
          {loading && <div className="loading-line" />}
          {page === "feed" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow greeting">
                    A LITTLE GOOD GOES A LONG WAY <span>✦</span>
                  </div>
                  <h1>
                    Good morning, {user.name.split(" ")[0]}
                    <span className="wave">☀</span>
                  </h1>
                  <p>
                    Someone’s ordinary bill could be your extraordinary act of
                    kindness.
                  </p>
                </div>
                <button className="text-button" onClick={() => setModal("how")}>
                  How it works <ArrowUpRight size={15} />
                </button>
              </div>
              <section className="impact-banner">
                <div className="banner-copy">
                  <div className="banner-eyebrow">
                    <span /> THE BORING BILLIONAIRE EFFECT
                  </div>
                  <h2>
                    Less worry for them.
                    <br />
                    <span>More meaning for you.</span>
                  </h2>
                  <p>
                    A school fee. A medical bill. A fresh start.
                    <br />
                    Your next small act could change someone’s whole day.
                  </p>
                  <button
                    onClick={() =>
                      document
                        .getElementById("feed-start")
                        ?.scrollIntoView({ behavior: "smooth", block: "start" })
                    }
                  >
                    Find your next act of good <ArrowRight size={16} />
                  </button>
                </div>
                <div className="banner-art" aria-hidden="true">
                  <div className="orbit orbit-one" />
                  <div className="orbit orbit-two" />
                  <span className="art-star one">✦</span>
                  <span className="art-star two">✧</span>
                  <div className="art-receipt">
                    <div className="receipt-mini-mark">
                      bb<span>✦</span>
                    </div>
                    <div className="art-line long" />
                    <div className="art-line" />
                    <div className="art-dashes" />
                    <div className="art-total">
                      <span>Everyday worries</span>
                      <strong>taken care of.</strong>
                    </div>
                    <div className="art-stamp">
                      <Check size={25} />
                    </div>
                  </div>
                  <div className="floating-heart">
                    <Heart size={23} fill="currentColor" />
                  </div>
                  <div className="kindness-tag">
                    <span>✦</span> Kindness looks good on you.
                  </div>
                </div>
              </section>
              <section className="stats-grid">
                <Stat
                  icon={Wallet}
                  color="amber"
                  title="Your wallet balance"
                  value={money(wallet.balance)}
                  detail={
                    <button
                      onClick={() => {
                        setModal("topup");
                        setError("");
                      }}
                    >
                      Top up wallet <Plus size={13} />
                    </button>
                  }
                />
                <Stat
                  icon={Heart}
                  color="rose"
                  title="Your kindness, in rupees"
                  value={money(wallet.impact)}
                  detail={
                    <span>
                      <TrendingUp size={13} /> Every rupee made a difference
                    </span>
                  }
                />
                <Stat
                  icon={CheckCircle2}
                  color="mint"
                  title="Bills you’ve helped with"
                  value={String(wallet.bills_helped).padStart(2, "0")}
                  detail={<span>Real people. A little less worry.</span>}
                />
              </section>
              <div className="feed-heading" id="feed-start">
                <div>
                  <h2>
                    A bill. A story. A chance to help.
                    <span className="live-badge">
                      <i />
                      {connected ? "LIVE" : "CONNECTING"}
                    </span>
                  </h2>
                  <p>
                    Verified bills from real people. Pick one that speaks to
                    you.
                  </p>
                </div>
                <span className="bill-count">
                  {liveCount} bills waiting for a little kindness
                </span>
              </div>
              <div className="filter-bar">
                <div className="category-tabs">
                  <button
                    className={filter === "all" ? "active" : ""}
                    onClick={() => setFilter("all")}
                  >
                    All bills <span>{liveCount}</span>
                  </button>
                  {[
                    "electricity",
                    "school fees",
                    "medical",
                    "rent",
                    "other",
                  ].map((k) => (
                    <button
                      className={filter === k ? "active" : ""}
                      key={k}
                      onClick={() => setFilter(k)}
                    >
                      {k === "other" ? "Other" : kinds[k].label}
                    </button>
                  ))}
                </div>
                <button
                  className={`filter-toggle ${modal === "filters" || urgent || location !== "all" ? "chosen" : ""}`}
                  onClick={() => setModal("filters")}
                >
                  <SlidersHorizontal size={15} /> Filters
                  {(urgent || location !== "all") && (
                    <span className="filter-dot" />
                  )}
                </button>
              </div>
              <div className="results-row">
                <span>
                  Showing <strong>{displayed.length}</strong>{" "}
                  {filter === "all"
                    ? "bills"
                    : kinds[filter]?.label.toLowerCase() + " bills"}{" "}
                  <span className="results-dot">·</span> A small act, a big
                  difference
                </span>
                <label>
                  Sort by:
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="recommended">Recommended</option>
                    <option value="newest">Newest first</option>
                    <option value="low">Amount: low to high</option>
                    <option value="high">Amount: high to low</option>
                    <option value="due">Due date</option>
                  </select>
                </label>
              </div>
              <div className="bill-grid">
                {displayed.map((b) => (
                  <BillCard
                    key={b.id}
                    bill={b}
                    fresh={newIds.includes(b.id)}
                    onOpen={() => openBill(b)}
                  />
                ))}
              </div>
              {!displayed.length && (
                <Empty
                  icon={Search}
                  title="A little quiet here."
                  text="Try a different filter to find a bill you can help with."
                />
              )}
              <div className="feed-footer">
                <ShieldCheck size={16} />
                <span>
                  Every bill is reviewed. Every act of kindness counts.
                </span>
                <span className="footer-separator">·</span>
                <button onClick={() => setModal("trust")}>
                  Our trust promise <ArrowUpRight size={13} />
                </button>
              </div>
            </>
          )}
          {page === "dashboard" && (
            <>
              <PageTitle
                eyebrow="A LITTLE BREATHING ROOM"
                title={`Your fresh start, ${user.name.split(" ")[0]}.`}
                text="Your bills, your progress, and a community in your corner."
                action={
                  <button
                    className="btn primary"
                    onClick={() => {
                      setSelected(null);
                      setError("");
                      setModal("upload");
                    }}
                  >
                    <Plus size={17} /> Upload a bill
                  </button>
                }
              />
              <div className="stats-grid">
                <Stat
                  icon={FileText}
                  color="blue"
                  title="Total bills submitted"
                  value={String(bills.length)}
                  detail={<span>One step at a time.</span>}
                />
                <Stat
                  icon={CircleDollarSign}
                  color="amber"
                  title="Outstanding amount"
                  value={money(
                    bills
                      .filter((b) => b.status !== "Rejected")
                      .reduce((n, b) => n + b.amount - b.funded, 0),
                  )}
                  detail={<span>Your remaining bill balance</span>}
                />
                <Stat
                  icon={Heart}
                  color="mint"
                  title="Community support"
                  value={money(bills.reduce((n, b) => n + b.funded, 0))}
                  detail={<span>Simulated Payoneer payouts</span>}
                />
              </div>
              <div className="section-heading">
                <h2>Your bills</h2>
                <span className="badge neutral">{bills.length} submitted</span>
              </div>
              <div className="info-box">
                <ShieldCheck size={17} />
                {user.kyc_status === "verified"
                  ? "Your demo KYC is verified. Your personal details stay private."
                  : "Complete your profile and contact the review team for KYC verification."}
              </div>
              <div className="bill-grid">
                {bills.map((b) => (
                  <BillCard
                    key={b.id}
                    bill={b}
                    owner
                    onOpen={() => openBill(b)}
                  />
                ))}
              </div>
              {!bills.length && (
                <Empty
                  icon={FileText}
                  title="A fresh page."
                  text="Upload your first bill. We’ll review it and help you take the next step."
                />
              )}
            </>
          )}
          {(page === "wallet" || page === "impact") && (
            <>
              <PageTitle
                eyebrow={
                  page === "wallet"
                    ? "YOUR GENEROSITY STARTS HERE"
                    : "THE DIFFERENCE YOU MAKE"
                }
                title={
                  page === "wallet"
                    ? "A wallet with a purpose."
                    : "Small acts. Lasting impact."
                }
                text={
                  page === "wallet"
                    ? "A little set aside. A lot of possibility."
                    : "Behind every number is someone with one less thing to worry about."
                }
              />
              <div className="wallet-layout">
                <div className="wallet-card">
                  <span className="banner-eyebrow">
                    BORING BILLIONAIRE WALLET
                  </span>
                  <div className="wallet-card-logo">
                    bb<span>✦</span>
                  </div>
                  <p>
                    {page === "impact"
                      ? "Total kindness, in rupees"
                      : "Available to do a little good"}
                  </p>
                  <h2>
                    {money(page === "impact" ? wallet.impact : wallet.balance)}
                  </h2>
                  <div className="wallet-card-bottom">
                    <span>
                      {user.name}
                      <small>VERIFIED MEMBER</small>
                    </span>
                    <ShieldCheck size={30} />
                  </div>
                </div>
                <div className="wallet-side">
                  <div className="category-icon amber">
                    <Wallet size={23} />
                  </div>
                  <h2>Good things start small.</h2>
                  <p>
                    {page === "impact"
                      ? `You’ve helped with ${wallet.bills_helped} bills. Every contribution means a little more breathing room for someone.`
                      : "Top up your wallet and be ready when a story speaks to you. All payouts go to a verified recipient’s Payoneer account."}
                  </p>
                  <button
                    className="btn primary"
                    onClick={() => {
                      setModal(page === "impact" ? "how" : "topup");
                      setError("");
                    }}
                  >
                    {page === "impact"
                      ? "How your impact works"
                      : "Top up wallet"}
                    <Plus size={16} />
                  </button>
                  <small>
                    <LockKeyhole size={13} /> Demo balance. No real funds held.
                  </small>
                </div>
              </div>
              <div className="section-heading">
                <h2>
                  {page === "impact"
                    ? "Your acts of kindness"
                    : "Wallet activity"}
                </h2>
                <button className="text-button" onClick={() => go("history")}>
                  View all <ArrowRight size={15} />
                </button>
              </div>
              <TransactionTable
                transactions={
                  page === "impact"
                    ? txs.filter((t) => t.kind === "funding")
                    : txs
                }
                bills={bills}
                onDispute={(id) => {
                  setPayAmount(id);
                  setModal("dispute");
                }}
              />
            </>
          )}
          {page === "history" && (
            <>
              <PageTitle
                eyebrow="EVERY RUPEE, ACCOUNTED FOR"
                title="A history of doing good."
                text="A clear record of every top-up, contribution, and payout."
              />
              <TransactionTable
                transactions={txs}
                incoming={user.role === "general"}
                bills={bills}
                onDispute={(id) => {
                  setPayAmount(id);
                  setModal("dispute");
                }}
              />
            </>
          )}
          {page === "profile" && (
            <>
              <PageTitle
                eyebrow="NICE TO KNOW YOU"
                title="The person behind the kindness."
                text="Keep your details up to date and your account protected."
              />
              <div className="profile-layout">
                <form
                  className="panel profile-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    action(
                      () =>
                        request("/me", token, {
                          method: "PATCH",
                          body: JSON.stringify(Object.fromEntries(f)),
                        }),
                      "Profile updated.",
                    );
                  }}
                >
                  <div className="section-heading">
                    <h2>Personal details</h2>
                    <span
                      className={`badge ${user.kyc_status === "verified" ? "green" : "amber"}`}
                    >
                      <ShieldCheck size={13} />
                      {user.kyc_status} KYC
                    </span>
                  </div>
                  <label>
                    Full name
                    <input name="name" required defaultValue={user.name} />
                  </label>
                  <label>
                    Mobile number
                    <input
                      name="mobile"
                      required
                      pattern="[0-9]{10}"
                      maxLength={10}
                      defaultValue={user.mobile || ""}
                      placeholder="10-digit mobile number"
                    />
                  </label>
                  <label>
                    Location
                    <input
                      name="location"
                      required
                      defaultValue={user.location}
                    />
                  </label>
                  <p className="form-hint">
                    Changing your mobile number resets KYC to pending. Donors
                    can’t fund bills while KYC is pending.
                  </p>
                  <button className="btn primary" disabled={busy}>
                    Save details <Check size={16} />
                  </button>
                </form>
                <div className="profile-side">
                  {user.role === "general" && (
                    <section className="panel payout-account-card">
                      <div className="category-icon blue">
                        <Wallet size={23} />
                      </div>
                      <span className="eyebrow">YOUR PAYOUT DESTINATION</span>
                      <h2>Payoneer account</h2>
                      <p>
                        Your mobile number is used for contact and login.
                        Payouts use a separate, provider-issued payee identity.
                      </p>
                      <span
                        className={`badge ${payoutAccount?.status === "verified" ? "green" : "amber"}`}
                      >
                        {payoutAccount?.status?.replace("_", " ") ||
                          "Not connected"}
                      </span>
                      {payoutAccount?.reference && (
                        <code>{payoutAccount.reference}</code>
                      )}
                      <div className="info-box">
                        Demo recipient only. No real Payoneer account is
                        connected. Live registration requires approved Payoneer
                        partner access.
                      </div>
                      {payoutAccount?.status !== "verified" && (
                        <button
                          className="btn primary full"
                          disabled={busy}
                          onClick={() =>
                            action(async () => {
                              setPayoutAccount(
                                await request(
                                  "/payout-account/connect",
                                  token,
                                  { method: "POST" },
                                ),
                              );
                            }, "Synthetic demo Payoneer recipient created. No real account was linked.")
                          }
                        >
                          Connect demo recipient <ArrowRight size={15} />
                        </button>
                      )}
                    </section>
                  )}
                  <div className="panel account-card">
                    <div className="avatar large">{user.name[0]}</div>
                    <h2>{user.name}</h2>
                    <p>{user.email || user.mobile}</p>
                    <span className="badge neutral">
                      {user.role === "donor"
                        ? "Billionaire"
                        : user.role === "general"
                          ? "Community member"
                          : "Admin"}
                    </span>
                    <div className="account-divider" />
                    <button className="btn white full" onClick={logout}>
                      <LogOut size={16} /> Sign out
                    </button>
                    <small>You’re exploring a simulated environment.</small>
                  </div>
                </div>
              </div>
            </>
          )}
          {page === "admin" && (
            <>
              <PageTitle
                eyebrow="A COMMUNITY BUILT ON TRUST"
                title="Good starts with a closer look."
                text="Review documents, check details, and help real stories reach the community."
              />
              <div className="section-heading">
                <h2>Pending review</h2>
                <span className="badge amber">
                  {bills.filter((b) => b.status === "Pending Review").length}{" "}
                  bills
                </span>
              </div>
              <div className="bill-grid">
                {bills
                  .filter((b) => b.status === "Pending Review")
                  .map((b) => (
                    <BillCard
                      key={b.id}
                      bill={b}
                      owner
                      onOpen={() => openBill(b)}
                    />
                  ))}
              </div>
              {!bills.some((b) => b.status === "Pending Review") && (
                <Empty
                  icon={ShieldCheck}
                  title="All caught up."
                  text="New bills will appear here instantly when someone submits a request."
                />
              )}
              <div className="section-heading">
                <h2>All reviewed bills</h2>
              </div>
              <div className="bill-grid">
                {bills
                  .filter((b) => b.status !== "Pending Review")
                  .map((b) => (
                    <BillCard
                      key={b.id}
                      bill={b}
                      owner
                      onOpen={() => openBill(b)}
                    />
                  ))}
              </div>
            </>
          )}
          {page === "members" && (
            <>
              <PageTitle
                eyebrow="THE PEOPLE BEHIND THE GOOD"
                title="Members & verification."
                text="Approve donor memberships and verify demo KYC after review."
              />
              <div className="panel table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Role</th>
                      <th>KYC</th>
                      <th>Approval</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminUsers.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <strong>{u.name}</strong>
                          <small>{u.email || u.mobile}</small>
                        </td>
                        <td>{u.role}</td>
                        <td>
                          <span
                            className={`badge ${u.kyc_status === "verified" ? "green" : "amber"}`}
                          >
                            {u.kyc_status}
                          </span>
                        </td>
                        <td>{u.approved ? "Approved" : "Pending"}</td>
                        <td>
                          <div className="table-actions">
                            {!u.approved && (
                              <button
                                disabled={busy}
                                onClick={() =>
                                  action(
                                    () =>
                                      request(
                                        `/admin/users/${u.id}/approve`,
                                        token,
                                        { method: "POST" },
                                      ),
                                    "Account approved.",
                                  )
                                }
                              >
                                Approve
                              </button>
                            )}
                            {u.kyc_status !== "verified" && (
                              <button
                                disabled={busy}
                                onClick={() =>
                                  action(
                                    () =>
                                      request(
                                        `/admin/users/${u.id}/kyc`,
                                        token,
                                        { method: "POST" },
                                      ),
                                    "Demo KYC verified.",
                                  )
                                }
                              >
                                Verify demo KYC
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {page === "readiness" && (
            <>
              <PageTitle
                eyebrow="FROM DEMO TO DOING GOOD"
                title="Before the first real rupee."
                text="Payoneer integration status. Credentials alone do not enable real payments."
              />
              <div className="info-box">
                <LockKeyhole size={18} />
                Real-money payments are disabled. The checks below identify
                configuration and implementation still required.
              </div>
              <section className="panel readiness-list">
                {readiness?.checks.map((check) => (
                  <article key={check.id}>
                    <span
                      className={`stat-icon ${check.passed ? "mint" : "amber"}`}
                    >
                      {check.passed ? (
                        <Check size={17} />
                      ) : (
                        <Clock3 size={17} />
                      )}
                    </span>
                    <div>
                      <h3>{check.id.replaceAll("_", " ")}</h3>
                      <p>{check.requirement}</p>
                    </div>
                    <span
                      className={`badge ${check.passed ? "green" : "amber"}`}
                    >
                      {check.passed ? "Configured" : "Required"}
                    </span>
                  </article>
                ))}
              </section>
            </>
          )}
          {page === "disputes" && (
            <>
              <PageTitle
                eyebrow="LET’S MAKE IT RIGHT"
                title="Disputes & support."
                text="Review payment concerns and keep a clear resolution trail. Live refunds require Payoneer integration."
              />
              {disputes.map((d) => (
                <article className="panel dispute-card" key={d.id}>
                  <div>
                    <span className="badge neutral">{d.status}</span>
                    <h3>Case #{d.id}</h3>
                    <p>{d.reason}</p>
                    <code>{d.transaction_id}</code>
                  </div>
                  {d.status === "open" && (
                    <div className="dispute-actions">
                      <button
                        className="btn white"
                        disabled={busy}
                        onClick={() =>
                          action(
                            () =>
                              request(
                                `/admin/transactions/${d.transaction_id}/refund`,
                                token,
                                { method: "POST" },
                              ),
                            "Demo contribution reversed. No real funds affected.",
                          )
                        }
                      >
                        Refund demo payment
                      </button>
                      <button
                        className="btn primary"
                        onClick={() =>
                          action(
                            () =>
                              request(
                                `/admin/disputes/${d.id}/resolve`,
                                token,
                                { method: "POST" },
                              ),
                            "Dispute marked resolved.",
                          )
                        }
                      >
                        Mark resolved
                      </button>
                    </div>
                  )}
                </article>
              ))}
              {!disputes.length && (
                <Empty
                  icon={ShieldCheck}
                  title="No open concerns."
                  text="Payment disputes submitted by members will appear here."
                />
              )}
            </>
          )}
        </main>
        <footer className="app-footer">
          <span>Good doesn’t have to be complicated.</span>
          <span>
            Made with a little more <Heart size={12} />{" "}
            <span className="footer-dot">·</span> Boring Billionaire ©{" "}
            {new Date().getFullYear()}
          </span>
        </footer>
      </div>
      {modal && (
        <div className="modal-backdrop" onClick={closeModal}>
          <section
            className={`modal ${modal === "bill" ? "bill-modal" : ""} ${modal === "upload" ? "upload-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={modal}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              onClick={closeModal}
              aria-label="Close dialog"
            >
              <X size={20} />
            </button>
            {modal === "bill" &&
              selected &&
              (paySuccess ? (
                <div className="success-state">
                  <div className="success-icon">
                    <Check size={33} />
                  </div>
                  <div className="eyebrow">YOU MADE SOMEONE’S DAY</div>
                  <h2>
                    A little less worry.
                    <br />
                    Thanks to you.
                  </h2>
                  <p>
                    Your demo contribution of{" "}
                    <strong>
                      {money(Math.round(Number(payAmount) * 100))}
                    </strong>{" "}
                    is recorded.
                    <br />
                    No real Payoneer transfer was made.
                  </p>
                  <div className="info-box">
                    <Heart size={16} /> Real kindness starts with showing up.
                  </div>
                  <button className="btn primary full" onClick={closeModal}>
                    Keep the good going <ArrowRight size={17} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="modal-eyebrow">
                    <span
                      className={`category-icon ${kinds[selected.bill_type]?.color}`}
                    >
                      {React.createElement(
                        kinds[selected.bill_type]?.icon || FileText,
                        { size: 23 },
                      )}
                    </span>
                    <span>
                      {kinds[selected.bill_type]?.label || selected.bill_type}
                      <small>
                        <MapPin size={12} />
                        {selected.location}
                      </small>
                    </span>
                  </div>
                  <h2>{selected.title}</h2>
                  <div className="detail-badges">
                    <span className="badge green">
                      <ShieldCheck size={13} />
                      {selected.kyc_status === "verified"
                        ? "Verified recipient"
                        : "KYC pending"}
                    </span>
                    <span
                      className={`badge ${selected.urgent ? "rose" : "neutral"}`}
                    >
                      <Clock3 size={12} />
                      Due{" "}
                      {new Date(
                        selected.due_date + "T00:00:00",
                      ).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                    <span className="badge neutral">{selected.status}</span>
                  </div>
                  <div className="detail-note">
                    <span>THE STORY BEHIND THE BILL</span>
                    <p>{selected.note}</p>
                    <small>
                      Submitted by {selected.beneficiary} · Personal details
                      protected
                    </small>
                  </div>
                  {selected.preview_id && (
                    <BillImage id={selected.preview_id} token={token} />
                  )}
                  <div className="document-preview">
                    <div className="document-paper">
                      <div className="document-header">
                        <FileText size={20} />
                        <span>BILL SUMMARY</span>
                        <ShieldCheck size={16} />
                      </div>
                      <h3>{selected.biller}</h3>
                      <div>
                        <span>Bill category</span>
                        <strong>{kinds[selected.bill_type]?.label}</strong>
                      </div>
                      <div>
                        <span>Due date</span>
                        <strong>{selected.due_date}</strong>
                      </div>
                      <div className="document-amount">
                        <span>Total bill amount</span>
                        <strong>{money(selected.amount)}</strong>
                      </div>
                      <p>
                        <LockKeyhole size={12} /> Original document is private
                        to the review team.
                      </p>
                    </div>
                  </div>
                  {(user.role === "admin" || user.role === "general") &&
                    selected.files.map((f) => (
                      <button
                        key={f.id}
                        className="text-button"
                        onClick={() => showDocument(f.id)}
                      >
                        <FileText size={15} />
                        View uploaded{" "}
                        {f.content_type === "application/pdf" ? "PDF" : "image"}
                        <ArrowUpRight size={14} />
                      </button>
                    ))}
                  <div className="detail-amounts">
                    <div>
                      <span>Still needed</span>
                      <strong>
                        {money(selected.amount - selected.funded)}
                      </strong>
                    </div>
                    <div>
                      <span>Community funded</span>
                      <strong>{money(selected.funded)}</strong>
                    </div>
                  </div>
                  {user.role === "donor" && selected.status === "Live" && (
                    <>
                      <label>
                        Your contribution (₹)
                        <input
                          type="number"
                          value={payAmount}
                          onChange={(e) => setPayAmount(e.target.value)}
                          min="0.01"
                          step="0.01"
                          max={(selected.amount - selected.funded) / 100}
                        />
                      </label>
                      <div className="contribution-options">
                        <button
                          onClick={() =>
                            setPayAmount(
                              String((selected.amount - selected.funded) / 100),
                            )
                          }
                        >
                          Cover the full bill
                        </button>
                        <button
                          onClick={() =>
                            setPayAmount(
                              String(
                                Math.ceil(
                                  (selected.amount - selected.funded) / 200,
                                ),
                              ),
                            )
                          }
                        >
                          Contribute half
                        </button>
                      </div>
                      <div className="payment-route">
                        <Wallet size={16} />
                        <span>Your wallet</span>
                        <ArrowRight size={14} />
                        <span>Recipient’s Payoneer account</span>
                        <ShieldCheck size={15} />
                      </div>
                      <p className="form-hint">
                        Demo payment · Your wallet balance:{" "}
                        {money(wallet.balance)}. Confirming deducts demo funds
                        immediately.
                      </p>
                      {error && <div className="error-box">{error}</div>}
                      <button
                        className="btn primary full"
                        disabled={busy}
                        onClick={makePayment}
                      >
                        {busy ? (
                          <LoaderCircle size={17} className="spin" />
                        ) : (
                          <Heart size={17} />
                        )}
                        Confirm demo payment ·{" "}
                        {money(Math.round(Number(payAmount || 0) * 100))}
                      </button>
                    </>
                  )}
                  {user.role === "admin" && (
                    <label className="preview-upload">
                      Publish a manually redacted image preview
                      <input
                        type="file"
                        accept="image/png,image/jpeg"
                        disabled={busy}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const fd = new FormData();
                            fd.append("file", file);
                            action(async () => {
                              await request(
                                `/admin/bills/${selected.id}/preview`,
                                token,
                                { method: "POST", body: fd },
                              );
                              setModal("");
                            }, "Redacted preview published.");
                          }
                        }}
                      />
                      <small>
                        Remove names, mobile numbers, addresses, account
                        numbers, and barcodes before uploading. Donors can see
                        this image.
                      </small>
                    </label>
                  )}
                  {user.role === "admin" &&
                    selected.status === "Pending Review" && (
                      <>
                        <p className="form-hint">
                          Check the original document, fraud signals, recipient
                          KYC, and note for personal details before publishing.
                        </p>
                        {error && <div className="error-box">{error}</div>}
                        <div className="modal-actions">
                          <button
                            className="btn white"
                            disabled={busy}
                            onClick={() =>
                              action(async () => {
                                await request(
                                  `/admin/bills/${selected.id}/review`,
                                  token,
                                  {
                                    method: "POST",
                                    body: JSON.stringify({
                                      decision: "reject",
                                    }),
                                  },
                                );
                                closeModal();
                              }, "Bill rejected.")
                            }
                          >
                            Reject bill
                          </button>
                          <button
                            className="btn primary"
                            disabled={busy}
                            onClick={() =>
                              action(async () => {
                                await request(
                                  `/admin/bills/${selected.id}/review`,
                                  token,
                                  {
                                    method: "POST",
                                    body: JSON.stringify({
                                      decision: "approve",
                                    }),
                                  },
                                );
                                closeModal();
                              }, "Bill is now live.")
                            }
                          >
                            <Check size={16} /> Approve & publish
                          </button>
                        </div>
                      </>
                    )}
                  {user.role === "general" &&
                    selected.status === "Pending Review" && (
                      <button
                        className="btn white full"
                        onClick={() => setModal("upload")}
                      >
                        <Upload size={16} />
                        Attach a bill document
                      </button>
                    )}
                </>
              ))}
            {modal === "topup" && (
              <>
                <div className="category-icon amber modal-icon">
                  <Wallet size={25} />
                </div>
                <h2>A little fuel for the good.</h2>
                <p className="modal-intro">
                  Top up your demo wallet. Be ready to make someone’s day.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    action(async () => {
                      await request("/wallet/topup", token, {
                        method: "POST",
                        headers: { "Idempotency-Key": crypto.randomUUID() },
                        body: JSON.stringify({
                          amount: Math.round(Number(topAmount) * 100),
                        }),
                      });
                      closeModal();
                    }, "Demo wallet topped up. No real payment was taken.");
                  }}
                >
                  <label>
                    Top-up amount (₹)
                    <input
                      value={topAmount}
                      onChange={(e) => setTopAmount(e.target.value)}
                      type="number"
                      min="1"
                      max="1000000"
                      step="0.01"
                      required
                    />
                  </label>
                  <div className="preset-amounts">
                    {["5000", "10000", "25000", "50000"].map((a) => (
                      <button
                        key={a}
                        type="button"
                        className={topAmount === a ? "active" : ""}
                        onClick={() => setTopAmount(a)}
                      >
                        {money(Number(a) * 100)}
                      </button>
                    ))}
                  </div>
                  <div className="info-box">
                    <LockKeyhole size={18} />
                    <span>
                      Demo mode: this adds simulated funds. Payoneer checkout is
                      disabled until merchant integration is configured.
                    </span>
                  </div>
                  {error && <div className="error-box">{error}</div>}
                  <button className="btn primary full" disabled={busy}>
                    Add {money(Number(topAmount) * 100)} in demo funds{" "}
                    <Plus size={16} />
                  </button>
                </form>
              </>
            )}
            {modal === "filters" && (
              <>
                <div className="category-icon slate modal-icon">
                  <SlidersHorizontal size={23} />
                </div>
                <h2>Find your kind of good.</h2>
                <p className="modal-intro">
                  A few filters to find the stories closest to your heart.
                </p>
                <label>
                  Location
                  <select
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                  >
                    <option value="all">All locations</option>
                    {[...new Set(bills.map((b) => b.location))].map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Search bills
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="A story, biller, or city…"
                  />
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={urgent}
                    onChange={(e) => setUrgent(e.target.checked)}
                  />
                  <span>
                    Urgent bills only
                    <small>Due within two days of submission</small>
                  </span>
                </label>
                <div className="modal-actions">
                  <button
                    className="btn white"
                    onClick={() => {
                      setFilter("all");
                      setLocation("all");
                      setUrgent(false);
                      setQuery("");
                    }}
                  >
                    Reset filters
                  </button>
                  <button className="btn primary" onClick={closeModal}>
                    Show {displayed.length} bills <ArrowRight size={15} />
                  </button>
                </div>
              </>
            )}
            {modal === "upload" && (
              <>
                <div className="category-icon blue modal-icon">
                  <Upload size={23} />
                </div>
                <h2>Let’s take one worry off.</h2>
                <p className="modal-intro">
                  Tell us a little about your bill. Our team will review it
                  before it goes live.
                </p>
                <form onSubmit={uploadBill}>
                  {!selected && (
                    <>
                      <label>
                        A short title
                        <input
                          name="title"
                          required
                          minLength={3}
                          maxLength={160}
                          placeholder="A little help with this month’s rent"
                        />
                      </label>
                      <div className="form-row">
                        <label>
                          Bill type
                          <select name="bill_type">
                            {Object.keys(kinds).map((k) => (
                              <option key={k} value={k}>
                                {kinds[k].label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Amount (₹)
                          <input
                            name="amount"
                            type="number"
                            min="1"
                            max="1000000"
                            step="0.01"
                            required
                            placeholder="0.00"
                          />
                        </label>
                      </div>
                      <div className="form-row">
                        <label>
                          Due date
                          <input name="due_date" type="date" required />
                        </label>
                        <label>
                          Biller name
                          <input
                            name="biller"
                            required
                            placeholder="Company or institution"
                            maxLength={160}
                          />
                        </label>
                      </div>
                      <label>
                        Location
                        <input
                          name="location"
                          required
                          placeholder="Your city"
                          defaultValue={
                            user.location === "India" ? "" : user.location
                          }
                        />
                      </label>
                      <label>
                        Your story
                        <textarea
                          name="note"
                          required
                          minLength={10}
                          maxLength={1500}
                          rows={3}
                          placeholder="A little context helps. Please leave out phone numbers, addresses, or account details."
                        />
                      </label>
                    </>
                  )}
                  <label className="upload-zone">
                    <Upload size={25} />
                    <strong>Attach your bill</strong>
                    <span>JPEG, PNG, or PDF · Up to 10 MB</span>
                    <input
                      name="file"
                      type="file"
                      accept="image/jpeg,image/png,application/pdf"
                      required
                    />
                  </label>
                  {selected && (
                    <div className="info-box">
                      Bill #{selected.id} is saved. Attach a document to
                      complete submission.
                    </div>
                  )}
                  <p className="form-hint">
                    <ShieldCheck size={13} /> Original documents are only
                    visible to you and our review team.
                  </p>
                  {error && <div className="error-box">{error}</div>}
                  <button disabled={busy} className="btn primary full">
                    {busy ? (
                      <LoaderCircle size={17} className="spin" />
                    ) : (
                      <Upload size={16} />
                    )}{" "}
                    Submit for review
                  </button>
                </form>
              </>
            )}
            {modal === "notifications" && (
              <>
                <div className="category-icon amber modal-icon">
                  <Bell size={23} />
                </div>
                <h2>A little good news.</h2>
                <p className="modal-intro">
                  Your latest updates, all in one place.
                </p>
                {notifications.length ? (
                  notifications.map((n) => (
                    <div className="notification-item" key={n.id}>
                      <CheckCircle2 size={19} />
                      <p>{n.message}</p>
                    </div>
                  ))
                ) : (
                  <Empty
                    icon={Bell}
                    title="Quiet, for now."
                    text="Bill reviews and payment updates will appear here."
                  />
                )}
              </>
            )}
            {modal === "dispute" && (
              <>
                <h2>We’re here to help.</h2>
                <p className="modal-intro">
                  Tell the review team what happened with this transaction.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    action(async () => {
                      await request("/disputes", token, {
                        method: "POST",
                        body: JSON.stringify({
                          transaction_id: payAmount,
                          reason: f.get("reason"),
                        }),
                      });
                      closeModal();
                    }, "Your concern was sent to the review team.");
                  }}
                >
                  <label>
                    Transaction
                    <input value={payAmount} readOnly />
                  </label>
                  <label>
                    What happened?
                    <textarea
                      name="reason"
                      minLength={10}
                      maxLength={1000}
                      rows={4}
                      required
                      placeholder="Please describe your concern…"
                    />
                  </label>
                  {error && <div className="error-box">{error}</div>}
                  <button className="btn primary full" disabled={busy}>
                    Send to review team <ArrowRight size={16} />
                  </button>
                </form>
              </>
            )}
            {["how", "trust", "help"].includes(modal) && (
              <>
                <div className="category-icon amber modal-icon">
                  {modal === "trust" ? (
                    <ShieldCheck size={25} />
                  ) : modal === "help" ? (
                    <HelpCircle size={25} />
                  ) : (
                    <Sparkles size={25} />
                  )}
                </div>
                <h2>
                  {modal === "trust"
                    ? "Kindness, with confidence."
                    : modal === "help"
                      ? "A little help, right here."
                      : "Doing good is pretty simple."}
                </h2>
                <p className="modal-intro">
                  {modal === "help"
                    ? "Here’s how to find your way around."
                    : "No grand gestures required. Just a little humanity."}
                </p>
                {(modal === "trust"
                  ? [
                      [
                        "Reviewed before it’s live",
                        "The review team checks bills and recipient KYC before publishing.",
                      ],
                      [
                        "Your details stay yours",
                        "Donors see masked identities. Original documents stay private.",
                      ],
                      [
                        "Every rupee has a record",
                        "Each demo payment creates a transaction, payout record, and audit log.",
                      ],
                    ]
                  : modal === "help"
                    ? [
                        [
                          "Need help with a payment?",
                          "Open Transactions and use “Report an issue” for the relevant payment.",
                        ],
                        [
                          "Looking for your updates?",
                          "The bell in the top bar holds your notifications.",
                        ],
                        [
                          "Exploring the demo?",
                          "Switch roles by signing out and choosing another demo account. No real money is moved.",
                        ],
                      ]
                    : [
                        [
                          "Find a story that speaks to you",
                          "Browse reviewed bills and choose the one you’d like to help with.",
                        ],
                        [
                          "Give a little. Or cover it all.",
                          "Use your wallet to contribute any amount up to the remaining balance.",
                        ],
                        [
                          "Let someone breathe a little easier",
                          "Demo payouts are recorded for the recipient’s Payoneer account. Live payments require Payoneer partner integration.",
                        ],
                      ]
                ).map(([h, p], i) => (
                  <div className="how-step" key={h}>
                    <span>0{i + 1}</span>
                    <div>
                      <h3>{h}</h3>
                      <p>{p}</p>
                    </div>
                  </div>
                ))}
                <button className="btn primary full" onClick={closeModal}>
                  Got it. Let’s do a little good. <ArrowRight size={16} />
                </button>
              </>
            )}
          </section>
        </div>
      )}
      {toast && (
        <div className="toast">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
function BillImage({ id, token }: { id: number; token: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let url = "";
    let active = true;
    fetch(`/api/previews/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.blob();
      })
      .then((blob) => {
        url = URL.createObjectURL(blob);
        if (active) setSrc(url);
        else URL.revokeObjectURL(url);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, token]);
  return src ? (
    <figure className="bill-image">
      <img src={src} alt="Admin-reviewed bill with personal details redacted" />
      <figcaption>
        <ShieldCheck size={12} /> Admin-published redacted bill preview
      </figcaption>
    </figure>
  ) : null;
}
function PageTitle({
  eyebrow,
  title,
  text,
  action,
}: {
  eyebrow: string;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow greeting">
          {eyebrow} <span>✦</span>
        </div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {action}
    </div>
  );
}
function Stat({
  icon: Icon,
  color,
  title,
  value,
  detail,
}: {
  icon: LucideIcon;
  color: string;
  title: string;
  value: string;
  detail: React.ReactNode;
}) {
  return (
    <article className="stat-card">
      <div className="stat-top">
        <span>{title}</span>
        <div className={`stat-icon ${color}`}>
          <Icon size={18} />
        </div>
      </div>
      <strong className="stat-value">{value}</strong>
      <div className="stat-detail">{detail}</div>
    </article>
  );
}
function BillCard({
  bill: b,
  fresh = false,
  owner = false,
  onOpen,
}: {
  bill: Bill;
  fresh?: boolean;
  owner?: boolean;
  onOpen: () => void;
}) {
  const kind = kinds[b.bill_type] || kinds.other;
  const Icon = kind.icon;
  const days = Math.round(
    (new Date(b.due_date + "T00:00:00").getTime() -
      new Date().setHours(0, 0, 0, 0)) /
      86400000,
  );
  return (
    <article className={`bill-card ${fresh ? "new-bill" : ""}`}>
      <div className="bill-card-top">
        <div className={`category-icon ${kind.color}`}>
          <Icon size={23} />
        </div>
        <div className="bill-card-category">
          <span>{kind.label}</span>
          <small>
            <MapPin size={11} />
            {b.location}
          </small>
        </div>
        {fresh ? (
          <span className="badge new">New bill</span>
        ) : owner ? (
          <span
            className={`badge ${b.status === "Paid" ? "green" : b.status === "Rejected" ? "rose" : b.status === "Live" ? "blue" : "amber"}`}
          >
            {b.status}
          </span>
        ) : b.urgent ? (
          <span className="badge urgent">
            <Clock3 size={11} />
            Urgent
          </span>
        ) : (
          <span className="verified-icon" title="Reviewed bill">
            <ShieldCheck size={17} />
          </span>
        )}
      </div>
      <button className="bill-title" onClick={onOpen}>
        {b.title}
      </button>
      <p className="bill-note">{b.note}</p>
      <div className="bill-trust">
        <ShieldCheck size={12} />
        <span>
          {b.status === "Pending Review"
            ? "Awaiting review"
            : b.status === "Rejected"
              ? "Request declined"
              : "Verified bill"}
        </span>
        <span className="dot">·</span>
        <span>{b.beneficiary}</span>
      </div>
      <div className="bill-divider" />
      <div className="bill-financial">
        <div>
          <span>{owner ? "Bill amount" : "A little help needed"}</span>
          <strong>{money(owner ? b.amount : b.amount - b.funded)}</strong>
        </div>
        <span className={`due ${b.urgent ? "due-urgent" : ""}`}>
          <Clock3 size={12} />
          {days < 0
            ? "Overdue"
            : days === 0
              ? "Due today"
              : `Due in ${days} ${days === 1 ? "day" : "days"}`}
        </span>
      </div>
      {b.funded > 0 && (
        <div className="funding-progress">
          <div style={{ width: `${(b.funded / b.amount) * 100}%` }} />
        </div>
      )}
      <button className="bill-action" onClick={onOpen}>
        {owner ? "View bill details" : "Make their day"}
        <ArrowUpRight size={16} />
      </button>
    </article>
  );
}
function Empty({
  icon: Icon,
  title,
  text,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
}) {
  return (
    <div className="empty-state">
      <div className="category-icon slate">
        <Icon size={24} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function TransactionTable({
  transactions,
  bills,
  onDispute,
  incoming = false,
}: {
  transactions: Tx[];
  bills: Bill[];
  incoming?: boolean;
  onDispute: (id: string) => void;
}) {
  return transactions.length ? (
    <div className="panel table-wrap">
      <table>
        <thead>
          <tr>
            <th>Transaction</th>
            <th>Date</th>
            <th>Amount</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => (
            <tr key={t.id}>
              <td>
                <div className="transaction-label">
                  <span
                    className={`stat-icon ${t.kind === "topup" ? "mint" : "rose"}`}
                  >
                    {t.kind === "topup" ? (
                      <Plus size={17} />
                    ) : (
                      <Heart size={17} />
                    )}
                  </span>
                  <div>
                    <strong>
                      {t.kind === "topup"
                        ? "Wallet top-up"
                        : t.kind === "refund"
                          ? "Contribution refund"
                          : bills.find((b) => b.id === t.bill_id)?.title ||
                            "Bill contribution"}
                    </strong>
                    <small>Demo · {t.id.slice(0, 12)}</small>
                  </div>
                </div>
              </td>
              <td>
                {new Date(t.created_at).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </td>
              <td className="amount-cell">
                {incoming
                  ? t.kind === "funding"
                    ? "+"
                    : "−"
                  : t.kind === "topup" || t.kind === "refund"
                    ? "+"
                    : "−"}
                {money(t.amount)}
              </td>
              <td>
                <span className="badge green">
                  <Check size={12} />
                  {t.status}
                </span>
              </td>
              <td>
                <button
                  className="report-button"
                  onClick={() => onDispute(t.id)}
                >
                  Report an issue
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty
      icon={History}
      title="Your story is just beginning."
      text="Your contributions and wallet activity will appear here."
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
