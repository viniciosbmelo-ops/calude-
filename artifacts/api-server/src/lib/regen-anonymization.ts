/**
 * Anonimização (LGPD) dos casos do módulo regenerativo (`regen_cases`).
 *
 * O caso guarda cópias do paciente em colunas (nome, nascimento, telefone, diabetes/HbA1c) e em JSON livre
 * (`anamnese_regen`: tabagismo, cigarros/dia, diabetes, HbA1c…; `plano_otimizacao.gerado`: texto gerado a partir
 * do caso, com cabeçalho e perfil do paciente). Os dados clínicos do procedimento (condição, produtos, lado,
 * locais de aplicação, PROMs, exames, procedimentos) ficam para pesquisa (Art. 16 LGPD). Texto livre do caso
 * (`condition_custom`, `goal_custom`, `hospital_local`) e do procedimento (`notes`, `adverse_event_desc`) é apagado
 * pela rota de anonimização; no JSON, chaves de texto livre (notas, observações, comentários, *custom) saem.
 */

/** Chaves removidas (em qualquer nível) do JSON do caso: tabagismo, diabetes e cópias de identificação. */
export const REGEN_CHAVES_SENSIVEIS: readonly RegExp[] = [
  // Tabagismo
  /^tabag/i, /^cigs/i, /fumante/i, /smok/i,
  // Diabetes / controle glicêmico
  /^diabet/i, /^hba1c/i, /^dm$/i,
  // Identificação
  /^(nome|name)$/i, /patient_?name|nome_?paciente|paciente_?nome|full_?name/i, /cpf/i,
  /telefone|phone|celular|whatsapp/i, /e_?-?mail/i, /nascimento|^dob$|_dob$|birth/i,
  /endere[cç]o|address|^cep$|^rg$/i,
  // Texto livre (pode citar nome, contato, hábitos): notas, observações, comentários, campos "outro/custom"
  /^(notas?|notes?|obs|observa[cç](ao|oes|ão|ões)|coment[aá]rios?|comments?)$/i, /custom$/i,
];

export const isChaveSensivelRegen = (chave: string): boolean => REGEN_CHAVES_SENSIVEIS.some((re) => re.test(chave));

/** Cópia do JSON sem as chaves sensíveis (recursivo em objetos e listas). */
export function limparJsonRegen(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(limparJsonRegen);
  if (valor === null || typeof valor !== "object") return valor;
  return Object.fromEntries(
    Object.entries(valor as Record<string, unknown>)
      .filter(([k]) => !isChaveSensivelRegen(k))
      .map(([k, v]) => [k, limparJsonRegen(v)]),
  );
}

/**
 * Plano de otimização: o texto gerado (`gerado`) e as notas livres do médico (`notas`) saem inteiros (texto livre
 * pode citar nome, telefone, hábitos); o restante passa pelo filtro de chaves.
 */
export function limparPlanoOtimizacao(valor: unknown): unknown {
  if (valor === null || typeof valor !== "object" || Array.isArray(valor)) return limparJsonRegen(valor);
  const { gerado: _gerado, notas: _notas, ...resto } = valor as Record<string, unknown>;
  return limparJsonRegen(resto);
}
