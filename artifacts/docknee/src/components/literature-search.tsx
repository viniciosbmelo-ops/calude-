import { useState, useCallback } from "react";
import { BookOpen, Search, ExternalLink, Loader2, SlidersHorizontal, X, Plus } from "lucide-react";


interface Article {
  key: string;
  title: string;
  authors: string;
  journal: string;
  pubDate: string;
  doi: string | null;
  url: string;
  pubType?: string;
}

interface Props {
  ligamentos: string[];
  tiposProcedimento: string[];
  lcaAlgorithm?: {
    tecnicaRecomendada?: string;
    instabAnteromedial?: boolean;
    instabAnterolateral?: boolean;
  };
  picsScore?: { ptsTotal?: number };
}

type Periodo = "5" | "10" | "todos";
type TipoEstudo = "todos" | "rct" | "revisao" | "meta";
type Ordenacao = "relevancia" | "data";

const PERIODO_OPTIONS: Periodo[] = ["5", "10", "todos"];
const TIPO_OPTIONS: TipoEstudo[] = ["todos", "rct", "revisao", "meta"];
const ORDENACAO_OPTIONS: Ordenacao[] = ["data", "relevancia"];

// Instantiation expressions (TS 4.7+) avoid using generic JSX tag syntax
// (`<FilterChip<T> .../>`), which Babel's TSX parser cannot handle.

const PERIODO_LABELS: Record<Periodo, string> = {
  "5": "Últimos 5 anos",
  "10": "Últimos 10 anos",
  "todos": "Todos os anos",
};

const TIPO_LABELS: Record<TipoEstudo, string> = {
  todos: "Todos",
  rct: "Ensaios Clínicos / RCT",
  revisao: "Revisão Sistemática",
  meta: "Meta-análise",
};

const TIPO_PUBMED: Record<TipoEstudo, string> = {
  todos: "",
  rct: ' AND ("Randomized Controlled Trial"[pt] OR "Clinical Trial"[pt])',
  revisao: ' AND "Systematic Review"[pt]',
  meta: ' AND "Meta-Analysis"[pt]',
};

function buildDateFilter(periodo: Periodo): string {
  if (periodo === "todos") return "";
  const year = new Date().getFullYear() - parseInt(periodo);
  return `&datetype=pdat&mindate=${year}&maxdate=3000`;
}

function buildQueries(props: Props): { terms: string[]; coreQuery: string } {
  const { ligamentos, tiposProcedimento, lcaAlgorithm } = props;
  const terms: string[] = [];
  const core: string[] = [];

  if (ligamentos.includes("LCA")) { terms.push("ACL reconstruction"); core.push("ACL reconstruction"); }
  if (ligamentos.includes("LCA") && lcaAlgorithm?.instabAnterolateral) { terms.push("anterolateral ligament"); core.push("anterolateral ligament"); }
  if (ligamentos.includes("LCA") && lcaAlgorithm?.instabAnteromedial) { terms.push("anterior oblique ligament"); core.push("anterior oblique ligament"); }
  if (ligamentos.includes("LCA") && (lcaAlgorithm?.instabAnterolateral || lcaAlgorithm?.instabAnteromedial)) terms.push("extra-articular");
  if (ligamentos.includes("LCP")) { terms.push("PCL reconstruction"); core.push("PCL reconstruction"); }
  if (ligamentos.includes("LCM")) { terms.push("medial collateral ligament reconstruction"); core.push("medial collateral ligament"); }
  if (ligamentos.includes("LCL")) { terms.push("posterolateral corner reconstruction"); core.push("posterolateral corner"); }
  if (tiposProcedimento.includes("Lesão Meniscal")) { terms.push("meniscal repair"); core.push("meniscus knee"); }
  if (tiposProcedimento.includes("Instabilidade Patelar")) { terms.push("patellar instability MPFL"); core.push("patellar instability"); }
  if (tiposProcedimento.includes("Osteotomia")) { terms.push("high tibial osteotomy"); core.push("tibial osteotomy"); }
  if (tiposProcedimento.includes("Lesões Osteocondrais")) { terms.push("osteochondral lesion knee"); core.push("osteochondral knee"); }
  if (tiposProcedimento.includes("Artroplastias")) { terms.push("total knee arthroplasty"); core.push("knee arthroplasty"); }
  if (terms.length === 0) { terms.push("knee surgery reconstruction"); core.push("knee reconstruction"); }

  return { terms, coreQuery: core.join(" ") };
}

async function pubmedSearch(
  query: string,
  retmax: number,
  periodo: Periodo,
  tipoEstudo: TipoEstudo,
  ordenacao: Ordenacao,
): Promise<Article[]> {
  try {
    const fullQuery = query + TIPO_PUBMED[tipoEstudo];
    const dateFilter = buildDateFilter(periodo);
    const sort = ordenacao === "data" ? "pub+date" : "relevance";
    const enc = encodeURIComponent(fullQuery);
    const sr = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${enc}&retmax=${retmax}&retmode=json&sort=${sort}${dateFilter}`
    );
    const sd = await sr.json();
    const ids: string[] = sd.esearchresult?.idlist ?? [];
    if (ids.length === 0) return [];
    const sumr = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(",")}&retmode=json`
    );
    const sumd = await sumr.json();
    const result = sumd.result ?? {};
    return ids.filter((id) => result[id]).map((id) => {
      const r = result[id];
      const authors =
        (r.authors ?? []).slice(0, 3).map((a: any) => a.name).join(", ") +
        ((r.authors?.length ?? 0) > 3 ? " et al." : "");
      const doi = (r.articleids ?? []).find((a: any) => a.idtype === "doi")?.value ?? null;
      const pubDate = r.pubdate?.split(" ")[0] ?? r.epubdate?.split(" ")[0] ?? "";
      const pubType: string = (r.pubtype ?? []).join(", ");
      return {
        key: `pm-${id}`,
        title: r.title ?? "",
        authors,
        journal: r.fulljournalname ?? r.source ?? "",
        pubDate,
        doi,
        pubType,
        url: doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      };
    });
  } catch { return []; }
}

async function fromCrossRef(query: string, periodo: Periodo, tipoEstudo: TipoEstudo): Promise<Article[]> {
  try {
    const typeFilter = tipoEstudo === "rct" ? " randomized controlled trial"
      : tipoEstudo === "revisao" ? " systematic review"
      : tipoEstudo === "meta" ? " meta-analysis"
      : " surgical technique";
    const enc = encodeURIComponent(query + typeFilter);
    const yearFilter = periodo !== "todos"
      ? `&filter=from-pub-date:${new Date().getFullYear() - parseInt(periodo)}`
      : "";
    const r = await fetch(
      `https://api.crossref.org/works?query=${enc}&filter=type:journal-article${yearFilter}&rows=10&sort=relevance&select=title,author,container-title,published,DOI,URL`
    );
    const d = await r.json();
    return (d.message?.items ?? [])
      .map((item: any, i: number) => {
        const authors =
          (item.author ?? []).slice(0, 3).map((a: any) => [a.given, a.family].filter(Boolean).join(" ")).join(", ") +
          ((item.author?.length ?? 0) > 3 ? " et al." : "");
        const parts = item.published?.["date-parts"]?.[0] ?? [];
        const doi = item.DOI ?? null;
        return {
          key: `cr-${i}-${doi ?? Math.random()}`,
          title: item.title?.[0] ?? "",
          authors,
          journal: item["container-title"]?.[0] ?? "",
          pubDate: parts[0] ? String(parts[0]) : "",
          doi,
          url: doi ? `https://doi.org/${doi}` : (item.URL ?? ""),
        };
      })
      .filter((a: Article) => a.title);
  } catch { return []; }
}

const EVIDENCE_BADGE: Record<string, { label: string; color: string }> = {
  "Randomized Controlled Trial": { label: "RCT", color: "#16a34a" },
  "Meta-Analysis": { label: "Meta-análise", color: "#7c3aed" },
  "Systematic Review": { label: "Revisão Sistemática", color: "#0369a1" },
  "Clinical Trial": { label: "Ensaio Clínico", color: "#b45309" },
};

function EvidenceBadge({ pubType }: { pubType?: string }) {
  if (!pubType) return null;
  for (const [key, badge] of Object.entries(EVIDENCE_BADGE)) {
    if (pubType.includes(key)) {
      return (
        <span
          className="text-[10px] px-2 py-0.5 rounded-full font-bold border"
          style={{ color: badge.color, borderColor: badge.color + "40", background: badge.color + "15" }}
        >
          {badge.label}
        </span>
      );
    }
  }
  return null;
}

function dedup(articles: Article[]): Article[] {
  const seen = new Set<string>();
  const out: Article[] = [];
  for (const a of articles) {
    const key = a.doi ? a.doi.toLowerCase() : a.title.toLowerCase().slice(0, 60);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(a);
    }
  }
  return out.sort((a, b) => (parseInt(b.pubDate) || 0) - (parseInt(a.pubDate) || 0));
}

function ArticleCard({ art }: { art: Article }) {
  return (
    <div className="rounded-xl p-3.5 border border-border bg-background/60 space-y-1.5">
      <a
        href={art.url} target="_blank" rel="noopener noreferrer"
        className="text-sm font-semibold leading-snug hover:underline flex items-start gap-1.5 group"
        style={{ color: "#1FB6E1" }}
      >
        <span className="flex-1 line-clamp-3">{art.title}</span>
        <ExternalLink className="h-3.5 w-3.5 shrink-0 mt-0.5 opacity-60 group-hover:opacity-100" />
      </a>
      {art.authors && <p className="text-[11px] text-muted-foreground leading-snug">{art.authors}</p>}
      <div className="flex items-center gap-2 flex-wrap">
        {art.journal && <span className="text-[11px] font-medium text-foreground/70 italic">{art.journal}</span>}
        {art.pubDate && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">{art.pubDate}</span>
        )}
        <EvidenceBadge pubType={art.pubType} />
      </div>
      {art.doi && (
        <a href={`https://doi.org/${art.doi}`} target="_blank" rel="noopener noreferrer"
          className="text-[11px] font-mono text-muted-foreground/60 hover:text-primary transition-colors block truncate">
          doi.org/{art.doi}
        </a>
      )}
    </div>
  );
}

function FilterChip<T extends string>({
  options, value, onChange, labels,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labels: Record<T, string>;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className="text-[11px] px-2.5 py-1 rounded-full font-medium border transition-all"
          style={
            value === opt
              ? { background: "#1FB6E1", color: "#fff", borderColor: "#1FB6E1" }
              : { background: "transparent", color: "var(--muted-foreground)", borderColor: "var(--border)" }
          }
        >
          {labels[opt]}
        </button>
      ))}
    </div>
  );
}

const PeriodoFilterChip = FilterChip<Periodo>;
const TipoEstudoFilterChip = FilterChip<TipoEstudo>;
const OrdenacaoFilterChip = FilterChip<Ordenacao>;

export function LiteratureSearch({ ligamentos, tiposProcedimento, lcaAlgorithm, picsScore }: Props) {
  const [articles, setArticles] = useState<Article[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const [periodo, setPeriodo] = useState<Periodo>("10");
  const [tipoEstudo, setTipoEstudo] = useState<TipoEstudo>("todos");
  const [ordenacao, setOrdenacao] = useState<Ordenacao>("data");

  const [customInput, setCustomInput] = useState("");
  const [customTerms, setCustomTerms] = useState<string[]>([]);

  const { terms: autoTerms, coreQuery } = buildQueries({ ligamentos, tiposProcedimento, lcaAlgorithm, picsScore });

  const addCustomTerm = () => {
    const t = customInput.trim();
    if (!t) return;
    setCustomTerms((prev) => prev.includes(t) ? prev : [...prev, t]);
    setCustomInput("");
  };

  const removeCustomTerm = (t: string) => setCustomTerms((prev) => prev.filter((x) => x !== t));

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addCustomTerm();
    }
  };

  const allTerms = [...autoTerms, ...customTerms];

  const effectiveCoreQuery = [coreQuery, ...customTerms].join(" ");

  const handleSearch = useCallback(async () => {
    setLoading(true);
    setError(null);
    setArticles(null);

    const journals: [string, number][] = [
      [`${effectiveCoreQuery} AND "Arthroscopy Techniques"[Journal]`, 20],
      [`${effectiveCoreQuery} AND "Arthroscopy"[Journal]`, 15],
      [`${effectiveCoreQuery} AND "Knee Surg Sports Traumatol Arthrosc"[Journal]`, 15],
      [`${effectiveCoreQuery} AND "Am J Sports Med"[Journal]`, 15],
      [`${effectiveCoreQuery} AND "Orthop J Sports Med"[Journal]`, 10],
      [`${effectiveCoreQuery} AND "J Bone Joint Surg Am"[Journal]`, 10],
      [`${effectiveCoreQuery} AND "Bone Joint J"[Journal]`, 10],
      [`${effectiveCoreQuery} AND "J Arthroplasty"[Journal]`, 10],
      [`${effectiveCoreQuery} AND "Sports Health"[Journal]`, 8],
      [`${effectiveCoreQuery} AND "Clin Orthop Relat Res"[Journal]`, 8],
      [effectiveCoreQuery + " knee", 15],
    ];

    try {
      const settled = await Promise.allSettled([
        ...journals.map(([q, n]) => pubmedSearch(q, n, periodo, tipoEstudo, ordenacao)),
        fromCrossRef(effectiveCoreQuery + " knee", periodo, tipoEstudo),
      ]);

      const all: Article[] = [];
      for (const r of settled) {
        if (r.status === "fulfilled") all.push(...r.value);
      }

      setArticles(dedup(all));
    } catch {
      setError("Não foi possível realizar a busca. Verifique sua conexão.");
    } finally {
      setLoading(false);
    }
  }, [effectiveCoreQuery, periodo, tipoEstudo, ordenacao]);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-border">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(31,182,225,0.12)" }}>
          <BookOpen className="h-4 w-4" style={{ color: "#1FB6E1" }} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold">Literatura Científica</p>
          <p className="text-[11px] text-muted-foreground leading-tight">
            PubMed · AJSM · KSSTA · JBJS · Bone&amp;Joint · Arthroscopy · CrossRef e mais
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowFilters(v => !v)}
          className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg border transition-all"
          style={
            showFilters
              ? { background: "rgba(31,182,225,0.12)", borderColor: "#1FB6E1", color: "#1FB6E1" }
              : { background: "transparent", borderColor: "var(--border)", color: "var(--muted-foreground)" }
          }
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filtros
        </button>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Auto search term tags */}
        {allTerms.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {autoTerms.map((t, i) => (
              <span key={i} className="text-[11px] px-2.5 py-1 rounded-full font-medium bg-primary/10 text-primary border border-primary/20">
                {t}
              </span>
            ))}
            {customTerms.map((t) => (
              <span key={t} className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full font-medium bg-emerald-500/10 text-emerald-700 border border-emerald-500/30">
                {t}
                <button type="button" onClick={() => removeCustomTerm(t)} className="hover:text-destructive transition-colors">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Custom term input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Adicionar termo de busca (ex: LET, ALL, hamstring graft…)"
            className="flex-1 text-sm px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:border-primary transition-colors placeholder:text-muted-foreground/60"
          />
          <button
            type="button"
            onClick={addCustomTerm}
            disabled={!customInput.trim()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-all disabled:opacity-40"
            style={{ background: "rgba(31,182,225,0.1)", borderColor: "#1FB6E1", color: "#1FB6E1" }}
          >
            <Plus className="h-4 w-4" />
            Adicionar
          </button>
        </div>

        {/* Filtros expandidos */}
        {showFilters && (
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3 space-y-3">
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Período</p>
              <PeriodoFilterChip
                options={PERIODO_OPTIONS}
                value={periodo}
                onChange={setPeriodo}
                labels={PERIODO_LABELS}
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Tipo de Estudo</p>
              <TipoEstudoFilterChip
                options={TIPO_OPTIONS}
                value={tipoEstudo}
                onChange={setTipoEstudo}
                labels={TIPO_LABELS}
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Ordenar por</p>
              <OrdenacaoFilterChip
                options={ORDENACAO_OPTIONS}
                value={ordenacao}
                onChange={setOrdenacao}
                labels={{ data: "Mais recentes", relevancia: "Relevância" }}
              />
            </div>
          </div>
        )}

        {/* Active filter summary */}
        {!showFilters && (periodo !== "todos" || tipoEstudo !== "todos" || ordenacao !== "relevancia") && (
          <div className="flex flex-wrap gap-1.5">
            {periodo !== "todos" && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-blue-500/10 text-blue-600 border border-blue-500/20">
                📅 {PERIODO_LABELS[periodo]}
              </span>
            )}
            {tipoEstudo !== "todos" && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-purple-500/10 text-purple-600 border border-purple-500/20">
                🔬 {TIPO_LABELS[tipoEstudo]}
              </span>
            )}
            {ordenacao === "data" && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-green-500/10 text-green-600 border border-green-500/20">
                ↓ Mais recentes primeiro
              </span>
            )}
          </div>
        )}

        {/* Search button */}
        <button
          type="button"
          onClick={handleSearch}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60"
          style={{ background: "linear-gradient(135deg, #1FB6E1 0%, #0A1628 100%)" }}
        >
          {loading
            ? <><Loader2 className="h-4 w-4 animate-spin" /> Buscando artigos...</>
            : <><Search className="h-4 w-4" /> Buscar Técnicas Cirúrgicas</>
          }
        </button>

        {error && <p className="text-xs text-destructive text-center">{error}</p>}

        {/* Results */}
        {articles && (
          <div className="space-y-3 pt-1">
            <p className="text-xs text-muted-foreground">{articles.length} artigos encontrados</p>
            <div className="space-y-2.5 max-h-[600px] overflow-y-auto pr-1">
              {articles.length === 0
                ? <p className="text-xs text-muted-foreground px-2 py-3">Nenhum artigo encontrado. Tente adicionar termos personalizados ou mudar os filtros.</p>
                : articles.map((art) => <ArticleCard key={art.key} art={art} />)
              }
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
