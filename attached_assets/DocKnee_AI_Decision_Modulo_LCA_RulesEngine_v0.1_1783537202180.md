# DocKnee AI Decision™ — Módulo LCA
## Rules Engine de Estratificação de Risco e Suporte à Decisão (Primária + Revisão)

**Versão:** 0.3 (draft para validação — atualiza limiar de hiperextensão com Helito 2024 + survey ISAKOS 2025)
**Data:** 08/07/2026
**Responsável clínico:** Dr. Vinicios Barreto Melo — CRM-ES 13416
**Natureza:** Camada de suporte à decisão **qualitativa**. Não gera probabilidade calibrada de falha.
**Nota v0.2:** A Parte II do consenso **não altera nenhuma indicação/gatilho** (L1–L12 inalterados). Acrescenta a camada de segurança/aconselhamento (§3.1) e o apêndice de execução técnica (§8A).
**Nota v0.3:** Regra de hiperextensão (L4) passa a **dois níveis** (≥5° flag; ≥6,5° com HT = alto risco, 14,6×). Beighton confirmado como **inadequado** para laxidão específica do joelho (survey ISAKOS 2025). Survey ISAKOS = Nível V (opinião); peso está nas primárias que ela cita.

---

## 0. Aviso de escopo e limites (obrigatório na saída ao usuário)

Este módulo **não** calcula "índice de falha" como probabilidade. Ele identifica **drivers de risco** e sugere **alavancas modificáveis** com potencial de reduzir a falha, cada uma rotulada por nível de evidência e força de recomendação.

Distinção que o motor respeita rigidamente:

- **Fator prognóstico** (prediz falha) ≠ **alavanca modificável** (reduz falha). Um fator predizer falha não implica que uma dada intervenção a modifique. Só disparam conduta as alavancas com evidência de *modificação* do desfecho naquele perfil.
- Se o usuário quiser probabilidade numérica de revisão, isso exige modelo de registro validado externamente (NKLR calculator, MOON, MARS AutoPrognosis), fora do escopo deste módulo. Teto realista de discriminação desses modelos: AUC ~0,67–0,70. Nenhum é calibrado em população brasileira.

### Selos de evidência exibidos por regra
- **[N-I]** RCT / Nível I
- **[N-II/III]** coorte prospectiva / comparativa
- **[N-V]** opinião de especialista / consenso Delphi
- **[VIÉS-IND]** fonte com patrocínio de indústria e/ou painel com predisposição declarada (aplica-se ao consenso de LEAP)

---

## 1. Fontes que alimentam o motor

**Válidas (backbone):**
1. Kayaalp ME, et al. Advances in ACL reconstruction: risk stratification, graft choices, and functional recovery in 2026. *J Exp Orthop.* 2026;13:e70766. — **mapa de fatores** [N-V, narrativa].
2. Sonnery-Cottet B, et al. Indications for Lateral Extra-articular Procedures in the ACL-Reconstructed Knee: Part I of an International Consensus Statement. *Arthroscopy.* 2025;41(9):3303-3312. — **motor do LEAP (indicações)** [N-V, Delphi; VIÉS-IND: apoio Arthrex; painel de alto volume com predisposição pró-LEAP declarada nas limitações].
3. Sonnery-Cottet B, et al. Surgical Treatment and Complications of LEAPs: Part II of an International Consensus Statement. *Arthroscopy.* 2025;41(9):3313-3321. — **camada de segurança/aconselhamento e execução técnica** [N-V, Delphi; VIÉS-IND, mesmo painel]. **Não altera indicações.**
4. Primárias de ancoragem numérica (ver §7).

**Rebaixada:** Rivarola H, et al. Personalized graft selection and reinforcement strategies in ACLR. *JOREP.* 2025. — mantida **apenas como contexto narrativo**. Escore ponderado **NÃO** incorporado ao motor: não validado (sem coorte de derivação/validação/AUC), com dois sistemas de estratificação incompatíveis no mesmo texto (contagem de fatores vs soma de escore), divergência 4 vs 5 variáveis e dupla contagem de exposição esportiva.

---

## 2. Arquitetura: separar driver de alavanca

### 2A. Drivers de risco NÃO modificáveis cirurgicamente
Elevam o risco pré-teste e **reforçam** a decisão de puxar uma alavanca. **Não disparam conduta isoladamente.**

| Driver | Efeito prognóstico | Fonte |
|---|---|---|
| Idade ≤20–25 anos | Rerruptura 2–3× vs adulto; OR 3,6 (MARS, revisão) | Kayaalp; MARS/Cooper 2018 |
| Sexo feminino | Maior incidência; recuperação de força mais lenta | Kayaalp |
| Chanfradura estreita / morfologia óssea | Marcador observacional; predição individual limitada | Kayaalp |
| História de LCA contralateral | Maior risco de nova lesão | Consenso (statement 17) |

### 2B. Alavancas modificáveis
São o que o motor recomenda — sempre ancoradas em evidência de *modificação* do desfecho:
escolha do enxerto · reforço lateral (LET/ALLR) · internal brace · osteotomia de correção de slope · timing cirúrgico · cessação de tabagismo.

---

## 3. Motor do LEAP — regras graduadas (consenso + STABILITY)

**Campo obrigatório de saída: força de recomendação.** Isso impede o motor de tratar "fortemente recomendado" e "considerar" com o mesmo peso visual.

**Equivalência técnica:** para efeito de indicação, **LET ≈ ALLR** (meta de Bosco, 14 RCTs, 1830 pacientes: sem diferença entre técnicas na redução de falha/pivot). A escolha entre elas é de técnica/morbidade, não de indicação.

| # | Gatilho | Alavanca | Força (consenso) | Nível | Contexto |
|---|---|---|---|---|---|
| L1 | ≤25 anos **E** enxerto **flexor (HT)** | LEAP (LET/ALLR) | **Fortemente recomendado (unânime 100%)** | N-I (STABILITY) + N-V | Primária |
| L2 | ≤25 anos **E** enxerto **não-flexor (QT/BTB)** | LEAP — **rebaixado** para considerar | Deve ser considerado (strong) | N-V | Primária |
| L3 | Pivot shift **grau 3** | LEAP | **Fortemente recomendado** | N-V | Ambas |
| L4 | **Hiperextensão do joelho ≥5°** (flag) · **≥6,5° com HT = alto risco** | LEAP + fixar/tensionar em extensão; se ≥6,5° e HT → migrar para BTB/QT + LEAP | **Fortemente recomendado** | N-II/III (primária) + N-V | Ambas |
| L5 | **Revisão de LCA** | LEAP | Recomendado (strong) | N-II/III (meta Grassi) + N-V | Revisão |
| L6 | Esqueleticamente imaturo | LEAP | **Fortemente recomendado** | N-V | Primária |
| L7 | Deficiência crônica sintomática de LCA | LEAP | Recomendado | N-V | Ambas |
| L8 | Retorno a esporte de pivô | LEAP | Deve ser considerado (strong) | N-V | Ambas |
| L9 | Lachman **grau 3** | LEAP | Deve ser considerado (strong) | N-V | Ambas |
| L10 | **PTS >12°** | LEAP (considerar) — ver §5 para alternativa de osteotomia | Deve ser considerado | N-V | Primária |
| L11 | História de LCA contralateral | LEAP | Deve ser considerado | N-V | Primária |
| L12 | **≥2 fatores relativos** combinados (statement 36) | LEAP pode cruzar o limiar mesmo sem fator determinante | Pode ser considerado (strong) | N-V | Ambas |

### Justificativa do gatilho de hiperextensão (L4) — dois níveis

Medida em **graus de hiperextensão passiva do joelho** (não Beighton — o survey ISAKOS 2025 confirma que Beighton é inadequado para laxidão específica do joelho: há hiperlaxo sem hiperextensão e vice-versa).

- **Nível 1 — ≥5° (flag de risco):** MARS/Cooper 2018 (revisão): preditor independente, OR >2× de ruptura. Guimarães/Helito 2021 (primária, HT): falha 14,7% vs 2,9% (p=0,005).
- **Nível 2 — ≥6,5° com enxerto HT (alto risco):** Helito 2024 (*Arthroscopy*): cutoff de 6,5° → **14,6×** mais risco de ruptura do enxerto de flexores, com pior estabilidade e função. **Alavanca:** migrar para BTB/QT + LEAP, não apenas reforçar. *Ressalva: monocêntrico, grupo Helito/SANTI (pró-LEAP/ALL), sem validação externa.*
- **Modificador de enxerto:** o efeito da hiperextensão aparece com flexores e **some com BTB** (Benner). ⇒ o motor **pesa mais** L4 quando o enxerto planejado é HT e **rebaixa** com BTB/QT. O cutoff de 6,5° é, por construção, específico de HT.
- **Regra derivada forte (survey ISAKOS 2025, discussão):** em paciente hiperlaxo/hiperextensão, **reconstrução isolada com flexores sem qualquer procedimento extra-articular deve ser evitada** — falha 21,7–24,4% (Helito 2019; Larson 2017) vs ~4% na população geral.

### 3.1 Camada de segurança e aconselhamento (Consenso Parte II) — [N-V, VIÉS-IND]

Statements de segurança da Parte II (todos **unânimes, 100%**), a serem exibidos junto da recomendação de LEAP:
- Taxa global de complicações **baixa** (st. 30).
- **Sem aumento** de OA do compartimento lateral (st. 31).
- **Sem necessidade** de mudança no protocolo de reabilitação (st. 33).
- **Sem efeito negativo** no retorno ao esporte (st. 34).

**Cautelas obrigatórias na saída (o motor NÃO exibe as afirmações acima sem estas ressalvas):**
1. Unanimidade de 100% vem do mesmo painel pró-LEAP com apoio Arthrex — as afirmações mais tranquilizadoras vêm da fonte mais conflituada.
2. "Sem aumento de OA" é **curto/médio prazo (~2 anos)**; a preocupação histórica de sobreconstrangimento lateral era **degenerativa de longo prazo**, ainda não respondida.
3. **Contradição interna a sinalizar:** o st. 34 ("sem efeito no RTS") contrasta com o substudo funcional do próprio STABILITY (Getgood 2020): ACLR+LET teve **função inferior e menor torque/potência de quadríceps aos 6 meses**, normalizando aos 12. ⇒ o motor deve aconselhar: *"possível déficit funcional transitório do quadríceps por volta dos 6 meses, resolvido até 12 meses."*

**Complicações a incluir no termo de consentimento (baixas, mas reais):** dor lateral, convergência de túneis, remoção de material (10 vs 4 casos no STABILITY — maior no grupo LET), lesão do LCL, inibição do quadríceps, rigidez.

---

## 4. NÃO-gatilhos de LEAP (não atingiram consenso)

Estes **não** disparam LEAP isoladamente. Entram apenas como fatores acessórios que somam no conjunto (regra L12).

| Fator | Status | Consequência no motor |
|---|---|---|
| Enxerto **<8 mm isolado** | Sem consenso (statement 4) | **Não** dispara LEAP. Corrigir diâmetro pela via do enxerto (§6). Bate com Mirzayan 2023: híbrido ≥8 mm **não** reduz revisão vs HT <8 mm. |
| Fratura de Segond | Sem consenso | Fator acessório |
| Sinal do notch femoral lateral profundo | Sem consenso | Fator acessório |
| Lesão do complexo anterolateral em RM/US | Sem consenso | Fator acessório |
| Pivot shift **grau 2** isolado | Sem consenso | Fator acessório (só grau 3 dispara) |
| Atleta feminina | Sem consenso | Fator acessório |
| Procedimento meniscal concomitante | Sem consenso | Fator acessório |

---

## 5. Módulo PTS (slope) — LEAP vs osteotomia

PTS é driver forte, mas as duas alavancas têm evidências de força diferente:

| Perfil | Alavanca A | Alavanca B | Evidência | Contexto |
|---|---|---|---|---|
| PTS >10,1° (11× risco de falha); ≥12° maior risco; medial ≥16° prediz falhas múltiplas | **LEAP (considerar)** — reduz probabilidade de ruptura ligada ao slope (subestudo STABILITY/Firth) | **Osteotomia de correção de slope (PLO)** — mecanicamente mais direcionada | Prognóstico [N-II]; intervenção LEAP [N-I subgrupo]; intervenção osteotomia **[N-V, expert]** | LEAP: ambas · Osteotomia: sobretudo **revisão/re-revisão**, rara em primária alto risco selecionado |

**Regra de saída:** oferecer LEAP como primeira linha em primária de alto risco; osteotomia reservada a revisão/falhas repetidas com slope marcadamente elevado, **sinalizando que a evidência da osteotomia em reduzir falha é de nível baixo (expert)**.

---

## 6. Módulo enxerto / diâmetro

| Gatilho | Alavanca | O que NÃO fazer | Evidência | Contexto |
|---|---|---|---|---|
| Predição HT <8 mm (RM/antropometria) | Migrar para **QT/BTB** (mais previsíveis) **ou** multi-strand 6–8 fitas **ou** internal brace como load-sharing | **Não** somar LEAP só por diâmetro; **não** usar híbrido só para "engordar" o enxerto | Diâmetro <8 mm preditor forte; cada 0,5 mm reduz risco (Itoh 2024). Híbrido ≥8 mm ≠ redução de revisão vs HT <8 mm (Mirzayan 2023) | Ambas |
| Hipermobilidade / HE ≥5° + escolha de HT no jovem | Preferir **BTB/QT** ou reforçar; se HE ≥6,5° e HT planejado → **migrar de HT** | **Nunca** deixar HT isolado sem procedimento extra-articular neste grupo | Hipermobilidade → ~4× rerruptura HT vs BTB (Lindskog 2025); HE ≥6,5° → 14,6× ruptura HT (Helito 2024); HT isolado em hiperlaxo falha 21,7–24,4% (Helito 2019) | Primária |
| Internal brace / suture tape | Reforço load-sharing em enxerto vulnerável | Não substitui incorporação biológica | Meta reduz falha + aumenta RTS sem elevar complicações; 5 anos com 1,1% falha (Wilson) | Ambas |

---

## 7. Módulo revisão-específico

| Gatilho | Alavanca | Evidência | Nível |
|---|---|---|---|
| Túnel femoral/tibial comprometido (tamanho/posição) | **Staged bone grafting** antes da revisão; reposicionar túnel | Túneis comprometidos = principais preditores de falha na revisão (MARS AutoPrognosis) | N-II/III |
| Uso de **aloenxerto** em jovem | Preferir **autoenxerto** | Aloenxerto OR 3,3 de falha (MARS); revisão 2–4× em <25 anos | N-II/III |
| Revisão + fatores rotacionais | **LEAP** (LET/ALLR) | Meta Grassi: redução relativa de **54%** na falha, sem aumento de complicações | N-II/III |
| Revisão + reconstrução do ALL isolada como "cura" | Cautela — benefício **inconsistente** | RCT de Sørensen negativo para ALL em revisão a 2 anos (Kayaalp ref 101) | N-I (negativo) |

---

## 8. Módulo biológico/comportamental (não cirúrgico)

| Gatilho | Alavanca | Evidência |
|---|---|---|
| Tabagismo | Cessação pré-operatória (aconselhamento) | Fumantes: falha 3× (Hendrikx 2025) |
| Atraso cirúrgico | Discussão de timing (>75 dias associado a mais falha; janela de decisão individual) | Kayaalp |
| Retorno precoce ao pivô na janela de ligamentização (6–12 sem) | Protelar RTS; reabilitação por critério | Kayaalp |
| Artrite séptica pós-op / efusão a 3 meses | Bandeira de risco (não pré-op) — falha 2× em 5 anos | Kayaalp |

---

## 8A. Camada de execução técnica do LEAP (Consenso Parte II) — referência, NÃO gatilho

Isto **não** participa da decisão (não dispara nem contraindica). É referência intraoperatória para exibir **depois** que a indicação de LEAP foi tomada. Todos [N-V, VIÉS-IND].

| Item | Recomendação | Consenso |
|---|---|---|
| ITB (banda iliotibial) — trajeto | Passar o enxerto **profundo ao LCL** | Strong (93,3%, st. 23) |
| ITB — fixação | Rotação neutra, **baixa tensão**, entre **0–60° de flexão** | Consenso (86%, st. 24) |
| ALLR — ponto femoral | **Proximal e posterior** ao epicôndilo femoral lateral | Unânime (100%, st. 27) |
| ALLR — posição de fixação | **Extensão completa + rotação neutra** | Consenso (80,6%, st. 26) |
| Método de fixação | Grampo, parafuso, sutura ou âncora — todos aceitáveis | Unânime (100%, st. 25) |
| Pediátrico | Adaptar técnica para **poupar a fise** | Unânime (100%, st. 28) |
| Superioridade de técnica | **Nenhum LEAP é superior a outro** (confirma equivalência LET ≈ ALLR) | Consenso (77,3%, st. 22) |

---

## 9. Números-âncora (para exibição e auditoria)

- **STABILITY (RCT, N-I):** ACLR+LET falha clínica **25% vs 40%** (p<0,0001); **redução de 67%** na ruptura (4% vs 11%); n=618, idade média 18,9.
- **PTS >10,1° → 11×** risco de falha; maior com ≥12°.
- **Revisão + LEAP:** RRR **54%** na falha (meta Grassi).
- **Imaturo:** ruptura até **32%** em seguimento longo.
- **HE >5° (primária HT):** falha **14,7% vs 2,9%**.
- **HE ≥6,5° (primária HT, Helito 2024):** **14,6×** risco de ruptura do enxerto.
- **Hiperlaxidade (HT isolado):** falha **21,7–24,4%** (Helito 2019; Larson 2017) vs **~4%** na população geral.
- **Hipermobilidade:** rerruptura **~4×** HT vs BTB.

---

## 10. Representação para o motor (JSON)

```json
{
  "module": "acl_decision_support",
  "version": "0.3",
  "output_type": "qualitative_decision_support",
  "disclaimers": {
    "not_calibrated_probability": true,
    "population_calibration": "not_validated_for_Brazil",
    "consensus_bias_flag": "industry_supported_pro_LEAP_panel"
  },
  "non_modifiable_drivers": [
    {"id":"age","label":"idade<=25","effect":"pretest_risk_up"},
    {"id":"female","label":"sexo_feminino","effect":"pretest_risk_up"},
    {"id":"notch","label":"chanfradura_estreita","effect":"pretest_risk_up"},
    {"id":"contralateral","label":"lca_contralateral_previa","effect":"pretest_risk_up"}
  ],
  "leap_rules": [
    {"id":"L1","if":{"age_le":25,"graft":"HT"},"lever":"LEAP","strength":"strongly_recommended","evidence_level":["I","V"],"context":"primary"},
    {"id":"L2","if":{"age_le":25,"graft":["QT","BTB"]},"lever":"LEAP","strength":"should_be_considered","evidence_level":["V"],"context":"primary"},
    {"id":"L3","if":{"pivot_shift":3},"lever":"LEAP","strength":"strongly_recommended","evidence_level":["V"],"context":"both"},
    {"id":"L4","if":{"knee_hyperextension_deg_ge":5},"lever":"LEAP+extension_fixation","strength":"strongly_recommended","evidence_level":["II","V"],"context":"both","modifier":{"graft_HT":"weight_up","graft_BTB_QT":"weight_down"},"high_risk_tier":{"if":{"knee_hyperextension_deg_ge":6.5,"graft":"HT"},"effect":"14.6x_rupture","lever":"switch_to_BTB_QT+LEAP","source":"Helito_2024_single_center"}},
    {"id":"L5","if":{"revision":true},"lever":"LEAP","strength":"recommended","evidence_level":["II","V"],"context":"revision"},
    {"id":"L6","if":{"skeletally_immature":true},"lever":"LEAP","strength":"strongly_recommended","evidence_level":["V"],"context":"primary"},
    {"id":"L7","if":{"chronic_symptomatic_deficiency":true},"lever":"LEAP","strength":"recommended","evidence_level":["V"],"context":"both"},
    {"id":"L8","if":{"return_pivoting_sport":true},"lever":"LEAP","strength":"should_be_considered","evidence_level":["V"],"context":"both"},
    {"id":"L9","if":{"lachman":3},"lever":"LEAP","strength":"should_be_considered","evidence_level":["V"],"context":"both"},
    {"id":"L10","if":{"pts_deg_gt":12},"lever":"LEAP_or_slope_osteotomy","strength":"should_be_considered","evidence_level":["V"],"context":"primary"},
    {"id":"L11","if":{"contralateral_acl_history":true},"lever":"LEAP","strength":"should_be_considered","evidence_level":["V"],"context":"primary"},
    {"id":"L12","if":{"relative_factors_count_ge":2},"lever":"LEAP","strength":"may_be_considered","evidence_level":["V"],"context":"both"}
  ],
  "leap_non_triggers_alone": ["graft_diameter_lt_8mm","segond_fracture","deep_notch_sign","alc_lesion_imaging","pivot_shift_2","female","concomitant_meniscal"],
  "graft_rules": [
    {"id":"G1","if":{"predicted_HT_diameter_lt":8},"lever":["switch_to_QT_BTB","multistrand_6_8","internal_brace"],"forbid":["hybrid_for_diameter","LEAP_for_diameter_alone"],"evidence_level":["III","IV"],"context":"both"},
    {"id":"G2","if":{"hypermobility_or_HE_ge":5,"graft":"HT","age_le":25},"lever":["prefer_BTB_QT","reinforce"],"escalate_if":{"HE_deg_ge":6.5},"forbid":["isolated_HT_without_extraarticular_in_hyperlaxity"],"evidence_level":["III"],"context":"primary"}
  ],
  "pts_rules": [
    {"id":"P1","if":{"pts_deg_ge":10.1},"lever_primary":"LEAP","lever_alt":"slope_osteotomy","note":"osteotomy_intervention_evidence=expert_level","context":{"LEAP":"both","osteotomy":"revision_or_selected_primary"}}
  ],
  "revision_rules": [
    {"id":"R1","if":{"compromised_tunnel":true},"lever":["staged_bone_grafting","tunnel_reposition"],"evidence_level":["II","III"]},
    {"id":"R2","if":{"allograft_in_young":true},"lever":"prefer_autograft","evidence_level":["II","III"]},
    {"id":"R3","if":{"revision":true,"rotational_instability":true},"lever":"LEAP","evidence_level":["II","III"]},
    {"id":"R4","if":{"revision":true,"proposed":"isolated_ALL_as_cure"},"lever":"caution_inconsistent_benefit","evidence_level":["I_negative"]}
  ],
  "behavioral_rules": [
    {"id":"B1","if":{"smoker":true},"lever":"cessation","evidence":"failure_3x"},
    {"id":"B2","if":{"surgical_delay_days_gt":75},"lever":"timing_discussion"},
    {"id":"B3","if":{"early_RTS_pivot_within_weeks":12},"lever":"delay_RTS_criteria_based"}
  ],
  "leap_counseling_layer": {
    "source": "consensus_part_II",
    "evidence_level": ["V"],
    "bias_flag": "industry_supported_pro_LEAP_panel",
    "reassurance_statements": ["low_complication_rate","no_increased_lateral_OA_short_mid_term","no_rehab_protocol_change","no_negative_RTS"],
    "mandatory_caveats": [
      "unanimity_from_conflicted_panel",
      "OA_claim_is_2yr_not_longterm",
      "transient_quad_deficit_at_6mo_resolves_by_12mo_STABILITY_substudy"
    ],
    "consent_complications": ["lateral_pain","tunnel_convergence","hardware_removal","LCL_injury","quadriceps_inhibition","stiffness"]
  },
  "technique_reference_non_trigger": {
    "source": "consensus_part_II",
    "note": "execution_reference_only_not_decision",
    "ITB_route": "deep_to_LCL",
    "ITB_fixation": {"rotation":"neutral","tension":"low","flexion_deg":[0,60]},
    "ALLR_femoral_point": "proximal_posterior_to_lateral_epicondyle",
    "ALLR_fixation_position": {"knee":"full_extension","rotation":"neutral"},
    "fixation_devices": ["staple","screw","suture","anchor"],
    "pediatric": "adapt_to_spare_physis",
    "technique_superiority": "none_superior_LET_eq_ALLR"
  }
}
```

---

## 11. Bibliografia (Vancouver)

1. Kayaalp ME, Konstantinou E, Lucidi GA, et al. Advances in anterior cruciate ligament reconstruction: risk stratification, graft choices, and functional recovery in 2026. J Exp Orthop. 2026;13:e70766.
2. Sonnery-Cottet B, Carrozzo A, Saithna A, et al. Indications for lateral extra-articular procedures in the anterior cruciate ligament–reconstructed knee: Part I of an international consensus statement. Arthroscopy. 2025;41(9):3303-3312.
3. Getgood AMJ, Bryant DM, Litchfield R, et al. Lateral extra-articular tenodesis reduces failure of hamstring tendon autograft anterior cruciate ligament reconstruction: 2-year outcomes from the STABILITY study randomized clinical trial. Am J Sports Med. 2020;48(2):285-297.
4. MARS Group; Cooper DE, Dunn WR, Huston LJ, et al. Physiologic preoperative knee hyperextension is a predictor of failure in an anterior cruciate ligament revision cohort: a report from the MARS Group. Am J Sports Med. 2018;46(12):2836-2841.
5. Guimarães TM, Giglio PN, Sobrado MF, Bonadio MB, Gobbi RG, Pécora JR, Helito CP. Knee hyperextension greater than 5° is a risk factor for failure in ACL reconstruction using hamstring graft. Orthop J Sports Med. 2021;9(11):23259671211056325.
6. Mirzayan R, Chang RN, Royse KE, Prentice HA, Maletis GB. No difference in revision risk between autologous hamstring graft less than 8 mm versus hybrid graft 8 mm or larger in anterior cruciate ligament reconstruction. Knee Surg Sports Traumatol Arthrosc. 2023;31:3465-3473.
7. Itoh M, Itou J, Okazaki K, Iwasaki K. Estimation failure risk by 0.5-mm differences in autologous hamstring graft diameter in anterior cruciate ligament reconstruction: a meta-analysis. Am J Sports Med. 2024;52:535-543.
8. Lindskog J, Högberg J, Hamrin Senorski R, et al. Primary anterior cruciate ligament reconstruction performed with hamstring tendon autograft leads to an over 4 times greater rate of second anterior cruciate ligament rupture after return to sport in patients with generalized joint hypermobility compared with bone-patellar tendon-bone autograft. Arthroscopy. 2025;41:3336-3345.
9. Hendrikx FR, Conte P, Van Haver A, et al. Smokers present a three times higher risk of graft failure after ACL reconstruction: a single-centre retrospective analysis. J Exp Orthop. 2025;12:e70422.
10. Dracic A, Zeravica D, Zovko I, Jäger M, Beck S. Cut-off value for the posterior tibial slope indicating the risk for retear of the anterior cruciate ligament. Knee Surg Sports Traumatol Arthrosc. 2025;33:2896-2904.
11. Firth AD, Bryant DM, Litchfield R, et al. Predictors of graft failure in young active patients undergoing hamstring autograft anterior cruciate ligament reconstruction with or without a lateral extra-articular tenodesis: the Stability Experience. Am J Sports Med. 2022;50:384-395.
12. Grassi A, Olivieri Huerta RA, Lucidi GA, et al. A lateral extra-articular procedure reduces the failure rate of revision anterior cruciate ligament reconstruction surgery without increasing complications: a systematic review and meta-analysis. Am J Sports Med. 2024;52:1098-1108.
13. Bosco F, Giustra F, Masoni V, et al. Combining an anterolateral complex procedure with anterior cruciate ligament reconstruction reduces the graft reinjury rate and improves clinical outcomes: a systematic review and meta-analysis of randomized controlled trials. Am J Sports Med. 2024;52:2129-2147.
14. Sørensen OG, Faunø P, Konradsen L, et al. Combined anterior cruciate ligament revision with reconstruction of the antero-lateral ligament does not improve outcome at 2-year follow-up compared to isolated ACL revision; a randomized controlled trial. Knee Surg Sports Traumatol Arthrosc. 2023;31:5077-5086.
15. Sonnery-Cottet B, Carrozzo A, Saithna A, et al. Surgical treatment and complications of lateral extra-articular procedures in the anterior cruciate ligament–reconstructed knee: Part II of an international consensus statement. Arthroscopy. 2025;41(9):3313-3321.
16. Getgood A, Hewison C, Bryant D, et al. No difference in functional outcomes when lateral extra-articular tenodesis is added to anterior cruciate ligament reconstruction in young active patients: the Stability Study. Arthroscopy. 2020;36(6):1690-1701.
17. D'Ambrosi R, Corona K, Cerciello S, et al. Combining an anterolateral complex procedure with anterior cruciate ligament reconstruction reduces graft reinjury without increasing the rate of complications: a systematic review and meta-analysis of randomized controlled trials. Am J Sports Med. 2025;53:2462-2470.
18. Helito CP, da Silva AGM, Sobrado MF, Guimarães TM, Gobbi RG, Pécora JR. Patients with more than 6.5° of knee hyperextension are 14.6 times more likely to have anterior cruciate ligament hamstring graft rupture and worse knee stability and functional outcomes. Arthroscopy. 2024;40:898-907.
19. Helito CP, Sobrado MF, Giglio PN, et al. Combined reconstruction of the anterolateral ligament in patients with anterior cruciate ligament injury and ligamentous hyperlaxity leads to better clinical stability and a lower failure rate than isolated anterior cruciate ligament reconstruction. Arthroscopy. 2019;35:2648-2654.
20. Sundemo D, Hamrin Senorski E, Karlsson L, et al. Generalised joint hypermobility increases ACL injury risk and is associated with inferior outcome after ACL reconstruction: a systematic review. BMJ Open Sport Exerc Med. 2019;5:e000620.
21. Larson CM, Bedi A, Dietrich ME, et al. Generalized hypermobility, knee hyperextension, and outcomes after anterior cruciate ligament reconstruction: prospective, case-control study with mean 6 years follow-up. Arthroscopy. 2017;33:1852-1858.
22. Helito CP, Moreira da Silva AG, Sherman SL, et al. Anterior cruciate ligament surgeons frequently modify their approach when treating patients with knee hyperextension or ligamentous hyperlaxity: results from an international survey of ISAKOS members. J ISAKOS. 2025;15:101021.

---

*Documento de trabalho. Nível de evidência máximo de intervenção neste módulo: RCT (STABILITY) para LEAP em primária de alto risco com HT. Todas as demais alavancas têm nível inferior e estão rotuladas como tal. O escore do JOREP (Rivarola) foi deliberadamente excluído do motor por não validação e inconsistência interna.*
