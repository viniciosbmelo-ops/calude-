import { useAuth } from "@/lib/auth";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, Users, BellRing, CalendarDays, LogOut, Menu, User, LineChart, MessageSquare, HelpCircle, Send, X, FlaskConical } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useState, useEffect, useCallback, useRef } from "react";
import { useLanguage } from "@/lib/i18n";
import { SUPPORT_WHATSAPP_URL } from "@/lib/support-contact";

const BRAND_TEAL = "#0E9AA7";
const BRAND_NAVY = "#0B1F4B";

interface SidebarProps {
  mobile?: boolean;
}

const DOCTOR_LINKS = [
  { href: "/dashboard", key: "nav.dashboard" as const, icon: LayoutDashboard },
  { href: "/regen", key: "nav.regenerative" as const, icon: FlaskConical },
  { href: "/patients", key: "nav.patients" as const, icon: Users },
  { href: "/agenda", key: "nav.appointments" as const, icon: CalendarDays },
  { href: "/followup-central", key: "nav.followups" as const, icon: BellRing },
  { href: "/reports", key: "nav.reports" as const, icon: LineChart },
  { href: "/profile", key: "nav.profile" as const, icon: User },
];

interface InboxMessage {
  id: number;
  mensagem: string;
  createdAt: string;
  resposta: string | null;
  respondidaEm: string | null;
  respostaLida: boolean;
}

function ContactModal({ open, onClose, user, onUnreadChange }: { open: boolean; onClose: () => void; user: any; onUnreadChange?: (n: number) => void }) {
  const { t, locale } = useLanguage();
  const [view, setView] = useState<"inbox" | "nova">("inbox");
  const [inbox, setInbox] = useState<InboxMessage[]>([]);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fetchInbox = useCallback(async () => {
    setLoadingInbox(true);
    try {
      const res = await fetch("/regen-api/inbox", { credentials: "same-origin" });
      if (res.ok) {
        const data: InboxMessage[] = await res.json();
        setInbox(data);
        const unread = data.filter(m => m.resposta && !m.respostaLida).length;
        onUnreadChange?.(unread);
      }
    } catch {} finally { setLoadingInbox(false); }
  }, [onUnreadChange]);

  const markReplyRead = useCallback(async (id: number) => {
    await fetch(`/regen-api/inbox/${id}/read-reply`, { method: "PATCH", credentials: "same-origin" });
    setInbox(prev => prev.map(m => m.id === id ? { ...m, respostaLida: true } : m));
    onUnreadChange?.(0);
  }, [onUnreadChange]);

  useEffect(() => {
    if (open) {
      setSent(false); setMensagem("");
      fetchInbox().then(() => setView("inbox"));
    }
  }, [open]);

  useEffect(() => {
    if (view === "nova") setTimeout(() => textareaRef.current?.focus(), 80);
  }, [view]);

  const handleSend = async () => {
    if (!mensagem.trim() || sending) return;
    setSending(true);
    try {
      await fetch("/regen-api/admin/contact", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: user?.nome, email: user?.email, crm: user?.crm ? `${user.crmEstado} ${user.crm}` : undefined, mensagem: mensagem.trim() }),
      });
      setSent(true);
      await fetchInbox();
    } catch {
      alert(t("support.sendError"));
    } finally { setSending(false); }
  };

  if (!open) return null;
  const unreadReplies = inbox.filter(m => m.resposta && !m.respostaLida).length;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl shadow-2xl flex flex-col"
        style={{ background: "#0F2035", border: "1px solid rgba(14,154,167,0.25)", maxHeight: "88vh" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "rgba(14,154,167,0.15)" }}>
              <MessageSquare className="h-4 w-4" style={{ color: BRAND_TEAL }} />
            </div>
            <div>
              <p className="text-sm font-semibold text-white leading-tight">{t("support.title")}</p>
              <p className="text-[11px] text-white/40 leading-tight">{t("support.adminMessages")}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex mx-5 mb-3 rounded-lg overflow-hidden shrink-0" style={{ background: "rgba(255,255,255,0.06)" }}>
          <button
            onClick={() => { setView("inbox"); setSent(false); }}
            className="flex-1 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all"
            style={view === "inbox" ? { background: "rgba(14,154,167,0.2)", color: BRAND_TEAL } : { color: "rgba(255,255,255,0.5)" }}
          >
            {t("support.messages")}
            {unreadReplies > 0 && (
              <span className="w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center" style={{ background: "#E53E3E", color: "#fff" }}>{unreadReplies}</span>
            )}
          </button>
          <button
            onClick={() => { setView("nova"); setSent(false); }}
            className="flex-1 py-2 text-xs font-semibold transition-all"
            style={view === "nova" ? { background: "rgba(14,154,167,0.2)", color: BRAND_TEAL } : { color: "rgba(255,255,255,0.5)" }}
          >
            {t("support.newMessage")}
          </button>
        </div>

        {/* Inbox view */}
        {view === "inbox" && (
          <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-3 min-h-0">
            {loadingInbox && <p className="text-xs text-white/40 text-center py-6">{t("common.loading")}</p>}
            {!loadingInbox && inbox.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <MessageSquare className="h-8 w-8 text-white/20" />
                <p className="text-sm text-white/40">{t("support.noMessages")}</p>
                <button onClick={() => setView("nova")} className="mt-2 text-xs font-medium px-4 py-2 rounded-lg" style={{ background: "rgba(14,154,167,0.15)", color: BRAND_TEAL }}>
                  {t("support.sendFirst")}
                </button>
              </div>
            )}
            {inbox.map(msg => {
              const hasUnreadReply = msg.resposta && !msg.respostaLida;
              return (
                <div key={msg.id} className="rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${hasUnreadReply ? "rgba(14,154,167,0.4)" : "rgba(255,255,255,0.08)"}` }}>
                  <div className="px-3.5 py-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] text-white/35">
                        {new Date(msg.createdAt).toLocaleString(locale, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {msg.resposta && !msg.respostaLida && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: BRAND_TEAL, color: "#fff" }}>{t("support.newReply")}</span>
                      )}
                      {msg.resposta && msg.respostaLida && (
                        <span className="text-[10px] text-white/30">{t("support.answered")}</span>
                      )}
                    </div>
                    <p className="text-sm text-white/70 leading-relaxed">{msg.mensagem}</p>
                  </div>
                  {msg.resposta && (
                    <div
                      className="px-3.5 py-3 cursor-pointer"
                      style={{ background: hasUnreadReply ? "rgba(14,154,167,0.1)" : "rgba(255,255,255,0.03)", borderTop: "1px solid rgba(14,154,167,0.15)" }}
                      onClick={() => { if (hasUnreadReply) markReplyRead(msg.id); }}
                    >
                      <p className="text-[11px] font-semibold mb-1" style={{ color: BRAND_TEAL }}>
                        {t("support.reply")} · {new Date(msg.respondidaEm!).toLocaleString(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </p>
                      <p className="text-sm text-white/80 leading-relaxed">{msg.resposta}</p>
                      {hasUnreadReply && (
                          <p className="text-[11px] mt-2" style={{ color: BRAND_TEAL }}>{t("support.markRead")}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Nova mensagem view */}
        {view === "nova" && (
          <div className="px-5 pb-5 flex flex-col gap-3 shrink-0">
            {sent ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "rgba(14,154,167,0.15)" }}>
                  <Send className="h-5 w-5" style={{ color: BRAND_TEAL }} />
                </div>
                <p className="text-sm font-medium text-white">{t("support.sent")}</p>
                <p className="text-xs text-white/50 text-center">{t("support.sentDescription")}</p>
                <button onClick={() => { setSent(false); setView("inbox"); }} className="mt-1 text-xs font-medium px-4 py-2 rounded-lg" style={{ background: "rgba(14,154,167,0.15)", color: BRAND_TEAL }}>
                  {t("support.viewMessages")}
                </button>
              </div>
            ) : (
              <>
                <textarea
                  ref={textareaRef}
                  value={mensagem}
                  onChange={e => setMensagem(e.target.value)}
                  placeholder={t("support.placeholder")}
                  rows={5}
                  className="w-full rounded-xl px-3.5 py-3 text-sm text-white placeholder-white/30 resize-none outline-none transition-all"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                />
                <button
                  onClick={handleSend}
                  disabled={!mensagem.trim() || sending}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40"
                  style={{ background: BRAND_TEAL }}
                >
                  <Send className="h-4 w-4" />
                  {sending ? t("support.sending") : t("support.send")}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SidebarContent({ onNavClick }: { onNavClick?: () => void }) {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const [location] = useLocation();
  const [contactOpen, setContactOpen] = useState(false);

  const links = DOCTOR_LINKS.map(link => ({
    ...link,
    label: t(link.key),
  }));
  const [inboxUnread, setInboxUnread] = useState(0);

  useEffect(() => {
    const fetchInboxCount = async () => {
      try {
        const res = await fetch("/regen-api/inbox/unread-count", { credentials: "same-origin" });
        if (res.ok) { const d = await res.json(); setInboxUnread(d.count ?? 0); }
      } catch {}
    };
    fetchInboxCount();
    const iv = setInterval(fetchInboxCount, 30_000);
    return () => clearInterval(iv);
  }, []);

  const isActive = (href: string) =>
    location === href ||
    (href === "/regen" && location.startsWith("/regen/")) ||
    (href === "/patients" && location.startsWith("/patients/")) ||
    (href === "/reports" && location.startsWith("/reports?"));

  return (
    <div className="flex flex-col h-full w-64" style={{ background: BRAND_NAVY }}>
      <div className="px-4 pt-6 pb-4 flex items-center justify-center">
        <img
          src={`${import.meta.env.BASE_URL}logo-docregen-white.png`}
          alt="DocRegen"
          style={{ height: 96, width: "100%", objectFit: "contain" }}
        />
      </div>

      <div className="mx-5 border-t border-white/10" />
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {links.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          const btnClass = cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
            active ? "text-white" : "text-white/65 hover:text-white hover:bg-white/8"
          );
          const btnStyle = active ? { background: "rgba(14, 154, 167, 0.22)", color: BRAND_TEAL } : undefined;
          return (
            <Link key={href} href={href} onClick={onNavClick}>
              <button className={btnClass} style={btnStyle}>
                <Icon className="h-4 w-4 shrink-0" style={{ color: active ? BRAND_TEAL : undefined }} />
                <span className="flex-1 text-left">{label}</span>
                {active && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full shrink-0" style={{ background: BRAND_TEAL }} />
                )}
              </button>
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-white/10">
        <a
          href={SUPPORT_WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onNavClick}
          className="w-full flex items-center gap-3 px-3 py-2.5 mb-1 rounded-lg text-sm font-medium transition-all"
          style={{ color: inboxUnread > 0 ? BRAND_TEAL : "rgba(14,154,167,0.8)" }}
          onMouseEnter={e => (e.currentTarget.style.background = "rgba(14,154,167,0.1)")}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
        >
          <HelpCircle className="h-4 w-4 shrink-0" style={{ color: inboxUnread > 0 ? BRAND_TEAL : undefined }} />
          <span className="flex-1 text-left">{t("nav.support")}</span>
          {inboxUnread > 0 && (
            <span
              className="flex items-center justify-center text-white font-bold rounded-full text-[10px] leading-none shrink-0"
              style={{ background: "#E53E3E", minWidth: 18, height: 18, padding: "0 5px", boxShadow: "0 0 0 2px rgba(10,24,40,0.8)" }}
            >
              {inboxUnread}
            </span>
          )}
        </a>
        <div className="px-3 py-2 mb-1">
          <p className="text-sm font-semibold text-white truncate">{user?.nome}</p>
          <p className="text-xs text-white/50 mt-0.5">CRM {user?.crm} · {user?.crmEstado}</p>
        </div>
        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-white/60 hover:text-red-400 hover:bg-red-500/10 transition-all"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {t("nav.logout")}
        </button>
      </div>

      <ContactModal open={contactOpen} onClose={() => setContactOpen(false)} user={user} onUnreadChange={setInboxUnread} />
    </div>
  );
}

export function Sidebar({ mobile = false }: SidebarProps) {
  const [open, setOpen] = useState(false);
  const { t } = useLanguage();

  if (mobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button className="w-full h-full flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-muted-foreground">
            <Menu className="h-5 w-5" />
            {t("nav.more")}
          </button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0 w-64 border-none">
          <SheetTitle className="sr-only">{t("nav.more")}</SheetTitle>
          <SheetDescription className="sr-only">
            {t("nav.menuDescription")}
          </SheetDescription>
          <SidebarContent onNavClick={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    );
  }

  return <div className="hidden md:block h-screen sticky top-0 shrink-0"><SidebarContent /></div>;
}
