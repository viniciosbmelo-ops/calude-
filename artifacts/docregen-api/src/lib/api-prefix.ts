/**
 * Path prefix under which the DocRegen API is mounted.
 *
 * DocKnee's api-server owns `/api`; DocRegen is a separate service with its
 * own prefix so the Replit path router, session cookies (scoped to this path)
 * and the service worker never mix the two apps. `/regen-api` shares no string
 * prefix with `/api`, `/docregen` (the DocRegen frontend) or `/__mockup`.
 */
export const API_PREFIX = "/regen-api";
