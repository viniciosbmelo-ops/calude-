import type { Locale } from "@/lib/i18n";

export const surgeryTextExportCopy: Record<Locale, {
  title: string;
  subtitle: string;
  patient: string;
  generatedAt: string;
  patientIdentification: string;
  procedureData: string;
  sections: Record<string, string>;
  fields: Record<string, string>;
  acuteComplications: string;
  lateComplications: string;
  uncategorizedComplications: string;
  notAssessed: string;
  yes: string;
  no: string;
  records: string;
}> = {
  "pt-BR": {
    title: "RESUMO COMPLETO DO PROCEDIMENTO", subtitle: "Documento em texto para inclusão em prontuário externo",
    patient: "Paciente", generatedAt: "Data de geração", patientIdentification: "Identificação do Paciente", procedureData: "Dados do Procedimento",
     sections: { exameLigamentar: "Exame Físico Ligamentar", examePatelar: "Avaliação Patelar", exameOsteocondral: "Avaliação Osteocondral", lcaAlgorithm: "Algoritmo Clínico — LCA", aclLeapDecision: "DocSholder AI Decision — LEAP", picsScore: "Algoritmo Clínico — PICS", procedimentoMeniscal: "Procedimento Meniscal", lcpReconstruction: "Reconstrução do LCP", cpmReconstruction: "Reconstrução do Canto Póstero-Medial", cplReconstruction: "Reconstrução do CPL", patelarTendonRupture: "Ruptura do Tendão Patelar", quadricepsTendonRupture: "Ruptura do Tendão do Quadríceps", periprostheticFracture: "Fratura Periprotética", distalFemurFracture: "Fratura do Fêmur Distal", tibialPlateauFracture: "Fratura do Platô Tibial", patellaFracture: "Fratura de Patela", tibialSpineFracture: "Fratura da Espinha Tibial", rxAnaliseJson: "Planejamento Radiográfico", followups: "Acompanhamentos Pós-Operatórios", bioReady: "BioReady Score® — Prontidão Biológica" },
     fields: {
       resultado: "Resultado", entradasClinicasSalvas: "Entradas clínicas salvas", resultadoSalvo: "Resultado salvo", leapIndicado: "Indicação LEAP", enxertoPlanejado: "Enxerto planejado",
       hiperextensaoGraus: "Hiperextensão (graus)", revisao: "Revisão", esqueletoImaturo: "Esqueleto imaturo",
       lesaoCronica: "Lesão crônica", esportePivot: "Esporte de pivô", ptsGraus: "PTS (graus)",
       contralateralLca: "História de LCA contralateral", tabagismo: "Tabagismo",
       atrasoCirurgicoDias: "Atraso cirúrgico (dias)", tunelComprometido: "Túnel comprometido",
       fatoresAcessoriosCount: "Quantidade de fatores acessórios", driversNaoModificaveis: "Fatores não modificáveis",
       fatoresAcessorios: "Fatores acessórios", camadaSeguranca: "Camada de segurança",
       execucaoTecnica: "Execução técnica", presente: "Presente", modulo: "Módulo", evidencia: "Evidência",
       titulo: "Título", alavanca: "Alavanca", forcaMaxima: "Força máxima", forca: "Força",
       naoCalibrado: "Não calibrado", populacao: "População", vies: "Viés",
     },
    acuteComplications: "Agudas (até 30 dias)", lateComplications: "Tardias (após 30 dias)", uncategorizedComplications: "Sem categoria (registro anterior)", notAssessed: "Não avaliado", yes: "Sim", no: "Não", records: "Registros",
  },
  es: {
    title: "RESUMEN COMPLETO DEL PROCEDIMIENTO", subtitle: "Documento de texto para incluir en una historia clínica externa",
    patient: "Paciente", generatedAt: "Fecha de generación", patientIdentification: "Identificación del paciente", procedureData: "Datos del procedimiento",
     sections: { exameLigamentar: "Examen físico ligamentario", examePatelar: "Evaluación patelar", exameOsteocondral: "Evaluación osteocondral", lcaAlgorithm: "Algoritmo clínico — LCA", aclLeapDecision: "DocSholder AI Decision — LEAP", picsScore: "Algoritmo clínico — PICS", procedimentoMeniscal: "Procedimiento meniscal", lcpReconstruction: "Reconstrucción del LCP", cpmReconstruction: "Reconstrucción de la esquina posteromedial", cplReconstruction: "Reconstrucción del CPL", patelarTendonRupture: "Rotura del tendón patelar", quadricepsTendonRupture: "Rotura del tendón del cuádriceps", periprostheticFracture: "Fractura periprotésica", distalFemurFracture: "Fractura del fémur distal", tibialPlateauFracture: "Fractura de la meseta tibial", patellaFracture: "Fractura de rótula", tibialSpineFracture: "Fractura de la espina tibial", rxAnaliseJson: "Planificación radiográfica", followups: "Seguimientos posoperatorios", bioReady: "BioReady Score® — Preparación biológica" },
     fields: {
        nome: "Nombre", sexo: "Sexo", telefone: "Teléfono", cpf: "CPF", dataNascimento: "Fecha de nacimiento", lado: "Lado", dataCirurgia: "Fecha del procedimiento", hospital: "Hospital / lugar", tipoCaso: "Tipo de caso", tiposProcedimento: "Procedimientos", ligamentosAcometidos: "Ligamentos afectados", diagnostico: "Diagnóstico", alinhamento: "Alineación", grauAlinhamento: "Grado de alineación", procedimentoRealizado: "Procedimiento realizado", procedimentosDetalhados: "Detalles de los procedimientos", tecnicasSutura: "Técnicas de sutura", pontosPorTecnica: "Puntos por técnica", observacoes: "Observaciones", jSign: "Signo de J", jSignGrau: "Grado del signo de J", justificativa: "Justificación", recomendacao: "Recomendación", conduta: "Conducta", score: "Puntuación", eixoMecanico: "Eje mecánico", classificacao: "Clasificación", graus: "Grados", periodo: "Período", gradeLabel: "Clasificación", dataCompleteness: "Completitud de los datos", factors: "Factores evaluados", topRecommendations: "Prioridades de optimización", complicacoes: "Complicaciones", fator: "Factor", status: "Estado", completudeDosDados: "Completitud de los datos", dadosIncompletos: "Datos incompletos", fatoresAvaliados: "Factores evaluados", prioridadesDeOtimizacao: "Prioridades de optimización", controleDanos: "Control de daños", controleDanosData: "Fecha del control de daños", controleDanosIndicacao: "Indicación", controleDanosProcedimento: "Procedimiento (etapa 1)", acesso: "Acceso", cirurgia: "Cirugía", complicacoesAgudas: "Complicaciones agudas", complicacoesTardias: "Complicaciones tardías", lesoesAssociadas: "Lesiones asociadas", enxertoOsseo: "Injerto óseo",
        resultado: "Resultado", entradasClinicasSalvas: "Entradas clínicas guardadas", resultadoSalvo: "Resultado guardado", leapIndicado: "Indicación LEAP", enxertoPlanejado: "Injerto planificado", loaEnxerto: "Injerto del LOA", loaFixacao: "Fijación femoral del LOA", hiperextensaoGraus: "Hiperextensión (grados)", revisao: "Revisión", esqueletoImaturo: "Esqueleto inmaduro", lesaoCronica: "Lesión crónica", esportePivot: "Deporte de pivote", ptsGraus: "PTS (grados)", contralateralLca: "Antecedentes de LCA contralateral", tabagismo: "Tabaquismo", atrasoCirurgicoDias: "Retraso quirúrgico (días)", tunelComprometido: "Túnel comprometido", fatoresAcessoriosCount: "Cantidad de factores accesorios", driversNaoModificaveis: "Factores no modificables", fatoresAcessorios: "Factores accesorios", camadaSeguranca: "Capa de seguridad", execucaoTecnica: "Ejecución técnica", presente: "Presente", modulo: "Módulo", evidencia: "Evidencia", titulo: "Título", alavanca: "Palanca", forcaMaxima: "Fuerza máxima", forca: "Fuerza", naoCalibrado: "No calibrado", populacao: "Población", vies: "Sesgo",
    },
    acuteComplications: "Agudas (hasta 30 días)", lateComplications: "Tardías (después de 30 días)", uncategorizedComplications: "Sin categoría (registro anterior)", notAssessed: "No evaluado", yes: "Sí", no: "No", records: "Registros",
  },
};