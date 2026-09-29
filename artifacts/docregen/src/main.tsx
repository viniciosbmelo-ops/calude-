import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Remove legacy localStorage auth keys on startup (theme is preserved)
const LEGACY_KEYS = [
  "docknee_token",
  "docknee_secretary_token",
  "docknee_secretary",
  "docknee_physio_token",
  "docknee_physio",
  "docknee_service_token",
  "docknee_service_info",
];
for (const key of LEGACY_KEYS) {
  localStorage.removeItem(key);
}

createRoot(document.getElementById("root")!).render(<App />);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
        updateViaCache: "none",
      })
      .catch((err) => {
        console.error("SW registro falhou:", err);
      });
  });
}
