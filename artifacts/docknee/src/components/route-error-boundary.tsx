import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLocation } from "wouter";
import { AlertTriangle } from "lucide-react";

const COPY = {
  "pt-BR": {
    title: "Não foi possível exibir esta parte da página",
    body: "Ocorreu um erro inesperado. Os demais dados continuam salvos.",
    retry: "Tentar novamente",
  },
  es: {
    title: "No fue posible mostrar esta parte de la página",
    body: "Ocurrió un error inesperado. Los demás datos siguen guardados.",
    retry: "Intentar de nuevo",
  },
} as const;

function copy() {
  const lang = typeof document === "undefined" ? "pt-BR" : document.documentElement.lang;
  return lang.startsWith("es") ? COPY.es : COPY["pt-BR"];
}

interface BoundaryProps {
  children: ReactNode;
  /** Compact inline fallback (for one card) instead of the page-level one. */
  inline?: boolean;
}

/**
 * Catches render errors so one broken card/page never blanks the whole app.
 * Route-level usage resets automatically on navigation (see RouteErrorBoundary).
 */
export class ErrorBoundary extends Component<BoundaryProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[DocKnee] render error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const text = copy();
    if (this.props.inline) {
      return (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {text.title}
        </div>
      );
    }
    return (
      <div role="alert" className="mx-auto my-10 max-w-md rounded-xl border border-amber-200 bg-amber-50 p-6 text-center space-y-3">
        <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
        <p className="text-sm font-semibold text-amber-900">{text.title}</p>
        <p className="text-xs text-amber-800">{text.body}</p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700"
        >
          {text.retry}
        </button>
      </div>
    );
  }
}

/** Page-level boundary that resets when the route changes. */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary key={location}>{children}</ErrorBoundary>;
}
