/**
 * PWAInstallPrompt.tsx
 * DocSholder — Componente de instalação PWA
 *
 * COMPORTAMENTO:
 *   - iOS Safari: mostra modal com instruções passo a passo
 *   - Android Chrome: captura o evento nativo e mostra botão "Instalar app"
 *   - Se já instalado (standalone): não aparece nada
 *   - "Agora não" / fechar: some por 7 dias (localStorage)
 *   - "Não receber essa mensagem novamente": some para sempre (localStorage)
 *   - Aparece 3 segundos após carregar a página
 */

import { useState, useEffect, useCallback } from 'react';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Platform = 'ios' | 'android' | 'other';

// ─── Detecção de plataforma ───────────────────────────────────────────────────

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

const INSTALLED_KEY = 'docknee_pwa_installed';

function isRunningStandalone(): boolean {
  if ((window.navigator as any).standalone === true) return true;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  return false;
}

function isAlreadyInstalled(): boolean {
  if (isRunningStandalone()) {
    // Marca a flag enquanto roda como PWA — assim o Safari do mesmo domínio saberá que já foi instalado
    try { localStorage.setItem(INSTALLED_KEY, '1'); } catch {}
    return true;
  }
  try {
    return localStorage.getItem(INSTALLED_KEY) === '1';
  } catch {
    return false;
  }
}

function wasNeverAgain(): boolean {
  try {
    return localStorage.getItem('docknee_pwa_never') === '1';
  } catch {
    return false;
  }
}

function markNeverAgain(): void {
  try {
    localStorage.setItem('docknee_pwa_never', '1');
  } catch {}
}

function wasRecentlyDismissed(): boolean {
  try {
    const ts = localStorage.getItem('docknee_pwa_dismissed');
    if (!ts) return false;
    const days = (Date.now() - parseInt(ts)) / (1000 * 60 * 60 * 24);
    return days < 7;
  } catch {
    return false;
  }
}

function markDismissed(): void {
  try {
    localStorage.setItem('docknee_pwa_dismissed', Date.now().toString());
  } catch {}
}

// ─── Estilos inline ───────────────────────────────────────────────────────────

const styles = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    zIndex: 9998,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    padding: '0 0 0 0',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
  },
  modal: {
    backgroundColor: '#0D1B3E',
    borderRadius: '24px 24px 0 0',
    border: '1px solid rgba(41, 182, 246, 0.3)',
    borderBottom: 'none',
    padding: '24px 24px 40px',
    width: '100%',
    maxWidth: '480px',
    boxShadow: '0 -8px 40px rgba(0, 0, 0, 0.5)',
    position: 'relative' as const,
    zIndex: 9999,
  },
  handle: {
    width: '40px',
    height: '4px',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: '2px',
    margin: '0 auto 20px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    marginBottom: '20px',
  },
  appIcon: {
    width: '56px',
    height: '56px',
    borderRadius: '14px',
    overflow: 'hidden' as const,
    flexShrink: 0,
    backgroundColor: '#0D1B3E',
  },
  appIconImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
    display: 'block',
  },
  headerText: {
    flex: 1,
  },
  title: {
    color: '#FFFFFF',
    fontSize: '18px',
    fontWeight: '700',
    margin: 0,
    lineHeight: 1.3,
  },
  subtitle: {
    color: '#94A3B8',
    fontSize: '14px',
    margin: '4px 0 0',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#64748B',
    fontSize: '22px',
    cursor: 'pointer',
    padding: '4px',
    lineHeight: 1,
    flexShrink: 0,
  },
  divider: {
    height: '1px',
    backgroundColor: 'rgba(255,255,255,0.08)',
    margin: '0 0 20px',
  },
  stepsContainer: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
    marginBottom: '24px',
  },
  step: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '14px',
  },
  stepNum: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    backgroundColor: '#1565C0',
    color: '#FFFFFF',
    fontSize: '14px',
    fontWeight: '700',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: '1px',
  },
  stepText: {
    flex: 1,
  },
  stepTitle: {
    color: '#FFFFFF',
    fontSize: '15px',
    fontWeight: '600',
    margin: '0 0 3px',
  },
  stepDesc: {
    color: '#94A3B8',
    fontSize: '13px',
    margin: 0,
    lineHeight: 1.5,
  },
  stepHighlight: {
    color: '#29B6F6',
    fontWeight: '600',
  },
  shareIconBox: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '26px',
    height: '26px',
    backgroundColor: '#1E3A5F',
    border: '1.5px solid #29B6F6',
    borderRadius: '6px',
    verticalAlign: 'middle',
    margin: '0 3px',
  },
  introText: {
    color: '#CBD5E1',
    fontSize: '14px',
    lineHeight: 1.5,
    margin: '0 0 16px',
  },
  warningBox: {
    backgroundColor: 'rgba(251, 146, 60, 0.1)',
    border: '1px solid rgba(251, 146, 60, 0.3)',
    borderRadius: '10px',
    padding: '10px 14px',
    marginBottom: '20px',
    display: 'flex',
    gap: '10px',
    alignItems: 'flex-start',
  },
  warningText: {
    color: '#FB923C',
    fontSize: '13px',
    margin: 0,
    lineHeight: 1.5,
  },
  androidBtn: {
    width: '100%',
    padding: '16px',
    backgroundColor: '#29B6F6',
    color: '#0D1B3E',
    border: 'none',
    borderRadius: '14px',
    fontSize: '16px',
    fontWeight: '700',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    marginBottom: '12px',
    boxShadow: '0 4px 20px rgba(41, 182, 246, 0.35)',
  },
  dismissLink: {
    display: 'block',
    textAlign: 'center' as const,
    color: '#94A3B8',
    fontSize: '14px',
    fontWeight: '600',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    width: '100%',
    padding: '10px',
  },
  neverLink: {
    display: 'block',
    textAlign: 'center' as const,
    color: '#64748B',
    fontSize: '13px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    width: '100%',
    padding: '8px',
  },
  alreadyBtn: {
    display: 'block',
    width: '100%',
    padding: '14px',
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    border: '1.5px solid rgba(34, 197, 94, 0.4)',
    borderRadius: '14px',
    color: '#4ADE80',
    fontSize: '15px',
    fontWeight: '700',
    cursor: 'pointer',
    marginBottom: '10px',
    textAlign: 'center' as const,
  },
};

// ─── Logo do app ──────────────────────────────────────────────────────────────

function AppLogo() {
  return (
    <div style={styles.appIcon}>
      <img
        src={`${import.meta.env.BASE_URL}icons/icon-192.png`}
        alt="DocSholder"
        style={styles.appIconImg}
      />
    </div>
  );
}

// ─── Modal iOS ────────────────────────────────────────────────────────────────

function IOSModal({ onDismiss, onNever }: { onDismiss: () => void; onNever: () => void }) {
  return (
    <div style={styles.overlay} onClick={onDismiss}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.handle} />

        <div style={styles.header}>
          <AppLogo />
          <div style={styles.headerText}>
            <p style={styles.title}>Instalar DocSholder</p>
            <p style={styles.subtitle}>Adicione à tela de início</p>
          </div>
          <button style={styles.closeBtn} onClick={onDismiss} aria-label="Fechar">
            ✕
          </button>
        </div>

        <div style={styles.divider} />

        <p style={styles.introText}>
          Para deixar o seu <strong>login da plataforma</strong> sempre à mão, na tela inicial do seu
          celular como um aplicativo, siga o passo a passo abaixo:
        </p>

        <div style={styles.warningBox}>
          <span style={{ fontSize: '16px' }}>⚠️</span>
          <p style={styles.warningText}>
            Funciona apenas no <strong>Safari</strong>. Se estiver usando outro browser, abra
            o link no Safari primeiro.
          </p>
        </div>

        <div style={styles.stepsContainer}>
          <div style={styles.step}>
            <div style={styles.stepNum}>1</div>
            <div style={styles.stepText}>
              <p style={styles.stepTitle}>Toque em Compartilhar</p>
              <p style={styles.stepDesc}>
                Na barra inferior do Safari, toque no ícone{' '}
                <span style={styles.shareIconBox}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <rect x="2" y="5" width="10" height="8" rx="1.5" stroke="#29B6F6" strokeWidth="1.5" />
                    <path d="M7 1 L7 9 M4 4 L7 1 L10 4" stroke="#29B6F6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>{' '}
                (quadrado com seta para cima)
              </p>
            </div>
          </div>

          <div style={styles.step}>
            <div style={styles.stepNum}>2</div>
            <div style={styles.stepText}>
              <p style={styles.stepTitle}>
                Role e toque em{' '}
                <span style={styles.stepHighlight}>"Adicionar à Tela de Início"</span>
              </p>
              <p style={styles.stepDesc}>
                Pode precisar rolar a lista de opções para baixo para encontrar.
              </p>
            </div>
          </div>

          <div style={styles.step}>
            <div style={styles.stepNum}>3</div>
            <div style={styles.stepText}>
              <p style={styles.stepTitle}>
                Toque em{' '}
                <span style={styles.stepHighlight}>"Adicionar"</span>
              </p>
              <p style={styles.stepDesc}>
                No canto superior direito da tela de confirmação. Pronto!
              </p>
            </div>
          </div>
        </div>

        <button style={styles.alreadyBtn} onClick={onNever}>
          ✓ &nbsp;Já instalei o app
        </button>
        <button style={styles.dismissLink} onClick={onDismiss}>
          Agora não
        </button>
        <button style={styles.neverLink} onClick={onNever}>
          Não receber essa mensagem novamente
        </button>
      </div>
    </div>
  );
}

// ─── Modal Android ────────────────────────────────────────────────────────────

function AndroidPrompt({
  onInstall,
  onDismiss,
  onNever,
}: {
  onInstall: () => void;
  onDismiss: () => void;
  onNever: () => void;
}) {
  return (
    <div style={styles.overlay} onClick={onDismiss}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.handle} />

        <div style={styles.header}>
          <AppLogo />
          <div style={styles.headerText}>
            <p style={styles.title}>Instalar DocSholder</p>
            <p style={styles.subtitle}>Acesso rápido pela tela inicial</p>
          </div>
          <button style={styles.closeBtn} onClick={onDismiss} aria-label="Fechar">
            ✕
          </button>
        </div>

        <div style={styles.divider} />

        <div style={{ ...styles.stepsContainer, gap: '10px', marginBottom: '20px' }}>
          {[
            { icon: '⚡', text: 'Abre instantaneamente, como um app nativo' },
            { icon: '📵', text: 'Funciona sem conexão para telas já visitadas' },
            { icon: '🔔', text: 'Receba notificações do consultório' },
          ].map(({ icon, text }) => (
            <div key={text} style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <span style={{ fontSize: '20px' }}>{icon}</span>
              <p style={{ ...styles.stepDesc, margin: 0, color: '#CBD5E1' }}>{text}</p>
            </div>
          ))}
        </div>

        <button style={styles.androidBtn} onClick={onInstall}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 2 L10 14 M5 9 L10 15 L15 9" stroke="#0D1B3E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="2" y="15" width="16" height="2.5" rx="1.25" fill="#0D1B3E" />
          </svg>
          Instalar app
        </button>

        <button style={styles.dismissLink} onClick={onDismiss}>
          Agora não
        </button>
        <button style={styles.neverLink} onClick={onNever}>
          Não receber essa mensagem novamente
        </button>
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function PWAInstallPrompt() {
  const [show, setShow] = useState(false);
  const [platform, setPlatform] = useState<Platform>('other');
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isAlreadyInstalled() || wasNeverAgain() || wasRecentlyDismissed()) return;

    const p = detectPlatform();
    setPlatform(p);

    let cleanup: (() => void) | undefined;

    if (p === 'ios') {
      const t = setTimeout(() => setShow(true), 3000);
      cleanup = () => clearTimeout(t);
    } else if (p === 'android') {
      const handler = (e: Event) => {
        e.preventDefault();
        setDeferredPrompt(e as BeforeInstallPromptEvent);
        setTimeout(() => setShow(true), 3000);
      };
      window.addEventListener('beforeinstallprompt', handler);
      cleanup = () => window.removeEventListener('beforeinstallprompt', handler);
    }

    return cleanup;
  }, []);

  const handleDismiss = useCallback(() => {
    setShow(false);
    markDismissed();
  }, []);

  const handleNever = useCallback(() => {
    setShow(false);
    markNeverAgain();
  }, []);

  const handleAndroidInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShow(false);
      setDeferredPrompt(null);
    }
  }, [deferredPrompt]);

  if (!show) return null;

  if (platform === 'ios') {
    return <IOSModal onDismiss={handleDismiss} onNever={handleNever} />;
  }

  if (platform === 'android' && deferredPrompt) {
    return <AndroidPrompt onInstall={handleAndroidInstall} onDismiss={handleDismiss} onNever={handleNever} />;
  }

  return null;
}
