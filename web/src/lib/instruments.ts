/**
 * Itens dos instrumentos preenchidos pelo médico. As CHAVES são as do núcleo (proms/instruments.ts);
 * a pontuação é SEMPRE calculada no servidor.
 */
export interface Item { key: string; label: string; kind: 'int' | 'num' | 'enum' | 'multi' | 'bool'; min?: number; max?: number; unit?: string; options?: [string, string][]; optional?: boolean; note?: string }

export const CONSTANT_ITEMS: Item[] = [
  { key: 'pain', label: 'Dor (15 = sem dor)', kind: 'int', min: 0, max: 15 },
  { key: 'sleep', label: 'Sono (0–2)', kind: 'int', min: 0, max: 2 },
  { key: 'work', label: 'Trabalho (0–4)', kind: 'int', min: 0, max: 4 },
  { key: 'recreation', label: 'Lazer (0–4)', kind: 'int', min: 0, max: 4 },
  { key: 'hand_position', label: 'Posição da mão', kind: 'enum', options: [['waist', 'Cintura'], ['xiphoid', 'Xifoide'], ['neck', 'Pescoço'], ['top_of_head', 'Topo da cabeça'], ['above_head', 'Acima da cabeça']] },
  { key: 'flexion_deg', label: 'Elevação anterior', kind: 'num', min: 0, max: 180, unit: '°' },
  { key: 'abduction_deg', label: 'Abdução', kind: 'num', min: 0, max: 180, unit: '°' },
  { key: 'er_achieved', label: 'Rotação externa — posições atingidas', kind: 'multi', options: [
    ['hand_behind_head_elbow_forward', 'Mão atrás da cabeça, cotovelo à frente'], ['hand_behind_head_elbow_back', 'Mão atrás da cabeça, cotovelo para trás'],
    ['hand_on_head_elbow_forward', 'Mão sobre a cabeça, cotovelo à frente'], ['hand_on_head_elbow_back', 'Mão sobre a cabeça, cotovelo para trás'], ['full_elevation_from_head', 'Elevação completa a partir da cabeça']] },
  { key: 'ir_position', label: 'Rotação interna (dorso da mão)', kind: 'enum', options: [['lateral_thigh', 'Face lateral da coxa'], ['buttock', 'Nádega'], ['lumbosacral', 'Junção lombossacra'], ['waist_L3', 'Cintura (L3)'], ['T12', 'T12'], ['interscapular_T7', 'Interescapular (T7)']] },
  { key: 'strength_kg', label: 'Força em abdução 90° (dinamômetro)', kind: 'num', min: 0, max: 50, unit: 'kg', optional: true, note: 'Deixe vazio se não medida: o escore fica sobre 75 e não é normalizado.' }
];

export const ROWE_ITEMS: Item[] = [
  { key: 'stability', label: 'Estabilidade', kind: 'enum', options: [['no_recurrence', 'Sem recidiva'], ['apprehension_positions', 'Apreensão em certas posições'], ['subluxation', 'Subluxação'], ['recurrent_dislocation', 'Luxação recidivante']] },
  { key: 'motion', label: 'Mobilidade', kind: 'enum', options: [['full', 'Completa'], ['er_75', 'RE ≥ 75% do normal'], ['er_50', 'RE ≥ 50% do normal'], ['no_er', 'Sem RE']] },
  { key: 'function', label: 'Função', kind: 'enum', options: [['no_limitation', 'Sem limitação'], ['mild', 'Limitação leve'], ['moderate', 'Limitação moderada'], ['marked', 'Limitação acentuada']] }
];

export const SANE_ITEMS: Item[] = [
  { key: 'value', label: 'Como o paciente avalia o ombro/cotovelo hoje, de 0 a 100 (100 = normal)?', kind: 'int', min: 0, max: 100 }
];

export const CLINICIAN_FORMS: Record<string, Item[]> = { CONSTANT: CONSTANT_ITEMS, ROWE: ROWE_ITEMS, SANE: SANE_ITEMS };
