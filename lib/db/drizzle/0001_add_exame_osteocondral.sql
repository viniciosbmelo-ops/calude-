ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "numero_carteirinha" text;
--> statement-breakpoint
CREATE TABLE "exame_osteocondral" (
"id" serial PRIMARY KEY NOT NULL,
"surgery_id" integer NOT NULL,
"sintomatica" boolean,
"falha_conservador" boolean,
"artrose_difusa" boolean,
"objetivo" text,
"icrs_grau" text,
"localizacao" text,
"tamanho_mm2" text,
"etiologia" text,
"padrao" text,
"osseo_status" text,
"profundidade" text,
"continencia" text,
"estabilidade_ocd" text,
"edema_osseo" boolean,
"cisto_subcondral" boolean,
"fragmento_solto" boolean,
"lesao_meniscal_associada" boolean,
"lesao_ligamentar_associada" boolean,
"desvio_axial" boolean,
"rm_disponivel" boolean,
"ocd_result" jsonb,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exame_osteocondral" ADD CONSTRAINT "exame_osteocondral_surgery_id_surgeries_id_fk" FOREIGN KEY ("surgery_id") REFERENCES "public"."surgeries"("id") ON DELETE cascade ON UPDATE no action;
