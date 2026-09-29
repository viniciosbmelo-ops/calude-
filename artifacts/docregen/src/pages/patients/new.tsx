import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCreatePatient } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useScopedTranslations } from "@/lib/i18n";
import { operationalCoreMessages } from "@/locales/operational-core";
import { operationalPatientRecordMessages } from "@/locales/operational-patient-record";
import {
  ArrowLeft,
  CheckCircle2,
  FlaskConical,
  Heart,
  MapPin,
  Save,
  User,
} from "lucide-react";
import { Link } from "wouter";
import { useSubscriptionStatus } from "@/hooks/use-subscription-status";
import { SubscriptionGate } from "@/components/subscription-gate";

const ESTADOS_BR = [
  { uf: "AC", nome: "Acre" },
  { uf: "AL", nome: "Alagoas" },
  { uf: "AP", nome: "Amapá" },
  { uf: "AM", nome: "Amazonas" },
  { uf: "BA", nome: "Bahia" },
  { uf: "CE", nome: "Ceará" },
  { uf: "DF", nome: "Distrito Federal" },
  { uf: "ES", nome: "Espírito Santo" },
  { uf: "GO", nome: "Goiás" },
  { uf: "MA", nome: "Maranhão" },
  { uf: "MT", nome: "Mato Grosso" },
  { uf: "MS", nome: "Mato Grosso do Sul" },
  { uf: "MG", nome: "Minas Gerais" },
  { uf: "PA", nome: "Pará" },
  { uf: "PB", nome: "Paraíba" },
  { uf: "PR", nome: "Paraná" },
  { uf: "PE", nome: "Pernambuco" },
  { uf: "PI", nome: "Piauí" },
  { uf: "RJ", nome: "Rio de Janeiro" },
  { uf: "RN", nome: "Rio Grande do Norte" },
  { uf: "RS", nome: "Rio Grande do Sul" },
  { uf: "RO", nome: "Rondônia" },
  { uf: "RR", nome: "Roraima" },
  { uf: "SC", nome: "Santa Catarina" },
  { uf: "SP", nome: "São Paulo" },
  { uf: "SE", nome: "Sergipe" },
  { uf: "TO", nome: "Tocantins" },
];

export default function NewPatient() {
  const t = useScopedTranslations(operationalCoreMessages);
  const tr = useScopedTranslations(operationalPatientRecordMessages);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createPatientMutation = useCreatePatient();
  const { canWrite, loading: subLoading } = useSubscriptionStatus();
  const [createdPatient, setCreatedPatient] = useState<{ id: number; nome: string } | null>(null);

  const [formData, setFormData] = useState({
    nome: "",
    cpf: "",
    dataNascimento: "",
    email: "",
    sexo: "",
    telefone: "",
    planoSaude: "",
    numeroCarteirinha: "",
    indicadoPor: "",
    pais: "",
    endereco: "",
    cidade: "",
    estado: "",
    cep: "",
  });

  const set = (field: string, value: string) => setFormData(prev => ({ ...prev, [field]: value }));

  const formatCpf = (value: string) => {
    const d = value.replace(/\D/g, "").slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0,3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`;
    return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(formData)) {
      if (v.trim() !== "") payload[k] = v.trim();
    }
    createPatientMutation.mutate(
      { data: payload as never },
      {
        onSuccess: (data) => {
          toast({ title: tr("patientCreatedToast") });
          setCreatedPatient({ id: data.id, nome: formData.nome.trim() });
        },
        onError: () => {
          toast({ title: tr("patientCreateError"), variant: "destructive" });
        }
      }
    );
  };

  const goToPatient = () => {
    if (createdPatient) setLocation(`/patients/${createdPatient.id}`);
  };

  if (!subLoading && !canWrite) return <SubscriptionGate />;

  return (
    <div className="w-full max-w-2xl mx-auto min-w-0">

      {/* Mobile navy banner */}
      <div className="md:hidden" style={{ background: "linear-gradient(135deg, #0B1F4B 0%, #12306B 100%)" }}>
        <div className="px-4 pt-5 pb-5">
          <Link href="/patients">
            <button style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "rgba(14,154,167,0.95)", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 10 }}>
              <ArrowLeft className="h-3.5 w-3.5" />
              {tr("patients")}
            </button>
          </Link>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#fff", margin: 0 }}>{t("newPatient")}</h1>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", margin: "4px 0 0" }}>{tr("completeRegistration")}</p>
        </div>
      </div>

      {/* Desktop header */}
      <div className="hidden md:flex items-center gap-4 p-8 pb-0">
        <Link href="/patients">
          <Button variant="outline" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("newPatient")}</h1>
          <p className="text-muted-foreground">{tr("completePatientRegistration")}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="p-4 md:p-8 space-y-6">

          {/* Identificação */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <User className="h-4 w-4 text-primary" /> {tr("identification")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="nome">{tr("fullName")}</Label>
                  <Input
                    id="nome"
                    placeholder={tr("fullNamePlaceholder")}
                    value={formData.nome}
                    onChange={e => set("nome", e.target.value.toLocaleUpperCase("pt-BR"))}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cpf">CPF</Label>
                  <Input id="cpf" placeholder="000.000.000-00" value={formData.cpf} onChange={e => set("cpf", formatCpf(e.target.value))} maxLength={14} />
                  <p className="text-xs text-muted-foreground">{tr("cpfHelp")}</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="dataNascimento">{tr("birthDate")}</Label>
                  <Input id="dataNascimento" type="date" value={formData.dataNascimento} onChange={e => set("dataNascimento", e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sexo">{tr("sex")}</Label>
                  <Select value={formData.sexo} onValueChange={val => set("sexo", val)}>
                    <SelectTrigger id="sexo"><SelectValue placeholder={tr("select")} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="M">{tr("male")}</SelectItem>
                      <SelectItem value="F">{tr("female")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="telefone">{tr("phoneWhatsapp")}</Label>
                  <Input id="telefone" placeholder="(00) 00000-0000" value={formData.telefone} onChange={e => set("telefone", e.target.value)} />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="email">{tr("email")}</Label>
                  <Input id="email" type="email" placeholder={tr("emailPlaceholder")} value={formData.email} onChange={e => set("email", e.target.value)} />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Saúde e Origem */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Heart className="h-4 w-4 text-primary" /> {tr("healthOrigin")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="planoSaude">{tr("healthPlan")}</Label>
                  <Input id="planoSaude" placeholder={tr("healthPlanPlaceholder")} value={formData.planoSaude} onChange={e => set("planoSaude", e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="numeroCarteirinha">{tr("memberNumber")}</Label>
                  <Input id="numeroCarteirinha" placeholder={tr("memberNumberPlaceholder")} value={formData.numeroCarteirinha} onChange={e => set("numeroCarteirinha", e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="indicadoPor">{tr("referredBy")}</Label>
                  <Input id="indicadoPor" placeholder={tr("referredByPlaceholder")} value={formData.indicadoPor} onChange={e => set("indicadoPor", e.target.value)} />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Endereço */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" /> {tr("addressSection")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="pais">{tr("country")}</Label>
                  <Input id="pais" placeholder={tr("countryPlaceholder")} value={formData.pais} onChange={e => set("pais", e.target.value)} />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="endereco">{tr("address")}</Label>
                  <Input id="endereco" placeholder={tr("addressPlaceholder")} value={formData.endereco} onChange={e => set("endereco", e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cidade">{tr("city")}</Label>
                  <Input id="cidade" placeholder={tr("cityPlaceholder")} value={formData.cidade} onChange={e => set("cidade", e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="estado">{tr("state")}</Label>
                  <select
                    id="estado"
                    value={formData.estado}
                    onChange={e => set("estado", e.target.value)}
                    className="flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-base shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring sm:text-sm"
                  >
                    <option value="">UF</option>
                    {ESTADOS_BR.map(({ uf, nome }) => (
                      <option key={uf} value={uf}>{uf} — {nome}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cep">CEP</Label>
                  <Input id="cep" placeholder="00000-000" value={formData.cep} onChange={e => set("cep", e.target.value)} />
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end pb-4">
            <Button type="submit" className="w-full sm:w-auto gap-2" disabled={createPatientMutation.isPending || !!createdPatient}>
              <Save className="h-4 w-4" />
              {createPatientMutation.isPending ? tr("saving") : tr("savePatient")}
            </Button>
          </div>
        </div>
      </form>

      <Dialog
        open={!!createdPatient}
        onOpenChange={(open) => {
          if (!open) goToPatient();
        }}
      >
        <DialogContent className="w-[calc(100%-2rem)] max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl p-5 sm:p-6">
          <DialogHeader className="text-left pr-6">
            <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-green-100 text-green-700">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <DialogTitle>{tr("patientCreated")}</DialogTitle>
            <DialogDescription>
              {tr("patientCreatedDescription", { name: createdPatient?.nome ?? "" })}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2 pt-1 sm:grid-cols-2">
            <Button type="button" variant="outline" className="w-full" onClick={goToPatient}>
              {tr("goToRecord")}
            </Button>
            <Button
              type="button"
              className="w-full gap-2"
              style={{ background: "#0B1F4B" }}
              onClick={() => setLocation("/regen/caso/novo")}
            >
              <FlaskConical className="h-4 w-4" />
              {t("newRegenCase")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
