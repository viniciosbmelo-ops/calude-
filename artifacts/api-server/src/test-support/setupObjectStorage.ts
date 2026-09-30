/**
 * Vitest setup: when OBJECT_STORAGE_FAKE=1, start the local fake of the Replit
 * object-storage sidecar + GCS API before any test module is imported, and point
 * the real storage client at it. Without the flag nothing changes and the
 * tests talk to the Replit sidecar at 127.0.0.1:1106 as before.
 */
import { afterAll } from "vitest";
import { startFakeObjectStorage } from "./fakeObjectStorage";

if (process.env["OBJECT_STORAGE_FAKE"] === "1") {
  const fake = await startFakeObjectStorage();
  process.env["OBJECT_STORAGE_SIDECAR_ENDPOINT"] = fake.url;
  process.env["OBJECT_STORAGE_API_ENDPOINT"] = fake.url;
  afterAll(() => fake.close());
}
