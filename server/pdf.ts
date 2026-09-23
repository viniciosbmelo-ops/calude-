/**
 * PDF do relatório: texto final, hash e QR para /verify/:hash.
 * O PDF é uma apresentação do texto assinado — a prova de integridade é o hash, não o arquivo.
 */
import * as path from 'path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

const FONT_DIR = path.join(__dirname, 'assets', 'fonts');

export interface PdfReport {
  final_text: string;
  version: number;
  supersedes: string | null;
  signed_at: string | null;
  content_hash: string | null;
}

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(iso));

/** Linha toda em maiúsculas = título de seção do motor de relatório. */
const isHeading = (l: string) => l.length > 3 && l === l.toUpperCase() && /[A-ZÀ-Ú]/.test(l) && !/[.:;]$/.test(l);

export async function renderReportPdf(r: PdfReport, verifyUrl: string | null): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 64, left: 56, right: 56 }, bufferPages: true, info: { Title: 'Relatório cirúrgico', Creator: 'DocSholder' } });
  if (r.signed_at) doc.info.CreationDate = new Date(r.signed_at);
  doc.registerFont('body', path.join(FONT_DIR, 'DejaVuSans.ttf'));
  doc.registerFont('bold', path.join(FONT_DIR, 'DejaVuSans-Bold.ttf'));
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const width = doc.page.width - 112;
  doc.font('bold').fontSize(14).text('RELATÓRIO CIRÚRGICO', { align: 'center' });
  doc.font('body').fontSize(8.5).fillColor('#555')
    .text(`Versão ${r.version}${r.supersedes ? ' — substitui a versão anterior' : ''}`, { align: 'center' })
    .fillColor('#000').moveDown(1);

  for (const line of r.final_text.replace(/\n+$/, '').split('\n')) {
    if (line.trim() === '') { doc.moveDown(0.5); continue; }
    // Título não fica sozinho no pé da página
    if (isHeading(line) && doc.y > doc.page.height - doc.page.margins.bottom - 60) doc.addPage();
    if (isHeading(line)) doc.moveDown(0.3).font('bold').fontSize(10.5).text(line, { width }).moveDown(0.15);
    else doc.font('body').fontSize(10).text(line, { width, align: 'left', lineGap: 1.5 });
  }

  // Bloco de assinatura
  doc.moveDown(1.2);
  if (doc.y > doc.page.height - 190) doc.addPage();
  const top = doc.y;
  doc.moveTo(56, top).lineTo(56 + width, top).strokeColor('#999').lineWidth(0.5).stroke();
  if (r.signed_at && r.content_hash) {
    const qrSize = 92;
    if (verifyUrl) {
      const png = await QRCode.toBuffer(verifyUrl, { errorCorrectionLevel: 'M', margin: 0, width: qrSize * 3 });
      doc.image(png, 56 + width - qrSize, top + 10, { width: qrSize });
    }
    const tw = width - qrSize - 16;
    doc.font('bold').fontSize(9.5).text('Assinado eletronicamente', 56, top + 10, { width: tw });
    doc.font('body').fontSize(8.5).text(`Data/hora (servidor): ${fmtDate(r.signed_at)}`, { width: tw });
    doc.text('Hash SHA-256 do conteúdo:', { width: tw });
    doc.fontSize(7.5).text(r.content_hash, { width: tw });
    if (verifyUrl) doc.fontSize(8).fillColor('#555').text('Verifique pelo QR ou em:', { width: tw }).text(verifyUrl, { width: tw }).fillColor('#000');
    doc.y = Math.max(doc.y, top + 10 + qrSize);
  } else {
    doc.font('bold').fontSize(10).fillColor('#b00').text('RASCUNHO — NÃO ASSINADO. Sem validade como documento.', 56, top + 10, { width }).fillColor('#000');
  }

  // Rodapé e marca d'água em todas as páginas
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    if (!r.signed_at) {
      doc.save().rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] })
        .font('bold').fontSize(64).fillColor('#d33').fillOpacity(0.12)
        .text('RASCUNHO', 0, doc.page.height / 2 - 40, { width: doc.page.width, align: 'center', lineBreak: false })
        .restore().fillOpacity(1).fillColor('#000');
    }
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('body').fontSize(7.5).fillColor('#777')
      .text(`Página ${i - range.start + 1} de ${range.count}`, 56, doc.page.height - 40, { width, align: 'right', lineBreak: false })
      .fillColor('#000');
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return done;
}
