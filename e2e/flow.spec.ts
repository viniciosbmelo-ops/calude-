/**
 * Fluxo completo pela interface: login → paciente → episódio → cirurgia com 3 procedimentos
 * (critério do Prompt 4) → mapa → implante → relatório → assinatura → verificação pública → PDF.
 */
import { expect, Page, test } from '@playwright/test';

const shots = process.env.E2E_SHOTS;
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${test.info().project.name}-${name}.png`, fullPage: true });
}
const chip = (page: Page, scope: string, text: string) => page.locator(`[data-field="${scope}"]`).getByRole('button', { name: text, exact: true });

test('registro cirúrgico completo até a assinatura', async ({ page }) => {
  const uniq = `${test.info().project.name}-${Date.now()}`;

  // login de desenvolvimento
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('E-mail').fill(`cirurgiao-${uniq}@exemplo.com`);
  await page.getByLabel('Nome completo (sai no relatório)').fill('Dr. Teste E2E');
  await page.getByLabel('CRM').fill('12345-ES');
  await shot(page, '01-login');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Pacientes' })).toBeVisible();

  // paciente
  await page.getByRole('button', { name: '+ Novo paciente' }).click();
  await page.getByLabel('Nome completo').fill(`Paciente ${uniq}`);
  await page.getByLabel('Prontuário').fill('E2E-1');
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  await expect(page.getByRole('heading', { name: `Paciente ${uniq}` })).toBeVisible();

  // episódio: manguito + bíceps + artrose AC
  await page.getByRole('button', { name: '+ Novo episódio' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: 'Direito' }).click();
  await dlg.getByRole('button', { name: 'Sim' }).click();
  await dlg.getByRole('option', { name: /^Lesão do manguito rotador/ }).click();
  await dlg.getByRole('button', { name: '+ Adicionar' }).click();
  await dlg.getByRole('button', { name: 'Lesão do cabo longo do bíceps', exact: true }).click();
  await dlg.getByRole('button', { name: 'Artrose acromioclavicular', exact: true }).click();
  await shot(page, '02-episodio');
  await dlg.getByRole('button', { name: 'Criar episódio' }).click();
  await expect(page.getByRole('heading', { name: 'Lesão do manguito rotador' })).toBeVisible();

  // cirurgia
  await page.getByRole('button', { name: '+ Nova cirurgia' }).click();
  await expect(page.getByRole('heading', { name: 'Dados gerais da cirurgia' })).toBeVisible();
  await chip(page, 'positioning', 'cadeira de praia').click();
  await chip(page, 'anesthesia.type', 'anestesia geral associada a bloqueio').click();
  await chip(page, 'approach', 'artroscópica').click();
  // diagnóstico pós-operatório
  const post = page.locator('[data-field="postop_dx"]');
  await post.getByRole('button', { name: '+ Adicionar' }).click();
  await post.getByRole('button', { name: 'Rotura completa do manguito rotador' }).click();
  await post.getByRole('button', { name: 'Lesão do cabo longo do bíceps', exact: true }).click();
  await post.getByRole('button', { name: 'Artrose acromioclavicular', exact: true }).click();
  await page.locator('[data-field="start_time"] input').fill('2026-09-23T10:00');
  await page.locator('[data-field="end_time"] input').fill('2026-09-23T11:25');
  await expect(page.locator('.field.missing')).toHaveCount(0);
  await expect(page.getByText('Salvo', { exact: true })).toBeVisible();
  await shot(page, '03-nucleo');

  // mapa artroscópico
  await page.getByRole('button', { name: /Próximo: mapa/ }).click();
  await page.getByRole('group', { name: 'supraespinal (face articular)' }).getByRole('button', { name: 'Tratada' }).click();
  await page.getByRole('group', { name: 'cabo longo do bíceps intra-articular' }).getByRole('button', { name: 'Lesão' }).click();
  await page.getByRole('button', { name: 'Marcar restantes como normais' }).click();
  await expect(page.getByText('Salvo', { exact: true })).toBeVisible();
  await shot(page, '04-mapa');

  // procedimentos
  await page.getByRole('button', { name: /Próximo: procedimentos/ }).click();
  for (const name of ['Rotura completa do manguito rotador', 'Lesão do cabo longo do bíceps', 'Artrose acromioclavicular']) {
    await page.getByRole('button', { name: '+ Procedimento' }).click();
    await page.getByRole('dialog').getByRole('button', { name: new RegExp(name) }).first().click();
  }
  const procs = page.locator('.proc');
  await expect(procs).toHaveCount(3);

  // 1) manguito: SSC torna Lafosse obrigatório; rotura total exige tamanho
  const rct = procs.nth(0);
  await rct.locator('[data-field="tendons"]').getByRole('button', { name: 'supraespinal' }).click();
  await rct.locator('[data-field="tendons"]').getByRole('button', { name: 'subescapular' }).click();
  await expect(rct.locator('[data-field="lafosse_ssc"].missing')).toBeVisible();
  await rct.locator('[data-field="lafosse_ssc"]').getByRole('button', { name: 'I', exact: true }).click();
  await rct.locator('[data-field="tear_type"]').getByRole('button', { name: 'de espessura total' }).click();
  await expect(rct.locator('[data-field="size_ap_mm"].missing')).toBeVisible();
  await shot(page, '05-condicional');
  await rct.locator('[data-field="size_ap_mm"] input').fill('28');
  await rct.locator('[data-field="patte"]').getByRole('button', { name: '2', exact: true }).click();
  await rct.locator('[data-field="tissue_quality"]').getByRole('button', { name: 'regular' }).click();
  await rct.locator('[data-field="mobility"]').getByRole('button', { name: 'redutível ao footprint com tensão' }).click();
  await rct.locator('[data-field="procedure"]').getByRole('button', { name: 'dupla fileira' }).click();
  await rct.locator('[data-field="medial_row_anchors"] input').fill('2');
  await rct.locator('[data-field="lateral_row_anchors"] input').fill('2');
  await rct.locator('[data-field="suture_config"]').getByRole('button', { name: 'sem nós mediais' }).click();
  await rct.locator('[data-field="repair_coverage"]').getByRole('button', { name: 'completa' }).click();
  await rct.locator('[data-field="repair_tension"]').getByRole('button', { name: 'aceitável' }).click();
  await expect(rct.getByText('completo')).toBeVisible();

  // 2) bíceps: tenodese
  const bic = procs.nth(1);
  await bic.locator('[data-field="procedure"]').getByRole('button', { name: 'tenodese do cabo longo do bíceps' }).click();
  await bic.locator('[data-field="tenodesis_site"]').getByRole('button', { name: 'suprapeitoral artroscópica' }).click();
  await bic.locator('[data-field="tenodesis_fixation"]').getByRole('button', { name: 'âncora' }).click();
  await expect(bic.getByText('completo')).toBeVisible();

  // 3) ressecção da clavícula distal
  const ac = procs.nth(2);
  await ac.locator('[data-field="procedure"]').getByRole('button', { name: 'ressecção da extremidade distal da clavícula' }).click();
  await expect(ac.locator('[data-field="resection_mm"].missing')).toBeVisible();
  await ac.locator('[data-field="resection_mm"] input').fill('7,5');
  await expect(ac.getByText('completo')).toBeVisible();
  await expect(page.locator('.saved.saving')).toHaveCount(0, { timeout: 15_000 });
  await shot(page, '06-procedimentos');

  // implante por código GS1 digitado
  await page.getByRole('button', { name: /Próximo: implantes/ }).click();
  await page.getByRole('button', { name: '+ Implante' }).click();
  const im = page.getByRole('dialog');
  await im.getByLabel('Código GS1').fill('(01)00888867123458(17)281231(10)LOT-A77(21)SN0001');
  await im.getByLabel('Código GS1').blur();
  await expect(im.getByText(/Lido: GTIN 00888867123458/)).toBeVisible();
  await im.getByLabel('Fabricante *').fill('Fabricante A');
  await im.getByLabel('Modelo *').fill('Âncora knotless');
  await im.getByLabel('Tamanho').fill('4,75 mm');
  await im.getByLabel('Quantidade').fill('2');
  await im.getByRole('button', { name: 'Registrar' }).click();
  await expect(page.getByRole('cell', { name: /Fabricante A Âncora knotless/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: /LOT-A77/ })).toBeVisible();

  // relatório
  await page.getByRole('button', { name: /Próximo: relatório/ }).click();
  await page.getByRole('button', { name: 'Gerar relatório' }).click();
  const text = page.getByLabel('Texto do relatório');
  await expect(text).toHaveValue(/Paciente: Paciente .* — Prontuário E2E-1/);
  await expect(text).toHaveValue(/Cirurgião: Dr\. Teste E2E \(CRM 12345-ES\)/);
  await expect(text).toHaveValue(/2× Fabricante A Âncora knotless \(4,75 mm\) — lote LOT-A77/);
  await expect(text).toHaveValue(/1\. Rotura completa do manguito rotador[\s\S]*2\. Lesão do cabo longo do bíceps[\s\S]*3\. Artrose acromioclavicular/);

  // edição manual → diff
  await text.fill((await text.inputValue()).replace('PROCEDIMENTOS', 'PROCEDIMENTOS REALIZADOS'));
  await expect(page.getByRole('button', { name: /Ver alterações \(2\)/ })).toBeVisible({ timeout: 15_000 });

  // checklist: lesão sem conduta gera aviso → exige confirmação
  await page.reload();
  await expect(page.getByText(/sem conduta documentada/)).toBeVisible();
  const sign = page.getByRole('button', { name: 'Assinar relatório' });
  await expect(sign).toBeDisabled();
  await page.getByLabel('Confirmo que revisei os avisos acima.').check();
  await shot(page, '07-checklist');
  await sign.click();
  await expect(page.getByText('assinado', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Seguimento agendado' })).toBeVisible();
  await shot(page, '08-assinado');

  // após assinar, registro travado
  await page.getByRole('button', { name: /Procedimentos/ }).click();
  await expect(page.getByText(/Relatório assinado: o registro está travado/)).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Procedimento' })).toHaveCount(0);

  // verificação pública e PDF
  await page.getByRole('button', { name: /Relatório/ }).click();
  const verify = page.getByRole('link', { name: 'verificar' });
  const href = await verify.getAttribute('href');
  const pub = await page.context().newPage();
  await pub.goto(href!);
  await expect(pub.getByRole('heading', { name: 'Assinatura válida' })).toBeVisible();
  await expect(pub.locator('body')).not.toContainText('Paciente');
  const pdf = await page.request.get(page.url().replace(/\/cirurgias.*/, '') + '/api/reports/x/pdf').catch(() => null);
  expect(pdf?.status()).toBe(401); // sem token não há PDF

  // seguimento aparece na agenda
  await page.getByRole('link', { name: 'Seguimento' }).click();
  await page.getByRole('button', { name: 'Todos' }).click();
  await expect(page.getByRole('cell', { name: '6 semanas' }).first()).toBeVisible();
  await shot(page, '09-agenda');
});

test('paciente responde SANE por link de uso único', async ({ page, browser }) => {
  const uniq = `${test.info().project.name}-${Date.now()}`;
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(`sane-${uniq}@exemplo.com`);
  await page.getByLabel('Nome completo (sai no relatório)').fill('Dra. SANE');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('button', { name: '+ Novo paciente' }).click();
  await page.getByLabel('Nome completo').fill(`Paciente SANE ${uniq}`);
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  await page.getByRole('button', { name: '+ Novo episódio' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: 'Esquerdo' }).click();
  await dlg.getByRole('button', { name: 'Não' }).click();
  await dlg.getByRole('option', { name: /^Instabilidade glenoumeral anterior/ }).click();
  await dlg.getByRole('button', { name: 'Criar episódio' }).click();

  // diagnóstico sem TC → painel não estima perda óssea
  await page.getByRole('tab', { name: 'Diagnóstico' }).click();
  await page.locator('[data-field="event_type"]').getByRole('button', { name: /luxação/i }).first().click();
  await page.locator('[data-field="episodes"]').getByRole('button').first().click();
  await page.locator('[data-field="ct_available"]').getByRole('button', { name: 'Não' }).click();
  await page.getByRole('button', { name: 'Salvar avaliação' }).click();
  await expect(page.getByText('Perda óssea não quantificada por TC.')).toBeVisible();
  await expect(page.getByText(/recomend|indicado/i)).toHaveCount(0);
  await shot(page, '10-instabilidade');

  await page.getByRole('tab', { name: 'Escores e seguimento' }).click();
  await page.getByRole('button', { name: 'Enviar SANE ao paciente' }).click();
  await page.getByRole('button', { name: 'Gerar link' }).click();
  const url = await page.getByLabel('Link').inputValue();
  expect(url).toMatch(/\/p\/[A-Za-z0-9_-]{43}$/);
  await page.getByRole('button', { name: 'Concluir' }).click();

  const patient = await browser.newPage();
  await patient.goto(url);
  await expect(patient.getByRole('heading', { name: 'Avaliação da sua articulação' })).toBeVisible();
  await patient.getByLabel('Nota digitada').fill('72');
  await shot(patient, '11-paciente');
  await patient.getByRole('button', { name: 'Enviar resposta' }).click();
  await expect(patient.getByRole('heading', { name: 'Obrigado!' })).toBeVisible();
  await patient.reload();
  await expect(patient.getByRole('heading', { name: 'Obrigado!' })).toBeVisible(); // uso único

  await page.reload();
  await page.getByRole('tab', { name: 'Escores e seguimento' }).click();
  await expect(page.getByRole('cell', { name: '72/100' })).toBeVisible();
  await expect(page.getByText('respondido')).toBeVisible();
});
