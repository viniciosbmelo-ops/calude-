import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetCurrentDoctor, getGetCurrentDoctorQueryKey } from "@workspace/docregen-api-client-react";
import type { Doctor } from "@workspace/docregen-api-client-react";
import { getBrowserAuthProfile } from "./auth-route";

interface AuthContextType {
  user: Doctor | null;
  isLoading: boolean;
  login: (authenticatedUser: Doctor) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const shouldCheckSession = getBrowserAuthProfile() === "doctor";

  const { data: user, isLoading, error } = useGetCurrentDoctor({
    query: {
      enabled: shouldCheckSession,
      retry: false,
      queryKey: getGetCurrentDoctorQueryKey(),
      staleTime: 30_000,
    }
  });

  useEffect(() => {
    if (error) {
      const status = (error as unknown as { status?: number }).status;
      if (status === 401 || status === 403) {
        queryClient.setQueryData(getGetCurrentDoctorQueryKey(), null);
      }
    }
  }, [error, queryClient]);

  const login = (authenticatedUser: Doctor) => {
    queryClient.setQueryData(getGetCurrentDoctorQueryKey(), authenticatedUser);
  };

  const logout = async () => {
    try {
      await fetch("/regen-api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch {
      // ignore network errors — still clear state
    }
    queryClient.clear();
    window.location.href = import.meta.env.BASE_URL;
  };

  return (
    <AuthContext.Provider value={{
      user: shouldCheckSession ? user || null : null,
      isLoading: shouldCheckSession && isLoading,
      login,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
