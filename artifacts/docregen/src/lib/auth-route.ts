export type BrowserAuthProfile = "doctor" | "secretary" | "physio" | "service" | "public";

export function getBrowserAuthProfile(pathname = window.location.pathname): BrowserAuthProfile {
  if (/\/secretary(?:\/|$)/.test(pathname)) return "secretary";
  if (/\/fisio(?:\/|$)/.test(pathname)) return "physio";
  if (/\/service(?:\/|$)/.test(pathname)) return "service";
  if (
    /\/patient(?:\/|$)/.test(pathname) ||
    /\/orientacoes-paciente(?:\/|$)/.test(pathname)
  ) {
    return "public";
  }
  return "doctor";
}