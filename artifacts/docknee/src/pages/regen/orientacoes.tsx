import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, ClipboardList, AlertTriangle, Activity, Calendar, CheckCircle2, XCircle, Info } from "lucide-react";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { regenCoreMessages } from "@/locales/regen-core";
import { ORIENTATION_ES_VALUES } from "@/locales/regen-orientacoes-es";

// ─── Data ────────────────────────────────────────────────────────────────────

export type Tag = "obrigatorio" | "recomendado" | "condicional";
export type Gravidade = "grave" | "moderada";

export interface CheckItem { title: string; desc: string; tag: Tag; }
export interface SinalEsperado { title: string; desc: string; periodo: string; }
export interface SinalAlerta { title: string; desc: string; gravidade: Gravidade; }
export interface Medicamento { nome: string; dose: string; intervalo: string; max: string; nota: string; }
export interface CronogramaItem { tempo: string; titulo: string; desc: string; }
export interface FisioFase { fase: string; foco: string; tecnicas: string; }
export interface Retorno { tempo: string; tipo: string; objetivo: string; }
export interface Escore { nome: string; min: number; max: number; desc: string; }

export interface ProcData {
  nome: string;
  icon: string;
  checklist: { hidrico: CheckItem[]; meds: CheckItem[]; alimentacao: CheckItem[]; logistica: CheckItem[]; docs: CheckItem[]; };
  sinaisEsperados: SinalEsperado[];
  sinaisAlerta: SinalAlerta[];
  analgesia: { fase1: { periodo: string; desc: string }; medicamentos: Medicamento[]; proibido: string; gelo: string; };
  cronograma: CronogramaItem[];
  fisio: { fases: FisioFase[]; frequencia: string; };
  retornos: Retorno[];
  escores: Escore[];
}

export const DATA: Record<string, ProcData> = {
  prp_articular: {
    nome: "PRP Intra-Articular", icon: "🦴",
    checklist: {
      hidrico: [
        { title: "Hidratação adequada", desc: "Ingerir 2-3 litros de água nas 24-48h anteriores. Hidratação otimiza a qualidade do plasma e a punção venosa.", tag: "obrigatorio" },
        { title: "Evitar álcool 48h antes", desc: "Álcool desidrata e altera a agregação plaquetária, reduzindo a qualidade do PRP.", tag: "obrigatorio" },
        { title: "Evitar café excessivo no dia", desc: "Cafeína em excesso pode causar vasoconstrição periférica e dificultar a coleta de sangue.", tag: "recomendado" },
      ],
      meds: [
        { title: "Suspender AINEs 7-10 dias antes", desc: "Anti-inflamatórios (ibuprofeno, diclofenaco, naproxeno, celecoxibe) inibem a COX e comprometem a cascata regenerativa. Usar paracetamol se necessário.", tag: "obrigatorio" },
        { title: "Informar uso de anticoagulantes", desc: "AAS 100mg geralmente não contraindica, mas anticoagulantes de alta intensidade aumentam risco de hematoma articular. Avaliar com cardiologia.", tag: "obrigatorio" },
        { title: "Informar uso de corticoides", desc: "Corticoides sistêmicos ou infiltrados recentes (< 3-6 meses) no mesmo sítio reduzem a resposta ao PRP. Considerar adiar procedimento.", tag: "obrigatorio" },
        { title: "Informar suplementação", desc: "Ômega-3 em altas doses, vitamina E > 400 UI e Ginkgo biloba podem aumentar risco de sangramento. Manter ou suspender conforme avaliação.", tag: "condicional" },
      ],
      alimentacao: [
        { title: "Alimentação habitual", desc: "Não é necessário jejum para PRP articular. Fazer refeição leve 2-3h antes para evitar lipotimia.", tag: "obrigatorio" },
        { title: "Evitar refeições muito gordurosas", desc: "Lipemia excessiva pode dificultar a centrifugação e separação do plasma rico em plaquetas.", tag: "recomendado" },
        { title: "Manter dieta anti-inflamatória", desc: "Evitar ultraprocessados, açúcares refinados e gorduras trans nas 48h prévias para otimizar o microambiente.", tag: "recomendado" },
      ],
      logistica: [
        { title: "Comparecer com acompanhante", desc: "Recomendado para procedimentos em membros inferiores ou pacientes com histórico de lipotimia/ansiedade.", tag: "recomendado" },
        { title: "Vestir roupas confortáveis", desc: "Facilitar acesso à região tratada. Roupas largas ou camisetas de manga larga são ideais.", tag: "recomendado" },
        { title: "Evitar esforço intenso no dia", desc: "Não realizar atividade física vigorosa 24h antes. Repouso relativo otimiza a resposta vascular.", tag: "recomendado" },
      ],
      docs: [
        { title: "Exames laboratoriais atualizados", desc: "Hemograma, coagulograma (se anticoagulante), PCR, glicemia. HbA1c se diabético. Vitamina D se não recente.", tag: "obrigatorio" },
        { title: "Imagem recente do sítio", desc: "RM ou USG com menos de 6 meses para avaliar estágio da lesão e planejamento da infiltração.", tag: "obrigatorio" },
        { title: "Termo de consentimento assinado", desc: "Incluir riscos (dor pós-procedimento, infecção, hematoma, falha terapêutica), benefícios esperados e alternativas.", tag: "obrigatorio" },
        { title: "Alergias medicamentosas documentadas", desc: "Verificar alergia a lidocaína, antissépticos (iodo), látex ou materiais de coleta.", tag: "obrigatorio" },
      ],
    },
    sinaisEsperados: [
      { title: "Dor local intensa nas primeiras 24-72h", desc: "Inflamação fisiológica ('flare') esperada. Dor piora com movimento e melhora com repouso e elevação. NÃO é sinal de infecção se não houver febre.", periodo: "24-72h" },
      { title: "Edema articular leve a moderado", desc: "Aumento de volume por resposta inflamatória e volume injetado. Regride em 3-5 dias.", periodo: "3-5 dias" },
      { title: "Calor e rubor local", desc: "Vasodilatação e aumento do fluxo sanguíneo no sítio de infiltração. Normal nas primeiras 48h.", periodo: "24-48h" },
      { title: "Rigidez articular matinal", desc: "Sensação de 'peso' ao iniciar movimentos. Melhora com mobilização suave.", periodo: "5-7 dias" },
      { title: "Sensação de plenitude intra-articular", desc: "Sensação subjetiva de pressão pelo volume do PRP. Alívio gradual em 48h.", periodo: "24-48h" },
    ],
    sinaisAlerta: [
      { title: "Febre > 38°C ou calafrios", desc: "Indica infecção sistêmica. NÃO é esperado após PRP. URGÊNCIA.", gravidade: "grave" },
      { title: "Piora progressiva da dor após 72h", desc: "Se a dor não melhora após 72h e piora a cada dia, suspeitar de infecção ou reação adversa.", gravidade: "grave" },
      { title: "Edema articular exuberante com deformidade", desc: "Aumento desproporcional, alteração do contorno articular. Pode indicar hemartrose ou infecção.", gravidade: "grave" },
      { title: "Vermelhidão extensa com linfangite", desc: "Rubor que se estende além da articulação, com traçado linfático vermelho. Sinal de infecção ascendente.", gravidade: "grave" },
      { title: "Drenagem purulenta pelo sítio de punção", desc: "Qualquer secreção amarela/esverdeada pelo local da agulha é INFECÇÃO até prova contrária.", gravidade: "grave" },
      { title: "Urticária, prurido ou dificuldade respiratória", desc: "Reação alérgica sistêmica (anafilaxia) ao antisséptico, anestésico ou material. URGÊNCIA.", gravidade: "grave" },
      { title: "Dor em repouso com pulsação", desc: "Dor pulsátil, piorada à noite. Pode indicar hematoma expansivo ou síndrome compartimental (raro).", gravidade: "moderada" },
      { title: "Entorpecimento ou fraqueza distal", desc: "Alteração de sensibilidade ou força no membro abaixo do sítio. Pode indicar lesão neurovascular.", gravidade: "moderada" },
    ],
    analgesia: {
      fase1: { periodo: "0-48h", desc: "Fase inflamatória aguda (flare). Priorizar analgésicos que não inibam a COX." },
      medicamentos: [
        { nome: "Paracetamol", dose: "500-1000mg", intervalo: "6/6h", max: "4g/dia", nota: "Analgésico de primeira linha. NÃO afeta cascata regenerativa." },
        { nome: "Tramadol", dose: "50-100mg", intervalo: "8/8h", max: "400mg/dia", nota: "Se dor intensa. Pode causar náusea/sonolência." },
        { nome: "Dipirona", dose: "500mg-1g", intervalo: "6/6h", max: "4g/dia", nota: "Alternativa ao paracetamol. Monitorar agranulocitose em uso prolongado." },
        { nome: "Codeína", dose: "30mg", intervalo: "12/12h", max: "120mg/dia", nota: "Opióide leve para dor moderada." },
      ],
      proibido: "AINEs (ibuprofeno, diclofenaco, naproxeno, celecoxibe, etoricoxibe) devem ser EVITADOS nas primeiras 2-4 semanas. Inibem a COX e anulam o efeito do PRP. Se absolutamente necessário, usar dose mínima por no máximo 3-5 dias após 72h.",
      gelo: "Aplicar gelo 15-20 minutos a cada 2-3h nas primeiras 48h. NUNCA aplicar gelo diretamente na pele (usar toalha). Elevar o membro quando possível.",
    },
    cronograma: [
      { tempo: "0-48h", titulo: "Fase de Proteção", desc: "Repouso relativo. Evitar carga articular. Marcha com muletas se dor intensa (membros inferiores). NÃO realizar fisioterapia ativa. Gelo conforme indicado." },
      { tempo: "48h-7 dias", titulo: "Fase de Mobilização Suave", desc: "Iniciar mobilização passiva e ativa assistida. Evitar carga de impacto. Fisioterapia: mobilização articular, alongamento leve, fortalecimento isométrico." },
      { tempo: "1-2 semanas", titulo: "Fase de Carga Parcial", desc: "Progressão para carga parcial. Fortalecimento excêntrico iniciado. Atividade aquática permitida." },
      { tempo: "2-4 semanas", titulo: "Fase de Carga Progressiva", desc: "Aumento gradual da resistência. Fortalecimento excêntrico progressivo. Propriocepção e equilíbrio. Evitar impacto ainda." },
      { tempo: "4-6 semanas", titulo: "Fase de Retorno Funcional", desc: "Retorno a atividades de vida diária normais. Início de atividade esportiva leve. Avaliação funcional." },
      { tempo: "6-12 semanas", titulo: "Fase de Retorno ao Esporte", desc: "Progressão para atividade de impacto controlada. Testes funcionais específicos. Retorno ao esporte competitivo apenas após liberação médica." },
    ],
    fisio: {
      frequencia: "2-3x/semana nas primeiras 4 semanas, 1-2x/semana nas semanas 5-8. Manutenção 1x/semana após 8 semanas se necessário.",
      fases: [
        { fase: "Semana 1-2", foco: "Controle de dor e inflamação", tecnicas: "Crioterapia, eletroterapia (TENS), mobilização passiva, drenagem linfática manual, fortalecimento isométrico, alongamento leve." },
        { fase: "Semana 3-4", foco: "Recuperação de amplitude", tecnicas: "Mobilização articular progressiva, fortalecimento excêntrico leve, propriocepção, hidroterapia, bicicleta ergométrica sem resistência." },
        { fase: "Semana 5-8", foco: "Fortalecimento neuromuscular", tecnicas: "Fortalecimento excêntrico progressivo, pliometria leve, esteira com inclinação, exercícios funcionais, plataforma vibratória." },
        { fase: "Semana 9-12", foco: "Retorno ao esporte", tecnicas: "Pliometria progressiva, treino de agilidade, testes específicos (hop test, Y-balance), simulação de gestos esportivos, retorno gradual." },
      ],
    },
    retornos: [
      { tempo: "7-10 dias", tipo: "Retorno inicial", objetivo: "Avaliar resposta ao flare, adesão à analgesia, início de fisioterapia. Ajustar conduta." },
      { tempo: "4-6 semanas", tipo: "Reavaliação funcional", objetivo: "Aplicar escores (VAS e escores funcionais). Avaliar progressão da reabilitação. Considerar 2ª sessão se protocolo prever múltiplas infiltrações." },
      { tempo: "3 meses", tipo: "Reavaliação principal", objetivo: "Avaliação clínica completa + escores funcionais. RM de controle se indicado. Decisão sobre necessidade de nova sessão." },
      { tempo: "6-12 meses", tipo: "Acompanhamento de longo prazo", objetivo: "Avaliar durabilidade do efeito. Comparar escores com baseline. Documentar resultado para registro." },
    ],
    escores: [
      { nome: "VAS (Dor)", min: 0, max: 10, desc: "Escala Visual Analógica. 0 = sem dor, 10 = pior dor imaginável." },
    ],
  },

  prp_tendineo: {
    nome: "PRP Tendíneo", icon: "💪",
    checklist: {
      hidrico: [
        { title: "Hidratação adequada", desc: "2-3 litros nas 24-48h prévias. Essencial para coleta de sangue de qualidade.", tag: "obrigatorio" },
        { title: "Evitar álcool 72h antes", desc: "Tendões têm vascularização limitada. Álcool compromete a perfusão e qualidade plaquetária.", tag: "obrigatorio" },
      ],
      meds: [
        { title: "Suspender AINEs 10-14 dias antes", desc: "Tendões dependem da resposta inflamatória fisiológica para remodelação. AINEs prolongam o tempo de reparo. Paracetamol permitido.", tag: "obrigatorio" },
        { title: "Informar anticoagulantes", desc: "Risco de hematoma peritendíneo significativo. AAS 100mg geralmente mantido. Anticoagulantes diretos: avaliar risco/benefício com cardiologia.", tag: "obrigatorio" },
        { title: "Corticoides: intervalo mínimo 3-6 meses", desc: "Infiltração de corticoide no tendão é contraindicação relativa para PRP nos 3-6 meses seguintes. Corticoides causam degeneração tendínea.", tag: "obrigatorio" },
      ],
      alimentacao: [
        { title: "Alimentação normal, sem jejum", desc: "Jejum não é necessário para PRP tendíneo. Refeição leve 2h antes.", tag: "obrigatorio" },
        { title: "Suplementação de colágeno 10g/dia", desc: "Se já em uso, manter. Se não, considerar iniciar 1-2 semanas antes para otimizar matriz de suporte.", tag: "recomendado" },
      ],
      logistica: [
        { title: "Acompanhante recomendado", desc: "Procedimento pode ser doloroso. Acompanhante auxilia no retorno e no manejo inicial.", tag: "recomendado" },
        { title: "Roupa que exponha o sítio", desc: "Calça curta para tendão calcâneo, camiseta sem manga para epicondilite. Facilitar acesso.", tag: "recomendado" },
        { title: "Evitar atividade que sobrecarregue o tendão", desc: "Não realizar exercício específico do tendão tratado 48h antes.", tag: "recomendado" },
      ],
      docs: [
        { title: "USG de alta resolução recente", desc: "Essencial para planejamento da infiltração (ecoguiada). Avaliar grau de degeneração, neovascularização, presença de bursa.", tag: "obrigatorio" },
        { title: "Exames laboratoriais", desc: "Hemograma, coagulograma (se anticoagulante). Vitamina D se não recente.", tag: "obrigatorio" },
        { title: "Termo de consentimento", desc: "Incluir risco de ruptura tendínea (raro, em tendão degenerado), dor intensa pós-procedimento.", tag: "obrigatorio" },
      ],
    },
    sinaisEsperados: [
      { title: "Dor intensa nas primeiras 48-72h", desc: "Tendões são estruturas densas e inervadas. A infiltração causa dor significativa ('flare tendíneo'). Normal e esperado.", periodo: "48-72h" },
      { title: "Edema peritendíneo", desc: "Inchaço ao redor do tendão, não dentro dele. Visível em tendões superficiais. Regride em 5-7 dias.", periodo: "5-7 dias" },
      { title: "Calor e rubor sobre o tendão", desc: "Resposta vascular normal. Mais evidente em tendões superficiais. Pode persistir 3-5 dias.", periodo: "3-5 dias" },
      { title: "Rigidez matinal", desc: "Tendão 'duro' ao acordar. Melhora com mobilização suave e aquecimento. Pode persistir 2-3 semanas.", periodo: "2-3 semanas" },
      { title: "Piora da dor com contração isométrica", desc: "Dor ao tensionar o tendão nas primeiras 2 semanas. Esperado. Não forçar contração máxima.", periodo: "2 semanas" },
    ],
    sinaisAlerta: [
      { title: "Febre > 38°C", desc: "Infecção. Tendões têm baixa vascularização, mas infecção peritendínea é possível. URGÊNCIA.", gravidade: "grave" },
      { title: "Dor em repouso com pulsação após 72h", desc: "Pode indicar hematoma peritendíneo expansivo ou síndrome compartimental.", gravidade: "grave" },
      { title: "Piora abrupta com estalo audível", desc: "SUSPEITA DE RUPTURA TENDÍNEA. Imobilizar e encaminhar IMEDIATAMENTE para avaliação ortopédica.", gravidade: "grave" },
      { title: "Drenagem pelo sítio de punção", desc: "Qualquer secreção é anormal. Cobertura estéril e avaliação médica.", gravidade: "grave" },
      { title: "Parestesia distal ao tendão", desc: "Alteração de sensibilidade abaixo do sítio. Pode indicar lesão de nervo adjacente (ex: nervo sural no calcâneo).", gravidade: "moderada" },
      { title: "Dor que não melhora após 1 semana", desc: "Se dor permanece intensa e inalterada após 7 dias, reconsiderar diagnóstico ou técnica.", gravidade: "moderada" },
    ],
    analgesia: {
      fase1: { periodo: "0-72h", desc: "Fase inflamatória aguda. Dor tendínea pode ser intensa." },
      medicamentos: [
        { nome: "Paracetamol", dose: "1g", intervalo: "6/6h", max: "4g/dia", nota: "Primeira linha. Seguro para tendão." },
        { nome: "Tramadol", dose: "50-100mg", intervalo: "8/8h", max: "400mg/dia", nota: "Se dor intensa. Associar a antiemético se náusea." },
        { nome: "Codeína", dose: "30mg", intervalo: "12/12h", max: "120mg/dia", nota: "Opióide leve." },
        { nome: "Pregabalina", dose: "75mg", intervalo: "12/12h", max: "300mg/dia", nota: "Componente neuropático ou dor refratária. Receita especial." },
      ],
      proibido: "AINEs devem ser EVITADOS por 3-4 semanas. Tendões dependem da resposta COX-2 para remodelação. AINEs atrasam a síntese de colágeno. Se absolutamente necessário, após 72h, usar mínima dose por 3 dias.",
      gelo: "Gelo 15-20 min a cada 3h nas primeiras 48h. Para tendões superficiais (Aquiles, epicondilite), proteger a pele com toalha grossa. ELEVAÇÃO do membro quando aplicável.",
    },
    cronograma: [
      { tempo: "0-72h", titulo: "Proteção Absoluta", desc: "Imobilização parcial (tala/bota de caminhada se indicado). NENHUMA carga no tendão. Apenas mobilização passiva suave. Gelo." },
      { tempo: "3-7 dias", titulo: "Mobilização Suave", desc: "Retirada da imobilização. Mobilização ativa assistida. Alongamento isométrico leve. NÃO carregar o tendão." },
      { tempo: "1-2 semanas", titulo: "Carga Leve", desc: "Início de fortalecimento isométrico progressivo. Carga < 30% 1RM. Exercícios excêntricos muito leves." },
      { tempo: "2-4 semanas", titulo: "Carga Moderada", desc: "Fortalecimento excêntrico progressivo. Carga 30-60% 1RM. Propriocepção. Hidroterapia." },
      { tempo: "4-8 semanas", titulo: "Carga Progressiva", desc: "Fortalecimento excêntrico pesado (Alfredson completo). Pliometria leve. Retorno a atividades diárias." },
      { tempo: "8-12 semanas", titulo: "Retorno ao Esporte", desc: "Pliometria progressiva. Testes funcionais específicos. Retorno gradual ao esporte. Tendões exigem 12+ semanas para maturação do colágeno." },
    ],
    fisio: {
      frequencia: "3x/semana nas primeiras 4 semanas (tendões exigem estímulo frequente). 2x/semana nas semanas 5-8. 1x/semana manutenção.",
      fases: [
        { fase: "Semana 1-2", foco: "Controle de dor, proteção", tecnicas: "Crioterapia, USG terapêutico (1MHz, baixa intensidade), mobilização passiva, drenagem, fortalecimento isométrico (5s x 10 reps)." },
        { fase: "Semana 3-4", foco: "Amplitude e carga leve", tecnicas: "Alongamento excêntrico leve, fortalecimento isométrico progressivo, esteira sem inclinação, hidroterapia." },
        { fase: "Semana 5-8", foco: "Fortalecimento excêntrico", tecnicas: "Protocolo Alfredson (excêntricos pesados), plataforma vibratória, propriocepção, esteira com inclinação." },
        { fase: "Semana 9-12", foco: "Retorno funcional", tecnicas: "Pliometria, treino de agilidade, testes funcionais (hop test, triple hop), retorno gradual ao esporte." },
      ],
    },
    retornos: [
      { tempo: "7-10 dias", tipo: "Retorno inicial", objetivo: "Avaliar resposta ao flare, adesão à imobilização/fisioterapia. USG de controle se dor excessiva." },
      { tempo: "4-6 semanas", tipo: "Reavaliação", objetivo: "Escores funcionais (VAS). Avaliar progressão excêntrica. 2ª sessão se protocolo indicar." },
      { tempo: "3 meses", tipo: "Reavaliação principal", objetivo: "Avaliação clínica + USG (neovascularização, espessamento tendíneo). Decisão sobre nova sessão." },
      { tempo: "6-12 meses", tipo: "Longo prazo", objetivo: "Avaliar durabilidade. Tendões maturam colágeno em 6-12 meses. Documentar resultado." },
    ],
    escores: [
      { nome: "VAS (Dor)", min: 0, max: 10, desc: "Escala Visual Analógica." },
    ],
  },

  prp_ligamentar: {
    nome: "PRP Ligamentar", icon: "🔗",
    checklist: {
      hidrico: [
        { title: "Hidratação adequada", desc: "2-3 litros nas 24-48h prévias.", tag: "obrigatorio" },
        { title: "Evitar álcool 48h antes", desc: "Álcool compromete coagulação e qualidade plaquetária.", tag: "obrigatorio" },
      ],
      meds: [
        { title: "Suspender AINEs 7-10 dias", desc: "Ligamentos dependem de resposta inflamatória para remodelação. AINEs atrasam síntese de colágeno tipo I.", tag: "obrigatorio" },
        { title: "Informar anticoagulantes", desc: "Risco de hematoma articular ou periligamentar. Avaliar risco trombótico vs. risco de sangramento.", tag: "obrigatorio" },
        { title: "Corticoides: intervalo mínimo 3 meses", desc: "Infiltração intra-articular de corticoide reduz resposta a PRP ligamentar.", tag: "obrigatorio" },
      ],
      alimentacao: [
        { title: "Alimentação normal, sem jejum", desc: "Refeição leve 2h antes.", tag: "obrigatorio" },
        { title: "Suplementação de colágeno + vitamina C", desc: "Colágeno hidrolisado 10g + vitamina C 500mg. Cofator para hidroxilação de prolina/lisina.", tag: "recomendado" },
      ],
      logistica: [
        { title: "Acompanhante obrigatório", desc: "Procedimento em articulação + possível imobilização posterior. Necessário para retorno.", tag: "obrigatorio" },
        { title: "Muletas disponíveis", desc: "Para membros inferiores, providenciar muletas antes do procedimento. Carga protegida por 1-2 semanas.", tag: "obrigatorio" },
        { title: "Roupa adequada", desc: "Roupas largas. Facilitar acesso à região tratada e imobilização posterior.", tag: "recomendado" },
      ],
      docs: [
        { title: "RM de articulação recente", desc: "Avaliar grau de lesão ligamentar (parcial vs. completa). PRP indicado para lesões parciais (grau I-II).", tag: "obrigatorio" },
        { title: "Exames laboratoriais", desc: "Hemograma, coagulograma. HbA1c se diabético.", tag: "obrigatorio" },
        { title: "Termo de consentimento", desc: "Incluir risco de lesão neurovascular (raro), hematoma articular, falha de cicatrização em lesão completa.", tag: "obrigatorio" },
      ],
    },
    sinaisEsperados: [
      { title: "Dor articular nas primeiras 48-72h", desc: "Resposta inflamatória no ligamento e articulação. Piora com movimentos de stress do ligamento.", periodo: "48-72h" },
      { title: "Edema articular", desc: "Inchaço por resposta inflamatória e volume injetado.", periodo: "3-5 dias" },
      { title: "Instabilidade subjetiva", desc: "Sensação de 'frouxidão' nas primeiras 2 semanas. Normal durante fase de remodelação. Melhora com fortalecimento.", periodo: "2-4 semanas" },
      { title: "Rigidez articular", desc: "Limitação de amplitude por edema e proteção muscular. Melhora com mobilização progressiva.", periodo: "1-2 semanas" },
    ],
    sinaisAlerta: [
      { title: "Febre > 38°C", desc: "Infecção articular (artrite séptica) é emergência. URGÊNCIA.", gravidade: "grave" },
      { title: "Hemartrose exuberante", desc: "Articulação tensa, dolorosa, com limitação severa. Pode indicar sangramento ativo. Punção articular pode ser necessária.", gravidade: "grave" },
      { title: "Piora da instabilidade com estalo", desc: "SUSPEITA DE RUPTURA PROGRESSIVA DO LIGAMENTO. Imobilizar e reavaliar com RM.", gravidade: "grave" },
      { title: "Drenagem pelo sítio", desc: "Infecção. Avaliação imediata.", gravidade: "grave" },
      { title: "Dor em repouso com pulsação", desc: "Hematoma expansivo ou síndrome compartimental.", gravidade: "moderada" },
    ],
    analgesia: {
      fase1: { periodo: "0-48h", desc: "Fase inflamatória aguda." },
      medicamentos: [
        { nome: "Paracetamol", dose: "1g", intervalo: "6/6h", max: "4g/dia", nota: "Primeira linha." },
        { nome: "Tramadol", dose: "50-100mg", intervalo: "8/8h", max: "400mg/dia", nota: "Se dor intensa." },
        { nome: "Codeína", dose: "30mg", intervalo: "12/12h", max: "120mg/dia", nota: "Opióide leve." },
      ],
      proibido: "AINEs EVITADOS por 2-3 semanas. Se necessário, após 72h, dose mínima por 3-5 dias. AINEs comprometem síntese de colágeno ligamentar.",
      gelo: "Gelo 15-20 min a cada 2-3h nas primeiras 48h. ELEVAÇÃO do membro. Imobilização parcial (joelheira/tala) conforme indicado.",
    },
    cronograma: [
      { tempo: "0-2 semanas", titulo: "Proteção e Imobilização", desc: "Imobilização parcial (joelheira articulada bloqueada, tela elástica). Carga protegida com muletas. NENHUM stress do ligamento." },
      { tempo: "2-4 semanas", titulo: "Mobilização Protegida", desc: "Retirada gradual da imobilização. Mobilização passiva e ativa assistida. Fortalecimento isométrico. NÃO aplicar stress valgo/varo." },
      { tempo: "4-6 semanas", titulo: "Carga Leve", desc: "Carga progressiva sem muletas. Fortalecimento excêntrico leve. Propriocepção. Evitar cortes e giros." },
      { tempo: "6-10 semanas", titulo: "Carga Funcional", desc: "Fortalecimento excêntrico progressivo. Propriocepção avançada (plataforma instável). Início de cortes leves." },
      { tempo: "10-16 semanas", titulo: "Retorno ao Esporte", desc: "Pliometria, treino de agilidade, testes funcionais (Y-balance, hop test). Retorno gradual." },
    ],
    fisio: {
      frequencia: "3x/semana nas primeiras 6 semanas. 2x/semana nas semanas 7-12. 1x/semana manutenção até 6 meses.",
      fases: [
        { fase: "Semana 1-2", foco: "Proteção, controle de edema", tecnicas: "Crioterapia, drenagem, eletroterapia, mobilização passiva (amplitude protegida), fortalecimento isométrico quadríceps/isquiotibiais." },
        { fase: "Semana 3-4", foco: "Amplitude e carga parcial", tecnicas: "Mobilização progressiva, fortalecimento isométrico/isotônico leve, propriocepção básica, esteira plana." },
        { fase: "Semana 5-8", foco: "Fortalecimento neuromuscular", tecnicas: "Fortalecimento excêntrico, plataforma instável, propriocepção avançada, hidroterapia, bicicleta." },
        { fase: "Semana 9-16", foco: "Retorno ao esporte", tecnicas: "Pliometria, treino de agilidade, cortes e giros progressivos, testes funcionais específicos, retorno gradual." },
      ],
    },
    retornos: [
      { tempo: "7-10 dias", tipo: "Retorno inicial", objetivo: "Avaliar edema, adesão à imobilização, início de fisioterapia." },
      { tempo: "4-6 semanas", tipo: "Reavaliação", objetivo: "Escores (VAS). Testes de estabilidade. 2ª sessão de PRP se indicado." },
      { tempo: "3 meses", tipo: "Reavaliação principal", objetivo: "Avaliação clínica + RM de controle. Avaliar sinais de cicatrização ligamentar. Decisão sobre retorno ao esporte." },
      { tempo: "6-12 meses", tipo: "Longo prazo", objetivo: "Avaliar estabilidade articular duradoura. Comparar escores com baseline." },
    ],
    escores: [
      { nome: "VAS (Dor)", min: 0, max: 10, desc: "Escala Visual Analógica." },
    ],
  },

  prp_muscular: {
    nome: "PRP Muscular", icon: "🏋️",
    checklist: {
      hidrico: [
        { title: "Hidratação adequada", desc: "2-3 litros nas 24-48h prévias. Músculos são 75% água. Hidratação otimiza perfusão.", tag: "obrigatorio" },
        { title: "Evitar álcool 48h antes", desc: "Álcool desidrata e compromete recuperação muscular.", tag: "obrigatorio" },
      ],
      meds: [
        { title: "Suspender AINEs 7-10 dias", desc: "AINEs atrasam regeneração muscular. Paracetamol permitido.", tag: "obrigatorio" },
        { title: "Informar anticoagulantes", desc: "Risco de hematoma intramuscular significativo. Avaliar risco/benefício.", tag: "obrigatorio" },
      ],
      alimentacao: [
        { title: "Alimentação normal, sem jejum", desc: "Refeição leve 2h antes.", tag: "obrigatorio" },
        { title: "Proteína adequada", desc: "Manter ingestão > 1,2 g/kg. Aminoácidos essenciais para regeneração muscular.", tag: "recomendado" },
      ],
      logistica: [
        { title: "Acompanhante recomendado", desc: "Procedimento pode ser doloroso. Acompanhante auxilia no retorno.", tag: "recomendado" },
        { title: "Evitar exercício do grupo muscular", desc: "Não trabalhar o grupo muscular a ser tratado 48h antes.", tag: "recomendado" },
      ],
      docs: [
        { title: "USG ou RM do músculo", desc: "Avaliar grau da lesão (1-3), localização, hematoma. PRP indicado para lesões grau 2-3 ou refratárias.", tag: "obrigatorio" },
        { title: "Exames laboratoriais", desc: "Hemograma, CK (creatina quinase) se lesão recente.", tag: "obrigatorio" },
        { title: "Termo de consentimento", desc: "Incluir risco de hematoma intramuscular, dor intensa, risco de fibrose em caso de reinjúria precoce.", tag: "obrigatorio" },
      ],
    },
    sinaisEsperados: [
      { title: "Dor local intensa 24-48h", desc: "Músculos são altamente inervados. A infiltração causa dor significativa. Normal.", periodo: "24-48h" },
      { title: "Edema muscular", desc: "Inchaço localizado no músculo tratado. Pode ser palpável. Regride em 5-7 dias.", periodo: "5-7 dias" },
      { title: "Calor e rubor", desc: "Resposta vascular normal. Mais evidente em músculos superficiais.", periodo: "24-48h" },
      { title: "Dor com contração isométrica", desc: "Dor ao tensionar o músculo nas primeiras 2 semanas. Esperado. Não forçar.", periodo: "2 semanas" },
    ],
    sinaisAlerta: [
      { title: "Febre > 38°C", desc: "Miosite infecciosa é rara mas grave. URGÊNCIA.", gravidade: "grave" },
      { title: "Hematoma expansivo", desc: "Aumento rápido de volume, dor intensa, tensão muscular. Pode indicar sangramento ativo.", gravidade: "grave" },
      { title: "Parestesia ou fraqueza distal", desc: "Lesão de nervo adjacente ou síndrome compartimental.", gravidade: "grave" },
      { title: "Dor que não melhora após 1 semana", desc: "Reconsiderar diagnóstico ou técnica.", gravidade: "moderada" },
    ],
    analgesia: {
      fase1: { periodo: "0-48h", desc: "Fase inflamatória aguda." },
      medicamentos: [
        { nome: "Paracetamol", dose: "1g", intervalo: "6/6h", max: "4g/dia", nota: "Primeira linha." },
        { nome: "Tramadol", dose: "50-100mg", intervalo: "8/8h", max: "400mg/dia", nota: "Se dor intensa." },
      ],
      proibido: "AINEs EVITADOS por 2-3 semanas. Atrasam regeneração muscular. Se necessário, após 72h, mínima dose por 3 dias.",
      gelo: "Gelo 15-20 min a cada 3h nas primeiras 48h. Compressão elástica moderada. ELEVAÇÃO do membro.",
    },
    cronograma: [
      { tempo: "0-48h", titulo: "Proteção", desc: "Repouso absoluto do grupo muscular. Gelo. Compressão. Elevação. NENHUM estímulo muscular." },
      { tempo: "48h-1 semana", titulo: "Mobilização Suave", desc: "Mobilização passiva e ativa assistida. Alongamento leve. NÃO carregar o músculo." },
      { tempo: "1-2 semanas", titulo: "Carga Leve", desc: "Fortalecimento isométrico leve. Carga < 30% 1RM. Mobilidade progressiva." },
      { tempo: "2-4 semanas", titulo: "Carga Moderada", desc: "Fortalecimento isotônico progressivo. Carga 30-60% 1RM. Alongamento ativo." },
      { tempo: "4-6 semanas", titulo: "Carga Funcional", desc: "Fortalecimento excêntrico. Carga > 60% 1RM. Propriocepção. Retorno a atividades diárias." },
      { tempo: "6-8 semanas", titulo: "Retorno ao Esporte", desc: "Pliometria leve. Testes funcionais. Retorno gradual. Músculos cicatrizam mais rápido que tendões (6-8 semanas)." },
    ],
    fisio: {
      frequencia: "3x/semana nas primeiras 3 semanas. 2x/semana nas semanas 4-6.",
      fases: [
        { fase: "Semana 1", foco: "Proteção, controle de edema", tecnicas: "Crioterapia, eletroterapia (TENS), mobilização passiva, drenagem, isometria leve (5s x 10 reps)." },
        { fase: "Semana 2", foco: "Amplitude e carga leve", tecnicas: "Mobilização progressiva, fortalecimento isométrico/isotônico leve, alongamento ativo, hidroterapia." },
        { fase: "Semana 3-4", foco: "Fortalecimento progressivo", tecnicas: "Fortalecimento isotônico progressivo, excêntricos leves, propriocepção, esteira/bicicleta." },
        { fase: "Semana 5-6", foco: "Retorno funcional", tecnicas: "Excêntricos pesados, pliometria, treino específico, testes funcionais, retorno gradual." },
      ],
    },
    retornos: [
      { tempo: "7-10 dias", tipo: "Retorno inicial", objetivo: "Avaliar edema, adesão ao repouso, início de fisioterapia." },
      { tempo: "3-4 semanas", tipo: "Reavaliação", objetivo: "Escores (VAS). Testes de força muscular. USG de controle se indicado." },
      { tempo: "6-8 semanas", tipo: "Reavaliação principal", objetivo: "Avaliação clínica + testes funcionais. Liberar retorno ao esporte se critérios atingidos." },
    ],
    escores: [
      { nome: "VAS (Dor)", min: 0, max: 10, desc: "Escala Visual Analógica." },
      { nome: "MRC (Força)", min: 0, max: 5, desc: "Medical Research Council Scale for Muscle Strength. 5 = força normal." },
    ],
  },

  ctm_osso: {
    nome: "CTM / Condicionado", icon: "🧬",
    checklist: {
      hidrico: [
        { title: "Hidratação adequada", desc: "2-3 litros nas 24-48h prévias. Essencial para coleta de medula óssea ou tecido adiposo.", tag: "obrigatorio" },
        { title: "Evitar álcool 72h antes", desc: "Álcool afeta viabilidade celular e resposta imunológica.", tag: "obrigatorio" },
      ],
      meds: [
        { title: "Suspender AINEs 10-14 dias antes", desc: "CTMs são sensíveis ao microambiente. AINEs inibem diferenciação osteogênica e condrogênica.", tag: "obrigatorio" },
        { title: "Suspender anticoagulantes conforme cardiologia", desc: "Risco de sangramento durante coleta de medula óssea. Warfarina: INR < 1,5. ACOs: suspender 24-48h.", tag: "obrigatorio" },
        { title: "Suspender corticoides sistêmicos", desc: "Corticoides inibem diferenciação de CTMs. Se possível, reduzir dose 2-4 semanas antes.", tag: "obrigatorio" },
        { title: "Informar imunossupressores", desc: "Imunossupressores de alta potência podem comprometer a sobrevida das CTMs. Avaliar com reumatologia.", tag: "obrigatorio" },
      ],
      alimentacao: [
        { title: "Jejum de 6-8h se sedação", desc: "Se procedimento envolver sedação (coleta de medula óssea), jejum de 6-8h para sólidos e 2h para líquidos claros.", tag: "condicional" },
        { title: "Alimentação normal se apenas anestesia local", desc: "Se apenas infiltração de CTM adiposo ou condicionado, refeição leve 2h antes.", tag: "obrigatorio" },
        { title: "Suplementação de vitamina D e ômega-3", desc: "Vitamina D > 30 ng/mL é essencial para diferenciação osteogênica. Ômega-3 reduz apoptose celular.", tag: "recomendado" },
      ],
      logistica: [
        { title: "Acompanhante obrigatório", desc: "Se sedação ou anestesia regional. Necessário para retorno.", tag: "obrigatorio" },
        { title: "Roupa confortável e acesso ao sítio de coleta", desc: "Se medula óssea: acesso à região lombar/ilíaca posterior. Se adiposo: acesso ao abdome/coxas.", tag: "obrigatorio" },
        { title: "Evitar esforço 48h antes", desc: "Repouso relativo otimiza a qualidade do tecido coletado.", tag: "recomendado" },
      ],
      docs: [
        { title: "Exames laboratoriais completos", desc: "Hemograma completo, coagulograma (TP, TTPA, INR), função renal e hepática, sorologias (HIV, HBV, HCV, sífilis). Obrigatório para terapia celular.", tag: "obrigatorio" },
        { title: "Imagem do sítio de aplicação", desc: "RM ou TC do sítio de lesão (cartilagem, osso, subcondral). Planejamento da abordagem.", tag: "obrigatorio" },
        { title: "Termo de consentimento específico", desc: "Incluir: natureza experimental/emergente da terapia celular, riscos de coleta, riscos de aplicação, falha terapêutica, necessidade de cirurgia futura.", tag: "obrigatorio" },
        { title: "Autorização ANVISA/Comitê de Ética", desc: "Se pesquisa clínica: CAAE, TCLE específico. Se uso compassivo: documentação regulatória.", tag: "obrigatorio" },
      ],
    },
    sinaisEsperados: [
      { title: "Dor no sítio de coleta", desc: "Medula óssea: dor lombar ou glútea por 3-7 dias. Adiposo: dor no sítio de lipoaspiração por 5-7 dias. Normal.", periodo: "3-7 dias" },
      { title: "Dor no sítio de aplicação", desc: "Dor local nas primeiras 48-72h. Piora com carga (se articular) ou movimento.", periodo: "48-72h" },
      { title: "Edema no sítio de coleta", desc: "Hematoma/equimose no sítio de lipoaspiração ou punção de medula. Regride em 1-2 semanas.", periodo: "1-2 semanas" },
      { title: "Edema no sítio de aplicação", desc: "Inchaço local pelo volume injetado e resposta inflamatória. Regride em 5-7 dias.", periodo: "5-7 dias" },
      { title: "Sensação de peso ou plenitude", desc: "Se intra-articular, sensação de pressão. Normal em 48h.", periodo: "24-48h" },
    ],
    sinaisAlerta: [
      { title: "Febre > 38°C", desc: "Infecção no sítio de coleta ou aplicação. URGÊNCIA.", gravidade: "grave" },
      { title: "Sangramento persistente no sítio de coleta", desc: "Se medula óssea: sangramento pelo local da punção que não cessa com compressão. URGÊNCIA.", gravidade: "grave" },
      { title: "Hematoma expansivo no sítio de lipoaspiração", desc: "Aumento rápido de volume, dor intensa. Pode indicar sangramento ativo.", gravidade: "grave" },
      { title: "Drenagem purulenta", desc: "Qualquer secreção é anormal.", gravidade: "grave" },
      { title: "Dor neuropática irradiada", desc: "Se medula óssea: dor irradiada para perna pode indicar lesão de nervo espinhal (raro).", gravidade: "moderada" },
      { title: "Piora progressiva após 1 semana", desc: "Se dor/edema não melhoram após 7 dias, avaliar complicação.", gravidade: "moderada" },
    ],
    analgesia: {
      fase1: { periodo: "0-72h", desc: "Fase inflamatória aguda. Dor pode ser intensa em coleta de medula óssea." },
      medicamentos: [
        { nome: "Paracetamol", dose: "1g", intervalo: "6/6h", max: "4g/dia", nota: "Primeira linha. Seguro para CTMs." },
        { nome: "Tramadol", dose: "50-100mg", intervalo: "8/8h", max: "400mg/dia", nota: "Se dor intensa." },
        { nome: "Dipirona", dose: "1g", intervalo: "6/6h", max: "4g/dia", nota: "Alternativa ao paracetamol." },
        { nome: "Codeína", dose: "30mg", intervalo: "12/12h", max: "120mg/dia", nota: "Opióide leve." },
      ],
      proibido: "AINEs EVITADOS por 3-4 semanas. Inibem diferenciação de CTMs e reduzem expressão de fatores de crescimento. Se absolutamente necessário, após 72h, mínima dose por 3-5 dias.",
      gelo: "Gelo no sítio de aplicação 15-20 min a cada 3h nas primeiras 48h. No sítio de coleta (medula): compressão local e repouso. No sítio de lipoaspiração: cinta de compressão por 2-4 semanas.",
    },
    cronograma: [
      { tempo: "0-72h", titulo: "Proteção", desc: "Repouso relativo. Gelo no sítio de aplicação. Compressão no sítio de coleta (se adiposo). Imobilização parcial se articular." },
      { tempo: "3-7 dias", titulo: "Mobilização Suave", desc: "Mobilização passiva e ativa assistida. NÃO carregar o sítio tratado. Fisioterapia: controle de dor/edema." },
      { tempo: "1-2 semanas", titulo: "Carga Leve", desc: "Fortalecimento isométrico leve. Carga < 30% 1RM. Mobilidade progressiva." },
      { tempo: "2-4 semanas", titulo: "Carga Moderada", desc: "Fortalecimento progressivo. Carga 30-60% 1RM. Propriocepção." },
      { tempo: "4-8 semanas", titulo: "Carga Funcional", desc: "Fortalecimento excêntrico. Carga > 60% 1RM. Retorno a atividades diárias." },
      { tempo: "8-12 semanas", titulo: "Retorno ao Esporte", desc: "Pliometria, testes funcionais. Retorno gradual. CTMs necessitam 8-12 semanas para diferenciação e integração tecidual." },
    ],
    fisio: {
      frequencia: "2-3x/semana nas primeiras 6 semanas. 2x/semana nas semanas 7-12. 1x/semana manutenção.",
      fases: [
        { fase: "Semana 1-2", foco: "Proteção, controle de dor/edema", tecnicas: "Crioterapia, eletroterapia, mobilização passiva, drenagem, fortalecimento isométrico." },
        { fase: "Semana 3-4", foco: "Amplitude e carga leve", tecnicas: "Mobilização progressiva, fortalecimento isométrico/isotônico leve, propriocepção básica." },
        { fase: "Semana 5-8", foco: "Fortalecimento neuromuscular", tecnicas: "Fortalecimento excêntrico progressivo, plataforma instável, propriocepção avançada, hidroterapia." },
        { fase: "Semana 9-12", foco: "Retorno funcional", tecnicas: "Pliometria, treino de agilidade, testes funcionais, retorno gradual ao esporte." },
      ],
    },
    retornos: [
      { tempo: "7-10 dias", tipo: "Retorno inicial", objetivo: "Avaliar sítio de coleta e aplicação. Edema, dor, sinais de infecção. Início de fisioterapia." },
      { tempo: "4-6 semanas", tipo: "Reavaliação", objetivo: "Escores funcionais (VAS). Avaliar progressão." },
      { tempo: "3 meses", tipo: "Reavaliação principal", objetivo: "Avaliação clínica completa + imagem (RM/TC) de controle. Avaliar integração tecidual. Decisão sobre nova sessão." },
      { tempo: "6-12 meses", tipo: "Longo prazo", objetivo: "Avaliar durabilidade. CTMs podem levar 6-12 meses para efeito máximo." },
    ],
    escores: [
      { nome: "VAS (Dor)", min: 0, max: 10, desc: "Escala Visual Analógica." },
    ],
  },

  fatores_crescimento: {
    nome: "Fatores de Crescimento", icon: "⚡",
    checklist: {
      hidrico: [
        { title: "Hidratação adequada", desc: "2-3 litros nas 24-48h prévias.", tag: "obrigatorio" },
        { title: "Evitar álcool 48h antes", desc: "Álcool pode alterar resposta tecidual aos fatores de crescimento.", tag: "obrigatorio" },
      ],
      meds: [
        { title: "Suspender AINEs 7-10 dias", desc: "AINEs inibem vias de sinalização dos fatores de crescimento (MAPK, PI3K/Akt).", tag: "obrigatorio" },
        { title: "Informar anticoagulantes", desc: "Avaliar risco de hematoma no sítio de aplicação.", tag: "obrigatorio" },
        { title: "Informar corticoides", desc: "Corticoides antagonizam a ação de TGF-β e BMPs.", tag: "obrigatorio" },
      ],
      alimentacao: [
        { title: "Alimentação normal, sem jejum", desc: "Refeição leve 2h antes.", tag: "obrigatorio" },
        { title: "Dieta rica em proteínas e aminoácidos", desc: "Glicina, prolina e lisina são substratos para síntese de colágeno estimulada pelos fatores de crescimento.", tag: "recomendado" },
      ],
      logistica: [
        { title: "Acompanhante recomendado", desc: "Procedimento geralmente rápido, mas acompanhante é útil.", tag: "recomendado" },
        { title: "Roupa adequada", desc: "Facilitar acesso ao sítio de aplicação.", tag: "recomendado" },
      ],
      docs: [
        { title: "Exames laboratoriais", desc: "Hemograma, coagulograma (se anticoagulante).", tag: "obrigatorio" },
        { title: "Imagem do sítio", desc: "USG ou RM recente para planejamento.", tag: "obrigatorio" },
        { title: "Termo de consentimento", desc: "Incluir: origem dos fatores de crescimento (recombinantes, autólogos, alogênicos), riscos, benefícios esperados e alternativas.", tag: "obrigatorio" },
      ],
    },
    sinaisEsperados: [
      { title: "Dor local 24-48h", desc: "Resposta inflamatória fisiológica. Normal.", periodo: "24-48h" },
      { title: "Edema local", desc: "Inchaço no sítio de aplicação. Regride em 3-5 dias.", periodo: "3-5 dias" },
      { title: "Calor e rubor", desc: "Vasodilatação local. Normal em 24-48h.", periodo: "24-48h" },
    ],
    sinaisAlerta: [
      { title: "Febre > 38°C", desc: "Infecção. URGÊNCIA.", gravidade: "grave" },
      { title: "Drenagem pelo sítio", desc: "Infecção.", gravidade: "grave" },
      { title: "Piora progressiva após 72h", desc: "Reavaliar diagnóstico ou técnica.", gravidade: "moderada" },
    ],
    analgesia: {
      fase1: { periodo: "0-48h", desc: "Fase inflamatória aguda." },
      medicamentos: [
        { nome: "Paracetamol", dose: "1g", intervalo: "6/6h", max: "4g/dia", nota: "Primeira linha." },
        { nome: "Tramadol", dose: "50-100mg", intervalo: "8/8h", max: "400mg/dia", nota: "Se dor intensa." },
      ],
      proibido: "AINEs EVITADOS por 2-3 semanas. Comprometem a sinalização dos fatores de crescimento.",
      gelo: "Gelo 15-20 min a cada 3h nas primeiras 48h.",
    },
    cronograma: [
      { tempo: "0-48h", titulo: "Proteção", desc: "Repouso relativo. Gelo." },
      { tempo: "48h-1 semana", titulo: "Mobilização Suave", desc: "Mobilização passiva e ativa assistida." },
      { tempo: "1-2 semanas", titulo: "Carga Leve", desc: "Fortalecimento isométrico leve." },
      { tempo: "2-4 semanas", titulo: "Carga Moderada", desc: "Fortalecimento progressivo." },
      { tempo: "4-6 semanas", titulo: "Carga Funcional", desc: "Retorno a atividades diárias." },
      { tempo: "6-8 semanas", titulo: "Retorno ao Esporte", desc: "Testes funcionais. Retorno gradual." },
    ],
    fisio: {
      frequencia: "2-3x/semana nas primeiras 4 semanas. 2x/semana nas semanas 5-6.",
      fases: [
        { fase: "Semana 1-2", foco: "Proteção, controle de dor", tecnicas: "Crioterapia, eletroterapia, mobilização passiva, fortalecimento isométrico." },
        { fase: "Semana 3-4", foco: "Amplitude e carga", tecnicas: "Mobilização progressiva, fortalecimento isotônico leve, propriocepção." },
        { fase: "Semana 5-6", foco: "Fortalecimento", tecnicas: "Fortalecimento excêntrico, plataforma instável, testes funcionais." },
      ],
    },
    retornos: [
      { tempo: "7-10 dias", tipo: "Retorno inicial", objetivo: "Avaliar resposta, início de fisioterapia." },
      { tempo: "4-6 semanas", tipo: "Reavaliação", objetivo: "Escores funcionais. Avaliar progressão." },
      { tempo: "3 meses", tipo: "Reavaliação principal", objetivo: "Avaliação clínica completa. Decisão sobre nova sessão." },
    ],
    escores: [
      { nome: "VAS (Dor)", min: 0, max: 10, desc: "Escala Visual Analógica." },
    ],
  },
};

export const PROCS = [
  { id: "prp_articular",      label: "PRP Intra-Articular", sub: "Ombro, cotovelo, quadril, tornozelo",     icon: "🦴" },
  { id: "prp_tendineo",       label: "PRP Tendíneo",         sub: "Tendão calcâneo, epicondilite",          icon: "💪" },
  { id: "prp_ligamentar",     label: "PRP Ligamentar",       sub: "Ligamentos colaterais, tornozelo",        icon: "🔗" },
  { id: "prp_muscular",       label: "PRP Muscular",         sub: "Lesões musculares, entorses",              icon: "🏋️" },
  { id: "ctm_osso",           label: "CTM / Condicionado",   sub: "Medula óssea, tecido adiposo, cordão",    icon: "🧬" },
  { id: "fatores_crescimento",label: "Fatores de Crescimento",sub: "Concentrados, BMP, PDGF",                icon: "⚡" },
];

export const CONTRAINDIC = [
  "Doença autoimune em atividade (contraindicação relativa)",
  "Infecção ativa no sítio ou sistêmica (contraindicação absoluta)",
  "Neoplasia ativa (contraindicação absoluta)",
  "Gravidez (contraindicação relativa — depende do tipo de procedimento)",
  "HbA1c > 8,5% (adiar até controle glicêmico)",
  "Uso de anticoagulantes de alta intensidade sem controle",
  "Alergia a materiais de coleta ou antissépticos",
];

/**
 * Spanish copy is deliberately paired with the authored protocol fields here,
 * rather than inferred from rendered DOM text. Clinical codes, medicine names,
 * doses, thresholds, units and enum/storage values never enter this pairing.
 */
function buildSpanishContent() {
  const data = structuredClone(DATA);
  const procs = structuredClone(PROCS);
  const contraindications = [...CONTRAINDIC];
  let cursor = 0;
  const translations = new Map<string, string>();
  const translated = (source: string) => {
    const existing = translations.get(source);
    if (existing !== undefined) return existing;
    const value = ORIENTATION_ES_VALUES[cursor++];
    if (value === undefined) throw new Error("orientation-es-catalog-incomplete");
    translations.set(source, value);
    return value;
  };
  const localizedPeriod = (value: string) => value.replace(/\bdias\b/g, "días");
  const localizedScoreNames: Record<string, string> = {
    "VAS (Dor)": "VAS (Dolor)",
    "MRC (Força)": "MRC (Fuerza)",
  };

  Object.values(data).forEach(protocol => {
    Object.values(protocol.checklist).forEach(items => items.forEach(item => {
      item.title = translated(item.title);
      item.desc = translated(item.desc);
    }));
    protocol.sinaisEsperados.forEach(item => {
      item.title = translated(item.title);
      item.desc = translated(item.desc);
      item.periodo = localizedPeriod(item.periodo);
    });
    protocol.sinaisAlerta.forEach(item => {
      item.title = translated(item.title);
      item.desc = translated(item.desc);
    });
    protocol.analgesia.fase1.desc = translated(protocol.analgesia.fase1.desc);
    protocol.analgesia.medicamentos.forEach(medicine => { medicine.nota = translated(medicine.nota); });
    protocol.analgesia.proibido = translated(protocol.analgesia.proibido);
    protocol.analgesia.gelo = translated(protocol.analgesia.gelo);
    protocol.cronograma.forEach(item => {
      item.tempo = localizedPeriod(item.tempo);
      item.titulo = translated(item.titulo);
      item.desc = translated(item.desc);
    });
    protocol.fisio.frequencia = translated(protocol.fisio.frequencia);
    protocol.fisio.fases.forEach(item => {
      item.foco = translated(item.foco);
      item.tecnicas = translated(item.tecnicas);
    });
    protocol.retornos.forEach(item => {
      item.tempo = localizedPeriod(item.tempo);
      item.tipo = translated(item.tipo);
      item.objetivo = translated(item.objetivo);
    });
    protocol.escores.forEach(item => {
      item.nome = localizedScoreNames[item.nome] ?? item.nome;
      item.desc = translated(item.desc);
    });
  });

  procs.forEach(item => {
    item.label = translated(item.label);
    item.sub = translated(item.sub);
    data[item.id].nome = item.label;
  });
  contraindications.forEach((value, index) => { contraindications[index] = translated(value); });

  if (cursor !== ORIENTATION_ES_VALUES.length) {
    throw new Error(`orientation-es-catalog-misaligned (${cursor}/${ORIENTATION_ES_VALUES.length})`);
  }
  return { data, procs, contraindications };
}

const SPANISH_CONTENT = buildSpanishContent();

/** The two authored protocol catalogues used by both clinician and patient views. */
export function getOrientationContent(locale: "pt-BR" | "es") {
  return locale === "es" ? SPANISH_CONTENT : {
    data: DATA,
    procs: PROCS,
    contraindications: CONTRAINDIC,
  };
}

type Tab = "pre" | "pos" | "alertas" | "rehab";

export const tagStyle: Record<Tag, { bg: string; text: string; label: string }> = {
  obrigatorio: { bg: "#fee2e2", text: "#991b1b", label: "" },
  recomendado:  { bg: "#fef3c7", text: "#92400e", label: "" },
  condicional:  { bg: "#e0e7ff", text: "#4338ca", label: "" },
};

export const TL = "#0f766e";

// ─── Component ────────────────────────────────────────────────────────────────
export default function RegenOrientacoes() {
  const t = useScopedTranslations(regenCoreMessages);
  const { locale } = useLanguage();
  const [, navigate] = useLocation();
  const [proc, setProc] = useState<string>("prp_articular");
  const [tab,  setTab]  = useState<Tab>("pre");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [scores, setScores] = useState<Record<string, string>>({});

  const orientationContent = getOrientationContent(locale);
  const localizedData = orientationContent.data;
  const localizedProcs = orientationContent.procs;
  const localizedContraindications = orientationContent.contraindications;
  const d = localizedData[proc];
  if (!d) return null;

  function toggleCheck(key: string) {
    setChecked(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function setScore(key: string, val: string) {
    setScores(prev => ({ ...prev, [key]: val }));
  }

  const SECTIONS: { key: keyof typeof d.checklist; label: string }[] = [
    { key: "hidrico", label: t("physicalHydration") }, { key: "meds", label: t("medicationsAllergies") },
    { key: "alimentacao", label: t("foodFasting") }, { key: "logistica", label: t("logistics") },
    { key: "docs", label: t("documentsExams") },
  ];
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "pre", label: t("preProcedure"), icon: <ClipboardList className="h-4 w-4" /> },
    { id: "pos", label: t("postProcedure"), icon: <CheckCircle2 className="h-4 w-4" /> },
    { id: "alertas", label: t("warningSigns"), icon: <AlertTriangle className="h-4 w-4" /> },
    { id: "rehab", label: t("rehabilitation"), icon: <Activity className="h-4 w-4" /> },
  ];
  const localizedTagStyle = {
    ...tagStyle,
    obrigatorio: { ...tagStyle.obrigatorio, label: t("mandatory") },
    recomendado: { ...tagStyle.recomendado, label: t("recommended") },
    condicional: { ...tagStyle.condicional, label: t("conditional") },
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">

      {/* ── Mobile header ── */}
      <div className="md:hidden" style={{ background: "linear-gradient(135deg,#0A1628 0%,#0D2040 100%)" }}>
        <div className="px-4 pt-5 pb-4">
          <button onClick={() => navigate("/regen")} data-analytics-destination="/regen"
            style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "rgba(31,182,225,0.85)", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 10 }}>
          <ArrowLeft className="h-3.5 w-3.5" /> {t("regenerative")}
          </button>
           <h1 style={{ fontSize: 20, fontWeight: 700, color: "#fff", margin: 0 }}>{t("orientationMobileTitle")}</h1>
           <p style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", margin: "3px 0 0" }}>{t("orientationSubtitle")}</p>
        </div>
      </div>

      {/* ── Desktop header ── */}
      <div className="hidden md:flex px-6 pt-6 pb-0 items-center gap-3">
        <button onClick={() => navigate("/regen")} data-analytics-destination="/regen"
          className="w-9 h-9 rounded-lg flex items-center justify-center border border-gray-200 bg-white hover:bg-gray-50 transition-colors shrink-0">
          <ArrowLeft className="h-4 w-4 text-gray-700" />
        </button>
        <div>
           <h1 className="text-2xl font-bold tracking-tight text-gray-900">{t("orientationTitle")}</h1>
           <p className="text-sm text-gray-500 mt-0.5">{t("protocolsByProcedure")}</p>
        </div>
      </div>

      <div className="px-4 md:px-6 pt-5 space-y-4 max-w-4xl mx-auto">

        {/* ── Procedure selector ── */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
           <p className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wider">{t("procedureType")}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {localizedProcs.map(p => (
              <button key={p.id} onClick={() => { setProc(p.id); setChecked(new Set()); setScores({}); }}
                className={`rounded-xl border-2 p-3 text-left transition-all ${proc === p.id
                  ? "border-teal-600 bg-teal-50 shadow-sm"
                  : "border-gray-200 bg-white hover:border-teal-300 hover:bg-teal-50/30"}`}>
                <div className="text-2xl mb-1">{p.icon}</div>
                <div className="text-xs font-bold text-gray-800 leading-tight">{p.label}</div>
                <div className="text-[11px] text-gray-500 mt-0.5 leading-tight">{p.sub}</div>
              </button>
            ))}
          </div>
          <div className="mt-3 px-3 py-2 rounded-lg text-sm font-semibold" style={{ background: "#f0fdfa", color: TL }}>
             {t("selected")} {d.nome}
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
           {tabs.map(tabItem => (
             <button key={tabItem.id} onClick={() => setTab(tabItem.id)}
               className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-colors shrink-0 ${tab === tabItem.id
                ? "text-white"
                : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}
               style={tab === tabItem.id ? { background: TL } : {}}>
               {tabItem.icon} {tabItem.label}
            </button>
          ))}
        </div>

        {/* ══ Tab: Pré-Procedimento ══ */}
        {tab === "pre" && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-blue-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-blue-100" style={{ background: "#eff6ff" }}>
                <h2 className="font-bold text-blue-900 text-base flex items-center gap-2">
                   <ClipboardList className="h-5 w-5 text-blue-600" /> {t("preChecklist")}
                </h2>
                 <p className="text-xs text-blue-700 mt-1">{t("checklistHelp")}</p>
              </div>
              <div className="p-4 space-y-4">
                {SECTIONS.map(sec => (
                  <div key={sec.key}>
                    <p className="text-xs font-bold text-gray-500 uppercase mb-2 tracking-wide">{sec.label}</p>
                    <div className="space-y-1.5">
                      {d.checklist[sec.key].map((item, i) => {
                        const key = `${sec.key}-${i}`;
                        const isChecked = checked.has(key);
                         const ts = localizedTagStyle[item.tag];
                        return (
                          <div key={i} onClick={() => toggleCheck(key)}
                            className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer border transition-all ${isChecked ? "border-green-200 bg-green-50" : "border-gray-100 bg-gray-50 hover:bg-gray-100"}`}>
                            <div className={`mt-0.5 w-5 h-5 rounded flex items-center justify-center shrink-0 border-2 transition-colors ${isChecked ? "border-green-500 bg-green-500" : "border-gray-300 bg-white"}`}>
                              {isChecked && <CheckCircle2 className="h-3.5 w-3.5 text-white" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold text-gray-800">{item.title}</div>
                              <div className="text-xs text-gray-500 mt-0.5 leading-relaxed">{item.desc}</div>
                            </div>
                            <span className="text-[10px] font-bold px-2 py-1 rounded-full shrink-0 mt-0.5"
                              style={{ background: ts.bg, color: ts.text }}>{ts.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-5 py-3 border-t border-amber-100 bg-amber-50 text-xs text-amber-800">
                 <strong>⚠️:</strong> {t("protocolNote")}
              </div>
            </div>

            {/* Contraindicações */}
            <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-amber-100" style={{ background: "#fffbeb" }}>
                <h2 className="font-bold text-amber-900 text-base flex items-center gap-2">
                   <XCircle className="h-5 w-5 text-amber-600" /> {t("contraindicationsPrecautions")}
                </h2>
              </div>
              <div className="p-4 space-y-2">
                 {localizedContraindications.map((c, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-red-50 border border-red-100">
                    <span className="text-red-500 shrink-0">⚠️</span>
                    <span className="text-sm text-gray-700">{c}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ══ Tab: Pós-Procedimento ══ */}
        {tab === "pos" && (
          <div className="space-y-4">
            {/* Sinais esperados */}
            <div className="bg-white rounded-2xl border border-green-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-green-100" style={{ background: "#f0fdf4" }}>
                <h2 className="font-bold text-green-900 text-base flex items-center gap-2">
                   <CheckCircle2 className="h-5 w-5 text-green-600" /> {t("expectedSigns")}
                </h2>
                 <p className="text-xs text-green-700 mt-1">{t("expectedSignsHelp")}</p>
              </div>
              <div className="p-4 space-y-2">
                {d.sinaisEsperados.map((s, i) => (
                  <div key={i} className="p-3 rounded-xl bg-green-50 border border-green-100">
                    <div className="font-semibold text-sm text-green-900">✅ {s.title}</div>
                    <div className="text-xs text-green-800 mt-1 leading-relaxed">{s.desc}</div>
                     <div className="text-[11px] text-green-700 mt-1 font-semibold">📅 {t("expectedPeriod")} {s.periodo}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Analgesia */}
            <div className="bg-white rounded-2xl border border-indigo-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-indigo-100" style={{ background: "#eef2ff" }}>
                <h2 className="font-bold text-indigo-900 text-base flex items-center gap-2">
                   💊 {t("analgesiaProtocol")}
                </h2>
                 <p className="text-xs text-indigo-700 mt-1">{t("phase")} {d.analgesia.fase1.periodo}: {d.analgesia.fase1.desc}</p>
              </div>
              <div className="p-4 space-y-2">
                {d.analgesia.medicamentos.map((m, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
                    <div className="flex-1">
                      <div className="font-bold text-sm text-gray-800">{m.nome}</div>
                       <div className="text-xs text-gray-500 mt-0.5">{m.dose} · {m.intervalo} · {t("maximum")} {m.max}</div>
                      <div className="text-xs text-gray-600 mt-0.5">{m.nota}</div>
                    </div>
                  </div>
                ))}
                <div className="p-3 rounded-xl bg-red-50 border border-red-100 text-xs text-red-800">
                   <strong>🚫 {t("avoid")}:</strong> {d.analgesia.proibido}
                </div>
              </div>
            </div>

            {/* Gelo */}
            <div className="bg-white rounded-2xl border border-sky-200 shadow-sm overflow-hidden">
               <div className="px-5 py-4 border-b border-sky-100" style={{ background: "#f0f9ff" }}>
                 <h2 className="font-bold text-sky-900 text-base">🧊 {t("cryotherapyCare")}</h2>
              </div>
              <div className="p-4">
                <p className="text-sm text-gray-700 leading-relaxed">{d.analgesia.gelo}</p>
                <div className="grid grid-cols-2 gap-3 mt-3">
                   {[["🧊","15-20 min",t("applicationDuration")],["⏱️",t("everyTwoThreeHours"),t("first48HoursFrequency")],["🛡️",t("withTowel"),t("neverDirectIce")],["🦵",t("elevation"),t("elevateWhenPossible")]].map(([icon,val,lab]) => (
                    <div key={lab} className="border border-gray-100 rounded-xl p-3 text-center bg-gray-50">
                      <div className="text-xl mb-1">{icon}</div>
                      <div className="text-xs font-bold text-gray-800">{val}</div>
                      <div className="text-[11px] text-gray-500 mt-0.5">{lab}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══ Tab: Sinais de Alerta ══ */}
        {tab === "alertas" && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-red-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-red-100" style={{ background: "#fef2f2" }}>
                <h2 className="font-bold text-red-900 text-base flex items-center gap-2">
                   <AlertTriangle className="h-5 w-5 text-red-600" /> {t("whenSeekHelp")}
                </h2>
                 <p className="text-xs text-red-700 mt-1">{t("warningNotExpected")}</p>
              </div>
              <div className="p-4 space-y-2">
                {d.sinaisAlerta.map((s, i) => (
                  <div key={i} className={`p-3 rounded-xl border text-sm ${s.gravidade === "grave"
                    ? "bg-red-50 border-red-200"
                    : "bg-amber-50 border-amber-200"}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.gravidade === "grave"
                        ? "bg-red-600 text-white"
                        : "bg-amber-500 text-white"}`}>
                         {s.gravidade === "grave" ? `🚨 ${t("urgent")}` : `⚠️ ${t("moderate")}`}
                      </span>
                      <span className="font-semibold text-gray-800">{s.title}</span>
                    </div>
                    <p className="text-xs text-gray-600 leading-relaxed">{s.desc}</p>
                  </div>
                ))}
              </div>
              <div className="px-5 py-3 border-t border-red-100 bg-red-50 text-xs text-red-800">
                 <strong>🚨 {t("absoluteEmergency")}:</strong> {t("absoluteEmergencyText")} → <strong>{t("immediateEmergencyRoom")}</strong>.
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-blue-200 shadow-sm p-4">
              <div className="text-sm font-semibold text-blue-900 mb-2 flex items-center gap-2">
                 <Info className="h-4 w-4 text-blue-500" /> {t("flareVsInfection")}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                   <div className="text-xs font-bold text-green-800 mb-1">✅ {t("physiologicFlare")}</div>
                  <div className="text-xs text-green-700 space-y-1">
                     <div>• {t("localizedPain")}</div>
                     <div>• {t("localHeat")}</div>
                     <div>• {t("progressiveEdema")}</div>
                     <div>• <strong>{t("noFever")}</strong></div>
                     <div>• {t("improvesAfter72Hours")}</div>
                  </div>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                   <div className="text-xs font-bold text-red-800 mb-1">🚨 {t("infection")}</div>
                  <div className="text-xs text-red-700 space-y-1">
                     <div>• <strong>{t("feverOver38")}</strong></div>
                     <div>• {t("chills")}</div>
                     <div>• {t("progressiveWorsening")}</div>
                     <div>• {t("purulentDrainage")}</div>
                     <div>• {t("lymphangitis")}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══ Tab: Reabilitação ══ */}
        {tab === "rehab" && (
          <div className="space-y-4">
            {/* Cronograma */}
            <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-amber-100" style={{ background: "#fffbeb" }}>
                <h2 className="font-bold text-amber-900 text-base flex items-center gap-2">
                   <Calendar className="h-5 w-5 text-amber-600" /> {t("activityTimeline")}
                </h2>
              </div>
              <div className="p-4">
                <div className="relative pl-6">
                  <div className="absolute left-2 top-2 bottom-2 w-0.5 bg-gray-200 rounded-full" />
                  {d.cronograma.map((c, i) => (
                    <div key={i} className="relative mb-4 last:mb-0">
                      <div className="absolute -left-4 top-3 w-3 h-3 rounded-full border-2 border-white shadow"
                        style={{ background: TL }} />
                      <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                        <div className="text-xs font-bold uppercase tracking-wide mb-0.5" style={{ color: TL }}>{c.tempo}</div>
                        <div className="text-sm font-semibold text-gray-800">{c.titulo}</div>
                        <div className="text-xs text-gray-600 mt-1 leading-relaxed">{c.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Fisioterapia */}
            <div className="bg-white rounded-2xl border border-purple-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-purple-100" style={{ background: "#faf5ff" }}>
                <h2 className="font-bold text-purple-900 text-base flex items-center gap-2">
                   🏃 {t("physiotherapyProtocol")}
                </h2>
                 <p className="text-xs text-purple-700 mt-1">📅 {t("frequency")} {d.fisio.frequencia}</p>
              </div>
              <div className="p-4 space-y-2">
                {d.fisio.fases.map((f, i) => (
                  <div key={i} className="p-3 rounded-xl bg-gray-50 border border-gray-100">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-gray-800">{f.fase}</span>
                      <span className="text-xs text-gray-500">· {f.foco}</span>
                    </div>
                    <p className="text-xs text-gray-600 leading-relaxed">{f.tecnicas}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Retornos */}
            <div className="bg-white rounded-2xl border shadow-sm overflow-hidden" style={{ borderColor: "#d1fae5" }}>
              <div className="px-5 py-4 border-b" style={{ background: "#f0fdfa", borderColor: "#d1fae5" }}>
                <h2 className="font-bold text-base flex items-center gap-2" style={{ color: "#065f46" }}>
                   🗓️ {t("scheduledReturns")}
                </h2>
              </div>
              <div className="p-4">
                <div className="relative pl-6">
                  <div className="absolute left-2 top-2 bottom-2 w-0.5 bg-gray-200 rounded-full" />
                  {d.retornos.map((r, i) => (
                    <div key={i} className="relative mb-4 last:mb-0">
                      <div className="absolute -left-4 top-3 w-3 h-3 rounded-full border-2 border-white shadow"
                        style={{ background: TL }} />
                      <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                        <div className="text-xs font-bold uppercase tracking-wide mb-0.5" style={{ color: TL }}>{r.tempo}</div>
                        <div className="text-sm font-semibold text-gray-800">{r.tipo}</div>
                        <div className="text-xs text-gray-600 mt-1 leading-relaxed">{r.objetivo}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}


      </div>
    </div>
  );
}
