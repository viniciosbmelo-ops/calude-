import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetCurrentDoctorQueryKey } from "@workspace/api-client-react";
import { useAuth } from "./auth";
import { formatCalendarDate, safeFormatDate } from "./utils";

export const SUPPORTED_LOCALES = ["pt-BR", "es"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

const DEFAULT_LOCALE: Locale = "pt-BR";
const LOCALE_STORAGE_KEY = "docknee_locale";

/**
 * Owns a temporary public-page locale. Only the most recently acquired
 * override can restore the normal locale, so a page which finishes loading
 * after it was unmounted cannot change the display language.
 */
export function createDisplayLocaleOverrideLifecycle(
  applyLocale: (locale: Locale) => void,
  getRestoreLocale: () => Locale,
) {
  let activeOverrideId = 0;
  let hasActiveOverride = false;

  return {
    begin(locale: Locale) {
      const overrideId = ++activeOverrideId;
      hasActiveOverride = true;
      applyLocale(locale);

      return () => {
        if (!hasActiveOverride || overrideId !== activeOverrideId) return;
        hasActiveOverride = false;
        activeOverrideId++;
        applyLocale(getRestoreLocale());
      };
    },
    isActive: () => hasActiveOverride,
  };
}

const messages = {
  "pt-BR": {
    "common.loading": "Carregando...",
    "common.back": "Voltar",
    "common.save": "Salvar",
    "common.saving": "Salvando...",
    "common.cancel": "Cancelar",
    "common.error": "Erro",
    "common.connectionError": "Erro de conexão",
    "common.language": "Idioma",
    "common.portuguese": "Português (Brasil)",
    "common.spanish": "Español",
    "nav.home": "Início",
    "nav.dashboard": "Painel",
    "nav.patients": "Pacientes",
    "nav.appointments": "Agendamentos",
    "nav.surgicalSchedule": "Agenda Cirúrgica",
    "nav.procedures": "Procedimentos",
    "nav.surgeries": "Cirurgias",
    "nav.regenerative": "Regenerativa",
    "nav.followups": "Follow-ups",
    "nav.reports": "Relatórios",
    "nav.profile": "Perfil",
    "nav.admin": "Painel Admin",
    "nav.messages": "Mensagens",
    "nav.support": "Falar com suporte",
    "nav.logout": "Sair",
    "nav.more": "Mais",
    "nav.newProcedure": "Novo procedimento",
    "nav.openAssistant": "Abrir Assistente IA",
    "nav.adminRole": "Administrador",
    "nav.adminPlatform": "Administrador da Plataforma",
    "nav.menuDescription": "Acesse as seções da plataforma DocSholder.",
    "support.sent": "Mensagem enviada!",
    "support.sentDescription": "O administrador receberá em breve e poderá responder aqui.",
    "support.viewMessages": "Ver mensagens",
    "support.placeholder": "Descreva sua dúvida ou problema...",
    "support.sending": "Enviando...",
    "support.send": "Enviar mensagem",
    "support.reply": "Resposta do administrador",
    "support.markRead": "Toque para marcar como lida",
    "support.sendError": "Erro ao enviar mensagem. Tente novamente.",
    "support.title": "Suporte",
    "support.adminMessages": "Mensagens com o administrador",
    "support.messages": "Mensagens",
    "support.newMessage": "Nova mensagem",
    "support.noMessages": "Nenhuma mensagem ainda.",
    "support.sendFirst": "Enviar primeira mensagem",
    "support.newReply": "NOVA RESPOSTA",
    "support.answered": "Respondida",
    "profile.title": "Meu Perfil",
    "profile.subtitle": "Gerencie seus dados pessoais, profissionais e de contato.",
    "profile.doctor": "Médico",
    "profile.credentials": "Credenciais de Acesso",
    "profile.credentialsDescription": "E-mail é usado para login. Entre em contato com o administrador para alterações.",
    "profile.email": "E-mail",
    "profile.cpf": "CPF",
    "profile.originCountry": "País de Origem",
    "profile.personalData": "Dados Pessoais",
    "profile.professionalData": "Dados Profissionais",
    "profile.professionalDataCrm": "Dados Profissionais (CRM)",
    "profile.languageDescription": "Escolha o idioma da plataforma, documentos e comunicações.",
    "profile.languageSaved": "Idioma atualizado.",
    "profile.languageSaveError": "Não foi possível salvar o idioma.",
    "profile.appearance": "Aparência",
    "profile.appearanceDescription": "Escolha entre tema claro ou escuro.",
    "profile.light": "Claro",
    "profile.dark": "Escuro",
    "profile.support": "Suporte e Contato",
    "profile.supportDescription": "Entre em contato conosco para dúvidas, sugestões ou problemas com a plataforma.",
    "profile.supportEmail": "Email de suporte",
    "profile.saveProfile": "Salvar Perfil",
    "profile.saved": "Perfil atualizado com sucesso!",
    "auth.login": "Entrar",
    "auth.loginError": "Erro ao fazer login",
    "auth.invalidCredentials": "Credenciais inválidas",
    "notFound.title": "Página não encontrada",
    "notFound.description": "A página solicitada não existe.",
  },
  es: {
    "common.loading": "Cargando...",
    "common.back": "Volver",
    "common.save": "Guardar",
    "common.saving": "Guardando...",
    "common.cancel": "Cancelar",
    "common.error": "Error",
    "common.connectionError": "Error de conexión",
    "common.language": "Idioma",
    "common.portuguese": "Português (Brasil)",
    "common.spanish": "Español",
    "nav.home": "Inicio",
    "nav.dashboard": "Panel",
    "nav.patients": "Pacientes",
    "nav.appointments": "Citas",
    "nav.surgicalSchedule": "Agenda Quirúrgica",
    "nav.procedures": "Procedimientos",
    "nav.surgeries": "Cirugías",
    "nav.regenerative": "Regenerativa",
    "nav.followups": "Seguimientos",
    "nav.reports": "Informes",
    "nav.profile": "Perfil",
    "nav.admin": "Panel Admin",
    "nav.messages": "Mensajes",
    "nav.support": "Hablar con soporte",
    "nav.logout": "Salir",
    "nav.more": "Más",
    "nav.newProcedure": "Nuevo procedimiento",
    "nav.openAssistant": "Abrir Asistente IA",
    "nav.adminRole": "Administrador",
    "nav.adminPlatform": "Administrador de la Plataforma",
    "nav.menuDescription": "Acceda a las secciones de la plataforma DocSholder.",
    "support.sent": "¡Mensaje enviado!",
    "support.sentDescription": "El administrador lo recibirá pronto y podrá responder aquí.",
    "support.viewMessages": "Ver mensajes",
    "support.placeholder": "Describa su duda o problema...",
    "support.sending": "Enviando...",
    "support.send": "Enviar mensaje",
    "support.reply": "Respuesta del administrador",
    "support.markRead": "Toque para marcar como leída",
    "support.sendError": "Error al enviar el mensaje. Inténtelo de nuevo.",
    "support.title": "Soporte",
    "support.adminMessages": "Mensajes con el administrador",
    "support.messages": "Mensajes",
    "support.newMessage": "Nuevo mensaje",
    "support.noMessages": "Aún no hay mensajes.",
    "support.sendFirst": "Enviar el primer mensaje",
    "support.newReply": "NUEVA RESPUESTA",
    "support.answered": "Respondida",
    "profile.title": "Mi Perfil",
    "profile.subtitle": "Administre sus datos personales, profesionales y de contacto.",
    "profile.doctor": "Médico",
    "profile.credentials": "Credenciales de acceso",
    "profile.credentialsDescription": "El correo electrónico se utiliza para iniciar sesión. Contacte al administrador para modificarlo.",
    "profile.email": "Correo electrónico",
    "profile.cpf": "CPF",
    "profile.originCountry": "País de origen",
    "profile.personalData": "Datos personales",
    "profile.professionalData": "Datos profesionales",
    "profile.professionalDataCrm": "Datos profesionales (CRM)",
    "profile.languageDescription": "Elija el idioma de la plataforma, los documentos y las comunicaciones.",
    "profile.languageSaved": "Idioma actualizado.",
    "profile.languageSaveError": "No se pudo guardar el idioma.",
    "profile.appearance": "Apariencia",
    "profile.appearanceDescription": "Elija entre el tema claro u oscuro.",
    "profile.light": "Claro",
    "profile.dark": "Oscuro",
    "profile.support": "Soporte y contacto",
    "profile.supportDescription": "Contáctenos para dudas, sugerencias o problemas con la plataforma.",
    "profile.supportEmail": "Correo de soporte",
    "profile.saveProfile": "Guardar perfil",
    "profile.saved": "¡Perfil actualizado correctamente!",
    "auth.login": "Iniciar sesión",
    "auth.loginError": "Error al iniciar sesión",
    "auth.invalidCredentials": "Credenciales inválidas",
    "notFound.title": "Página no encontrada",
    "notFound.description": "La página solicitada no existe.",
  },
} as const;

export type TranslationKey = keyof typeof messages["pt-BR"];
type TranslationParams = Record<string, string | number>;
export type ScopedMessages<T extends Record<string, string>> = {
  "pt-BR": T;
  es: { [K in keyof T]: string };
};

function normalizeLocale(value: unknown): Locale {
  return value === "es" ? "es" : DEFAULT_LOCALE;
}

function readStoredLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  return normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
}

export function resolveRestoredDisplayLocale(
  accountLocale: unknown,
  storedLocale: unknown,
): Locale {
  if (typeof accountLocale === "string" && accountLocale.trim()) {
    return normalizeLocale(accountLocale);
  }
  return normalizeLocale(storedLocale);
}

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? `{${key}}`));
}

export function resolveScopedTranslation<T extends Record<string, string>>(
  catalog: ScopedMessages<T>,
  locale: Locale,
  key: keyof T,
  params?: TranslationParams,
): string {
  return interpolate(catalog[locale][key] ?? catalog[DEFAULT_LOCALE][key] ?? String(key), params);
}

interface LanguageContextValue {
  locale: Locale;
  t: (key: TranslationKey, params?: TranslationParams) => string;
  setLanguage: (locale: Locale) => Promise<void>;
  beginTemporaryDisplayLanguage: (locale: Locale) => () => void;
  /** Timestamps/instants (and date-only strings as calendar dates). Never throws: "—" for invalid input. */
  formatDate: (value: Date | string | number | null | undefined, options?: Intl.DateTimeFormatOptions) => string;
  /** Calendar dates (birth, case, scheduled dates) — never timezone-shifted. "—" for invalid input. */
  formatCalendarDate: (value: Date | string | null | undefined, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatCurrency: (value: number, currency?: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [locale, setLocale] = useState<Locale>(readStoredLocale);
  const userRef = useRef(user);
  userRef.current = user;
  const displayLocaleLifecycleRef = useRef<ReturnType<typeof createDisplayLocaleOverrideLifecycle> | null>(null);

  if (!displayLocaleLifecycleRef.current) {
    displayLocaleLifecycleRef.current = createDisplayLocaleOverrideLifecycle(
      setLocale,
      () => resolveRestoredDisplayLocale(
        (userRef.current as { idioma?: string } | null)?.idioma,
        typeof window === "undefined" ? null : window.localStorage.getItem(LOCALE_STORAGE_KEY),
      ),
    );
  }

  useEffect(() => {
    if (!user) return;
    const next = normalizeLocale((user as { idioma?: string }).idioma);
    window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    // An account refresh must not replace a token owner's temporary locale.
    if (!displayLocaleLifecycleRef.current?.isActive()) setLocale(next);
  }, [user]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const beginTemporaryDisplayLanguage = useCallback((next: Locale) => {
    return displayLocaleLifecycleRef.current!.begin(next);
  }, []);

  const setLanguage = useCallback(async (next: Locale) => {
    const previous = locale;
    setLocale(next);
    window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    document.documentElement.lang = next;
    if (!user) return;

    try {
      const response = await fetch(`/api/doctors/${user.id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idioma: next }),
      });
      if (!response.ok) throw new Error("language-update-failed");
      const saved = await response.json();
      queryClient.setQueryData(getGetCurrentDoctorQueryKey(), saved);
    } catch (error) {
      setLocale(previous);
      window.localStorage.setItem(LOCALE_STORAGE_KEY, previous);
      document.documentElement.lang = previous;
      throw error;
    }
  }, [locale, queryClient, user]);

  const value = useMemo<LanguageContextValue>(() => ({
    locale,
    t: (key, params) => interpolate(messages[locale][key] ?? messages[DEFAULT_LOCALE][key] ?? key, params),
    setLanguage,
    beginTemporaryDisplayLanguage,
    formatDate: (value, options) => safeFormatDate(value, locale, options),
    formatCalendarDate: (value, options) => formatCalendarDate(value, locale, options),
    formatNumber: (value, options) => new Intl.NumberFormat(locale, options).format(value),
    formatCurrency: (value, currency = "BRL") => new Intl.NumberFormat(locale, { style: "currency", currency }).format(value),
  }), [beginTemporaryDisplayLanguage, locale, setLanguage]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within a LanguageProvider");
  return context;
}

export function useScopedTranslations<T extends Record<string, string>>(catalog: ScopedMessages<T>) {
  const { locale } = useLanguage();
  return useCallback(
    (key: keyof T, params?: TranslationParams) => resolveScopedTranslation(catalog, locale, key, params),
    [catalog, locale],
  );
}