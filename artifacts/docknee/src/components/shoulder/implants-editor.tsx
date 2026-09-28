/** Implantes da cirurgia. O código GS1 (DataMatrix/código de barras) colado ou lido preenche lote, série e validade. */
import { useState } from "react";
import { Plus, ScanLine, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { parseGs1, type ClinicalImplant } from "@workspace/clinical/web";
import { IMPLANT_CATEGORIES, canAddImplant, emptyImplantDraft, implantSummary } from "./implant-draft";

export function ImplantsEditor({ value, onChange, readOnly }: { value: ClinicalImplant[]; onChange(v: ClinicalImplant[]): void; readOnly?: boolean }) {
  const [draft, setDraft] = useState<ClinicalImplant | null>(null);
  const [scanMsg, setScanMsg] = useState<string | null>(null);

  function readCode(raw: string) {
    if (!draft) return;
    setDraft((d) => d && ({ ...d, codigoBarras: raw || undefined }));
    if (!raw.trim()) { setScanMsg(null); return; }
    try {
      const r = parseGs1(raw);
      setDraft((d) => d && ({ ...d, codigoBarras: raw, lote: r.lot ?? d.lote, serie: r.serial ?? d.serie, validade: r.expiry ?? d.validade }));
      setScanMsg(`Lido: GTIN ${r.gtin ?? "—"} · lote ${r.lot ?? "—"} · validade ${r.expiry ?? "—"}${r.serial ? ` · série ${r.serial}` : ""}`);
    } catch (e) {
      setScanMsg(e instanceof Error ? e.message : "Código inválido.");
    }
  }

  const upd = (patch: Partial<ClinicalImplant>) => setDraft((d) => d && ({ ...d, ...patch }));
  const canAdd = canAddImplant(draft);

  return (
    <div className="space-y-3">
      {value.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum implante registrado.</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {value.map((m, i) => (
            <li key={i} className="flex items-start justify-between gap-3 p-3 text-sm">
              <div>
                <p className="font-medium">{m.quantidade}× {m.fabricante} {m.modelo}{m.tamanho ? ` (${m.tamanho})` : ""}</p>
                <p className="text-xs text-muted-foreground">
                  {implantSummary(m)}
                </p>
              </div>
              {!readOnly && (
                <button type="button" aria-label="Remover implante" className="text-muted-foreground hover:text-destructive" onClick={() => onChange(value.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && !draft && (
        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => { setDraft(emptyImplantDraft()); setScanMsg(null); }}>
          <Plus className="h-4 w-4" /> Adicionar implante
        </Button>
      )}

      {draft && (
        <div className="space-y-3 rounded-xl border p-4 bg-muted/20">
          <div className="space-y-2">
            <Label htmlFor="imp-gs1" className="flex items-center gap-2"><ScanLine className="h-4 w-4" /> Código GS1 (opcional)</Label>
            <Input id="imp-gs1" placeholder="Leia com o leitor ou cole: (01)…(17)…(10)…" value={draft.codigoBarras ?? ""} onChange={(e) => readCode(e.target.value)} />
            {scanMsg && <p className="text-xs text-muted-foreground">{scanMsg}</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="imp-cat">Categoria *</Label>
              <Select value={draft.categoria} onValueChange={(v) => upd({ categoria: v })}>
                <SelectTrigger id="imp-cat"><SelectValue placeholder="Selecione a categoria" /></SelectTrigger>
                <SelectContent>{IMPLANT_CATEGORIES.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label htmlFor="imp-qtd">Quantidade</Label><Input id="imp-qtd" inputMode="numeric" value={String(draft.quantidade)} onChange={(e) => upd({ quantidade: Math.max(1, Math.min(50, Number.parseInt(e.target.value, 10) || 1)) })} /></div>
            <div className="space-y-2"><Label htmlFor="imp-fab">Fabricante *</Label><Input id="imp-fab" maxLength={120} value={draft.fabricante} onChange={(e) => upd({ fabricante: e.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="imp-modelo">Modelo *</Label><Input id="imp-modelo" maxLength={120} value={draft.modelo} onChange={(e) => upd({ modelo: e.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="imp-tamanho">Tamanho</Label><Input id="imp-tamanho" maxLength={40} placeholder="ex.: 4,75 mm" value={draft.tamanho ?? ""} onChange={(e) => upd({ tamanho: e.target.value || undefined })} /></div>
            <div className="space-y-2"><Label htmlFor="imp-lote">Lote</Label><Input id="imp-lote" maxLength={60} value={draft.lote ?? ""} onChange={(e) => upd({ lote: e.target.value || undefined })} /></div>
            <div className="space-y-2"><Label htmlFor="imp-serie">Série</Label><Input id="imp-serie" maxLength={60} value={draft.serie ?? ""} onChange={(e) => upd({ serie: e.target.value || undefined })} /></div>
            <div className="space-y-2"><Label htmlFor="imp-validade">Validade</Label><Input id="imp-validade" type="date" value={draft.validade ?? ""} onChange={(e) => upd({ validade: e.target.value || undefined })} /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="imp-local">Localização</Label><Input id="imp-local" maxLength={120} placeholder="ex.: fileira medial" value={draft.localizacao ?? ""} onChange={(e) => upd({ localizacao: e.target.value || undefined })} /></div>
          </div>
          {!draft.lote && (
            <p className="text-xs text-amber-700">Sem lote: {draft.categoria === "prosthesis_component" ? "componente protético precisa de lote para rastreabilidade." : "registre o lote sempre que possível."}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)}>Cancelar</Button>
            <Button type="button" size="sm" disabled={!canAdd} onClick={() => { onChange([...value, { ...draft!, fabricante: draft!.fabricante.trim(), modelo: draft!.modelo.trim() }]); setDraft(null); }}>Adicionar</Button>
          </div>
        </div>
      )}
    </div>
  );
}
