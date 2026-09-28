ALTER TABLE "procedimento_meniscal"
  ADD COLUMN "dor_interlinha" text,
  ADD COLUMN "mc_murray_medial" boolean,
  ADD COLUMN "mc_murray_lateral" boolean,
  ADD COLUMN "apley_compressao" boolean,
  ADD COLUMN "apley_tracao" boolean,
  ADD COLUMN "marcha_pato" boolean,
  ADD COLUMN "steinmann_1" boolean,
  ADD COLUMN "steinmann_2" boolean,
  ADD COLUMN "observacoes_exame" text;