import { pgTable, text, serial, timestamp, boolean, integer, real, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { surgeriesTable } from "./surgeries";

export const exameLigamentarTable = pgTable("exame_ligamentar", {
  id: serial("id").primaryKey(),
  surgeryId: integer("surgery_id").notNull().references(() => surgeriesTable.id, { onDelete: "cascade" }),
  lachman: integer("lachman"),
  gavetaNeutra: integer("gaveta_neutra"),
  pivotShift: integer("pivot_shift"),
  aderTest: boolean("ader_test"),
  laerTest: boolean("laer_test"),
  gavetaRotInterna: boolean("gaveta_rot_interna"),
  estresseValgo0: integer("estresse_valgo_0"),
  estresseValgo30: integer("estresse_valgo_30"),
  estresseVaro0: integer("estresse_varo_0"),
  estresseVaro30: integer("estresse_varo_30"),
  gavetaPosterior: integer("gaveta_posterior"),
  sagSign: boolean("sag_sign"),
  quadricepsAtivo: boolean("quadriceps_ativo"),
  lachmantPosterior: boolean("lachman_posterior"),
  dialTest: boolean("dial_test"),
  dialTest30: boolean("dial_test_30"),
  dialTest90: boolean("dial_test_90"),
  recurvato: boolean("recurvato"),
  gavetaRotatoria: boolean("gaveta_rotatoria"),
  hiperextensao: text("hiperextensao"),
  slopeTibialPts: real("slope_tibial_pts"),
  // Classificação de Tanner (pacientes ≤ 15 anos)
  tannerPelos: text("tanner_pelos"),
  tannerMamas: text("tanner_mamas"),
  tannerGenitalia: text("tanner_genitalia"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertExameLigamentarSchema = createInsertSchema(exameLigamentarTable).omit({
  id: true,
  createdAt: true,
});
export type InsertExameLigamentar = z.infer<typeof insertExameLigamentarSchema>;
export type ExameLigamentar = typeof exameLigamentarTable.$inferSelect;

export const lcaAlgorithmTable = pgTable("lca_algorithm", {
  id: serial("id").primaryKey(),
  surgeryId: integer("surgery_id").notNull().references(() => surgeriesTable.id, { onDelete: "cascade" }),
  idade: integer("idade"),
  esportePivot: boolean("esporte_pivot"),
  pivotShift: integer("pivot_shift"),
  revisao: boolean("revisao"),
  hiperlaxidade: boolean("hiperlaxidade"),
  meniscoLateral: boolean("menisco_lateral"),
  lesaoCronica: boolean("lesao_cronica"),
  krirsScore: integer("krirs_score"),
  krirsInterpretacao: text("krirs_interpretacao"),
  tecnicaRecomendada: text("tecnica_recomendada"),
  justificativa: text("justificativa"),
  flagAltoRisco: boolean("flag_alto_risco"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLcaAlgorithmSchema = createInsertSchema(lcaAlgorithmTable).omit({
  id: true,
  createdAt: true,
});
export type InsertLcaAlgorithm = z.infer<typeof insertLcaAlgorithmSchema>;
export type LcaAlgorithm = typeof lcaAlgorithmTable.$inferSelect;

export const lcaLeapDecisionTable = pgTable("lca_leap_decision", {
  id: serial("id").primaryKey(),
  surgeryId: integer("surgery_id").notNull().references(() => surgeriesTable.id, { onDelete: "cascade" }),
  idade: integer("idade"),
  sexo: text("sexo"),
  enxertoPlanejado: text("enxerto_planejado"),
  pivotShift: integer("pivot_shift"),
  lachman: integer("lachman"),
  hiperextensaoGraus: real("hiperextensao_graus"),
  revisao: boolean("revisao"),
  esqueletoImaturo: boolean("esqueleto_imaturo"),
  lesaoCronica: boolean("lesao_cronica"),
  esportePivot: boolean("esporte_pivot"),
  ptsGraus: real("pts_graus"),
  contralateralLca: boolean("contralateral_lca"),
  tabagismo: boolean("tabagismo"),
  atrasoCirurgicoDias: integer("atraso_cirurgico_dias"),
  tunelComprometido: boolean("tunel_comprometido"),
  aloenxertoJovem: boolean("aloenxerto_jovem"),
  allIsoladaConduta: boolean("all_isolada_conduta"),
  segondFratura: boolean("segond_fratura"),
  notchEstreito: boolean("notch_estreito"),
  lesaoAlcImagem: boolean("lesao_alc_imagem"),
  meniscalConcomitante: boolean("meniscal_concomitante"),
  graftDiametroMm: real("graft_diametro_mm"),
  leapIndicado: boolean("leap_indicado"),
  forcaMaxima: text("forca_maxima"),
  resultado: jsonb("resultado"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLcaLeapDecisionSchema = createInsertSchema(lcaLeapDecisionTable).omit({
  id: true,
  createdAt: true,
});
export type InsertLcaLeapDecision = z.infer<typeof insertLcaLeapDecisionSchema>;
export type LcaLeapDecision = typeof lcaLeapDecisionTable.$inferSelect;

export const procedimentoMeniscalTable = pgTable("procedimento_meniscal", {
  id: serial("id").primaryKey(),
  surgeryId: integer("surgery_id").notNull().references(() => surgeriesTable.id, { onDelete: "cascade" }),
  dorInterlinha: text("dor_interlinha"),
  mcMurrayMedial: boolean("mc_murray_medial"),
  mcMurrayLateral: boolean("mc_murray_lateral"),
  apleyCompressao: boolean("apley_compressao"),
  apleyTracao: boolean("apley_tracao"),
  marchaPato: boolean("marcha_pato"),
  steinmann1: boolean("steinmann_1"),
  steinmann2: boolean("steinmann_2"),
  observacoesExame: text("observacoes_exame"),
  contexto: text("contexto"),
  meniscectomia: boolean("meniscectomia"),
  sutura: boolean("sutura"),
  ladoMedial: boolean("lado_medial"),
  ladoLateral: boolean("lado_lateral"),
  lesaoRampa: boolean("lesao_rampa"),
  lesaoRaiz: boolean("lesao_raiz"),
  lesaoRaizAnterior: boolean("lesao_raiz_anterior"),
  lesaoCornoAnterior: boolean("lesao_corno_anterior"),
  lesaoCornoPosterior: boolean("lesao_corno_posterior"),
  lesaoAlcaBalde: boolean("lesao_alca_balde"),
  lesaoRadial: boolean("lesao_radial"),
  lesaoCorpo: boolean("lesao_corpo"),
  fixacaoRaiz: text("fixacao_raiz"),
  centralizacaoRaiz: boolean("centralizacao_raiz"),
  centralizacaoMetodo: text("centralizacao_metodo"),
  tecnicasSutura: text("tecnicas_sutura").array().notNull().default([]),
  numPontos: integer("num_pontos"),
  pontosPorTecnica: text("pontos_por_tecnica"),
  tipoFio: text("tipo_fio"),
  estimuloBiologico: boolean("estimulo_biologico").default(false),
  estimuloPerfuracaoIntercondilo: boolean("estimulo_perfuracao_intercondilo").default(false),
  estimuloOrtobiologico: boolean("estimulo_ortobiologico").default(false),
  estimuloOrtobiologicoTipo: text("estimulo_ortobiologico_tipo"),
  // Pediatric: Menisco Discoide + Saucerização
  lesaoDiscoide: boolean("lesao_discoide"),
  saucerizacao: boolean("saucerizacao"),
  estimuloCoaguloFibrina: boolean("estimulo_coagulo_fibrina").default(false),
  detalhesMedial: jsonb("detalhes_medial"),
  detalhesLateral: jsonb("detalhes_lateral"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProcedimentoMeniscalSchema = createInsertSchema(procedimentoMeniscalTable).omit({
  id: true,
  createdAt: true,
});
export type InsertProcedimentoMeniscal = z.infer<typeof insertProcedimentoMeniscalSchema>;
export type ProcedimentoMeniscal = typeof procedimentoMeniscalTable.$inferSelect;

export const examePatelarTable = pgTable("exame_patelar", {
  id: serial("id").primaryKey(),
  surgeryId: integer("surgery_id").notNull().references(() => surgeriesTable.id, { onDelete: "cascade" }),
  luxacaoAguda: boolean("luxacao_aguda"),
  luxacaoCronica: boolean("luxacao_cronica"),
  numEpisodios: integer("num_episodios"),
  apprehensionTest: boolean("apprehension_test"),
  jSign: boolean("j_sign"),
  tiltPatelar: text("tilt_patelar"),
  ttTgMm: real("tt_tg_mm"),
  catonDeschamps: real("caton_deschamps"),
  dejourTipo: text("dejour_tipo"),
  inclinacaoPatelarGraus: real("inclinacao_patelar_graus"),
  inclinacaoPatelarCategoria: text("inclinacao_patelar_categoria"),
  lesaoCondral: boolean("lesao_condral"),
  maltrackingDinamico: boolean("maltracking_dinamico"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertExamePatelarSchema = createInsertSchema(examePatelarTable).omit({
  id: true,
  createdAt: true,
});
export type InsertExamePatelar = z.infer<typeof insertExamePatelarSchema>;
export type ExamePatelar = typeof examePatelarTable.$inferSelect;

export const picsScoreTable = pgTable("pics_score", {
  id: serial("id").primaryKey(),
  surgeryId: integer("surgery_id").notNull().references(() => surgeriesTable.id, { onDelete: "cascade" }),
  ptsTotal: integer("pts_total"),
  ptsRisco: text("pts_risco"),
  ptsConduta: text("pts_conduta"),
  fatorDominante: text("fator_dominante"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPicsScoreSchema = createInsertSchema(picsScoreTable).omit({
  id: true,
  createdAt: true,
});
export type InsertPicsScore = z.infer<typeof insertPicsScoreSchema>;
export type PicsScore = typeof picsScoreTable.$inferSelect;

export const lcpReconstructionTable = pgTable("lcp_reconstruction", {
  id: serial("id").primaryKey(),
  surgeryId: integer("surgery_id").notNull().references(() => surgeriesTable.id, { onDelete: "cascade" }),
  grauLesao: text("grau_lesao"),
  indicacaoCirurgica: boolean("indicacao_cirurgica"),
  tecnica: text("tecnica"),
  abordagem: text("abordagem"),
  enxerto: text("enxerto"),
  diametroEnxerto: text("diametro_enxerto"),
  flipCutter: text("flip_cutter"),
  fixacaoFemoral: text("fixacao_femoral"),
  fixacaoTibial: text("fixacao_tibial"),
  fixacaoAnteromedial: text("fixacao_anteromedial"),
  fixacaoPosterolateral: text("fixacao_posterolateral"),
  justificativa: text("justificativa"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLcpReconstructionSchema = createInsertSchema(lcpReconstructionTable).omit({
  id: true,
  createdAt: true,
});
export type InsertLcpReconstruction = z.infer<typeof insertLcpReconstructionSchema>;
export type LcpReconstruction = typeof lcpReconstructionTable.$inferSelect;

// ── CPM — Canto Póstero-Medial (LCM isolado ou LCM + LOP) ────────────
export const cpmReconstructionTable = pgTable("cpm_reconstruction", {
  id: serial("id").primaryKey(),
  surgeryId: integer("surgery_id").notNull().references(() => surgeriesTable.id, { onDelete: "cascade" }),
  // Abordagem: "lcm_isolado" | "lcm_lop"
  abordagem: text("abordagem"),
  // LCM — Ligamento Colateral Medial
  lcmTecnica: text("lcm_tecnica"),
  lcmEnxerto: text("lcm_enxerto"),
  lcmFixacaoProximal: text("lcm_fixacao_proximal"),
  lcmFixacaoDistal: text("lcm_fixacao_distal"),
  // LOP — Ligamento Oblíquo Posterior (somente quando abordagem = lcm_lop)
  lopTecnica: text("lop_tecnica"),
  lopEnxerto: text("lop_enxerto"),
  lopFixacao: text("lop_fixacao"),
  justificativa: text("justificativa"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCpmReconstructionSchema = createInsertSchema(cpmReconstructionTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCpmReconstruction = z.infer<typeof insertCpmReconstructionSchema>;
export type CpmReconstruction = typeof cpmReconstructionTable.$inferSelect;

// ── CPL — Canto Póstero-Lateral ─────────────────────────────────────
export const cplReconstructionTable = pgTable("cpl_reconstruction", {
  id: serial("id").primaryKey(),
  surgeryId: integer("surgery_id").notNull().references(() => surgeriesTable.id, { onDelete: "cascade" }),
  tecnica: text("tecnica"),
  // JSON array: [{nome: string, diametro: string}]
  enxertos: jsonb("enxertos"),
  fixacaoFemoral1: text("fixacao_femoral_1"),
  fixacaoFemoral2: text("fixacao_femoral_2"),
  fixacaoFibular: text("fixacao_fibular"),
  fixacaoTibial: text("fixacao_tibial"),
  reaAssociada: boolean("rea_associada"),
  reaTipo: text("rea_tipo"),
  justificativa: text("justificativa"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCplReconstructionSchema = createInsertSchema(cplReconstructionTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCplReconstruction = z.infer<typeof insertCplReconstructionSchema>;
export type CplReconstruction = typeof cplReconstructionTable.$inferSelect;

// ── Fraturas Periprotéticas do Joelho ───────────────────────────────
export const periprostheticFractureTable = pgTable("periprosthetic_fracture", {
  id: serial("id").primaryKey(),
  surgeryId: integer("surgery_id").notNull().references(() => surgeriesTable.id, { onDelete: "cascade" }),
  // 1. Classificação
  classificacaoFemur: text("classificacao_femur"), // Lewis & Rorabeck: I | II | III
  classificacaoTibia: text("classificacao_tibia"), // Felix & Associates: I | II | III | IV
  classificacaoPatela: text("classificacao_patela"), // Ortiguera & Berry: I | II | IIIa | IIIb
  estoquePatelarMm: real("estoque_patelar_mm"), // obrigatório se IIIa/IIIb
  // 2. Controle de danos
  controleDanos: boolean("controle_danos"),
  controleDanosData: text("controle_danos_data"),
  controleDanosIndicacao: text("controle_danos_indicacao").array().notNull().default([]),
  controleDanosIndicacaoOutro: text("controle_danos_indicacao_outro"),
  controleDanosProcedimento: text("controle_danos_procedimento").array().notNull().default([]),
  controleDanosProcedimentoOutro: text("controle_danos_procedimento_outro"),
  definitivaData: text("definitiva_data"),
  // 3. Localização
  localizacao: jsonb("localizacao"), // [{estrutura, lado, classificacao, tipo}]
  // 4. Acesso cirúrgico
  acessoFemur: text("acesso_femur").array().notNull().default([]),
  acessoFemurOutro: text("acesso_femur_outro"),
  extensaoAbordagem: boolean("extensao_abordagem"),
  extensaoAbordagemTipo: text("extensao_abordagem_tipo"),
  extensaoAbordagemOutro: text("extensao_abordagem_outro"),
  acessoTibia: text("acesso_tibia").array().notNull().default([]),
  // 5. OPME
  opme: jsonb("opme"), // [{categoria, item, tamanho}]
  // 6/7. Complicações agudas/tardias
  complicacoesAgudas: jsonb("complicacoes_agudas"), // [{ocorrencia, data, descricao, resolvido}]
  complicacoesTardias: jsonb("complicacoes_tardias"), // [{ocorrencia, data, descricao, resolvido}]
  observacoes: text("observacoes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPeriprostheticFractureSchema = createInsertSchema(periprostheticFractureTable).omit({
  id: true,
  createdAt: true,
});
export type InsertPeriprostheticFracture = z.infer<typeof insertPeriprostheticFractureSchema>;
export type PeriprostheticFracture = typeof periprostheticFractureTable.$inferSelect;

// ── Fratura do Fêmur Distal (AO/OTA 33) ─────────────────────────────
export const distalFemurFractureTable = pgTable("distal_femur_fracture", {
  id: serial("id").primaryKey(),
  surgeryId: integer("surgery_id").notNull().references(() => surgeriesTable.id, { onDelete: "cascade" }),
  // Classificação AO/OTA
  classificacaoAoOta: text("classificacao_ao_ota"), // 33A | 33B | 33C
  classificacaoSubtipo: text("classificacao_subtipo"), // 1 | 2 | 3
  // Controle de danos
  controleDanos: boolean("controle_danos"),
  controleDanosData: text("controle_danos_data"),
  dataLesao: text("data_lesao"),
  dataCirurgiaDefinitiva: text("data_cirurgia_definitiva"),
  // Acesso cirúrgico
  acesso: text("acesso").array().notNull().default([]),
  acessoOutro: text("acesso_outro"),
  // Cirurgia / materiais utilizados
  cirurgia: text("cirurgia").array().notNull().default([]),
  cirurgiaOutro: text("cirurgia_outro"),
  // OPME (legado)
  opme: text("opme").array().notNull().default([]),
  enxertoOsseo: boolean("enxerto_osseo"),
  // Complicações
  complicacoesAgudas: text("complicacoes_agudas").array().notNull().default([]),
  complicacoesAgudasOutro: text("complicacoes_agudas_outro"),
  complicacoesTardias: text("complicacoes_tardias").array().notNull().default([]),
  complicacoesTardiasOutro: text("complicacoes_tardias_outro"),
  // Lesões associadas
  lesoesAssociadas: text("lesoes_associadas").array().notNull().default([]),
  lesoesAssociadasOutro: text("lesoes_associadas_outro"),
  observacoes: text("observacoes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDistalFemurFractureSchema = createInsertSchema(distalFemurFractureTable).omit({
  id: true,
  createdAt: true,
});
export type InsertDistalFemurFracture = z.infer<typeof insertDistalFemurFractureSchema>;
export type DistalFemurFracture = typeof distalFemurFractureTable.$inferSelect;

// ── Fratura do Platô Tibial (Schatzker) ─────────────────────────────
export const tibialPlateauFractureTable = pgTable("tibial_plateau_fracture", {
  id: serial("id").primaryKey(),
  surgeryId: integer("surgery_id").notNull().references(() => surgeriesTable.id, { onDelete: "cascade" }),
  // Classificação Schatzker
  classificacaoSchatzker: text("classificacao_schatzker"), // I | II | III | IV | V | VI
  // Controle de danos
  controleDanos: boolean("controle_danos"),
  controleDanosData: text("controle_danos_data"),
  dataLesao: text("data_lesao"),
  dataCirurgiaDefinitiva: text("data_cirurgia_definitiva"),
  // Acesso cirúrgico
  acesso: text("acesso").array().notNull().default([]), // Lateral | Medial | Postero-lateral | Postero-medial | Posterior | Osteotomia da cabeça da fíbula | Dual (lateral + medial) | Outro
  acessoOutro: text("acesso_outro"),
  // Cirurgia / materiais utilizados
  cirurgia: text("cirurgia").array().notNull().default([]),
  cirurgiaOutro: text("cirurgia_outro"),
  // OPME (com quantidades) — mantido para compatibilidade com dados anteriores
  opme: jsonb("opme"), // [{item, quantidade}]
  enxertoOsseo: boolean("enxerto_osseo"),
  // Complicações
  complicacoesAgudas: text("complicacoes_agudas").array().notNull().default([]),
  complicacoesAgudasOutro: text("complicacoes_agudas_outro"),
  complicacoesTardias: text("complicacoes_tardias").array().notNull().default([]),
  complicacoesTardiasOutro: text("complicacoes_tardias_outro"),
  // Lesões associadas
  lesoesAssociadas: text("lesoes_associadas").array().notNull().default([]),
  lesoesAssociadasOutro: text("lesoes_associadas_outro"),
  observacoes: text("observacoes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTibialPlateauFractureSchema = createInsertSchema(tibialPlateauFractureTable).omit({
  id: true,
  createdAt: true,
});
export type InsertTibialPlateauFracture = z.infer<typeof insertTibialPlateauFractureSchema>;
export type TibialPlateauFracture = typeof tibialPlateauFractureTable.$inferSelect;

// ── Fratura da Patela (AO/OTA 34) ───────────────────────────────────
export const patellaFractureTable = pgTable("patella_fracture", {
  id: serial("id").primaryKey(),
  surgeryId: integer("surgery_id").notNull().references(() => surgeriesTable.id, { onDelete: "cascade" }),
  // Classificação AO/OTA
  classificacaoAoOta: text("classificacao_ao_ota"), // 34A | 34B | 34C
  classificacaoSubtipo: text("classificacao_subtipo"), // 1 | 2 | 3
  dataLesao: text("data_lesao"),
  dataCirurgiaDefinitiva: text("data_cirurgia_definitiva"),
  // Acesso cirúrgico
  acesso: text("acesso").array().notNull().default([]), // Longitudinal anterior | Parapatelar medial | Parapatelar lateral | Minimamente invasivo | Outro
  acessoOutro: text("acesso_outro"),
  // Cirurgia / materiais (pode usar mais de um)
  cirurgia: text("cirurgia").array().notNull().default([]), // Banda de tensão com fio de aço | Parafusos canulados | Parafusos de Herbert | Fio de aço | Fiber tape | Placa patelar anterior | Patelectomia parcial | Patelectomia total
  cirurgiaOutro: text("cirurgia_outro"),
  // Complicações
  complicacoesAgudas: text("complicacoes_agudas").array().notNull().default([]),
  complicacoesAgudasOutro: text("complicacoes_agudas_outro"),
  complicacoesTardias: text("complicacoes_tardias").array().notNull().default([]),
  complicacoesTardiasOutro: text("complicacoes_tardias_outro"),
  // Lesões associadas
  lesoesAssociadas: text("lesoes_associadas").array().notNull().default([]),
  lesoesAssociadasOutro: text("lesoes_associadas_outro"),
  observacoes: text("observacoes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPatellaFractureSchema = createInsertSchema(patellaFractureTable).omit({
  id: true,
  createdAt: true,
});
export type InsertPatellaFracture = z.infer<typeof insertPatellaFractureSchema>;
export type PatellaFracture = typeof patellaFractureTable.$inferSelect;

// ── Fratura da Espinha Tibial / Eminência Tibial (Meyers & McKeever) ─
export const tibialSpineFractureTable = pgTable("tibial_spine_fracture", {
  id: serial("id").primaryKey(),
  surgeryId: integer("surgery_id").notNull().references(() => surgeriesTable.id, { onDelete: "cascade" }),
  // Classificação Meyers & McKeever
  classificacaoMeyers: text("classificacao_meyers"), // I | II | III | IV
  dataLesao: text("data_lesao"),
  dataCirurgiaDefinitiva: text("data_cirurgia_definitiva"),
  // Técnica: aberta ou vídeo
  tecnica: text("tecnica"), // Artroscópica (vídeo) | Aberta | Conversão artroscópica → aberta
  // OPME (com quantidades)
  opme: jsonb("opme"), // [{item, quantidade}]
  materialSutura: text("material_sutura"), // Ethibond | FiberWire | Outro
  // Lesões associadas
  lesoesAssociadas: text("lesoes_associadas").array().notNull().default([]),
  lcaSubtipo: text("lca_subtipo"), // Lesão de alongamento | Lesão parcial | Lesão completa
  lesoesAssociadasOutro: text("lesoes_associadas_outro"),
  observacoes: text("observacoes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTibialSpineFractureSchema = createInsertSchema(tibialSpineFractureTable).omit({
  id: true,
  createdAt: true,
});
export type InsertTibialSpineFracture = z.infer<typeof insertTibialSpineFractureSchema>;
export type TibialSpineFracture = typeof tibialSpineFractureTable.$inferSelect;

// ── Ruptura do Tendão Patelar ─────────────────────────────────────────────
export const patelarTendonRuptureTable = pgTable("patelar_tendon_rupture", {
  id: serial("id").primaryKey(),
  surgeryId: integer("surgery_id").notNull().references(() => surgeriesTable.id, { onDelete: "cascade" }),
  classificacao: text("classificacao"), // Avulsão na Patela | Trans Tendão | Avulsão na TAT
  dataLesao: text("data_lesao"),
  dataCirurgiaDefinitiva: text("data_cirurgia_definitiva"),
  cirurgia: text("cirurgia").array().notNull().default([]),
  cirurgiaOutro: text("cirurgia_outro"),
  reforco: boolean("reforco"),
  reforcoTipo: text("reforco_tipo").array().notNull().default([]),
  reforcoTendao: text("reforco_tendao").array().notNull().default([]),
  reforcoTendaoOutro: text("reforco_tendao_outro"),
  imageUrls: jsonb("image_urls"),
  observacoes: text("observacoes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPatelarTendonRuptureSchema = createInsertSchema(patelarTendonRuptureTable).omit({
  id: true,
  createdAt: true,
});
export type InsertPatelarTendonRupture = z.infer<typeof insertPatelarTendonRuptureSchema>;
export type PatelarTendonRupture = typeof patelarTendonRuptureTable.$inferSelect;

// ── Ruptura do Tendão Quadríceps ──────────────────────────────────────────
export const quadricepsTendonRuptureTable = pgTable("quadriceps_tendon_rupture", {
  id: serial("id").primaryKey(),
  surgeryId: integer("surgery_id").notNull().references(() => surgeriesTable.id, { onDelete: "cascade" }),
  classificacao: text("classificacao"), // Avulsão na Patela | Trans Tendão
  dataLesao: text("data_lesao"),
  dataCirurgiaDefinitiva: text("data_cirurgia_definitiva"),
  acesso: text("acesso").array().notNull().default([]),
  acessoOutro: text("acesso_outro"),
  cirurgia: text("cirurgia").array().notNull().default([]),
  cirurgiaOutro: text("cirurgia_outro"),
  reforco: boolean("reforco"),
  reforcoTipo: text("reforco_tipo").array().notNull().default([]),
  reforcoTendao: text("reforco_tendao").array().notNull().default([]),
  reforcoTendaoOutro: text("reforco_tendao_outro"),
  imageUrls: jsonb("image_urls"),
  observacoes: text("observacoes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertQuadricepsTendonRuptureSchema = createInsertSchema(quadricepsTendonRuptureTable).omit({
  id: true,
  createdAt: true,
});
export type InsertQuadricepsTendonRupture = z.infer<typeof insertQuadricepsTendonRuptureSchema>;
export type QuadricepsTendonRupture = typeof quadricepsTendonRuptureTable.$inferSelect;

// ── Lesão Osteocondral — Exame Clínico + Resultado do Algoritmo ─────
export const exameOsteocondralTable = pgTable("exame_osteocondral", {
  id: serial("id").primaryKey(),
  surgeryId: integer("surgery_id").notNull().references(() => surgeriesTable.id, { onDelete: "cascade" }),
  // Gate de elegibilidade
  sintomatica: boolean("sintomatica"),
  falhaConservador: boolean("falha_conservador"),
  artroseDifusa: boolean("artrose_difusa"),
  objetivo: text("objetivo"),
  // Classificação da lesão
  icrsGrau: text("icrs_grau"),
  localizacao: text("localizacao"),
  tamanhoMm2: text("tamanho_mm2"),
  etiologia: text("etiologia"),
  padrao: text("padrao"),
  osseoStatus: text("osseo_status"),
  profundidade: text("profundidade"),
  continencia: text("continencia"),
  estabilidadeOcd: text("estabilidade_ocd"),
  // Achados clínicos/imagem (booleans)
  edemaOsseo: boolean("edema_osseo"),
  cistoSubcondral: boolean("cisto_subcondral"),
  fragmentoSolto: boolean("fragmento_solto"),
  lesaoMeniscalAssociada: boolean("lesao_meniscal_associada"),
  lesaoLigamentarAssociada: boolean("lesao_ligamentar_associada"),
  desvioAxial: boolean("desvio_axial"),
  rmDisponivel: boolean("rm_disponivel"),
  bancoTecidosDisponivel: boolean("banco_tecidos_disponivel"),
  // Achados adicionais — instabilidade patelar e sobrecarga patelofemoral
  instabilidadePatelar: boolean("instabilidade_patelar"),
  sobrecargaPatelofemoral: boolean("sobrecarga_patelofemoral"),
  // Ligamentos acometidos pela lesão OCD (array JSON de strings)
  ligamentosOCD: jsonb("ligamentos_ocd"),
  // Resultado do DocSholder Cartilage Algorithm v1.0 (JSON completo)
  ocdResult: jsonb("ocd_result"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertExameOsteocondralSchema = createInsertSchema(exameOsteocondralTable).omit({
  id: true,
  createdAt: true,
});
export type InsertExameOsteocondral = z.infer<typeof insertExameOsteocondralSchema>;
export type ExameOsteocondral = typeof exameOsteocondralTable.$inferSelect;
