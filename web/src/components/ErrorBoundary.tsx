import { Component, ReactNode } from 'react';

/** Evita tela em branco: qualquer erro de renderização vira mensagem com opção de recarregar. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <div className="alert error" role="alert">
          <strong>Algo deu errado nesta tela.</strong> O que já foi salvo continua salvo.
          <div className="small" style={{ marginTop: 6 }}>{this.state.error.message}</div>
          <div style={{ marginTop: 10 }}><button onClick={() => window.location.reload()}>Recarregar</button></div>
        </div>
      </div>
    );
  }
}
