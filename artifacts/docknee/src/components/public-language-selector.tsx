import { Languages } from "lucide-react";
import { useLanguage, type Locale } from "@/lib/i18n";
import { publicPageMessages } from "@/locales/public-pages";

export function PublicLanguageSelector({ dark = false }: { dark?: boolean }) {
  const { locale, setLanguage } = useLanguage();
  const copy = publicPageMessages[locale];

  return (
    <label
      className="inline-flex items-center gap-2 text-xs"
      style={{ color: dark ? "rgba(255,255,255,.72)" : "#4A6070" }}
    >
      <Languages size={15} aria-hidden="true" />
      <span className="sr-only">{copy.language}</span>
      <select
        value={locale}
        onChange={(event) => void setLanguage(event.target.value as Locale)}
        aria-label={copy.language}
        data-testid="select-public-language"
        className="rounded-md border px-2 py-1.5 text-xs"
        style={{
          borderColor: dark ? "rgba(255,255,255,.25)" : "#D8E6EE",
          background: dark ? "#0D1F30" : "#FFFFFF",
          color: dark ? "#FFFFFF" : "#0F1F2B",
        }}
      >
        <option value="pt-BR">{copy.portuguese}</option>
        <option value="es">{copy.spanish}</option>
      </select>
    </label>
  );
}