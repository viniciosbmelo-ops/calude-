/** Leitura de DataMatrix/código de barras GS1 pela câmera (html5-qrcode). */
import { useEffect, useRef, useState } from 'react';

export function Scanner({ onResult, onClose }: { onResult(raw: string): void; onClose(): void }) {
  const id = useRef(`scan-${Math.random().toString(36).slice(2)}`);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let stop: (() => Promise<void>) | undefined;
    let done = false;
    (async () => {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats: F } = await import('html5-qrcode');
        const s = new Html5Qrcode(id.current, { formatsToSupport: [F.DATA_MATRIX, F.QR_CODE, F.CODE_128, F.EAN_13], verbose: false });
        await s.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } }, (text) => {
          if (done) return;
          done = true;
          void s.stop().finally(() => onResult(text));
        }, () => undefined);
        stop = () => s.stop().catch(() => undefined);
      } catch (e: any) {
        setErr(e?.message?.includes('Permission') || e?.name === 'NotAllowedError' ? 'Permissão de câmera negada.' : 'Câmera indisponível neste dispositivo. Use a entrada manual.');
      }
    })();
    return () => { if (!done) void stop?.(); };
  }, [onResult]);
  return (
    <div>
      <div id={id.current} style={{ width: '100%', minHeight: 260, background: '#000', borderRadius: 8 }} />
      {err && <div className="alert warn" style={{ marginTop: 8 }}>{err}</div>}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}><button onClick={onClose}>Fechar</button></div>
    </div>
  );
}
