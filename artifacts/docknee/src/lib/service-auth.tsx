import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getBrowserAuthProfile } from "./auth-route";

interface ServiceInfo {
  id: number;
  nome: string;
  email: string;
  idioma?: "pt-BR" | "es";
}

interface ServiceAuthContextValue {
  service: ServiceInfo | null;
  isLoading: boolean;
  logout: () => void;
  setAuth: (service: ServiceInfo) => void;
}

const ServiceAuthContext = createContext<ServiceAuthContextValue>({
  service: null,
  isLoading: true,
  logout: () => {},
  setAuth: () => {},
});

export function ServiceAuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [service, setService] = useState<ServiceInfo | null>(null);
  const shouldCheckSession = getBrowserAuthProfile() === "service";
  const [isLoading, setIsLoading] = useState(shouldCheckSession);

  useEffect(() => {
    if (!shouldCheckSession) return;
    fetch("/api/service-auth/me", {
      credentials: "same-origin",
    })
      .then(res => {
        if (res.ok) return res.json();
        return null;
      })
      .then((data: ServiceInfo | null) => {
        setService(data);
      })
      .catch(() => {
        setService(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [shouldCheckSession]);

  const setAuth = (s: ServiceInfo) => {
    queryClient.clear();
    setService(s);
  };

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch {
      // ignore
    }
    setService(null);
    queryClient.clear();
    window.location.href = `${import.meta.env.BASE_URL}service/login`.replace(/\/\//g, "/");
  };

  return (
    <ServiceAuthContext.Provider value={{ service, isLoading, logout, setAuth }}>
      {children}
    </ServiceAuthContext.Provider>
  );
}

export function useServiceAuth() {
  return useContext(ServiceAuthContext);
}

export async function serviceFetch(url: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> ?? {}),
  };
  return fetch(url, { ...options, headers, credentials: "same-origin" });
}
