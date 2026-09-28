CREATE TABLE "doctors" (
	"id" serial PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"email" text NOT NULL,
	"senha_hash" text NOT NULL,
	"crm" text NOT NULL,
	"crm_estado" text NOT NULL,
	"telefone" text,
	"cpf" text NOT NULL,
	"data_nascimento" text,
	"endereco" text,
	"cidade" text,
	"estado" text,
	"cep" text,
	"especialidade" text,
	"whatsapp_business" text,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"is_admin" boolean DEFAULT false NOT NULL,
	"is_free" boolean DEFAULT false NOT NULL,
	"aprovado" boolean DEFAULT true NOT NULL,
	"deletion_requested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doctors_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" serial PRIMARY KEY NOT NULL,
	"doctor_id" integer NOT NULL,
	"nome" text NOT NULL,
	"cpf" text,
	"data_nascimento" text,
	"email" text,
	"sexo" text,
	"telefone" text,
	"lado" text,
	"nivel_atividade" text,
	"esporte_pivot" boolean DEFAULT false NOT NULL,
	"beighton_score" integer,
	"anamnese" text,
	"laudos" text,
	"plano_saude" text,
	"indicado_por" text,
	"pais" text,
	"endereco" text,
	"cidade" text,
	"estado" text,
	"cep" text,
	"numero_registro" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patients_numero_registro_unique" UNIQUE("numero_registro")
);
--> statement-breakpoint
CREATE TABLE "surgeries" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"doctor_id" integer NOT NULL,
	"data_cirurgia" text,
	"hospital" text,
	"lado" text,
	"tipo_caso" text,
	"diagnostico" text,
	"alinhamento" text,
	"grau_alinhamento" text,
	"rx_analise_json" text,
	"rx_image_url" text,
	"slope_tibial_json" text,
	"tipos_procedimento" text[] DEFAULT '{}' NOT NULL,
	"ligamentos_acometidos" text[] DEFAULT '{}' NOT NULL,
	"enxerto" text,
	"diametro_enxerto" text,
	"tunel_femoral" text,
	"fixacao_femoral" text,
	"fixacao_tibial" text,
	"internal_brace" text,
	"tipo_lca" text,
	"localizacao_lesao_lca" text,
	"fixacao_reparo_lca" text,
	"preservacao_remanescente" text,
	"reforco" text,
	"procedimento_realizado" text,
	"procedimentos_detalhados" text,
	"observacoes" text,
	"tunel_femoral_pediatrico" text,
	"tunel_tibial_pediatrico" text,
	"status" text DEFAULT 'completo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cpl_reconstruction" (
	"id" serial PRIMARY KEY NOT NULL,
	"surgery_id" integer NOT NULL,
	"tecnica" text,
	"enxertos" jsonb,
	"fixacao_femoral_1" text,
	"fixacao_femoral_2" text,
	"fixacao_fibular" text,
	"fixacao_tibial" text,
	"rea_associada" boolean,
	"rea_tipo" text,
	"justificativa" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cpm_reconstruction" (
	"id" serial PRIMARY KEY NOT NULL,
	"surgery_id" integer NOT NULL,
	"abordagem" text,
	"lcm_tecnica" text,
	"lcm_enxerto" text,
	"lcm_fixacao_proximal" text,
	"lcm_fixacao_distal" text,
	"lop_tecnica" text,
	"lop_enxerto" text,
	"lop_fixacao" text,
	"justificativa" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "distal_femur_fracture" (
	"id" serial PRIMARY KEY NOT NULL,
	"surgery_id" integer NOT NULL,
	"classificacao_ao_ota" text,
	"classificacao_subtipo" text,
	"controle_danos" boolean,
	"controle_danos_data" text,
	"data_lesao" text,
	"data_cirurgia_definitiva" text,
	"acesso" text[] DEFAULT '{}' NOT NULL,
	"acesso_outro" text,
	"cirurgia" text[] DEFAULT '{}' NOT NULL,
	"cirurgia_outro" text,
	"opme" text[] DEFAULT '{}' NOT NULL,
	"enxerto_osseo" boolean,
	"complicacoes_agudas" text[] DEFAULT '{}' NOT NULL,
	"complicacoes_agudas_outro" text,
	"complicacoes_tardias" text[] DEFAULT '{}' NOT NULL,
	"complicacoes_tardias_outro" text,
	"lesoes_associadas" text[] DEFAULT '{}' NOT NULL,
	"lesoes_associadas_outro" text,
	"observacoes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exame_ligamentar" (
	"id" serial PRIMARY KEY NOT NULL,
	"surgery_id" integer NOT NULL,
	"lachman" integer,
	"gaveta_neutra" integer,
	"pivot_shift" integer,
	"ader_test" boolean,
	"laer_test" boolean,
	"gaveta_rot_interna" boolean,
	"estresse_valgo_0" integer,
	"estresse_valgo_30" integer,
	"estresse_varo_0" integer,
	"estresse_varo_30" integer,
	"gaveta_posterior" integer,
	"sag_sign" boolean,
	"quadriceps_ativo" boolean,
	"lachman_posterior" boolean,
	"dial_test" boolean,
	"dial_test_30" boolean,
	"dial_test_90" boolean,
	"recurvato" boolean,
	"gaveta_rotatoria" boolean,
	"hiperextensao" text,
	"slope_tibial_pts" real,
	"tanner_pelos" text,
	"tanner_mamas" text,
	"tanner_genitalia" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exame_patelar" (
	"id" serial PRIMARY KEY NOT NULL,
	"surgery_id" integer NOT NULL,
	"luxacao_aguda" boolean,
	"luxacao_cronica" boolean,
	"num_episodios" integer,
	"apprehension_test" boolean,
	"j_sign" boolean,
	"tilt_patelar" text,
	"tt_tg_mm" real,
	"caton_deschamps" real,
	"dejour_tipo" text,
	"inclinacao_patelar_graus" real,
	"inclinacao_patelar_categoria" text,
	"lesao_condral" boolean,
	"maltracking_dinamico" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lca_algorithm" (
	"id" serial PRIMARY KEY NOT NULL,
	"surgery_id" integer NOT NULL,
	"idade" integer,
	"esporte_pivot" boolean,
	"pivot_shift" integer,
	"revisao" boolean,
	"hiperlaxidade" boolean,
	"menisco_lateral" boolean,
	"lesao_cronica" boolean,
	"krirs_score" integer,
	"krirs_interpretacao" text,
	"tecnica_recomendada" text,
	"justificativa" text,
	"flag_alto_risco" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lca_leap_decision" (
	"id" serial PRIMARY KEY NOT NULL,
	"surgery_id" integer NOT NULL,
	"idade" integer,
	"sexo" text,
	"enxerto_planejado" text,
	"pivot_shift" integer,
	"lachman" integer,
	"hiperextensao_graus" real,
	"revisao" boolean,
	"esqueleto_imaturo" boolean,
	"lesao_cronica" boolean,
	"esporte_pivot" boolean,
	"pts_graus" real,
	"contralateral_lca" boolean,
	"tabagismo" boolean,
	"atraso_cirurgico_dias" integer,
	"tunel_comprometido" boolean,
	"aloenxerto_jovem" boolean,
	"all_isolada_conduta" boolean,
	"segond_fratura" boolean,
	"notch_estreito" boolean,
	"lesao_alc_imagem" boolean,
	"meniscal_concomitante" boolean,
	"graft_diametro_mm" real,
	"leap_indicado" boolean,
	"forca_maxima" text,
	"resultado" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lcp_reconstruction" (
	"id" serial PRIMARY KEY NOT NULL,
	"surgery_id" integer NOT NULL,
	"grau_lesao" text,
	"indicacao_cirurgica" boolean,
	"tecnica" text,
	"abordagem" text,
	"enxerto" text,
	"diametro_enxerto" text,
	"fixacao_femoral" text,
	"fixacao_tibial" text,
	"fixacao_anteromedial" text,
	"fixacao_posterolateral" text,
	"justificativa" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patelar_tendon_rupture" (
	"id" serial PRIMARY KEY NOT NULL,
	"surgery_id" integer NOT NULL,
	"classificacao" text,
	"data_lesao" text,
	"data_cirurgia_definitiva" text,
	"cirurgia" text[] DEFAULT '{}' NOT NULL,
	"cirurgia_outro" text,
	"reforco" boolean,
	"reforco_tipo" text[] DEFAULT '{}' NOT NULL,
	"reforco_tendao" text[] DEFAULT '{}' NOT NULL,
	"reforco_tendao_outro" text,
	"image_urls" jsonb,
	"observacoes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patella_fracture" (
	"id" serial PRIMARY KEY NOT NULL,
	"surgery_id" integer NOT NULL,
	"classificacao_ao_ota" text,
	"classificacao_subtipo" text,
	"data_lesao" text,
	"data_cirurgia_definitiva" text,
	"acesso" text[] DEFAULT '{}' NOT NULL,
	"acesso_outro" text,
	"cirurgia" text[] DEFAULT '{}' NOT NULL,
	"cirurgia_outro" text,
	"complicacoes_agudas" text[] DEFAULT '{}' NOT NULL,
	"complicacoes_agudas_outro" text,
	"complicacoes_tardias" text[] DEFAULT '{}' NOT NULL,
	"complicacoes_tardias_outro" text,
	"lesoes_associadas" text[] DEFAULT '{}' NOT NULL,
	"lesoes_associadas_outro" text,
	"observacoes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "periprosthetic_fracture" (
	"id" serial PRIMARY KEY NOT NULL,
	"surgery_id" integer NOT NULL,
	"classificacao_femur" text,
	"classificacao_tibia" text,
	"classificacao_patela" text,
	"estoque_patelar_mm" real,
	"controle_danos" boolean,
	"controle_danos_data" text,
	"controle_danos_indicacao" text[] DEFAULT '{}' NOT NULL,
	"controle_danos_indicacao_outro" text,
	"controle_danos_procedimento" text[] DEFAULT '{}' NOT NULL,
	"controle_danos_procedimento_outro" text,
	"definitiva_data" text,
	"localizacao" jsonb,
	"acesso_femur" text[] DEFAULT '{}' NOT NULL,
	"acesso_femur_outro" text,
	"extensao_abordagem" boolean,
	"extensao_abordagem_tipo" text,
	"extensao_abordagem_outro" text,
	"acesso_tibia" text[] DEFAULT '{}' NOT NULL,
	"opme" jsonb,
	"complicacoes_agudas" jsonb,
	"complicacoes_tardias" jsonb,
	"observacoes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pics_score" (
	"id" serial PRIMARY KEY NOT NULL,
	"surgery_id" integer NOT NULL,
	"pts_total" integer,
	"pts_risco" text,
	"pts_conduta" text,
	"fator_dominante" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "procedimento_meniscal" (
	"id" serial PRIMARY KEY NOT NULL,
	"surgery_id" integer NOT NULL,
	"contexto" text,
	"meniscectomia" boolean,
	"sutura" boolean,
	"lado_medial" boolean,
	"lado_lateral" boolean,
	"lesao_rampa" boolean,
	"lesao_raiz" boolean,
	"lesao_raiz_anterior" boolean,
	"lesao_corno_anterior" boolean,
	"lesao_corno_posterior" boolean,
	"lesao_alca_balde" boolean,
	"lesao_radial" boolean,
	"lesao_corpo" boolean,
	"fixacao_raiz" text,
	"centralizacao_raiz" boolean,
	"centralizacao_metodo" text,
	"tecnicas_sutura" text[] DEFAULT '{}' NOT NULL,
	"num_pontos" integer,
	"pontos_por_tecnica" text,
	"tipo_fio" text,
	"estimulo_biologico" boolean DEFAULT false,
	"estimulo_perfuracao_intercondilo" boolean DEFAULT false,
	"estimulo_ortobiologico" boolean DEFAULT false,
	"estimulo_ortobiologico_tipo" text,
	"lesao_discoide" boolean,
	"saucerizacao" boolean,
	"estimulo_coagulo_fibrina" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quadriceps_tendon_rupture" (
	"id" serial PRIMARY KEY NOT NULL,
	"surgery_id" integer NOT NULL,
	"classificacao" text,
	"data_lesao" text,
	"data_cirurgia_definitiva" text,
	"acesso" text[] DEFAULT '{}' NOT NULL,
	"acesso_outro" text,
	"cirurgia" text[] DEFAULT '{}' NOT NULL,
	"cirurgia_outro" text,
	"reforco" boolean,
	"reforco_tipo" text[] DEFAULT '{}' NOT NULL,
	"reforco_tendao" text[] DEFAULT '{}' NOT NULL,
	"reforco_tendao_outro" text,
	"image_urls" jsonb,
	"observacoes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tibial_plateau_fracture" (
	"id" serial PRIMARY KEY NOT NULL,
	"surgery_id" integer NOT NULL,
	"classificacao_schatzker" text,
	"controle_danos" boolean,
	"controle_danos_data" text,
	"data_lesao" text,
	"data_cirurgia_definitiva" text,
	"acesso" text[] DEFAULT '{}' NOT NULL,
	"acesso_outro" text,
	"cirurgia" text[] DEFAULT '{}' NOT NULL,
	"cirurgia_outro" text,
	"opme" jsonb,
	"enxerto_osseo" boolean,
	"complicacoes_agudas" text[] DEFAULT '{}' NOT NULL,
	"complicacoes_agudas_outro" text,
	"complicacoes_tardias" text[] DEFAULT '{}' NOT NULL,
	"complicacoes_tardias_outro" text,
	"lesoes_associadas" text[] DEFAULT '{}' NOT NULL,
	"lesoes_associadas_outro" text,
	"observacoes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tibial_spine_fracture" (
	"id" serial PRIMARY KEY NOT NULL,
	"surgery_id" integer NOT NULL,
	"classificacao_meyers" text,
	"data_lesao" text,
	"data_cirurgia_definitiva" text,
	"tecnica" text,
	"opme" jsonb,
	"material_sutura" text,
	"lesoes_associadas" text[] DEFAULT '{}' NOT NULL,
	"lca_subtipo" text,
	"lesoes_associadas_outro" text,
	"observacoes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "followup" (
	"id" serial PRIMARY KEY NOT NULL,
	"surgery_id" integer NOT NULL,
	"tempo" text NOT NULL,
	"data_avaliacao" text,
	"ikdc" real,
	"koos_sintomas" real,
	"koos_dor" real,
	"koos_funcao" real,
	"koos_esporte" real,
	"koos_qualidade" real,
	"lysholm" integer,
	"tegner" integer,
	"kujala" integer,
	"vas_dor" integer,
	"acl_rsi" real,
	"marx" integer,
	"womac" real,
	"koos12" real,
	"adm_flexao" integer,
	"adm_extensao" integer,
	"complicacoes" text[],
	"retorno_esporte" boolean,
	"nivel_retorno" text,
	"falha" boolean,
	"falha_type" text,
	"observacoes" text,
	"token" text,
	"escalas_enviadas" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "followup_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "scale_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"followup_id" integer NOT NULL,
	"nome_escala" text NOT NULL,
	"respostas" text NOT NULL,
	"score" real,
	"completado_em" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scheduled_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"surgery_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"periodo" text NOT NULL,
	"days_after_surgery" integer,
	"scheduled_date" text,
	"scales" text[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"followup_id" integer,
	"sent_at" timestamp with time zone,
	"whatsapp_message_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xray_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"cache_key" text NOT NULL,
	"result_json" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xray_cache_cache_key_unique" UNIQUE("cache_key")
);
--> statement-breakpoint
CREATE TABLE "surgery_media" (
	"id" serial PRIMARY KEY NOT NULL,
	"surgery_id" integer NOT NULL,
	"media_type" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"original_path" text NOT NULL,
	"preview_path" text,
	"preview_status" text DEFAULT 'pending' NOT NULL,
	"duration_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_contact_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"doctor_id" integer,
	"nome" text,
	"email" text,
	"celular" text,
	"crm" text,
	"mensagem" text NOT NULL,
	"lida" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resposta" text,
	"respondida_em" timestamp with time zone,
	"resposta_lida" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"doctor_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer,
	"mime_type" text NOT NULL,
	"object_path" text NOT NULL,
	"category" text,
	"descricao" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"doctor_id" integer,
	"method" text NOT NULL,
	"endpoint" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"ip_address" text,
	"user_agent" text,
	"request_body_hash" text,
	"response_status" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consentimentos" (
	"id" serial PRIMARY KEY NOT NULL,
	"doctor_id" integer NOT NULL,
	"tipo" text DEFAULT 'plataforma_docknee' NOT NULL,
	"texto_versao" text DEFAULT '1.0' NOT NULL,
	"texto_hash" text NOT NULL,
	"aceito" boolean DEFAULT true NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consentimentos_doctor_id_unique" UNIQUE("doctor_id")
);
--> statement-breakpoint
CREATE TABLE "secretaries" (
	"id" serial PRIMARY KEY NOT NULL,
	"doctor_id" integer NOT NULL,
	"nome" text NOT NULL,
	"email" text NOT NULL,
	"senha_hash" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "secretaries_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" serial PRIMARY KEY NOT NULL,
	"doctor_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"secretary_id" integer,
	"data" text NOT NULL,
	"hora" text NOT NULL,
	"tipo" text DEFAULT 'consulta' NOT NULL,
	"observacoes" text,
	"status" text DEFAULT 'agendado' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctor_surgery_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"doctor_id" integer NOT NULL,
	"hospitais" text DEFAULT '[]' NOT NULL,
	"planos_saude" text DEFAULT '[]' NOT NULL,
	"materiais" text DEFAULT '[]' NOT NULL,
	"fornecedores" text DEFAULT '[]' NOT NULL,
	"destinatarios" text DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_surgery_config_doctor_id_unique" UNIQUE("doctor_id")
);
--> statement-breakpoint
CREATE TABLE "scheduled_surgeries" (
	"id" serial PRIMARY KEY NOT NULL,
	"doctor_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"data" text NOT NULL,
	"hora" text NOT NULL,
	"tipo_cirurgia" text NOT NULL,
	"hospital" text,
	"plano_saude" text,
	"codigos_cbhpm" text,
	"materiais" text,
	"destinatarios" text,
	"status" text DEFAULT 'agendado' NOT NULL,
	"observacoes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_visits" (
	"id" serial PRIMARY KEY NOT NULL,
	"path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "care_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"surgeon_id" integer NOT NULL,
	"physio_id" integer NOT NULL,
	"surgery_id" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "care_links_physio_surgery_unique" UNIQUE("physio_id","surgery_id")
);
--> statement-breakpoint
CREATE TABLE "physio_appointments" (
	"id" serial PRIMARY KEY NOT NULL,
	"physio_id" integer NOT NULL,
	"physio_patient_id" integer,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"appointment_type" text DEFAULT 'sessao' NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "physio_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"physio_id" integer NOT NULL,
	"physio_patient_id" integer NOT NULL,
	"doc_type" text NOT NULL,
	"title" text,
	"content" jsonb NOT NULL,
	"pdf_url" text,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "physio_followups" (
	"id" serial PRIMARY KEY NOT NULL,
	"physio_id" integer NOT NULL,
	"physio_patient_id" integer NOT NULL,
	"care_link_id" integer,
	"source" text DEFAULT 'manual' NOT NULL,
	"phase" smallint,
	"title" text NOT NULL,
	"required_assessments" text[],
	"due_date" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp with time zone,
	"linked_assessment_ids" integer[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "physio_patients" (
	"id" serial PRIMARY KEY NOT NULL,
	"physio_id" integer NOT NULL,
	"patient_id" integer,
	"care_link_id" integer,
	"full_name" text NOT NULL,
	"cpf" text,
	"birth_date" date,
	"phone" text,
	"diagnosis" text,
	"diagnosis_code" text DEFAULT 'outro' NOT NULL,
	"protocol_id" integer,
	"protocol_start_date" date,
	"protocol_customized" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "physio_patients_physio_care_link_unique" UNIQUE("physio_id","care_link_id")
);
--> statement-breakpoint
CREATE TABLE "physiotherapists" (
	"id" serial PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"email" text NOT NULL,
	"senha_hash" text NOT NULL,
	"celular" text NOT NULL,
	"crefito" text,
	"cpf" text,
	"clinica" text,
	"cidade" text,
	"plan" text DEFAULT 'free' NOT NULL,
	"subscription_status" text DEFAULT 'none' NOT NULL,
	"stripe_customer_id" text,
	"patients_created_total" integer DEFAULT 0 NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "physiotherapists_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "rehab_assessments" (
	"id" serial PRIMARY KEY NOT NULL,
	"care_link_id" integer,
	"physio_patient_id" integer NOT NULL,
	"physio_id" integer NOT NULL,
	"phase" smallint,
	"assessment_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"computed" jsonb,
	"red_flags" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rehab_invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"surgeon_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"surgery_id" integer NOT NULL,
	"consent_recorded_at" timestamp with time zone NOT NULL,
	"consent_method" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_by" integer,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rehab_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "rehab_protocols" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"version" smallint DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"definition" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rehab_protocols_code_version_unique" UNIQUE("code","version")
);
--> statement-breakpoint
CREATE TABLE "doctor_locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"doctor_id" integer NOT NULL,
	"nome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctor_services" (
	"id" serial PRIMARY KEY NOT NULL,
	"doctor_id" integer NOT NULL,
	"service_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_service_unique" UNIQUE("doctor_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" serial PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"cnpj" text,
	"responsavel_nome" text NOT NULL,
	"responsavel_cpf" text NOT NULL,
	"responsavel_crm" text NOT NULL,
	"email" text NOT NULL,
	"senha_hash" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surgeries" ADD CONSTRAINT "surgeries_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surgeries" ADD CONSTRAINT "surgeries_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cpl_reconstruction" ADD CONSTRAINT "cpl_reconstruction_surgery_id_surgeries_id_fk" FOREIGN KEY ("surgery_id") REFERENCES "public"."surgeries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cpm_reconstruction" ADD CONSTRAINT "cpm_reconstruction_surgery_id_surgeries_id_fk" FOREIGN KEY ("surgery_id") REFERENCES "public"."surgeries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distal_femur_fracture" ADD CONSTRAINT "distal_femur_fracture_surgery_id_surgeries_id_fk" FOREIGN KEY ("surgery_id") REFERENCES "public"."surgeries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exame_ligamentar" ADD CONSTRAINT "exame_ligamentar_surgery_id_surgeries_id_fk" FOREIGN KEY ("surgery_id") REFERENCES "public"."surgeries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exame_patelar" ADD CONSTRAINT "exame_patelar_surgery_id_surgeries_id_fk" FOREIGN KEY ("surgery_id") REFERENCES "public"."surgeries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lca_algorithm" ADD CONSTRAINT "lca_algorithm_surgery_id_surgeries_id_fk" FOREIGN KEY ("surgery_id") REFERENCES "public"."surgeries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lca_leap_decision" ADD CONSTRAINT "lca_leap_decision_surgery_id_surgeries_id_fk" FOREIGN KEY ("surgery_id") REFERENCES "public"."surgeries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lcp_reconstruction" ADD CONSTRAINT "lcp_reconstruction_surgery_id_surgeries_id_fk" FOREIGN KEY ("surgery_id") REFERENCES "public"."surgeries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patelar_tendon_rupture" ADD CONSTRAINT "patelar_tendon_rupture_surgery_id_surgeries_id_fk" FOREIGN KEY ("surgery_id") REFERENCES "public"."surgeries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patella_fracture" ADD CONSTRAINT "patella_fracture_surgery_id_surgeries_id_fk" FOREIGN KEY ("surgery_id") REFERENCES "public"."surgeries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periprosthetic_fracture" ADD CONSTRAINT "periprosthetic_fracture_surgery_id_surgeries_id_fk" FOREIGN KEY ("surgery_id") REFERENCES "public"."surgeries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pics_score" ADD CONSTRAINT "pics_score_surgery_id_surgeries_id_fk" FOREIGN KEY ("surgery_id") REFERENCES "public"."surgeries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedimento_meniscal" ADD CONSTRAINT "procedimento_meniscal_surgery_id_surgeries_id_fk" FOREIGN KEY ("surgery_id") REFERENCES "public"."surgeries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quadriceps_tendon_rupture" ADD CONSTRAINT "quadriceps_tendon_rupture_surgery_id_surgeries_id_fk" FOREIGN KEY ("surgery_id") REFERENCES "public"."surgeries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tibial_plateau_fracture" ADD CONSTRAINT "tibial_plateau_fracture_surgery_id_surgeries_id_fk" FOREIGN KEY ("surgery_id") REFERENCES "public"."surgeries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tibial_spine_fracture" ADD CONSTRAINT "tibial_spine_fracture_surgery_id_surgeries_id_fk" FOREIGN KEY ("surgery_id") REFERENCES "public"."surgeries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followup" ADD CONSTRAINT "followup_surgery_id_surgeries_id_fk" FOREIGN KEY ("surgery_id") REFERENCES "public"."surgeries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scale_responses" ADD CONSTRAINT "scale_responses_followup_id_followup_id_fk" FOREIGN KEY ("followup_id") REFERENCES "public"."followup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_notifications" ADD CONSTRAINT "scheduled_notifications_surgery_id_surgeries_id_fk" FOREIGN KEY ("surgery_id") REFERENCES "public"."surgeries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_notifications" ADD CONSTRAINT "scheduled_notifications_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_notifications" ADD CONSTRAINT "scheduled_notifications_followup_id_followup_id_fk" FOREIGN KEY ("followup_id") REFERENCES "public"."followup"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surgery_media" ADD CONSTRAINT "surgery_media_surgery_id_surgeries_id_fk" FOREIGN KEY ("surgery_id") REFERENCES "public"."surgeries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_attachments" ADD CONSTRAINT "patient_attachments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_attachments" ADD CONSTRAINT "patient_attachments_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consentimentos" ADD CONSTRAINT "consentimentos_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secretaries" ADD CONSTRAINT "secretaries_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_secretary_id_secretaries_id_fk" FOREIGN KEY ("secretary_id") REFERENCES "public"."secretaries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_surgery_config" ADD CONSTRAINT "doctor_surgery_config_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_surgeries" ADD CONSTRAINT "scheduled_surgeries_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_surgeries" ADD CONSTRAINT "scheduled_surgeries_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_links" ADD CONSTRAINT "care_links_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_links" ADD CONSTRAINT "care_links_surgeon_id_doctors_id_fk" FOREIGN KEY ("surgeon_id") REFERENCES "public"."doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_links" ADD CONSTRAINT "care_links_physio_id_physiotherapists_id_fk" FOREIGN KEY ("physio_id") REFERENCES "public"."physiotherapists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_links" ADD CONSTRAINT "care_links_surgery_id_surgeries_id_fk" FOREIGN KEY ("surgery_id") REFERENCES "public"."surgeries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physio_appointments" ADD CONSTRAINT "physio_appointments_physio_id_physiotherapists_id_fk" FOREIGN KEY ("physio_id") REFERENCES "public"."physiotherapists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physio_appointments" ADD CONSTRAINT "physio_appointments_physio_patient_id_physio_patients_id_fk" FOREIGN KEY ("physio_patient_id") REFERENCES "public"."physio_patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physio_documents" ADD CONSTRAINT "physio_documents_physio_id_physiotherapists_id_fk" FOREIGN KEY ("physio_id") REFERENCES "public"."physiotherapists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physio_documents" ADD CONSTRAINT "physio_documents_physio_patient_id_physio_patients_id_fk" FOREIGN KEY ("physio_patient_id") REFERENCES "public"."physio_patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physio_followups" ADD CONSTRAINT "physio_followups_physio_id_physiotherapists_id_fk" FOREIGN KEY ("physio_id") REFERENCES "public"."physiotherapists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physio_followups" ADD CONSTRAINT "physio_followups_physio_patient_id_physio_patients_id_fk" FOREIGN KEY ("physio_patient_id") REFERENCES "public"."physio_patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physio_followups" ADD CONSTRAINT "physio_followups_care_link_id_care_links_id_fk" FOREIGN KEY ("care_link_id") REFERENCES "public"."care_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physio_patients" ADD CONSTRAINT "physio_patients_physio_id_physiotherapists_id_fk" FOREIGN KEY ("physio_id") REFERENCES "public"."physiotherapists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physio_patients" ADD CONSTRAINT "physio_patients_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physio_patients" ADD CONSTRAINT "physio_patients_care_link_id_care_links_id_fk" FOREIGN KEY ("care_link_id") REFERENCES "public"."care_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physio_patients" ADD CONSTRAINT "physio_patients_protocol_id_rehab_protocols_id_fk" FOREIGN KEY ("protocol_id") REFERENCES "public"."rehab_protocols"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rehab_assessments" ADD CONSTRAINT "rehab_assessments_care_link_id_care_links_id_fk" FOREIGN KEY ("care_link_id") REFERENCES "public"."care_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rehab_assessments" ADD CONSTRAINT "rehab_assessments_physio_patient_id_physio_patients_id_fk" FOREIGN KEY ("physio_patient_id") REFERENCES "public"."physio_patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rehab_assessments" ADD CONSTRAINT "rehab_assessments_physio_id_physiotherapists_id_fk" FOREIGN KEY ("physio_id") REFERENCES "public"."physiotherapists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rehab_invites" ADD CONSTRAINT "rehab_invites_surgeon_id_doctors_id_fk" FOREIGN KEY ("surgeon_id") REFERENCES "public"."doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rehab_invites" ADD CONSTRAINT "rehab_invites_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rehab_invites" ADD CONSTRAINT "rehab_invites_surgery_id_surgeries_id_fk" FOREIGN KEY ("surgery_id") REFERENCES "public"."surgeries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rehab_invites" ADD CONSTRAINT "rehab_invites_accepted_by_physiotherapists_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."physiotherapists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_locations" ADD CONSTRAINT "doctor_locations_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_services" ADD CONSTRAINT "doctor_services_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_services" ADD CONSTRAINT "doctor_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_doctor_id_idx" ON "audit_logs" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_resource_idx" ON "audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "consentimentos_doctor_id_idx" ON "consentimentos" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "idx_physio_agenda" ON "physio_appointments" USING btree ("physio_id","starts_at");--> statement-breakpoint
CREATE INDEX "idx_physio_docs_patient" ON "physio_documents" USING btree ("physio_patient_id","doc_type","created_at");--> statement-breakpoint
CREATE INDEX "idx_followups_dashboard" ON "physio_followups" USING btree ("physio_id","status","due_date");