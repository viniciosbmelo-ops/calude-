import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../../docknee-funcionalidades.pdf");

const C = {
  azul:    [0, 82, 165],
  azulMed: [0, 120, 215],
  azulCla: [219, 234, 254],
  cinzaFd: [245, 247, 250],
  cinza:   [100, 116, 139],
  preto:   [15, 23, 42],
  verde:   [5, 150, 105],
  verdeCla:[209, 250, 229],
  branco:  [255, 255, 255],
  amarelo: [251, 191, 36],
  lilas:   [139, 92, 246],
  lilasC:  [237, 233, 254],
  vermelho:[220, 38, 38],
};

const doc = new PDFDocument({ size: "A4", margins: { top: 0, bottom: 0, left: 0, right: 0 }, autoFirstPage: false });
doc.pipe(fs.createWriteStream(OUT));

const W = 595.28;
const H = 841.89;
const M = 40; // margin
const CW = W - M * 2; // content width

// ── helpers ──────────────────────────────────────────────────────────────────
const rgb = (c) => ({ r: c[0] / 255, g: c[1] / 255, b: c[2] / 255 });
const fill  = (c) => doc.fillColor([c[0], c[1], c[2]]);
const stroke = (c) => doc.strokeColor([c[0], c[1], c[2]]);

function rect(x, y, w, h, color, radius = 0) {
  fill(color);
  if (radius > 0) doc.roundedRect(x, y, w, h, radius).fill();
  else doc.rect(x, y, w, h).fill();
}

function tag(x, y, text, bg, fg, fontSize = 7.5) {
  doc.save();
  fill(bg);
  const tw = doc.fontSize(fontSize).widthOfString(text);
  doc.roundedRect(x, y - 1, tw + 12, 14, 3).fill();
  fill(fg);
  doc.fontSize(fontSize).font("Helvetica-Bold").text(text, x + 6, y + 1.5, { lineBreak: false });
  doc.restore();
  return tw + 12 + 6;
}

function sectionHeader(y, title, subtitle, accent) {
  rect(M, y, CW, 42, accent, 6);
  fill(C.branco);
  doc.font("Helvetica-Bold").fontSize(15).text(title, M + 14, y + 8, { lineBreak: false });
  if (subtitle) {
    fill([255,255,255]);
    doc.font("Helvetica").fontSize(9).fillOpacity(0.85).text(subtitle, M + 14, y + 27, { lineBreak: false });
    doc.fillOpacity(1);
  }
  return y + 54;
}

function featureCard(x, y, w, icon, title, items, accent) {
  const estimatedH = 28 + items.length * 14 + 10;
  rect(x, y, w, estimatedH, C.cinzaFd, 6);
  // accent left bar
  rect(x, y, 4, estimatedH, accent, 2);
  // icon + title
  fill(accent);
  doc.font("Helvetica-Bold").fontSize(9).text(`${icon}  ${title}`, x + 12, y + 8, { lineBreak: false, width: w - 20 });
  // items
  fill(C.preto);
  doc.font("Helvetica").fontSize(7.8);
  let iy = y + 22;
  for (const item of items) {
    doc.text(`• ${item}`, x + 12, iy, { lineBreak: false, width: w - 20 });
    iy += 14;
  }
  return y + estimatedH + 8;
}

function divider(y) {
  stroke(C.azulCla);
  doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.5).stroke();
  return y + 10;
}

// ═══════════════════════════════════════════════════════════════════════════
// CAPA
// ═══════════════════════════════════════════════════════════════════════════
doc.addPage();

// Fundo gradiente simulado com retângulos
rect(0, 0, W, H, [0, 55, 120]);
rect(0, 0, W, 4, C.amarelo);

// Padrão decorativo — círculos sobrepostos
doc.save();
doc.fillOpacity(0.06);
fill(C.branco);
doc.circle(W - 80, 160, 180).fill();
doc.circle(80, H - 120, 140).fill();
doc.fillOpacity(1);
doc.restore();

// Badge superior
fill(C.amarelo);
doc.font("Helvetica-Bold").fontSize(8).text("MATERIAL DE APRESENTAÇÃO COMERCIAL — CONFIDENCIAL", M, 22, { lineBreak: false });

// Logo / nome
fill(C.branco);
doc.font("Helvetica-Bold").fontSize(52).text("DocKnee", M, 110, { lineBreak: false });
fill(C.amarelo);
doc.font("Helvetica-Bold").fontSize(18).text("®", M + 246, 110, { lineBreak: false });

fill([180, 210, 255]);
doc.font("Helvetica").fontSize(16).text("Plataforma de Documentação e Planejamento Cirúrgico do Joelho", M, 175, { width: CW });

// Linha decorativa
rect(M, 230, 60, 3, C.amarelo, 2);

fill(C.branco);
doc.font("Helvetica").fontSize(12).text(
  "A solução completa para o ortopedista moderno — do diagnóstico ao acompanhamento, tudo em um só lugar.",
  M, 248, { width: CW - 40 }
);

// Cards de destaque
const destaques = [
  { n: "7+",   label: "Módulos\nclinicos" },
  { n: "12+",  label: "Escalas\nvalidadas" },
  { n: "100%", label: "Baseado\nem evidências" },
  { n: "2 anos", label: "Follow-up\nautomático" },
];
const cardW = (CW - 30) / 4;
destaques.forEach((d, i) => {
  const cx = M + i * (cardW + 10);
  fill([255, 255, 255]);
  doc.fillOpacity(0.12).roundedRect(cx, 330, cardW, 70, 8).fill();
  doc.fillOpacity(1);
  fill(C.amarelo);
  doc.font("Helvetica-Bold").fontSize(20).text(d.n, cx, 345, { width: cardW, align: "center", lineBreak: false });
  fill([200, 225, 255]);
  doc.font("Helvetica").fontSize(8).text(d.label, cx, 370, { width: cardW, align: "center" });
});

// Proposta de valor
fill([255, 255, 255]);
doc.fillOpacity(0.08).roundedRect(M, 425, CW, 110, 8).fill();
doc.fillOpacity(1);
fill(C.amarelo);
doc.font("Helvetica-Bold").fontSize(11).text("Por que DocKnee?", M + 16, 440);
fill([220, 235, 255]);
doc.font("Helvetica").fontSize(9.5);
const bullets = [
  "✓  Elimina registros em papel — toda a documentação cirúrgica em formato digital, seguro e auditável",
  "✓  Algoritmos clínicos integrados (KRIRS, PICS 2.0, LEAP) que suportam a decisão intraoperatória",
  "✓  Planejamento de RX panorâmico com IA — análise automática de alinhamento e osteotomia",
  "✓  PROMs automatizados via WhatsApp/e-mail — IKDC, KOOS, Lysholm, Tegner, Kujala e mais",
  "✓  Dashboard do médico com métricas de resultados — dados prontos para publicações científicas",
];
let by = 460;
for (const b of bullets) {
  doc.text(b, M + 16, by, { lineBreak: false });
  by += 14;
}

// Rodapé capa
fill([140, 175, 220]);
doc.font("Helvetica").fontSize(8).text("dockneeapp.com  ·  contato@docknee.com.br  ·  © 2024–2025 DocKnee. Todos os direitos reservados.", M, H - 45, { align: "center", width: CW });

// ═══════════════════════════════════════════════════════════════════════════
// PÁGINA 2 — CADASTRO, AUTENTICAÇÃO E GESTÃO DE PACIENTES
// ═══════════════════════════════════════════════════════════════════════════
doc.addPage();
rect(0, 0, W, H, C.branco);
rect(0, 0, W, 8, C.azul);

let y = 28;

// Cabeçalho de página
fill(C.azul);
doc.font("Helvetica-Bold").fontSize(22).text("DocKnee", M, y, { lineBreak: false });
fill(C.cinza);
doc.font("Helvetica").fontSize(10).text("Funcionalidades Completas da Plataforma", M + 110, y + 8, { lineBreak: false });
fill(C.amarelo);
doc.font("Helvetica-Bold").fontSize(9).text("Pág. 1 / 5", W - M - 50, y + 7, { lineBreak: false });
y += 40;

y = sectionHeader(y, "01  Cadastro & Autenticação", "Onboarding seguro e perfil profissional completo", C.azul);

const col2w = (CW - 10) / 2;
y = featureCard(M, y, col2w, "🔐", "Registro de Médico", [
  "Formulário completo: CRM, CPF, especialidade",
  "Endereço com CEP (autopreenchimento via API)",
  "Upload de foto de perfil",
  "Validação CPF e CRM em tempo real",
  "Aprovação automática + e-mail de boas-vindas",
], C.azul);

featureCard(M + col2w + 10, y - (14*5 + 28 + 10 + 8), col2w, "🔑", "Login & Segurança", [
  "Autenticação JWT com refresh automático",
  "Criptografia bcryptjs nas senhas",
  "Recuperação de senha por e-mail (link seguro)",
  "Sessão persistente no navegador",
  "Proteção de rotas por perfil (médico / admin)",
], C.azulMed);

y = divider(y);
y = sectionHeader(y, "02  Gestão de Pacientes", "Cadastro completo e histórico longitudinal centralizado", C.verde);

const cols3 = (CW - 20) / 3;
const startY2 = y;
const h1 = featureCard(M, y, cols3, "👤", "Dados do Paciente", [
  "Nome, data de nascimento, sexo",
  "CPF, contato (telefone + e-mail)",
  "Endereço completo",
  "Peso, altura, IMC automático",
  "Lateralidade dominante",
], C.verde);

const h2 = featureCard(M + cols3 + 10, startY2, cols3, "📋", "Avaliação Clínica Inicial", [
  "Score de Beighton (frouxidão ligamentar)",
  "Nível de atividade (Tegner pré-op)",
  "Ocupação e esporte principal",
  "Histórico de cirurgias anteriores",
  "Alergias e comorbidades",
], C.verde);

featureCard(M + (cols3 + 10) * 2, startY2, cols3, "🔗", "Link do Paciente", [
  "QR code individual por paciente",
  "Acesso autônomo via WhatsApp/e-mail",
  "Formulários de follow-up respondem online",
  "Sem necessidade de app no celular",
  "URL segura com token de uso único",
], C.verde);

y = Math.max(h1, h2) + 8;
y = divider(y);
y = sectionHeader(y, "03  Agenda Cirúrgica", "Organização visual de procedimentos agendados e rascunhos", C.lilas);

featureCard(M, y, col2w, "📅", "Calendário & Agendamentos", [
  "Visão mensal/semanal de cirurgias",
  "Criação de rascunho (draft) de cirurgia",
  "Edição e remoção de agendamentos",
  "Indicador visual de status (rascunho / finalizada)",
  "Filtros por período e status",
], C.lilas);

featureCard(M + col2w + 10, y, col2w, "📝", "Gestão de Drafts", [
  "Salva progresso parcial do wizard",
  "Retoma de qualquer etapa anterior",
  "Dados preservados entre sessões",
  "Notificação de cirurgias incompletas",
  "Descarte seguro com confirmação",
], C.lilas);

// Rodapé
y = H - 30;
rect(0, H - 18, W, 18, C.azul);
fill(C.branco);
doc.font("Helvetica").fontSize(7.5).text("DocKnee  ·  Material comercial confidencial  ·  dockneeapp.com", M, H - 13, { align: "center", width: CW });

// ═══════════════════════════════════════════════════════════════════════════
// PÁGINA 3 — WIZARD CIRÚRGICO
// ═══════════════════════════════════════════════════════════════════════════
doc.addPage();
rect(0, 0, W, H, C.branco);
rect(0, 0, W, 8, C.azul);

y = 28;
fill(C.azul);
doc.font("Helvetica-Bold").fontSize(22).text("DocKnee", M, y, { lineBreak: false });
fill(C.cinza);
doc.font("Helvetica").fontSize(10).text("Funcionalidades Completas da Plataforma", M + 110, y + 8, { lineBreak: false });
fill(C.amarelo);
doc.font("Helvetica-Bold").fontSize(9).text("Pág. 2 / 5", W - M - 50, y + 7, { lineBreak: false });
y += 40;

y = sectionHeader(y, "04  Wizard de Documentação Cirúrgica", "6 etapas guiadas — da indicação ao registro intraoperatório completo", C.vermelho);

// Steps
const steps = [
  { n:"Etapa 1", title:"Dados Básicos", icon:"📌", items:[
    "Seleção do paciente cadastrado",
    "Data e horário do procedimento",
    "Lado operado (Direito / Esquerdo / Bilateral)",
    "Hospital / clínica",
    "Diagnóstico principal (ACL, menisco, patela, etc.)",
  ]},
  { n:"Etapa 2", title:"Tipo de Caso & Exame Físico", icon:"🩺", items:[
    "Exame ligamentar: Lachman, Pivot Shift, Gaveta, ADER",
    "Instabilidade patelar: Dejour, Caton-Deschamps, TT-TG",
    "Meniscal: McMurray, Apley, Childress, linha articular",
    "Osteocondral: ICRS, tamanho, localização da lesão",
    "Fatores de risco LEAP (hiperfrouxidão, PTS, idade)",
  ]},
  { n:"Etapa 3", title:"Técnica Cirúrgica", icon:"🔧", items:[
    "LCA: enxerto, túneis, fixação, remanescente, bracing interno",
    "LCP/LCM/LCL: grau, técnica (Canuto, Larson, etc.)",
    "Menisco: sutura, fixação de raiz, meniscectomia, biológico",
    "Osteotomia: HTO / DFO / Dupla — tamanho e fixação",
    "Artroplastia: UKA/ATJ — Ahlbäck, implante, tecnologia",
    "Fratura: AO/OTA, Schatzker — fêmur distal, planalto, patela",
  ]},
  { n:"Etapa 4", title:"Algoritmos Clínicos", icon:"🧮", items:[
    "KRIRS — risco de falha e técnica para LCA",
    "PICS 2.0 — risco de instabilidade patelar",
    "LEAP Engine — indicação de reforço extra-articular",
    "Score de resultado calculado automaticamente",
  ]},
  { n:"Etapa 5", title:"Procedimentos Específicos", icon:"⚙️", items:[
    "MPFL: âncoras, fixação, tensão",
    "Trocleoplastia: técnica, profundidade do sulco",
    "TTO (osteotomia da tuberosidade): distância e fixação",
    "Mosaicoplastia: número e tamanho dos plugs",
    "Biológicos: PRP, membrana, scaffold",
  ]},
  { n:"Etapa 6", title:"Finalização", icon:"✅", items:[
    "Observações clínicas livres",
    "Resumo intraoperatório completo",
    "Geração do PDF do relatório cirúrgico",
    "Agendamento automático do follow-up (2 anos)",
    "Envio de notificação ao paciente",
  ]},
];

const stepW = (CW - 10) / 2;
let sx = M, sy = y;
for (let i = 0; i < steps.length; i++) {
  const s = steps[i];
  sy = featureCard(sx, sy, stepW, s.icon, `${s.n}: ${s.title}`, s.items, C.vermelho);
  if (i % 2 === 0) {
    sx = M + stepW + 10;
    sy -= (28 + s.items.length * 14 + 10 + 8);
  } else {
    sx = M;
  }
}

y = Math.max(sy, sy) + 10;
y = divider(y);

// Callout box
fill(C.verdeCla);
doc.roundedRect(M, y, CW, 52, 6).fill();
fill(C.verde);
doc.font("Helvetica-Bold").fontSize(10).text("💡  Diferenciais do Wizard", M + 14, y + 10);
fill(C.preto);
doc.font("Helvetica").fontSize(8.5).text(
  "O wizard adapta dinamicamente os campos exibidos ao diagnóstico selecionado — nenhum campo irrelevante é mostrado. " +
  "Toda a lógica de validação é Zod-based no backend, garantindo integridade clínica dos dados registrados. " +
  "O progresso é salvo em tempo real como rascunho, permitindo que o médico finalize o registro no pós-operatório imediato.",
  M + 14, y + 24, { width: CW - 28 }
);
y += 62;

// Rodapé
rect(0, H - 18, W, 18, C.azul);
fill(C.branco);
doc.font("Helvetica").fontSize(7.5).text("DocKnee  ·  Material comercial confidencial  ·  dockneeapp.com", M, H - 13, { align: "center", width: CW });

// ═══════════════════════════════════════════════════════════════════════════
// PÁGINA 4 — IA, RX, FOLLOW-UP, FISIO
// ═══════════════════════════════════════════════════════════════════════════
doc.addPage();
rect(0, 0, W, H, C.branco);
rect(0, 0, W, 8, C.azul);

y = 28;
fill(C.azul);
doc.font("Helvetica-Bold").fontSize(22).text("DocKnee", M, y, { lineBreak: false });
fill(C.cinza);
doc.font("Helvetica").fontSize(10).text("Funcionalidades Completas da Plataforma", M + 110, y + 8, { lineBreak: false });
fill(C.amarelo);
doc.font("Helvetica-Bold").fontSize(9).text("Pág. 3 / 5", W - M - 50, y + 7, { lineBreak: false });
y += 40;

y = sectionHeader(y, "05  Planejamento RX com Inteligência Artificial", "Análise automática de RX panorâmico — alinhamento mecânico e planejamento de osteotomia", C.azulMed);

const rxCards = [
  featureCard(M, y, cols3, "🤖", "Análise por IA (Gemini)", [
    "Upload de RX panorâmico (JPG, PNG, HEIC)",
    "Medição automática: HKA, mLDFA, aMPTA, JLCA",
    "MAD (distância eixo mecânico) e WBL",
    "Detecção de varo / valgo / neutro",
    "Identificação do nível da deformidade",
  ], C.azulMed),
  featureCard(M + cols3 + 10, y, cols3, "📐", "Marcações do Cirurgião", [
    "Confirmação manual de HKA, mLDFA, aMPTA",
    "Marcação de eixo anatômico femoral (AMA)",
    "Divergência tibial para bowing diafisário",
    "Compatível com touch (tablet/celular)",
    "Recalcula plano instantaneamente após marca",
  ], C.azulMed),
  featureCard(M + (cols3 + 10) * 2, y, cols3, "🦴", "Planejamento de Osteotomia", [
    "HTO valgizante — abertura / fechamento medial",
    "DFO varizante — abertura / fechamento lateral",
    "Dupla osteotomia — distribuição proporcional",
    "Cunha calculada por fórmula de Paley/Noyes",
    "Algoritmo JLCA correction phenomenon",
  ], C.azulMed),
];
y = Math.max(...rxCards);

y = featureCard(M, y, col2w, "📊", "Resultados Gerados", [
  "Origem da deformidade: femoral / tibial / mista",
  "Ângulo de correção necessário (°)",
  "Tamanho da cunha (mm) — tibial e femoral",
  "WBL pré e pós-operatório estimado (%)",
  "Alertas clínicos: JLCA, bowing, sobrecorreção",
  "PDF do planejamento para impressão",
], C.azulMed);

featureCard(M + col2w + 10, y - (28 + 6*14 + 10 + 8), col2w, "⚙️", "Configurações & Cache", [
  "Estratégia de correção: neutro ou Fujisawa (62%)",
  "WBL alvo ajustável pelo cirurgião",
  "Cache inteligente — IA não reprocessa mesma imagem",
  "Formulário Paley de reconciliação automática",
  "Compatível com HEIC (iPhone)",
], C.azulMed);

y = divider(y);
y = sectionHeader(y, "06  Follow-up Automatizado & PROMs", "Acompanhamento de 2 anos — escalas validadas enviadas automaticamente ao paciente", C.verde);

featureCard(M, y, cols3, "📲", "Envio Automático", [
  "WhatsApp + e-mail com link personalizado",
  "Cronograma: 15d, 45d, 3m, 6m, 1 ano, 2 anos",
  "Lembretes automáticos de follow-up",
  "WhatsApp Central para broadcasts",
  "Histórico de envios e confirmações",
], C.verde);

featureCard(M + cols3 + 10, y, cols3, "📏", "Escalas Integradas", [
  "IKDC — função geral do joelho",
  "KOOS — osteoartrite e recuperação",
  "Lysholm — atividade e sintomas",
  "Tegner — nível de atividade esportiva",
  "Kujala — instabilidade patelar",
  "VAS Dor, ACL-RSI, Marx, WOMAC",
], C.verde);

featureCard(M + (cols3 + 10) * 2, y, cols3, "📈", "Dashboard de Resultados", [
  "Evolução temporal por escala e paciente",
  "Comparativo pré × pós-operatório",
  "Gráficos de tendência por procedimento",
  "Exportação de dados para publicações",
  "Compliance de resposta do paciente",
], C.verde);

y += 28 + 6*14 + 10 + 8;
y = divider(y);
y = sectionHeader(y, "07  Módulo de Fisioterapia", "Portal dedicado ao fisioterapeuta com acesso ao protocolo e prontuário de reabilitação", C.lilas);

featureCard(M, y, col2w, "🏃", "Prontuário de Reabilitação", [
  "Evolução de sessões com data e anotações",
  "Testes funcionais (FMS, força, ADM)",
  "Protocolos de reabilitação por cirurgia",
  "Linha do tempo de recuperação",
  "Acesso ao relatório cirúrgico original",
], C.lilas);

featureCard(M + col2w + 10, y, col2w, "🤝", "Convite & Colaboração", [
  "Médico convida fisio por e-mail ou link",
  "Fisio acessa somente seus pacientes",
  "Comunicação assíncrona médico–fisio",
  "Paywall: plano Premium libera módulo",
  "Dashboard do fisio com agenda de sessões",
], C.lilas);

// Rodapé
rect(0, H - 18, W, 18, C.azul);
fill(C.branco);
doc.font("Helvetica").fontSize(7.5).text("DocKnee  ·  Material comercial confidencial  ·  dockneeapp.com", M, H - 13, { align: "center", width: CW });

// ═══════════════════════════════════════════════════════════════════════════
// PÁGINA 5 — ADMIN, RELATÓRIOS, PLANOS, DIFERENCIAIS
// ═══════════════════════════════════════════════════════════════════════════
doc.addPage();
rect(0, 0, W, H, C.branco);
rect(0, 0, W, 8, C.azul);

y = 28;
fill(C.azul);
doc.font("Helvetica-Bold").fontSize(22).text("DocKnee", M, y, { lineBreak: false });
fill(C.cinza);
doc.font("Helvetica").fontSize(10).text("Funcionalidades Completas da Plataforma", M + 110, y + 8, { lineBreak: false });
fill(C.amarelo);
doc.font("Helvetica-Bold").fontSize(9).text("Pág. 4 / 5", W - M - 50, y + 7, { lineBreak: false });
y += 40;

y = sectionHeader(y, "08  Dashboards & Relatórios", "Métricas individuais e agregadas — do consultório à publicação científica", [21, 128, 61]);

featureCard(M, y, col2w, "👨‍⚕️", "Dashboard do Médico", [
  "Contagem total de cirurgias realizadas",
  "Distribuição por diagnóstico e procedimento",
  "Taxa de complicações e reoperações",
  "Evolução de resultados funcionais (PROMs)",
  "Gráficos interativos com filtros de período",
  "Cards de KPIs: pacientes, cirurgias, follow-ups",
], [21, 128, 61]);

featureCard(M + col2w + 10, y, col2w, "🏛️", "Dashboard Administrativo", [
  "Dados agregados de todos os médicos",
  "Filtros por técnica, hospital, período",
  "Exportação CSV / Excel para pesquisa",
  "Gestão de usuários e assinaturas",
  "Aprovação de novos cadastros",
  "Métricas de uso da plataforma",
], [21, 128, 61]);

y += 28 + 6*14 + 10 + 8;

featureCard(M, y, cols3, "📄", "PDF Cirúrgico", [
  "Relatório completo do ato operatório",
  "Todos os dados do wizard inclusos",
  "Layout profissional com logo DocKnee",
  "Compartilhamento via WhatsApp / e-mail",
  "Gerado em segundos, sem internet adicional",
], [21, 128, 61]);

featureCard(M + cols3 + 10, y, cols3, "📊", "PDF de Follow-up", [
  "Evolução das escalas ao longo do tempo",
  "Comparativo pré × pós em tabela",
  "Ideal para consultas de retorno",
  "Histórico de todos os follow-ups",
  "Exportação individual por paciente",
], [21, 128, 61]);

featureCard(M + (cols3 + 10) * 2, y, cols3, "🔬", "Dados para Publicação", [
  "Exportação anonimizada de base de dados",
  "Compatível com SPSS/Excel/R",
  "Consentimento LGPD integrado",
  "Logs de auditoria por acesso",
  "Backup automático criptografado",
], [21, 128, 61]);

y += 28 + 5*14 + 10 + 18;
y = divider(y);
y = sectionHeader(y, "09  Planos & Monetização", "Modelo de assinatura acessível para médicos em qualquer fase da carreira", C.amarelo);

const planW = (CW - 20) / 3;
// Plan 1 — Free
rect(M, y, planW, 130, C.cinzaFd, 8);
rect(M, y, planW, 8, C.cinza, 8);
fill(C.cinza);
doc.font("Helvetica-Bold").fontSize(10).text("GRATUITO", M, y + 16, { width: planW, align: "center" });
fill(C.preto);
doc.font("Helvetica").fontSize(8);
const freeItems = ["Até 5 pacientes", "Wizard completo", "Algoritmos KRIRS/PICS", "PDF cirúrgico"];
freeItems.forEach((item, i) => doc.text(`✓  ${item}`, M + 10, y + 34 + i * 15, { lineBreak: false }));

// Plan 2 — Pro
rect(M + planW + 10, y, planW, 130, C.azulCla, 8);
rect(M + planW + 10, y, planW, 8, C.azul, 8);
fill(C.azul);
doc.font("Helvetica-Bold").fontSize(10).text("PROFISSIONAL", M + planW + 10, y + 16, { width: planW, align: "center" });
fill(C.preto);
doc.font("Helvetica").fontSize(8);
const proItems = ["Pacientes ilimitados", "Follow-up automático (PROMs)", "Planejamento RX com IA", "Dashboards avançados"];
proItems.forEach((item, i) => doc.text(`✓  ${item}`, M + planW + 20, y + 34 + i * 15, { lineBreak: false }));

// Plan 3 — Premium
rect(M + (planW + 10) * 2, y, planW, 130, C.lilasC, 8);
rect(M + (planW + 10) * 2, y, planW, 8, C.lilas, 8);
fill(C.lilas);
doc.font("Helvetica-Bold").fontSize(10).text("PREMIUM", M + (planW + 10) * 2, y + 16, { width: planW, align: "center" });
fill(C.preto);
doc.font("Helvetica").fontSize(8);
const premItems = ["Tudo do Profissional", "Módulo Fisioterapia", "Admin dashboard", "Exportação para publicações"];
premItems.forEach((item, i) => doc.text(`✓  ${item}`, M + (planW + 10) * 2 + 10, y + 34 + i * 15, { lineBreak: false }));

y += 145;
y = divider(y);

// Diferenciais tecnológicos
fill(C.azul);
doc.font("Helvetica-Bold").fontSize(12).text("10  Stack Tecnológico & Segurança", M, y);
y += 20;

const techItems = [
  ["🔒", "Dados criptografados", "HTTPS/TLS + bcryptjs + tokens JWT de curta duração"],
  ["☁️", "Infraestrutura cloud", "PostgreSQL gerenciado + backups automáticos + alta disponibilidade"],
  ["📱", "Responsivo & mobile", "Interface adaptativa — funciona em tablet e celular no centro cirúrgico"],
  ["⚡", "Tempo real", "Atualizações instantâneas sem reload — React Query + Vite + Express 5"],
  ["🇧🇷", "100% LGPD compliant", "Anonimização, logs de auditoria, consentimento explícito, dados no Brasil"],
  ["🔗", "Integrações", "Stripe (pagamentos), Gmail SMTP, WhatsApp Business, Google Gemini AI"],
];

techItems.forEach((item, i) => {
  const tx = M + (i % 2) * (col2w + 10);
  const ty = y + Math.floor(i / 2) * 22;
  fill(C.azulCla);
  doc.roundedRect(tx, ty - 2, col2w, 18, 3).fill();
  fill(C.azul);
  doc.font("Helvetica-Bold").fontSize(8).text(`${item[0]}  ${item[1]}`, tx + 8, ty + 3, { lineBreak: false });
  fill(C.cinza);
  doc.font("Helvetica").fontSize(7.5).text(item[2], tx + 8 + doc.widthOfString(`${item[0]}  ${item[1]}`) + 6, ty + 3.5, { lineBreak: false });
});

// Rodapé final
rect(0, H - 18, W, 18, C.azul);
fill(C.branco);
doc.font("Helvetica").fontSize(7.5).text("DocKnee  ·  Material comercial confidencial  ·  dockneeapp.com", M, H - 13, { align: "center", width: CW });

// ═══════════════════════════════════════════════════════════════════════════
// PÁGINA 6 — CONTATO & CTA
// ═══════════════════════════════════════════════════════════════════════════
doc.addPage();
rect(0, 0, W, H, [0, 45, 100]);
rect(0, 0, W, 4, C.amarelo);

doc.save();
doc.fillOpacity(0.07);
fill(C.branco);
doc.circle(W - 60, 200, 200).fill();
doc.circle(60, H - 100, 150).fill();
doc.fillOpacity(1);
doc.restore();

fill(C.amarelo);
doc.font("Helvetica-Bold").fontSize(9).text("Pág. 5 / 5", W - M - 50, 30, { lineBreak: false });

fill(C.branco);
doc.font("Helvetica-Bold").fontSize(36).text("Pronto para transformar\nsua documentação cirúrgica?", M, 120, { width: CW });

fill([180, 210, 255]);
doc.font("Helvetica").fontSize(13).text(
  "Experimente o DocKnee gratuitamente e veja como a plataforma se adapta à sua rotina cirúrgica.",
  M, 240, { width: CW - 60 }
);

// CTA Button simulado
fill(C.amarelo);
doc.roundedRect(M, 305, 200, 44, 8).fill();
fill([0, 40, 90]);
doc.font("Helvetica-Bold").fontSize(13).text("Criar conta grátis", M, 318, { width: 200, align: "center" });

fill([200, 220, 255]);
doc.font("Helvetica").fontSize(10).text("dockneeapp.com", M + 215, 320, { lineBreak: false });

// Contatos
y = 400;
fill(C.branco);
doc.font("Helvetica-Bold").fontSize(14).text("Entre em contato", M, y);
y += 30;

const contacts = [
  ["🌐", "Site oficial", "dockneeapp.com"],
  ["📧", "E-mail comercial", "comercial@docknee.com.br"],
  ["💬", "WhatsApp", "+55 (27) 9 9999-9999"],
  ["📸", "Instagram", "@docknee"],
];

contacts.forEach((c) => {
  fill([180, 210, 255]);
  doc.font("Helvetica-Bold").fontSize(10).text(c[0] + "  " + c[1] + ":", M, y);
  fill(C.branco);
  doc.font("Helvetica").fontSize(10).text(c[2], M + 150, y);
  y += 22;
});

// Assinatura final
rect(M, H - 120, CW, 1, [70, 110, 170]);
fill([140, 175, 220]);
doc.font("Helvetica").fontSize(8).text(
  "© 2024–2025 DocKnee. Todos os direitos reservados. Este material é confidencial e destinado exclusivamente a " +
  "campanhas de marketing e apresentações comerciais. Reprodução proibida sem autorização.",
  M, H - 110, { width: CW, align: "center" }
);

doc.end();
console.log("PDF gerado em:", OUT);
