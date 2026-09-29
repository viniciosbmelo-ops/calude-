import { Lock } from "lucide-react";
import { Link } from "wouter";

export function SubscriptionGate() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", padding: "0 24px", textAlign: "center", gap: 24 }}>
      <div style={{ width: 72, height: 72, borderRadius: "50%", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Lock style={{ width: 34, height: 34, color: "#94a3b8" }} />
      </div>
      <div style={{ maxWidth: 340 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "#0B1F4B", margin: "0 0 10px" }}>
          Assinatura encerrada
        </h2>
        <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.6, margin: 0 }}>
          Sua assinatura foi cancelada ou expirou. Você ainda pode visualizar seus pacientes e cirurgias já cadastrados, mas não é possível adicionar novos dados ou usar a IA.
        </p>
      </div>
      <Link href="/profile">
        <button style={{ background: "linear-gradient(135deg,#0B1F4B 0%,#1d4ed8 100%)", color: "#fff", border: "none", borderRadius: 12, padding: "12px 28px", fontSize: 14, fontWeight: 600, cursor: "pointer", boxShadow: "0 4px 14px rgba(29,78,216,0.28)" }}>
          Gerenciar assinatura
        </button>
      </Link>
    </div>
  );
}
