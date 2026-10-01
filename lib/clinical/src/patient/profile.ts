/**
 * Características clínicas do paciente registradas UMA vez no cadastro (prontuário), e não em cada cirurgia:
 * lado dominante, tabagismo, diabetes e nível de atividade.
 *
 * Até PREOP_COMMON.v1 esses campos ficavam em `avaliacaoPreop.comum` de cada cirurgia. A partir da v2 o bloco
 * comum guarda só o que é da cirurgia (data da avaliação); payloads antigos continuam aceitos e esses campos são
 * descartados na leitura (`parseClinicalPayload`).
 *
 * Os valores (enums) são os mesmos da v1, para que a API do paciente, o formulário e os algoritmos de apoio à
 * decisão falem a mesma língua.
 */

export const LADO_DOMINANTE_VALORES = ['R', 'L', 'ambidestro'] as const;
export const TABAGISMO_VALORES = ['nunca', 'ex_tabagista', 'atual'] as const;
export const NIVEL_ATIVIDADE_VALORES = ['sedentario', 'recreativo', 'competitivo', 'trabalhador_bracal'] as const;

export type LadoDominante = (typeof LADO_DOMINANTE_VALORES)[number];
export type Tabagismo = (typeof TABAGISMO_VALORES)[number];
export type NivelAtividade = (typeof NIVEL_ATIVIDADE_VALORES)[number];

/** Campos do cadastro do paciente (nomes da API: camelCase). Ausente/null = não informado. */
export interface PerfilClinicoPaciente {
  ladoDominante?: LadoDominante | null;
  tabagismo?: Tabagismo | null;
  diabetes?: boolean | null;
  nivelAtividade?: NivelAtividade | null;
}

export type CampoPerfilClinico = keyof PerfilClinicoPaciente;

/** Campos que saíram de `avaliacaoPreop.comum` (PREOP_COMMON.v1) para o cadastro: chave antiga → campo do paciente. */
export const CAMPOS_PREOP_NO_CADASTRO = {
  lado_dominante: 'ladoDominante',
  tabagismo: 'tabagismo',
  diabetes: 'diabetes',
  nivel_atividade: 'nivelAtividade',
} as const satisfies Record<string, CampoPerfilClinico>;

export const CAMPOS_PERFIL_CLINICO: readonly CampoPerfilClinico[] = ['ladoDominante', 'tabagismo', 'diabetes', 'nivelAtividade'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const umDe = <T extends string>(valores: readonly T[], v: unknown): T | undefined =>
  typeof v === 'string' && (valores as readonly string[]).includes(v) ? (v as T) : undefined;

/**
 * Perfil clínico a partir de um registro de paciente (linha do banco ou resposta da API).
 * Só copia valores válidos; qualquer outro (inclusive texto livre legado) fica ausente.
 */
export function perfilClinicoDe(raw: unknown): PerfilClinicoPaciente {
  if (!isObj(raw)) return {};
  const out: PerfilClinicoPaciente = {};
  const lado = umDe(LADO_DOMINANTE_VALORES, raw.ladoDominante);
  const tab = umDe(TABAGISMO_VALORES, raw.tabagismo);
  const ativ = umDe(NIVEL_ATIVIDADE_VALORES, raw.nivelAtividade);
  if (lado) out.ladoDominante = lado;
  if (tab) out.tabagismo = tab;
  if (typeof raw.diabetes === 'boolean') out.diabetes = raw.diabetes;
  if (ativ) out.nivelAtividade = ativ;
  return out;
}

/** Remove de um `avaliacaoPreop.comum` os campos que agora vivem no cadastro do paciente (cópia). */
export function semCamposDoCadastro<T extends Record<string, unknown>>(comum: T): Partial<T> {
  const out: Record<string, unknown> = { ...comum };
  for (const k of Object.keys(CAMPOS_PREOP_NO_CADASTRO)) delete out[k];
  return out as Partial<T>;
}
