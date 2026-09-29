import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getBrowserAuthProfile } from "./auth-route";

export interface SecretaryUser {
  id: number;
  doctorId: number;
  nome: string;
  email: string;
  ativo: boolean;
  createdAt: string;
  idioma?: "pt-BR" | "es";
}

interface SecretaryAuthContextType {
  secretary: SecretaryUser | null;
  isLoading: boolean;
  login: (data: SecretaryUser) => void;
  logout: () => void;
}

const SecretaryAuthContext = createContext<SecretaryAuthContextType | undefined>(undefined);

export function SecretaryAuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [secretary, setSecretary] = useState<SecretaryUser | null>(null);
  const shouldCheckSession = getBrowserAuthProfile() === "secretary";
  const [isLoading, setIsLoading] = useState(shouldCheckSession);

  useEffect(() => {
    if (!shouldCheckSession) return;
    fetch("/regen-api/secretary-auth/me", {
      credentials: "same-origin",
    })
      .then(res => {
        if (res.ok) return res.json();
        return null;
      })
      .then((data: SecretaryUser | null) => {
        setSecretary(data);
      })
      .catch(() => {
        setSecretary(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [shouldCheckSession]);

  const login = (data: SecretaryUser) => {
    queryClient.clear();
    setSecretary(data);
  };

  const logout = async () => {
    try {
      await fetch("/regen-api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch {
      // ignore
    }
    setSecretary(null);
    queryClient.clear();
    window.location.href = `${import.meta.env.BASE_URL}secretary/login`.replace(/\/\//g, "/");
  };

  return (
    <SecretaryAuthContext.Provider value={{ secretary, isLoading, login, logout }}>
      {children}
    </SecretaryAuthContext.Provider>
  );
}

export function useSecretaryAuth() {
  const context = useContext(SecretaryAuthContext);
  if (context === undefined) {
    throw new Error("useSecretaryAuth must be used within a SecretaryAuthProvider");
  }
  return context;
}

export async function secretaryFetch(url: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> ?? {}),
  };
  return fetch(url, { ...options, headers, credentials: "same-origin" });
}
