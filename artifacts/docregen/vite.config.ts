import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const productionCsp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://storage.googleapis.com https://*.googleapis.com",
  "connect-src 'self' https://storage.googleapis.com https://*.googleapis.com https://eutils.ncbi.nlm.nih.gov https://api.crossref.org",
  // The app embeds only its own temporary PDF route in the mobile viewer.
  "frame-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self' blob: https://storage.googleapis.com https://*.googleapis.com",
  "upgrade-insecure-requests",
].join("; ");

const developmentCsp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' http: https: ws: wss:",
  // The app embeds only its own temporary PDF route in the mobile viewer.
  "frame-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self' blob: https:",
].join("; ");

function cspMetaPlugin(policy: string) {
  const metaPolicy = policy
    .split("; ")
    .filter((directive) => !directive.startsWith("frame-ancestors "))
    .join("; ");
  return {
    name: "docregen-content-security-policy",
    transformIndexHtml() {
      return [{
        tag: "meta",
        attrs: {
          "http-equiv": "Content-Security-Policy",
          content: metaPolicy,
        },
        injectTo: "head-prepend" as const,
      }];
    },
  };
}

export default defineConfig(async ({ command }) => {
  const isProduction = command === "build" || process.env.NODE_ENV === "production";
  // Static production builds do not receive the development server variables
  // from artifact.toml. Keep strict validation for dev/preview, while using
  // the artifact's own defaults during the build step.
  const rawPort = process.env.PORT ?? (isProduction ? "20452" : undefined);

  if (!rawPort) {
    throw new Error(
      "PORT environment variable is required but was not provided.",
    );
  }

  const port = Number(rawPort);

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  const basePath = process.env.BASE_PATH ?? (isProduction ? "/docregen/" : undefined);

  if (!basePath) {
    throw new Error(
      "BASE_PATH environment variable is required but was not provided.",
    );
  }

  const csp = isProduction ? productionCsp : developmentCsp;

  return {
    base: basePath,
    plugins: [
      cspMetaPlugin(csp),
      react(),
      tailwindcss(),
      runtimeErrorOverlay(),
      ...(!isProduction && process.env.REPL_ID !== undefined
        ? [
            await import("@replit/vite-plugin-cartographer").then((m) =>
              m.cartographer({
                root: path.resolve(import.meta.dirname, ".."),
              }),
            ),
            await import("@replit/vite-plugin-dev-banner").then((m) =>
              m.devBanner(),
            ),
          ]
        : []),
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
        "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
      },
      dedupe: ["react", "react-dom"],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
    },
    server: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
      // Outside the Replit path router, forward API calls to the shared
      // api-server (artifacts/api-server) so DocRegen can run standalone.
      ...(process.env.API_PROXY_TARGET
        ? { proxy: { "/api": { target: process.env.API_PROXY_TARGET, changeOrigin: true } } }
        : {}),
      headers: {
        "Content-Security-Policy": csp,
      },
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
    },
    preview: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
      headers: {
        "Content-Security-Policy": productionCsp,
      },
    },
  };
});
