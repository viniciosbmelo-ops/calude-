export type BrowserAuthProfile = "doctor" | "secretary" | "service" | "public";

export function getBrowserAuthProfile(pathname = window.location.pathname): BrowserAuthProfile {
  if (/\/secretary(?:\/|$)/.test(pathname)) return "secretary";
  if (/\/service(?:\/|$)/.test(pathname)) return "service";
  if (
    /\/patient(?:\/|$)/.test(pathname) ||
    /\/orientacoes-paciente(?:\/|$)/.test(pathname)
  ) {
    return "public";
  }
  return "doctor";
}