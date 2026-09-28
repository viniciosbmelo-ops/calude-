ALTER TABLE "exame_osteocondral" ADD COLUMN IF NOT EXISTS "instabilidade_patelar" boolean;
--> statement-breakpoint
ALTER TABLE "exame_osteocondral" ADD COLUMN IF NOT EXISTS "sobrecarga_patelofemoral" boolean;
--> statement-breakpoint
ALTER TABLE "exame_osteocondral" ADD COLUMN IF NOT EXISTS "ligamentos_ocd" jsonb;
