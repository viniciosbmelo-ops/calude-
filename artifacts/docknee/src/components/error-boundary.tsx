import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: (error: Error) => ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[ErrorBoundary] Render error:", error.message, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error);
      }
      const msg = this.state.error.message ?? "(sem mensagem)";
      const stack = this.state.error.stack ?? "";
      return (
        <div className="p-4 max-w-lg mx-auto mt-6 border border-red-200 rounded-lg bg-red-50">
          <h2 className="text-base font-semibold text-red-700 mb-2">Erro ao carregar</h2>
          <div className="text-xs font-mono bg-white border border-red-200 rounded p-2 mb-3 whitespace-pre-wrap break-all text-red-800 select-all">
            {msg}
          </div>
          <div className="text-xs font-mono bg-white border border-red-200 rounded p-2 mb-3 whitespace-pre-wrap break-all text-red-600 select-all max-h-48 overflow-y-auto">
            {stack}
          </div>
          <button
            className="px-4 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700"
            onClick={() => this.setState({ error: null })}
          >
            Tentar novamente
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
