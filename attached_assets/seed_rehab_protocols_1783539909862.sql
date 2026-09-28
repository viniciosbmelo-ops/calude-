-- ============================================================
-- DocKnee — Seed: Protocolos de Reabilitação do Joelho (v1)
-- 8 protocolos baseados em critérios. Conteúdo clínico: sugestão
-- editável — a conduta final é do fisioterapeuta (COFFITO).
-- Versionamento: mesmo padrão de evidence versioning do
-- DocKnee AI Decision (code + version, is_active).
-- ============================================================

-- ------------------------------------------------------------
-- 1. RECONSTRUÇÃO DO LCA (± LAL / menisco associado)  [lca_r]
-- Refs: van Melick 2016 (BJSM); Grindem 2016 (BJSM, Delaware-Oslo);
-- Delphi retorno ao esporte pós-LCA (Sonnery-Cottet); Meredith 2020 (JEO).
-- ------------------------------------------------------------
INSERT INTO rehab_protocols (code, version, name, definition) VALUES
('lca_r', 1, 'Reconstrução do LCA', '{
  "start_reference": "surgery_date",
  "references": [
    "van Melick N, et al. Evidence-based clinical practice update: practice guidelines for anterior cruciate ligament rehabilitation. Br J Sports Med. 2016;50(24):1506-1515.",
    "Grindem H, et al. Simple decision rules can reduce reinjury risk by 84% after ACL reconstruction: the Delaware-Oslo ACL cohort study. Br J Sports Med. 2016;50(13):804-808.",
    "Meredith SJ, et al. Return to sport after anterior cruciate ligament injury: Panther Symposium ACL Injury Return to Sport Consensus Group. Knee Surg Sports Traumatol Arthrosc. 2020;28(8):2403-2414."
  ],
  "phases": [
    {
      "phase": 1, "label": "Proteção", "weeks": [0, 6],
      "followups": [
        { "title": "Avaliação inicial", "week": 1, "assessments": ["adm", "derrame", "forca_mrc"] },
        { "title": "Controle ADM e derrame", "week": 2, "assessments": ["adm", "derrame"] },
        { "title": "Controle ADM e derrame", "week": 3, "assessments": ["adm", "derrame", "circunferencia"] },
        { "title": "Controle ADM e derrame", "week": 4, "assessments": ["adm", "derrame"] },
        { "title": "Reavaliação fim da proteção", "week": 6, "assessments": ["adm", "derrame", "circunferencia", "forca_mrc"] }
      ],
      "progression_criteria": "Extensão completa (0°), flexão >120°, derrame ausente/traço, SLR sem lag de extensão, marcha sem claudicação.",
      "notes": "Prioridade absoluta: extensão completa precoce e ativação do quadríceps. Derrame persistente 2+ ou perda de extensão = alerta ao cirurgião."
    },
    {
      "phase": 2, "label": "Fortalecimento", "weeks": [6, 12],
      "followups": [
        { "title": "Força e controle motor", "week": 8, "assessments": ["forca", "adm", "circunferencia", "agachamento_unipodal"] },
        { "title": "Reavaliação 3 meses", "week": 12, "assessments": ["forca", "adm", "circunferencia", "agachamento_unipodal", "equilibrio", "valgo_dinamico"] }
      ],
      "progression_criteria": "LSI quadríceps >70%, agachamento unipodal com bom controle, valgo dinâmico ausente/leve, sem dor ou derrame reativo.",
      "notes": "Introduzir cadeia cinética fechada progressiva; leg press e extensora em arco protegido conforme enxerto."
    },
    {
      "phase": 3, "label": "Corrida e função", "weeks": [12, 26],
      "followups": [
        { "title": "Critérios para corrida", "week": 14, "assessments": ["forca", "valgo_dinamico", "equilibrio"] },
        { "title": "Bateria funcional intermediária", "week": 18, "assessments": ["forca", "hop", "y_balance"] },
        { "title": "Reavaliação 6 meses", "week": 24, "assessments": ["forca", "hop", "y_balance", "less", "valgo_dinamico"] }
      ],
      "progression_criteria": "Corrida: LSI quadríceps >70–80%, dor <2/10, sem derrame. Hop tests iniciados quando LSI força >80%.",
      "notes": "Progressão de corrida linear antes de mudanças de direção. LESS na semana 24 define ênfase de pliometria."
    },
    {
      "phase": 4, "label": "Retorno ao esporte", "weeks": [26, 52],
      "followups": [
        { "title": "Bateria RTS — 6-7 meses", "week": 28, "assessments": ["forca", "hop", "y_balance", "less", "acl_rsi"] },
        { "title": "Bateria RTS — 9 meses", "week": 39, "assessments": ["forca", "hop", "y_balance", "less", "acl_rsi"] },
        { "title": "Avaliação de alta — 12 meses", "week": 52, "assessments": ["forca", "hop", "y_balance", "less", "acl_rsi", "retorno_esporte"] }
      ],
      "progression_criteria": "Liberação: LSI quadríceps ≥90%, bateria de hop ≥90%, ACL-RSI ≥65, LESS bom/excelente, decisão compartilhada com o cirurgião. RTS <9 meses associado a maior risco de re-lesão (Grindem 2016).",
      "notes": "Sinais vermelhos automáticos do DocKnee aplicam-se integralmente nesta fase."
    }
  ]
}'::jsonb);

-- ------------------------------------------------------------
-- 2. RECONSTRUÇÃO DO LCP  [lcp_r]
-- Refs: Pierce 2013 (KSSTA); LaPrade 2015; Fowler Kennedy PCL protocol.
-- Progressão deliberadamente mais lenta que LCA; proteger tibial posterior.
-- ------------------------------------------------------------
INSERT INTO rehab_protocols (code, version, name, definition) VALUES
('lcp_r', 1, 'Reconstrução do LCP', '{
  "start_reference": "surgery_date",
  "references": [
    "Pierce CM, et al. Posterior cruciate ligament tears: functional and postoperative rehabilitation. Knee Surg Sports Traumatol Arthrosc. 2013;21(5):1071-1084.",
    "LaPrade RF, et al. Emerging updates on the posterior cruciate ligament. Am J Sports Med. 2015;43(12):3077-3092."
  ],
  "phases": [
    {
      "phase": 1, "label": "Proteção prolongada", "weeks": [0, 12],
      "followups": [
        { "title": "Avaliação inicial", "week": 1, "assessments": ["adm", "derrame", "forca_mrc"] },
        { "title": "Controle ADM (flexão protegida)", "week": 3, "assessments": ["adm", "derrame"] },
        { "title": "Controle ADM e derrame", "week": 6, "assessments": ["adm", "derrame", "circunferencia"] },
        { "title": "Reavaliação fim da proteção", "week": 12, "assessments": ["adm", "derrame", "circunferencia", "forca_mrc"] }
      ],
      "progression_criteria": "Flexão progressiva conforme protocolo do cirurgião (tipicamente 90° até 6 sem, em prono); sem trabalho isolado de isquiotibiais; sem gaveta posterior gravitacional.",
      "notes": "ADM de flexão preferencialmente em decúbito prono nas primeiras semanas. Órtese dinâmica/PCL brace conforme prescrição do cirurgião."
    },
    {
      "phase": 2, "label": "Fortalecimento", "weeks": [12, 26],
      "followups": [
        { "title": "Força (ênfase quadríceps)", "week": 16, "assessments": ["forca", "adm", "circunferencia"] },
        { "title": "Controle motor e equilíbrio", "week": 20, "assessments": ["forca", "agachamento_unipodal", "equilibrio", "valgo_dinamico"] },
        { "title": "Reavaliação 6 meses", "week": 26, "assessments": ["forca", "adm", "circunferencia", "agachamento_unipodal", "equilibrio"] }
      ],
      "progression_criteria": "LSI quadríceps >70%; isquiotibiais isolados apenas após 12-16 semanas e sem dor; sem derrame reativo.",
      "notes": "Quadríceps é o protetor dinâmico do enxerto de LCP — ênfase máxima."
    },
    {
      "phase": 3, "label": "Função e retorno ao esporte", "weeks": [26, 52],
      "followups": [
        { "title": "Critérios para corrida", "week": 28, "assessments": ["forca", "valgo_dinamico"] },
        { "title": "Bateria funcional", "week": 36, "assessments": ["forca", "hop", "y_balance", "less"] },
        { "title": "Bateria RTS — 10-12 meses", "week": 46, "assessments": ["forca", "hop", "y_balance", "less", "retorno_esporte"] }
      ],
      "progression_criteria": "Corrida ~6 meses se LSI >80%. Liberação: LSI força e hop ≥90%, tipicamente 9-12 meses.",
      "notes": "Expectativa de cronograma mais longo que LCA — alinhar com paciente desde a fase 1."
    }
  ]
}'::jsonb);

-- ------------------------------------------------------------
-- 3. SUTURA MENISCAL  [menisc_sutura]
-- Refs: Cavanaugh & Killian 2012 (Curr Rev Musculoskelet Med);
-- Spang 2018; consenso: proteger flexão em carga >90° por 4-6 sem.
-- ------------------------------------------------------------
INSERT INTO rehab_protocols (code, version, name, definition) VALUES
('menisc_sutura', 1, 'Sutura meniscal', '{
  "start_reference": "surgery_date",
  "references": [
    "Cavanaugh JT, Killian SE. Rehabilitation following meniscal repair. Curr Rev Musculoskelet Med. 2012;5(1):46-58.",
    "Spang RC, et al. Rehabilitation following meniscal repair: a systematic review. BMJ Open Sport Exerc Med. 2018;4(1):e000212."
  ],
  "phases": [
    {
      "phase": 1, "label": "Proteção", "weeks": [0, 6],
      "followups": [
        { "title": "Avaliação inicial", "week": 1, "assessments": ["adm", "derrame", "forca_mrc"] },
        { "title": "Controle ADM (0-90°)", "week": 3, "assessments": ["adm", "derrame"] },
        { "title": "Reavaliação fim da proteção", "week": 6, "assessments": ["adm", "derrame", "circunferencia", "forca_mrc"] }
      ],
      "progression_criteria": "ADM 0-90° respeitada em carga; carga parcial→total conforme tipo/local da sutura e prescrição do cirurgião; derrame controlado.",
      "notes": "Sem flexão >90° em carga, sem agachamento profundo, sem rotação em carga. Restrições variam com o padrão da lesão (radial vs longitudinal, zona vascular) — confirmar com o registro cirúrgico."
    },
    {
      "phase": 2, "label": "Fortalecimento", "weeks": [6, 16],
      "followups": [
        { "title": "Força e ADM completa", "week": 10, "assessments": ["forca", "adm", "circunferencia", "agachamento_unipodal"] },
        { "title": "Reavaliação 3-4 meses", "week": 14, "assessments": ["forca", "agachamento_unipodal", "equilibrio", "valgo_dinamico"] }
      ],
      "progression_criteria": "ADM completa e indolor, LSI quadríceps >70%, agachamento até 90° sem dor na interlinha.",
      "notes": "Dor na interlinha ou novo derrame durante progressão = alerta ao cirurgião (possível falha da sutura)."
    },
    {
      "phase": 3, "label": "Retorno funcional", "weeks": [16, 26],
      "followups": [
        { "title": "Bateria funcional", "week": 20, "assessments": ["forca", "hop", "y_balance"] },
        { "title": "Avaliação de alta", "week": 26, "assessments": ["forca", "hop", "y_balance", "less", "retorno_esporte"] }
      ],
      "progression_criteria": "Liberação esportes com pivô: tipicamente ≥6 meses, LSI força e hop ≥90%, sem dor na interlinha.",
      "notes": "Se sutura associada a reconstrução do LCA, o protocolo lca_r prevalece (cronograma mais restritivo)."
    }
  ]
}'::jsonb);

-- ------------------------------------------------------------
-- 4. MENISCECTOMIA PARCIAL  [meniscectomia]
-- Curto. Refs: Dias 2013 (JOSPT systematic review).
-- ------------------------------------------------------------
INSERT INTO rehab_protocols (code, version, name, definition) VALUES
('meniscectomia', 1, 'Meniscectomia parcial', '{
  "start_reference": "surgery_date",
  "references": [
    "Dias JM, et al. The effectiveness of postoperative physical therapy treatment in patients who have undergone arthroscopic partial meniscectomy: systematic review. J Orthop Sports Phys Ther. 2013;43(8):560-576."
  ],
  "phases": [
    {
      "phase": 1, "label": "Recuperação imediata", "weeks": [0, 2],
      "followups": [
        { "title": "Avaliação inicial", "week": 1, "assessments": ["adm", "derrame", "forca_mrc"] },
        { "title": "Controle de derrame e ADM", "week": 2, "assessments": ["adm", "derrame"] }
      ],
      "progression_criteria": "Carga total conforme tolerância; ADM completa precoce; derrame controlado.",
      "notes": "Derrame persistente além de 2-3 semanas foge do esperado — comunicar cirurgião."
    },
    {
      "phase": 2, "label": "Fortalecimento e retorno", "weeks": [2, 12],
      "followups": [
        { "title": "Força e função", "week": 6, "assessments": ["forca", "adm", "circunferencia", "agachamento_unipodal"] },
        { "title": "Avaliação de alta", "week": 12, "assessments": ["forca", "agachamento_unipodal", "equilibrio", "retorno_esporte"] }
      ],
      "progression_criteria": "Retorno esportivo típico 4-8 semanas (recreacional) se LSI >85%, sem dor e sem derrame.",
      "notes": "Hop tests opcionais para atletas — adicionar manualmente se aplicável."
    }
  ]
}'::jsonb);

-- ------------------------------------------------------------
-- 5. ARTROPLASTIA TOTAL DE JOELHO  [atj]
-- Refs: Jette 2020 (Phys Ther, APTA CPG); metas funcionais TUG/30s STS.
-- ------------------------------------------------------------
INSERT INTO rehab_protocols (code, version, name, definition) VALUES
('atj', 1, 'Artroplastia total de joelho', '{
  "start_reference": "surgery_date",
  "references": [
    "Jette DU, et al. Physical therapist management of total knee arthroplasty: clinical practice guideline (APTA). Phys Ther. 2020;100(9):1603-1631."
  ],
  "phases": [
    {
      "phase": 1, "label": "Mobilidade e marcha", "weeks": [0, 6],
      "followups": [
        { "title": "Avaliação inicial", "week": 1, "assessments": ["adm", "derrame", "forca_mrc", "marcha"] },
        { "title": "ADM e marcha", "week": 2, "assessments": ["adm", "derrame", "marcha"] },
        { "title": "ADM e marcha", "week": 3, "assessments": ["adm", "derrame", "marcha"] },
        { "title": "ADM e marcha", "week": 4, "assessments": ["adm", "derrame", "marcha"] },
        { "title": "Reavaliação 6 semanas", "week": 6, "assessments": ["adm", "derrame", "forca_mrc", "marcha", "tug"] }
      ],
      "progression_criteria": "Metas: extensão 0° e flexão ≥90° até sem 2-3; flexão ≥110-120° até sem 6; marcha sem auxiliar até sem 4-6.",
      "notes": "Flexão <90° na semana 4-6 = alerta ao cirurgião (risco de rigidez / possível manipulação). ADM é a métrica crítica desta fase."
    },
    {
      "phase": 2, "label": "Força e função", "weeks": [6, 12],
      "followups": [
        { "title": "Força e testes funcionais", "week": 9, "assessments": ["forca", "adm", "tug", "sts_30s"] },
        { "title": "Reavaliação 3 meses", "week": 12, "assessments": ["forca", "adm", "tug", "sts_30s", "equilibrio"] }
      ],
      "progression_criteria": "TUG <12s, 30s sit-to-stand dentro da faixa etária, subir/descer escadas alternado.",
      "notes": "Fortalecimento de quadríceps progressivo; déficit de força persiste até 1 ano se não tratado ativamente."
    },
    {
      "phase": 3, "label": "Retorno às atividades", "weeks": [12, 26],
      "followups": [
        { "title": "Função avançada", "week": 18, "assessments": ["forca", "tug", "sts_30s", "equilibrio"] },
        { "title": "Avaliação de alta", "week": 26, "assessments": ["forca", "adm", "tug", "sts_30s", "equilibrio"] }
      ],
      "progression_criteria": "Alta: independência funcional completa, força adequada para demandas do paciente, atividades de baixo impacto liberadas.",
      "notes": "Hop tests NÃO se aplicam. Objetivos individualizados por demanda (caminhada, ciclismo, golfe, dança)."
    }
  ]
}'::jsonb);

-- ------------------------------------------------------------
-- 6. OSTEOTOMIA (HTO / DFO)  [osteotomia]
-- Carga condicionada à consolidação — decisão do cirurgião a cada RX.
-- Integra com o planejamento Miniaci/mLDFA do DocKnee médico.
-- ------------------------------------------------------------
INSERT INTO rehab_protocols (code, version, name, definition) VALUES
('osteotomia', 1, 'Osteotomia do joelho (HTO/DFO)', '{
  "start_reference": "surgery_date",
  "references": [
    "Lee OS, et al. Rehabilitation after high tibial osteotomy. Knee Surg Relat Res. 2016;28(2):89-98.",
    "Chen 2025 (referência interna DocKnee — planejamento Miniaci/alturas de osteotomia)."
  ],
  "phases": [
    {
      "phase": 1, "label": "Proteção e consolidação inicial", "weeks": [0, 6],
      "followups": [
        { "title": "Avaliação inicial", "week": 1, "assessments": ["adm", "derrame", "forca_mrc"] },
        { "title": "ADM e controle de carga", "week": 3, "assessments": ["adm", "derrame"] },
        { "title": "Reavaliação 6 semanas (pós-RX)", "week": 6, "assessments": ["adm", "derrame", "circunferencia", "forca_mrc", "marcha"] }
      ],
      "progression_criteria": "Progressão de carga EXCLUSIVAMENTE conforme liberação do cirurgião por consolidação radiográfica (tipicamente parcial 2-6 sem, total 6-8 sem em HTO medial com placa bloqueada).",
      "notes": "O follow-up da semana 6 deve ocorrer APÓS a consulta com RX. O fisioterapeuta registra a carga liberada pelo cirurgião no campo de observações."
    },
    {
      "phase": 2, "label": "Fortalecimento", "weeks": [6, 16],
      "followups": [
        { "title": "Força e marcha", "week": 10, "assessments": ["forca", "adm", "marcha", "circunferencia"] },
        { "title": "Reavaliação 3-4 meses", "week": 14, "assessments": ["forca", "agachamento_unipodal", "equilibrio", "valgo_dinamico"] }
      ],
      "progression_criteria": "Carga total consolidada, marcha sem claudicação, LSI quadríceps >70%.",
      "notes": "Atenção ao alinhamento dinâmico — a correção óssea muda o padrão de movimento; retreinar."
    },
    {
      "phase": 3, "label": "Retorno às atividades", "weeks": [16, 39],
      "followups": [
        { "title": "Bateria funcional", "week": 24, "assessments": ["forca", "hop", "y_balance"] },
        { "title": "Avaliação de alta", "week": 36, "assessments": ["forca", "hop", "y_balance", "retorno_esporte"] }
      ],
      "progression_criteria": "Impacto progressivo após consolidação completa (RX ~3-4 meses). Retorno esportivo 6-9 meses conforme demanda.",
      "notes": "Hop tests apenas em pacientes com demanda esportiva — remover na confirmação do cronograma se não aplicável."
    }
  ]
}'::jsonb);

-- ------------------------------------------------------------
-- 7. RECONSTRUÇÃO DO MPFL / INSTABILIDADE PATELAR  [mpfl]
-- Refs: Manske & Prohaska 2017 (IJSPT); controle de valgo é o eixo.
-- ------------------------------------------------------------
INSERT INTO rehab_protocols (code, version, name, definition) VALUES
('mpfl', 1, 'Reconstrução do MPFL', '{
  "start_reference": "surgery_date",
  "references": [
    "Manske RC, Prohaska D. Rehabilitation following medial patellofemoral ligament reconstruction for patellar instability. Int J Sports Phys Ther. 2017;12(3):494-511."
  ],
  "phases": [
    {
      "phase": 1, "label": "Proteção", "weeks": [0, 6],
      "followups": [
        { "title": "Avaliação inicial", "week": 1, "assessments": ["adm", "derrame", "forca_mrc"] },
        { "title": "ADM e ativação do quadríceps", "week": 3, "assessments": ["adm", "derrame"] },
        { "title": "Reavaliação fim da proteção", "week": 6, "assessments": ["adm", "derrame", "circunferencia", "forca_mrc"] }
      ],
      "progression_criteria": "Flexão progressiva (90° até sem 2-4, completa até sem 6); SLR sem lag; apreensão patelar em redução.",
      "notes": "Ativação precoce do VMO/quadríceps. Evitar posições de instabilidade (flexão + rotação externa da tíbia) nas primeiras semanas."
    },
    {
      "phase": 2, "label": "Fortalecimento e controle", "weeks": [6, 16],
      "followups": [
        { "title": "Força e valgo dinâmico", "week": 10, "assessments": ["forca", "adm", "agachamento_unipodal", "valgo_dinamico"] },
        { "title": "Reavaliação 3-4 meses", "week": 14, "assessments": ["forca", "agachamento_unipodal", "valgo_dinamico", "equilibrio"] }
      ],
      "progression_criteria": "LSI quadríceps >70%, agachamento unipodal sem valgo moderado/grave, sem apreensão.",
      "notes": "Valgo dinâmico é O critério desta cirurgia — glúteo médio e controle de tronco no centro do programa. Valgo grave persistente = revisar programa antes de progredir."
    },
    {
      "phase": 3, "label": "Retorno ao esporte", "weeks": [16, 26],
      "followups": [
        { "title": "Bateria funcional", "week": 20, "assessments": ["forca", "hop", "y_balance", "less", "valgo_dinamico"] },
        { "title": "Avaliação de alta", "week": 26, "assessments": ["forca", "hop", "y_balance", "less", "retorno_esporte"] }
      ],
      "progression_criteria": "Liberação: LSI força e hop ≥90%, LESS bom/excelente, valgo ausente/leve em fadiga, sem apreensão. Tipicamente 4-6 meses.",
      "notes": "Testar controle de valgo também em condição de fadiga antes da alta."
    }
  ]
}'::jsonb);

-- ------------------------------------------------------------
-- 8. TENDINOPATIA PATELAR (conservador)  [tend_patelar]
-- start_reference = treatment_start. Refs: Malliaras 2015 (JOSPT);
-- Rio 2015 (isometria); VISA-P mensal como PROM central.
-- ------------------------------------------------------------
INSERT INTO rehab_protocols (code, version, name, definition) VALUES
('tend_patelar', 1, 'Tendinopatia patelar (tratamento conservador)', '{
  "start_reference": "treatment_start",
  "references": [
    "Malliaras P, et al. Patellar tendinopathy: clinical diagnosis, load management, and advice for challenging case presentations. J Orthop Sports Phys Ther. 2015;45(11):887-898.",
    "Rio E, et al. Isometric exercise induces analgesia and reduces inhibition in patellar tendinopathy. Br J Sports Med. 2015;49(19):1277-1283.",
    "Visentini PJ, et al. The VISA score: an index of severity of symptoms in patients with jumper''s knee. J Sci Med Sport. 1998;1(1):22-28."
  ],
  "phases": [
    {
      "phase": 1, "label": "Manejo de dor e carga isométrica", "weeks": [0, 4],
      "followups": [
        { "title": "Avaliação inicial + VISA-P", "week": 0, "assessments": ["forca", "visa_p", "dor_carga"] },
        { "title": "Resposta à carga isométrica", "week": 4, "assessments": ["visa_p", "dor_carga", "forca"] }
      ],
      "progression_criteria": "Dor no single leg decline squat ≤3/10 e estável 24h pós-carga.",
      "notes": "Monitorar dor 24h pós-exercício (regra das 24h). Reduzir/gerenciar cargas de salto durante esta fase, não repouso absoluto."
    },
    {
      "phase": 2, "label": "Fortalecimento isotônico progressivo", "weeks": [4, 12],
      "followups": [
        { "title": "Progressão de carga + VISA-P", "week": 8, "assessments": ["visa_p", "forca", "dor_carga"] },
        { "title": "Reavaliação 3 meses + VISA-P", "week": 12, "assessments": ["visa_p", "forca", "agachamento_unipodal", "valgo_dinamico"] }
      ],
      "progression_criteria": "Força progredindo com dor controlada; VISA-P em melhora (>10 pontos vs inicial é mudança clinicamente relevante).",
      "notes": "HSR (heavy slow resistance) ou excêntrico conforme tolerância e fase da temporada do atleta."
    },
    {
      "phase": 3, "label": "Energia elástica e retorno pleno", "weeks": [12, 24],
      "followups": [
        { "title": "Introdução de pliometria + VISA-P", "week": 16, "assessments": ["visa_p", "forca", "hop", "dor_carga"] },
        { "title": "Avaliação de alta + VISA-P", "week": 24, "assessments": ["visa_p", "forca", "hop", "less", "retorno_esporte"] }
      ],
      "progression_criteria": "Alta: VISA-P >80, dor ausente/mínima em saltos repetidos, LSI força e hop ≥90%.",
      "notes": "VISA-P mensal é o desfecho primário deste protocolo. Estagnação do VISA-P por 8+ semanas = reavaliar diagnóstico com o médico (diferencial: Hoffa, femoropatelar, tendinopatia quadricipital)."
    }
  ]
}'::jsonb);

-- ============================================================
-- Novos assessment_types introduzidos por estes protocolos
-- (adicionar ao enum/validação Zod de rehab_assessments):
--   marcha        — qualitativo (normal | claudicante | com auxiliar)
--   tug           — Timed Up and Go (segundos)
--   sts_30s       — 30s sit-to-stand (repetições)
--   visa_p        — questionário VISA-P (0-100)
--   dor_carga     — EVA no single leg decline squat (0-10)
--   retorno_esporte — decisão apto/não apto/parcial + justificativa
-- Já existentes: adm, derrame, circunferencia, forca, forca_mrc,
--   agachamento_unipodal, valgo_dinamico, equilibrio, hop,
--   y_balance, less, acl_rsi
-- ============================================================
