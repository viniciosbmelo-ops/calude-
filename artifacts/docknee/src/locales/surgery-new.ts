import type { Locale, ScopedMessages } from "@/lib/i18n";

/** Rótulos de exibição de valores gravados em português (só apresentação). */
export const surgeryNewDisplayLabels: Record<Locale, Record<string, string>> = {
  "pt-BR": {},
  es: {
    "Serviços Vinculados": "Servicios vinculados",
    "Locais Favoritos": "Ubicaciones favoritas",
  },
};

/** Textos compartilhados do cadastro de cirurgia (campo de hospital). */
export const surgeryNewMessages = {
  "pt-BR": {
    hospitalPlaceholder: "Nome do hospital ou clínica",
  },
  es: {
    hospitalPlaceholder: "Nombre del hospital o clínica",
  },
} satisfies ScopedMessages<Record<string, string>>;
