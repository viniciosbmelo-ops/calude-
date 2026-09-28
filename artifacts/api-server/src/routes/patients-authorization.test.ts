import { describe, expect, it } from "vitest";
import router from "./patients";

type RouterLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: { name?: string } }>;
  };
};

function middlewareNames(method: string, path: string): string[] {
  const layers = (router as unknown as { stack: RouterLayer[] }).stack;
  const route = layers.find(
    (layer) => layer.route?.path === path && layer.route.methods[method],
  )?.route;
  if (!route) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  return route.stack.map((layer) => layer.handle.name ?? "");
}

describe("patient route role boundaries", () => {
  it("shares only patient listing and creation with secretaries", () => {
    expect(middlewareNames("get", "/patients")).toContain("requireDoctorOrSecretary");
    expect(middlewareNames("post", "/patients")).toContain("requireDoctorOrSecretary");
  });

  it("keeps patient detail, editing and deletion doctor-only", () => {
    expect(middlewareNames("get", "/patients/:id")).toContain("requireAuth");
    expect(middlewareNames("patch", "/patients/:id")).toContain("requireAuth");
    expect(middlewareNames("delete", "/patients/:id")).toContain("requireAuth");

    expect(middlewareNames("get", "/patients/:id")).not.toContain("requireDoctorOrSecretary");
    expect(middlewareNames("patch", "/patients/:id")).not.toContain("requireDoctorOrSecretary");
    expect(middlewareNames("delete", "/patients/:id")).not.toContain("requireDoctorOrSecretary");
  });
});