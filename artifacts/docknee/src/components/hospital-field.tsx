import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { sortByPtBrName } from "@/lib/utils";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { surgeryNewDisplayLabels, surgeryNewMessages } from "@/locales/surgery-new";

// ── HospitalField: dropdown com serviços vinculados + locais favoritos + texto livre ──
export function HospitalField({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  const t = useScopedTranslations(surgeryNewMessages);
  const { locale } = useLanguage();
  const [services, setServices] = useState<{ id: number; nome: string }[]>([]);
  const [locations, setLocations] = useState<{ id: number; nome: string }[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const fetchOpts = { credentials: "same-origin" as const };
    Promise.all([
      fetch("/api/doctor/services", fetchOpts).then(r => r.json()).catch(() => []),
      fetch("/api/doctor/locations", fetchOpts).then(r => r.json()).catch(() => []),
    ]).then(([s, l]) => {
      setServices(Array.isArray(s) ? sortByPtBrName(s, (service) => service.nome, (service) => service.id) : []);
      setLocations(Array.isArray(l) ? sortByPtBrName(l, (location) => location.nome, (location) => location.id) : []);
    });
  }, []);

  const suggestions = [
    ...services.map(s => ({ label: s.nome, group: "Serviços Vinculados" })),
    ...locations.map(l => ({ label: l.nome, group: "Locais Favoritos" })),
  ];

  const filtered = suggestions.filter(s => s.label.toLowerCase().includes(value.toLowerCase()));
  const showDropdown = open && filtered.length > 0;

  return (
    <div className="relative">
      <Input
        id={id}
        placeholder={t("hospitalPlaceholder")}
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        autoComplete="off"
      />
      {showDropdown && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
          {(() => {
            let lastGroup = "";
            return filtered.map((s, i) => {
              const showHeader = s.group !== lastGroup;
              lastGroup = s.group;
              return (
                <div key={i}>
                  {showHeader && (
                    <div className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide bg-muted/40">
                      {surgeryNewDisplayLabels[locale][s.group] ?? s.group}
                    </div>
                  )}
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 transition-colors"
                    onMouseDown={() => { onChange(s.label); setOpen(false); }}
                  >
                    {s.label}
                  </button>
                </div>
              );
            });
          })()}
        </div>
      )}
    </div>
  );
}
