import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getBrowserAuthProfile } from "./auth-route";

export interface PhysioUser {
  id: number;
  nome: string;
  email: string;
  celular: string;
  crefito: string | null;
  clinica: string | null;
  cidade: string | null;
  plan: string;
  subscriptionStatus: string;
  patientsCreatedTotal: number;
  ativo: boolean;
  createdAt: string;
}

interface PhysioAuthContextType {
  physio: PhysioUser | null;
  isLoading: boolean;
  login: (data: PhysioUser) => void;
  logout: () => void;
  refresh: () => Promise<void>;
}

const PhysioAuthContext = createContext<PhysioAuthContextType | undefined>(undefined);

export function PhysioAuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [physio, setPhysio] = useState<PhysioUser | null>(null);
  const shouldCheckSession = getBrowserAuthProfile() === "physio";
  const [isLoading, setIsLoading] = useState(shouldCheckSession);

  const refresh = async () => {
    if (!shouldCheckSession) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch("/api/physio-auth/me", {
        credentials: "same-origin",
      });
      if (res.ok) {
        const data = await res.json();
        setPhysio(data);
      } else if (res.status === 401 || res.status === 403) {
        setPhysio(null);
      }
    } catch {
      // mantém estado local em caso de falha de rede
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, [shouldCheckSession]);

  const login = (data: PhysioUser) => {
    queryClient.clear();
    setPhysio(data);
    setIsLoading(false);
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
    setPhysio(null);
    queryClient.clear();
    window.location.href = `${import.meta.env.BASE_URL}fisio/login`.replace(/\/\//g, "/");
  };

  return (
    <PhysioAuthContext.Provider value={{ physio, isLoading, login, logout, refresh }}>
      {children}
    </PhysioAuthContext.Provider>
  );
}

export function usePhysioAuth() {
  const context = useContext(PhysioAuthContext);
  if (context === undefined) {
    throw new Error("usePhysioAuth must be used within a PhysioAuthProvider");
  }
  return context;
}

export async function physioFetch(url: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> ?? {}),
  };
  return fetch(url, { ...options, headers, credentials: "same-origin" });
}
