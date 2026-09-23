import { ClinicalGuardError } from '../src/clinical/errors';
import { evaluateInstabilityMetrics, glenoidBoneLossPct, glenoidTrack, isisScore, trackStatus } from '../src/clinical/instability/metrics';

describe('SH_INST_ANT_METRICS', () => {
  test('D=28, d=5 → perda 17,9% e GT 18,2 mm', () => {
    expect(glenoidBoneLossPct(28, 5)).toBe(17.9);
    expect(glenoidTrack(28, 5)).toBe(18.2);
  });
  test('HSI 20 > GT 18,2 → off-track, margem −1,8', () => {
    expect(trackStatus(18.2, 20)).toEqual({ track: 'off_track', margin_mm: -1.8 });
  });
  test('HSI = GT → on-track (igualdade)', () => {
    expect(trackStatus(18.2, 18.2)).toEqual({ track: 'on_track', margin_mm: 0 });
  });
  test('d ≥ D → ClinicalGuardError G1', () => {
    expect(() => glenoidTrack(28, 30)).toThrow(ClinicalGuardError);
    try { glenoidTrack(28, 28); } catch (e) { expect((e as ClinicalGuardError).code).toBe('G1'); }
  });
  test('D em cm (2,8) → G2', () => {
    try { glenoidBoneLossPct(2.8, 0.5); fail('deveria lançar'); } catch (e) { expect((e as ClinicalGuardError).code).toBe('G2'); }
  });
  test('d negativo → G1', () => {
    expect(() => glenoidBoneLossPct(28, -1)).toThrow(/negativo/);
  });
  test('HSI implausível → G3', () => {
    try { trackStatus(18, 60); fail('deveria lançar'); } catch (e) { expect((e as ClinicalGuardError).code).toBe('G3'); }
  });
  test('NaN → NOT_A_NUMBER', () => {
    expect(() => glenoidTrack(NaN, 2)).toThrow(ClinicalGuardError);
  });
  test('ISIS: 19a, competitivo, contato, sem hiperfrouxidão, HS visível, contorno íntegro = 7', () => {
    const r = isisScore({ age_at_surgery: 19, sport_competitive: true, sport_contact_or_forced_overhead: true, hyperlaxity: false, hs_visible_ap_er: true, glenoid_contour_loss_ap: false });
    expect(r.total).toBe(7);
  });
  test('ISIS máximo = 10 e mínimo = 0', () => {
    expect(isisScore({ age_at_surgery: 18, sport_competitive: true, sport_contact_or_forced_overhead: true, hyperlaxity: true, hs_visible_ap_er: true, glenoid_contour_loss_ap: true }).total).toBe(10);
    expect(isisScore({ age_at_surgery: 21, sport_competitive: false, sport_contact_or_forced_overhead: false, hyperlaxity: false, hs_visible_ap_er: false, glenoid_contour_loss_ap: false }).total).toBe(0);
  });
  test('ISIS: 20 anos pontua, 21 não', () => {
    const base = { sport_competitive: false, sport_contact_or_forced_overhead: false, hyperlaxity: false, hs_visible_ap_er: false, glenoid_contour_loss_ap: false };
    expect(isisScore({ ...base, age_at_surgery: 20 }).total).toBe(2);
    expect(isisScore({ ...base, age_at_surgery: 21 }).total).toBe(0);
  });
  test('ISIS idade implausível → G4', () => {
    expect(() => isisScore({ age_at_surgery: 150, sport_competitive: false, sport_contact_or_forced_overhead: false, hyperlaxity: false, hs_visible_ap_er: false, glenoid_contour_loss_ap: false })).toThrow(ClinicalGuardError);
  });
  test('avaliação completa com flag subcrítica e sem recomendações', () => {
    const r = evaluateInstabilityMetrics({ D_mm: 28, d_mm: 5, hsi_mm: 20 }, { age_at_surgery: 19, sport_competitive: true, sport_contact_or_forced_overhead: true, hyperlaxity: false, hs_visible_ap_er: true, glenoid_contour_loss_ap: false });
    expect(r.outputs_are_recommendations).toBe(false);
    expect(r).toMatchObject({ gbl_pct: 17.9, gt_mm: 18.2, track: 'off_track', margin_mm: -1.8, isis: 7, missing: [] });
    expect(r.flags.map((f) => f.id)).toEqual(['I4_FLAG_SUBCRITICAL']);
  });
  test('perda < 13,5% não gera flag', () => {
    const r = evaluateInstabilityMetrics({ D_mm: 28, d_mm: 3 }, {});
    expect(r.gbl_pct).toBe(10.7);
    expect(r.flags).toHaveLength(0);
  });
  test('sem TC: nada ósseo é estimado; faltantes listados', () => {
    const r = evaluateInstabilityMetrics({}, { age_at_surgery: 25 });
    expect(r.gbl_pct).toBeNull();
    expect(r.gt_mm).toBeNull();
    expect(r.track).toBeNull();
    expect(r.isis).toBeNull();
    expect(r.missing).toEqual(expect.arrayContaining(['D_mm', 'd_mm', 'hsi_mm', 'isis.sport_competitive']));
  });
  test('HSI presente sem D/d → track não calculado', () => {
    const r = evaluateInstabilityMetrics({ hsi_mm: 15 }, {});
    expect(r.track).toBeNull();
    expect(r.hsi_mm).toBe(15);
  });
});
