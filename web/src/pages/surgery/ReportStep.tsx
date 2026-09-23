import { useEffect, useState } from 'react';
import { ApiError, api, errorText } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { TIMEPOINT_PT, useReference } from '../../lib/ref';
import { ErrorBox, Loading, SaveIndicator, fmtDate, toast, useAutosave, useLoad } from '../../components/ui';
import type { Episode } from '../Patient';
import type { SurgeryFull } from '../Surgery';

interface Report {
  id: string; version: number; generated_text: string; final_text: string; diff_from_generated: { op: string; line: string }[] | null;
  signed_at: string | null; content_hash: string | null; supersedes: string | null;
  checklist: { canSign: boolean; issues: { rule: string; severity: 'BLOCKER' | 'WARNING'; message_pt: string }[] } | null;
}

/** Troca códigos de estrutura (GH_LHB…) pelo nome legível nas mensagens do checklist. */
function humanize(msg: string, names: Record<string, string>): string {
  return msg.replace(/\b(GH|SA|EL)_[A-Z_]+\b/g, (c) => names[c] ?? c);
}

export function ReportStep({ surgery, episode, onChanged }: { surgery: SurgeryFull; episode: Episode; onChanged(): void }) {
  const { me } = useAuth();
  const versions = useLoad(() => api.get<any[]>(`/api/surgeries/${surgery.id}/reports`), [surgery.id]);
  const [currentId, setCurrentId] = useState<string>();
  useEffect(() => { if (versions.data?.length) setCurrentId(versions.data[versions.data.length - 1].id); }, [versions.data]);
  const isSurgeon = me?.id === surgery.surgeon_id;

  if (!versions.data) return <Loading />;
  const latest = versions.data[versions.data.length - 1];
  return (
    <div className="stack">
      {!isSurgeon && <div className="alert info">Somente o cirurgião responsável gera e assina o relatório. Você pode visualizar.</div>}
      {(!latest || latest.signed_at) && isSurgeon && (
        <Generate surgery={surgery} episode={episode} amend={!!latest} onDone={async () => { await versions.reload(); onChanged(); }} />
      )}
      {versions.data.length > 1 && (
        <div className="row small">Versões:
          {versions.data.map((v) => <button key={v.id} className="small" aria-pressed={v.id === currentId} style={v.id === currentId ? { borderColor: 'var(--primary)', color: 'var(--primary)' } : undefined} onClick={() => setCurrentId(v.id)}>v{v.version} {v.signed_at ? '✓' : '(rascunho)'}</button>)}
        </div>
      )}
      {currentId && <ReportView key={currentId} id={currentId} isLatest={currentId === latest?.id} canEdit={isSurgeon} surgery={surgery} episode={episode} onChanged={async () => { await versions.reload(); onChanged(); }} />}
    </div>
  );
}

function Generate({ surgery, episode, amend, onDone }: { surgery: SurgeryFull; episode: Episode; amend: boolean; onDone(): void }) {
  const { byCode } = useReference();
  const protocols = useLoad(() => api.get<any[]>('/api/protocols'), []);
  const [plan, setPlan] = useState('');
  const [chosen, setChosen] = useState('');
  const [err, setErr] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  // Pré-seleciona o protocolo do médico cujo código bate com o padrão da patologia principal
  useEffect(() => {
    const def = byCode.get(episode.primary_pathology)?.default_protocol_code;
    const p = protocols.data?.find((x) => x.active && x.code === def);
    if (p && !chosen) { setChosen(p.id); setPlan(p.body); }
  }, [protocols.data]); // eslint-disable-line react-hooks/exhaustive-deps
  async function go() {
    setBusy(true); setErr(undefined);
    try { await api.post(`/api/surgeries/${surgery.id}/report/generate`, { postop_plan: plan.trim() || undefined }); toast(amend ? 'Nova versão criada' : 'Relatório gerado'); onDone(); } catch (e) { setErr(e); setBusy(false); }
  }
  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>{amend ? 'Corrigir relatório assinado' : 'Gerar relatório'}</h2>
      <p className="muted small" style={{ margin: 0 }}>{amend ? 'Cria nova versão que substitui a assinada. A versão anterior continua registrada e verificável.' : 'Texto montado por regras fixas a partir do registro — sem inteligência artificial. Você revisa antes de assinar.'}</p>
      <label className="field"><div className="field-label">Conduta pós-operatória</div>
        <select value={chosen} onChange={(e) => { setChosen(e.target.value); const p = protocols.data?.find((x) => x.id === e.target.value); setPlan(p?.body ?? ''); }}>
          <option value="">— texto livre —</option>
          {(protocols.data ?? []).filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
      </label>
      <textarea value={plan} maxLength={5000} onChange={(e) => setPlan(e.target.value)} placeholder="Opcional. Cadastre seus protocolos em Protocolos." aria-label="Conduta pós-operatória" />
      <ErrorBox error={err} />
      {err instanceof ApiError && err.code === 'VALIDATION_FAILED' && <div className="muted small">Volte às etapas marcadas com “!” e complete os campos destacados.</div>}
      <div><button className="primary" onClick={go} disabled={busy}>{amend ? 'Criar nova versão' : 'Gerar relatório'}</button></div>
    </div>
  );
}

function ReportView({ id, isLatest, canEdit, surgery, episode, onChanged }: { id: string; isLatest: boolean; canEdit: boolean; surgery: SurgeryFull; episode: Episode; onChanged(): void }) {
  const { structures } = useReference();
  const names = structures[surgery.region];
  const r = useLoad(() => api.get<Report>(`/api/reports/${id}`), [id]);
  const [text, setText] = useState<string>();
  const [showDiff, setShowDiff] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [err, setErr] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [signedInfo, setSignedInfo] = useState<any>();
  useEffect(() => { if (r.data && text === undefined) setText(r.data.final_text); }, [r.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const editable = !!r.data && !r.data.signed_at && canEdit && isLatest;
  const save = useAutosave(text, async (t) => { if (t !== undefined) { const u = await api.patch<Report>(`/api/reports/${id}`, { final_text: t }); r.setData({ ...r.data!, ...u, checklist: r.data!.checklist }); } }, editable);

  if (r.error) return <ErrorBox error={r.error} />;
  if (!r.data || text === undefined) return <Loading />;
  const rep = r.data;
  const blockers = rep.checklist?.issues.filter((i) => i.severity === 'BLOCKER') ?? [];
  const warnings = rep.checklist?.issues.filter((i) => i.severity === 'WARNING') ?? [];

  async function regenerate() {
    if (!confirm('Descartar suas edições e gerar o texto de novo a partir do registro?')) return;
    try { await save.flush(); const g = await api.post<Report>(`/api/surgeries/${surgery.id}/report/generate`, { force: true }); setText(g.final_text); await r.reload(); } catch (e) { toast(errorText(e)); }
  }
  async function sign() {
    setBusy(true); setErr(undefined);
    try {
      await save.flush();
      const out = await api.post(`/api/reports/${id}/sign`, { confirm_warnings: confirmed });
      setSignedInfo(out);
      await r.reload();
      onChanged();
      toast('Relatório assinado');
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  async function openPdf() {
    const w = window.open('', '_blank');
    try {
      const blob = await api.blob(`/api/reports/${id}/pdf`);
      const url = URL.createObjectURL(blob);
      if (w) w.location.href = url; else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { w?.close(); toast(errorText(e)); }
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)', gap: 16 }}>
      <div className="card">
        <div className="card-head">
          <h2 style={{ margin: 0 }}>Relatório v{rep.version} {rep.signed_at ? <span className="badge ok">assinado</span> : <span className="badge warn">rascunho</span>}</h2>
          <div className="row">
            {editable && <SaveIndicator state={save.state} error={save.error} />}
            {!rep.signed_at && rep.diff_from_generated && <button className="small" onClick={() => setShowDiff(!showDiff)}>{showDiff ? 'Editar texto' : `Ver alterações (${rep.diff_from_generated.length})`}</button>}
            {editable && <button className="small" onClick={regenerate}>Regerar</button>}
            <button className="small" onClick={openPdf}>PDF</button>
          </div>
        </div>
        {showDiff && rep.diff_from_generated ? (
          <div className="diff" aria-label="Alterações em relação ao texto gerado">{rep.diff_from_generated.map((d, i) => <div key={i} className={d.op === '+' ? 'add' : 'del'}>{d.op} {d.line}</div>)}</div>
        ) : (
          <textarea className="report-text" value={text} readOnly={!editable} onChange={(e) => setText(e.target.value)} aria-label="Texto do relatório" spellCheck />
        )}
        {rep.signed_at && (
          <div className="alert ok small" style={{ marginTop: 12 }}>
            Assinado em {fmtDate(rep.signed_at)}. Hash <span className="mono" style={{ wordBreak: 'break-all' }}>{rep.content_hash}</span>
            {' · '}<a href={`/verify/${rep.content_hash}`} target="_blank" rel="noreferrer">verificar</a>
          </div>
        )}
      </div>

      {!rep.signed_at && isLatest && canEdit && (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Checklist pré-assinatura</h2>
          {blockers.length === 0 && warnings.length === 0 && <div className="alert ok">Nenhuma pendência.</div>}
          {blockers.length > 0 && <div className="alert error"><strong>Impedem a assinatura:</strong><ul>{blockers.map((b) => <li key={b.rule + b.message_pt}>{humanize(b.message_pt, names)}</li>)}</ul></div>}
          {warnings.length > 0 && (
            <div className="alert warn">
              <strong>Avisos:</strong><ul>{warnings.map((w) => <li key={w.rule + w.message_pt}>{humanize(w.message_pt, names)}</li>)}</ul>
              <label className="row" style={{ marginTop: 8 }}><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> Confirmo que revisei os avisos acima.</label>
            </div>
          )}
          <p className="muted small" style={{ margin: 0 }}>Ao assinar, data e hora vêm do servidor e o conteúdo fica imutável. Correções posteriores geram nova versão.</p>
          <ErrorBox error={err} />
          <div><button className="primary" disabled={busy || blockers.length > 0 || (warnings.length > 0 && !confirmed)} onClick={sign}>Assinar relatório</button></div>
        </div>
      )}

      {signedInfo?.prom_schedule?.length > 0 && (
        <div className="card">
          <h2>Seguimento agendado</h2>
          <p className="muted small" style={{ marginTop: 0 }}>Pendências de escores criadas para {episode.region === 'shoulder' ? 'o ombro' : 'o cotovelo'} operado. Acompanhe em Seguimento.</p>
          <ul className="small">{signedInfo.prom_schedule.map((t: any) => <li key={t.code}>{TIMEPOINT_PT[t.code]}: {fmtDate(t.due)} (janela {fmtDate(t.window_start)} a {fmtDate(t.window_end)})</li>)}</ul>
        </div>
      )}
    </div>
  );
}
