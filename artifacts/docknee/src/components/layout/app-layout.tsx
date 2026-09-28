import { Sidebar } from "./sidebar";
import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, Users, FileText, Plus, Scan, Sun, Moon, BellRing, Scissors, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useLanguage } from "@/lib/i18n";
import { JoIA } from "@/components/joia";

const NAV_ITEMS = [
  { href: "/dashboard", key: "nav.home", Icon: LayoutDashboard },
  { href: "/patients", key: "nav.patients", Icon: Users },
  { href: "/surgeries", key: "nav.surgeries", Icon: FileText },
  { href: "/xray-planning", key: "nav.xray", Icon: Scan },
] as const;

const PAGE_TITLE_KEYS = {
  "/dashboard": "nav.home",
  "/patients": "nav.patients",
  "/agenda": "nav.appointments",
  "/agenda-cirurgica": "nav.surgicalSchedule",
  "/surgeries": "nav.surgeries",
  "/xray-planning": "nav.xray",
  "/followup-central": "nav.followups",
  "/reports": "nav.reports",
  "/profile": "nav.profile",
  "/admin": "nav.admin",
} as const;

/** Returns the in-app parent path or null if already at a root nav page */
function getBackPath(location: string): string | null {
  if (location.startsWith("/patients/")) return "/patients";
  if (location.startsWith("/surgeries/")) return "/surgeries";
  if (location.startsWith("/admin/")) return "/admin";
  const secondary = [
    "/agenda-cirurgica", "/agenda", "/followup-central",
    "/whatsapp-broadcast", "/reports", "/profile", "/admin",
  ];
  if (secondary.some(p => location === p || location.startsWith(p + "/"))) return "/dashboard";
  return null;
}

function BottomNav() {
  const [location] = useLocation();
  const { t } = useLanguage();

  const isActive = (href: string) => {
    if (href === "/surgeries") return location.startsWith("/surgeries") && !location.startsWith("/surgeries/new");
    if (href === "/patients") return location.startsWith("/patients");
    if (href === "/xray-planning") return location.startsWith("/xray-planning");
    return location === href;
  };

  // Rendered as a normal flex child (shrink-0) at the bottom of the column.
  // No portal, no position:fixed — flexbox keeps it pinned to the bottom of
  // the 100dvh container without any of the iOS Safari "fixed detach" reflow
  // bugs that plagued the previous portal approach.
  return (
    <nav
      className="md:hidden shrink-0 flex items-end z-50"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* Glass card */}
      <div
        className="w-full flex items-stretch bg-background/95 backdrop-blur-md border-t border-border overflow-hidden relative"
        style={{
          boxShadow: "0 -4px 24px rgba(0,0,0,0.07)",
          height: 64,
        }}
      >
        {NAV_ITEMS.slice(0, 2).map(({ href, key, Icon }) => {
          const active = isActive(href);
          return (
            <Link key={href} href={href} className="flex-1">
              <button className="w-full h-full flex flex-col items-center justify-center gap-0.5 relative group">
                {/* Active pill indicator */}
                {active && (
                  <span
                    className="absolute top-0 left-1/2 -translate-x-1/2 rounded-b-full"
                    style={{ width: 28, height: 3, background: "#1FB6E1" }}
                  />
                )}
                <Icon
                  className={cn("transition-all duration-200", active ? "h-[22px] w-[22px]" : "h-[20px] w-[20px]")}
                  style={{ color: active ? "#1FB6E1" : "#94A3B8", strokeWidth: active ? 2.2 : 1.8 }}
                />
                <span
                  className="text-[10px] font-semibold tracking-tight transition-colors duration-200"
                  style={{ color: active ? "#1FB6E1" : "#94A3B8" }}
                >
                  {t(key)}
                </span>
              </button>
            </Link>
          );
        })}

        {/* FAB — new surgery */}
        <div className="flex-none flex items-center justify-center shrink-0" style={{ width: 80 }}>
          <Link href="/surgeries/new">
            <button
              className="flex items-center justify-center rounded-full shadow-lg active:scale-95 transition-transform duration-150"
              style={{
                width: 52,
                height: 52,
                marginTop: -18,
                background: "linear-gradient(135deg, #1FB6E1 0%, #0A1628 100%)",
                boxShadow: "0 4px 18px rgba(31,182,225,0.40)",
              }}
              aria-label={t("nav.newProcedure")}
            >
              <Plus className="h-6 w-6 text-white" strokeWidth={2.5} />
            </button>
          </Link>
        </div>

        {NAV_ITEMS.slice(2).map(({ href, key, Icon }) => {
          const active = isActive(href);
          return (
            <Link key={href} href={href} className="flex-1">
              <button className="w-full h-full flex flex-col items-center justify-center gap-0.5 relative group">
                {active && (
                  <span
                    className="absolute top-0 left-1/2 -translate-x-1/2 rounded-b-full"
                    style={{ width: 28, height: 3, background: "#1FB6E1" }}
                  />
                )}
                <Icon
                  className={cn("transition-all duration-200", active ? "h-[22px] w-[22px]" : "h-[20px] w-[20px]")}
                  style={{ color: active ? "#1FB6E1" : "#94A3B8", strokeWidth: active ? 2.2 : 1.8 }}
                />
                <span
                  className="text-[10px] font-semibold tracking-tight transition-colors duration-200"
                  style={{ color: active ? "#1FB6E1" : "#94A3B8" }}
                >
                  {t(key)}
                </span>
              </button>
            </Link>
          );
        })}

        {/* JoIA */}
        <div className="flex-1">
          <button
            onClick={() => window.dispatchEvent(new Event("joia-open"))}
            className="w-full h-full flex flex-col items-center justify-center gap-0.5 relative group"
            aria-label={t("nav.openJoia")}
          >
            <div
              className="rounded-full overflow-hidden"
              style={{ width: 22, height: 22 }}
            >
              <img
                src={`${import.meta.env.BASE_URL}joia-logo.png`}
                alt="JoIA"
                className="w-full h-full object-cover"
              />
            </div>
            <span
              className="text-[10px] font-semibold tracking-tight"
              style={{ color: "#94A3B8" }}
            >
              JoIA
            </span>
          </button>
        </div>

        {/* More */}
        <div className="flex-1">
          <Sidebar mobile />
        </div>
      </div>
    </nav>
  );
}

function MobileHeader() {
  const [location, setLocation] = useLocation();
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { t } = useLanguage();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const main = document.getElementById("main-scroll");
    if (!main) return;
    const handler = () => setScrolled(main.scrollTop > 8);
    main.addEventListener("scroll", handler, { passive: true });
    return () => main.removeEventListener("scroll", handler);
  }, []);

  const backPath = getBackPath(location);
  const isNewSurgery = location.startsWith("/surgeries/new");
  const titleKey = Object.keys(PAGE_TITLE_KEYS).find(key => location.startsWith(key)) as keyof typeof PAGE_TITLE_KEYS | undefined;
  const title = titleKey ? t(PAGE_TITLE_KEYS[titleKey]) : "DocKnee";

  return (
    <header
      className="md:hidden sticky top-0 z-40 transition-all duration-200 bg-background/95 backdrop-blur-md"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        borderBottom: scrolled ? "1px solid rgba(0,0,0,0.09)" : "1px solid transparent",
        boxShadow: scrolled ? "0 1px 12px rgba(0,0,0,0.06)" : "none",
      }}
    >
      <div className="h-14 flex items-center px-3">
      <div className="flex items-center justify-between w-full gap-2">
        {/* Left: back button OR logo */}
        <div className="flex flex-1 items-center gap-2 min-w-0">
          {backPath ? (
            <button
              onClick={() => setLocation(backPath)}
              data-analytics-destination={backPath}
              className="flex items-center gap-1 shrink-0 rounded-lg px-2 py-1.5 transition-colors active:scale-95"
              style={{ background: "rgba(10,22,40,0.06)" }}
              aria-label={t("common.back")}
            >
              <ChevronLeft style={{ width: 18, height: 18, color: "#1FB6E1" }} strokeWidth={2.5} />
              <span className="text-xs font-semibold" style={{ color: "#1FB6E1" }}>{t("common.back")}</span>
            </button>
          ) : (
            <img
              src={`${import.meta.env.BASE_URL}${theme === "dark" ? "logo-docknee-new.png" : "logo-docknee-clean.png"}?v=3`}
              alt="DocKnee"
              width={132}
              height={39}
              className="h-9 w-[132px] max-w-none object-contain object-left shrink-0"
            />
          )}
          {backPath && !isNewSurgery && title !== t("nav.home") && title !== "DocKnee" && (
            <span className="text-sm font-semibold truncate" style={{ color: theme === "dark" ? "#e2e8f0" : "#0A1628" }}>
              {title}
            </span>
          )}
          {!backPath && !isNewSurgery && title !== t("nav.home") && title !== "DocKnee" && (
            <span className="flex-1 min-w-0 truncate text-sm font-semibold" style={{ color: theme === "dark" ? "#e2e8f0" : "#0A1628" }}>
              {title}
            </span>
          )}
        </div>

        {/* Right: theme toggle + avatar */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={toggleTheme}
            className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
            style={{ background: "rgba(10,22,40,0.07)" }}
            aria-label="Alternar tema"
          >
            {theme === "dark"
              ? <Sun style={{ width: 17, height: 17, color: "#1FB6E1" }} />
              : <Moon style={{ width: 17, height: 17, color: "#0A1628" }} />
            }
          </button>
          {user && (
            <Link href="/profile">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                style={{ background: "linear-gradient(135deg, #1A365D, #2A4A7F)" }}
              >
                {(() => {
                  const cleaned = (user.nome ?? "").replace(/^Dr[aA]?\.?\s*/i, "").trim();
                  const parts = cleaned.split(/\s+/).filter(Boolean);
                  if (parts.length === 0) return "?";
                  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
                  return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
                })()}
              </div>
            </Link>
          )}
        </div>
      </div>
      </div>
    </header>
  );
}

function DesktopBackButton() {
  const [location, setLocation] = useLocation();
  const { t } = useLanguage();
  const backPath = getBackPath(location);
  if (!backPath) return null;

  const titleKey = Object.keys(PAGE_TITLE_KEYS).find(key => location.startsWith(key)) as keyof typeof PAGE_TITLE_KEYS | undefined;
  const title = titleKey ? t(PAGE_TITLE_KEYS[titleKey]) : undefined;

  return (
    <div className="hidden md:flex items-center px-6 pt-4 pb-0">
      <button
        onClick={() => setLocation(backPath)}
        data-analytics-destination={backPath}
        className="flex items-center gap-1.5 text-sm font-medium rounded-lg px-3 py-1.5 transition-all active:scale-95 hover:bg-accent"
        style={{ color: "#1FB6E1" }}
        aria-label={t("common.back")}
      >
        <ChevronLeft style={{ width: 16, height: 16 }} strokeWidth={2.5} />
        <span>{t("common.back")}</span>
        {title && <span className="text-muted-foreground font-normal">— {title}</span>}
      </button>
    </div>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const isAdmin = user?.isAdmin;

  return (
    <div
      className="flex bg-background w-full max-w-[100vw] overflow-x-hidden"
      style={{ height: "100dvh", maxHeight: "100dvh" }}
    >
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
        <MobileHeader />
        <main
          id="main-scroll"
          className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 w-full relative"
        >
          <DesktopBackButton />
          {children}
        </main>
        {!isAdmin && <BottomNav />}
      </div>
      <JoIA />
    </div>
  );
}
