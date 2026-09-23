# DocSholder — Núcleo Clínico v0.1.0 · Guia de integração no Replit

## O que este pacote JÁ entrega (testado)

| Módulo | Arquivo | Testes |
|---|---|---|
| Migração SQL: episódio, cirurgia 1:N procedimentos, mapa artroscópico, implantes, relatório imutável, eventos, PROMs, consentimento de pesquisa, RLS | `db/migrations/001_docsholder_core.sql` | 12 testes de RLS/integridade em PostgreSQL 16 real (`db/test/`) |
| Seed do catálogo (44 patologias de ombro e cotovelo) | `db/seeds/002_pathology_catalog.sql` (gerado de `src/clinical/catalog/pathologies.ts`) | — |
| JSON Schemas por patologia: núcleo cirúrgico, manguito, instabilidade anterior (diagnóstico + intraop), bíceps/SLAP, AC, artroplastia, bíceps distal | `src/clinical/schemas/*.json` | campos condicionais, faixas, rótulos |
| Validador (ajv, mensagens em PT-BR) + middleware Express 422 | `src/clinical/schemaRegistry.ts` | ✓ |
| Motor de relatório determinístico (Handlebars, sem LLM) + hash SHA-256 de assinatura | `src/clinical/report/` | determinismo (100×), snapshot, espelhamento do relógio D/E, zero ≠ vazio |
| Métricas de instabilidade (perda glenoidal, glenoid track, on/off-track, ISIS) com `ClinicalGuardError` | `src/clinical/instability/metrics.ts` | casos da spec + bordas |
| Parser GS1 (código de barras / DataMatrix de implantes) | `src/clinical/gs1/parser.ts` | 19 casos válidos/inválidos |
| Escores: SANE, ASES, Constant-Murley (com/sem força), MEPS, Rowe + agendamento de timepoints | `src/clinical/proms/instruments.ts` | mín/máx/faltantes/faixas |
| Checklist pré-assinatura (bloqueios e avisos) | `src/clinical/presign/checklist.ts` | ✓ |
| Guarda de produto: falha o build se aparecer "indicado/recomendado/sugere-se" em texto exibido | `scripts/check-forbidden-terms.ts` | ✓ |

**Suite:** 118 testes Jest, cobertura de linhas 98%. `npx tsc --noEmit` limpo.

> **Atualização:** os Prompts 2 a 8 já estão implementados e testados — API em `server/`, telas em `web/`,
> PDF com QR, `/verify`, PROM por link e agenda de seguimento. Ver `README.md`. Os prompts abaixo ficam
> como registro da especificação original; os "3 ajustes obrigatórios" continuam valendo.

## O que NÃO está aqui (é o trabalho do Replit Agent)

- Telas (formulário dirigido por schema, mapa artroscópico, editor do relatório, leitor de câmera)
- Rotas Express conectadas ao seu banco
- Exportação em PDF e rota pública `/verify/:hash`
- Envio de PROMs ao paciente por link
- Protocolos pós-operatórios (conteúdo clínico é seu)

---

## ANTES de rodar a migração — 3 ajustes obrigatórios

1. **`public.patient`**: a migração assume as colunas `id`, `owner_id` e `clinic_id`. Se os nomes forem outros no seu prontuário, ajuste as FKs e a função `care_episode_patient_guard`.
2. **`public.clinic_member`**: a função `can_access_owner()` consulta essa tabela. Se o DocKnee usa outra (ou um helper próprio), troque o corpo da função. **Não** remova a checagem de clínica sem substituir.
3. **Rode primeiro num banco descartável**: `PGURL=... ./db/test/run.sh` (o stub em `db/test/000_supabase_stub.sql` é **só para teste**; nunca aplicar em produção).

---

## Prompts sequenciais para o Replit Agent

> Suba a pasta `docsholder-core` para a raiz do repositório. Cole **um prompt por vez**. Só avance com `npm test` verde.

### Prompt 1 — Instalar o núcleo e aplicar a migração

```
Adicionei a pasta docsholder-core/ na raiz. Ela é o núcleo clínico do DocSholder e JÁ ESTÁ TESTADA — não reescreva a lógica dela.

1. Leia docsholder-core/REPLIT_INTEGRACAO.md inteiro.
2. Mova docsholder-core/src/clinical para server/clinical (ou o diretório de backend equivalente deste projeto) e ajuste os imports. Adicione as dependências ajv, ajv-formats, handlebars e as devDependencies de teste (jest, ts-jest, @types/jest) ao package.json do projeto. Copie tests/ para o diretório de testes do backend e configure o jest para rodá-los. Todos os 118 testes devem passar SEM alteração nos testes.
3. Inspecione a tabela de pacientes existente e a tabela de membros de clínica. Ajuste SOMENTE a função can_access_owner() e as referências a public.patient em db/migrations/001_docsholder_core.sql para os nomes reais. Me mostre o diff antes de aplicar.
4. Aplique 001_docsholder_core.sql e depois db/seeds/002_pathology_catalog.sql no Supabase.
5. Adapte db/test/900_rls_tests.sql aos nomes reais e rode contra um banco de teste (não produção). Todos os 12 blocos devem imprimir OK.
Critério de aceite: npm test verde; 12 OK nos testes de RLS.
```

### Prompt 2 — Rotas de episódio e catálogo

```
Usando server/clinical (não altere a lógica):
1. GET /api/pathologies?region=shoulder|elbow → lista de pathology_catalog agrupada por parent_code.
2. POST /api/patients/:id/episodes, GET /api/patients/:id/episodes, GET /api/episodes/:id, PATCH /api/episodes/:id (status, secondary_pathologies).
3. Todas as queries com o JWT do usuário (cliente Supabase do usuário, não service_role), para que a RLS valha.
4. Testes de integração: usuário A não lê nem altera episódio de B (esperar 404, não 403, para não vazar existência).
5. UI: aba "Episódios" na ficha do paciente: região → lado → dominância → patologia principal (árvore) → secundárias (chips) → mecanismo → data de início.
```

### Prompt 3 — Formulário dirigido por schema

```
Crie o componente <SchemaForm> no frontend que renderiza qualquer schema de server/clinical/schemas (exponha-os via GET /api/schemas/:id).
- enum → chips (ou segmented se ≤4 opções); boolean → toggle; number → input numérico com unidade inferida do nome do campo (_mm → mm, _deg → °, _pct → %, _cm → cm, _kg → kg); array de enum → multi-chips; object → seção recolhível.
- Rótulos SEMPRE de server/clinical/labels.pt.json (exponha via GET /api/labels). Nenhum texto hardcoded.
- allOf/if-then: campo que passa a ser obrigatório ganha destaque imediatamente.
- x-ui "clock_face": seletor de relógio com passo de 0,5 h; guardar SEMPRE na convenção de ombro direito e exibir espelhado quando o lado for esquerdo (h → 12 − h).
- Validar no cliente com o mesmo schema (ajv no browser) e no servidor com validateAgainstSchema.
Critério: com SH_RCT.intraop.v1, selecionar SSC faz aparecer Lafosse como obrigatório; rotura total sem tamanho não deixa salvar.
```

### Prompt 4 — Registro cirúrgico

```
Fluxo "Nova cirurgia" a partir de um episódio:
1. Passo 1: núcleo (CORE_SURGERY.v1) com defaults copiados da última cirurgia do mesmo cirurgião (anestesia, posicionamento, antibiótico, portais).
2. Passo 2: mapa artroscópico — linhas de ARTHRO_STRUCTURES[region] com 4 botões (Normal / Lesão / Tratada / N.A.). "Lesão" abre campo curto de achado e campo "justificativa se não tratada".
3. Passo 3: "+ Procedimento" → escolher patologia do episódio (principal, secundárias ou filhas) → SchemaForm do intraop correspondente. N procedimentos, ordenáveis por arrastar (atualiza sequence).
4. Autosave (draft) com indicador "salvo".
5. O banco já bloqueia lado divergente e patologia fora do episódio — traduza esses erros (códigos 23514) em mensagens amigáveis.
Critério: registrar manguito + tenodese do bíceps + ressecção da clavícula distal na MESMA cirurgia.
```

### Prompt 5 — Implantes

```
1. Modal de leitura com html5-qrcode. Ao ler, chame parseGs1() de server/clinical (exponha POST /api/gs1/parse). Guarde raw_barcode sempre.
2. GTIN → busca em implant_catalog (global + privado). Se não existir: cadastro rápido no catálogo privado.
3. Cada implante pode ser vinculado a um procedimento e ter "localização".
4. Entrada manual continua possível (sem câmera).
Critério: ler um DataMatrix real de âncora e preencher GTIN/lote/validade.
```

### Prompt 6 — Relatório e assinatura

```
1. POST /api/surgeries/:id/report/generate → monta ReportInput a partir do banco e chama new ReportEngine().generate(). Grava generated_text e final_text (igual, inicialmente) em surgical_report (versão nova, não assinada).
2. Editor de texto simples para o médico revisar final_text; mostrar diff vs generated_text.
3. Antes de assinar: runPresignChecklist(). BLOCKER impede; WARNING exige marcar "confirmo".
4. Assinar: signed_at vem do SERVIDOR; calcule reportHash({surgery_id, version, template_versions, final_text, signed_by, signed_at}) e grave. O banco bloqueia qualquer alteração depois disso.
5. Correção após assinatura = nova versão com supersedes.
6. PDF: cabeçalho do cirurgião, texto, hash e QR para /verify/:hash (rota pública que responde apenas válido/inválido + data, sem conteúdo clínico).
PROIBIDO chamar LLM neste fluxo.
```

### Prompt 7 — Painel de instabilidade

```
Na tela de diagnóstico de SH_INST_ANT, após salvar, chame evaluateInstabilityMetrics() e mostre o painel "Fatores documentados" em 3 colunas: Métricas ósseas | Fatores do paciente | Dados faltantes.
- Cada número com a referência (tooltip com a citação Vancouver).
- ClinicalGuardError → mostrar a mensagem no campo, sem calcular.
- Sem TC: mostrar "perda óssea não quantificada por TC" — nunca estimar.
- Nenhum texto de indicação de conduta (o teste guardrails.test.ts falha se aparecer).
```

### Prompt 8 — Escores e seguimento

```
1. Tela de escores clínicos (Constant, MEPS, Rowe) para o médico; SANE por link ao paciente.
2. ASES e MEPS estão com license_status 'pending' em instruments.ts: NÃO altere para 'free' — isso depende de confirmação de licença pelo responsável.
3. Constant sem dinamômetro: salvar com max 75 e flag constant_no_strength; o gráfico NUNCA deve misturar Constant/75 com Constant/100.
4. scheduleTimepoints(surgery_date) ao assinar o relatório → criar pendências de PROM.
5. Gráfico pré-op → timepoints por paciente.
```

---

## Decisões embutidas no código (mudar só conscientemente)

- **Relógio glenoidal** armazenado na convenção do ombro direito; relatório espelha para o esquerdo.
- **Igualdade HSI = GT → on-track** (off-track só se HSI > GT, conforme Di Giacomo 2014).
- **Faixa 15–40 mm do diâmetro glenoidal** é guarda de unidade (pega cm digitado como mm), não normalidade.
- **Constant: 1 ponto por libra**, kg × 2,20462 arredondado para baixo, teto 25.
- **Nenhum escore imputa itens faltantes** na v1.
- **0 é dado**: ângulos/medidas iguais a 0 aparecem no relatório (helper `has`); contagens iguais a 0 não geram frase.
- Relatório assinado é imutável **até para service_role** (trigger).
