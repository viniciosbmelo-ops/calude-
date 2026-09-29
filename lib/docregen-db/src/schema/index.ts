// DocRegen database schema (independent from DocKnee's @workspace/db).
// Only the tables the DocRegen API uses: no surgical, physiotherapy,
// institutional, admin-console or decision-support tables.
export * from "./doctors";
export * from "./patients";
export * from "./pre-consult";
export * from "./admin-messages";
export * from "./patient-attachments";
export * from "./audit-logs";
export * from "./consentimentos";
export * from "./secretaries";
export * from "./appointments";
export * from "./page-visits";
export * from "./upload-grants";
export * from "./storage-cleanup-jobs";
export * from "./patient-verification";
export * from "./password-reset-tokens";
export * from "./regen";
export * from "./analytics";
export * from "./whatsapp-outbox";
export * from "./stripe-webhook-events";
