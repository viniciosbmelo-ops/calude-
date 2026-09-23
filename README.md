# docsholder-core

Núcleo clínico do DocSholder (ombro e cotovelo) + API HTTP que o expõe. Ver `REPLIT_INTEGRACAO.md` para o núcleo.

```bash
npm install
npm test                 # 118 testes do núcleo + 24 de API (os de API exigem TEST_PGURL)
npm run typecheck
npm run lint:no-recommend
npm run seed:sql         # regenera db/seeds/002_pathology_catalog.sql a partir do catálogo
PGURL=postgres://.../banco_descartavel ./db/test/run.sh          # 12 testes de RLS em Postgres real
TEST_PGURL=postgres://superuser:senha@host/postgres npm run test:api   # cria e derruba um banco próprio
DATABASE_URL=... SUPABASE_JWT_SECRET=... npm start                    # API em :3000
```

## API (`server/`)

Cada request autenticada roda numa transação com `SET LOCAL ROLE authenticated` e o `sub` do JWT em
`request.jwt.claim.sub`/`request.jwt.claims` — mesma semântica do PostgREST. **A RLS da migração 001 é a
barreira de acesso**; o código da API não reimplementa permissão (há teste de mutação: sem o `SET ROLE`,
6 testes de isolamento falham). Recurso alheio responde **404**, não 403.

| Método e rota | O que faz |
|---|---|
| `GET /health` · `GET /verify/:hash` | Públicas. `/verify` devolve só `{valid, signed_at, superseded}` |
| `GET /api/pathologies?region=` | Catálogo agrupado por mãe (`children`) |
| `GET /api/schemas` · `/api/schemas/:id` · `/api/labels` · `/api/arthro-structures/:region` · `/api/instruments` | Referência para o `<SchemaForm>` |
| `POST /api/gs1/parse` · `POST /api/instability/metrics` · `GET /api/proms/schedule?surgery_date=` | Cálculos puros; `ClinicalGuardError` → 422 com `field` |
| `POST/GET /api/patients/:id/episodes` · `GET/PATCH /api/episodes/:id` | Episódios (PATCH só `status`, `secondary_pathologies`) |
| `GET /api/surgeries/defaults` | Anestesia, posicionamento, antibiótico, portais… da última cirurgia do cirurgião |
| `POST /api/episodes/:id/surgeries` · `GET/PATCH /api/surgeries/:id` | Cirurgia (rascunho aceita core incompleto; `completed` exige válido) |
| `POST /api/surgeries/:id/procedures` · `PUT/DELETE …/procedures/:procId` · `PUT …/procedures-order` | N procedimentos; reordenação atômica |
| `PUT /api/surgeries/:id/arthroscopic-map` | Substitui o mapa inteiro |
| `GET /api/implant-catalog?gtin=` · `POST/DELETE /api/surgeries/:id/implants` | `raw_barcode` é parseado e sempre guardado; item novo vai para o catálogo privado |
| `POST /api/surgeries/:id/report/generate` | Motor determinístico; exige tudo válido; só o cirurgião |
| `GET/PATCH /api/reports/:id` | Retorna checklist pré-assinatura; PATCH grava `final_text` + diff de linhas |
| `POST /api/reports/:id/sign` `{confirm_warnings}` | BLOCKER → 422; WARNING sem confirmação → 409; `signed_at` do servidor; devolve agenda de PROMs |
| `GET /api/reports/:id/integrity` | Recalcula o hash a partir do conteúdo gravado |
| `POST/GET /api/episodes/:id/proms` | Escores do médico; ASES/MEPS bloqueados (licença `pending`); séries separadas por máximo |

Erros do banco: `23514` (triggers do núcleo) → 422 com a mensagem original; `42501` → 404; `23505` → 409.

**Rascunho vs. finalizado:** procedimentos e core podem ser gravados incompletos (autosave) e toda
escrita devolve `validation`. Gerar e assinar relatório exigem 100% válido pelos schemas.

### Antes de usar em produção — decisões e limites conhecidos

1. **Migração nova:** aplique `db/migrations/003_api_support.sql` (função `verify_report_hash` para `anon`).
2. **Conexão:** `DATABASE_URL` precisa de um usuário que possa `SET ROLE authenticated`/`anon` (no Supabase,
   o `postgres` da conexão direta pode). Isso substitui o cliente supabase-js sugerido no Prompt 2: mesma RLS,
   mas com transações (necessárias para versionar relatório e reordenar procedimentos).
3. **JWT:** HS256 com `SUPABASE_JWT_SECRET`. Projetos com chaves assimétricas (JWKS) precisam trocar `server/auth.ts`.
4. **Dados do relatório:** `defaultPartiesResolver` lê `public.patient.name` e o cirurgião de
   `user_metadata.full_name`/`crm` do JWT. Ajuste para o prontuário real (nº de prontuário, CRM oficial).
5. **Só o cirurgião (`surgery.surgeon_id`) gera e assina.** Membro de clínica lê, mas recebe 403 ao assinar.
   Foi uma escolha médico-legal minha — reverta se o fluxo real tiver assinatura delegada.
6. **Agenda de PROMs:** o núcleo não tem tabela de pendências; `sign` devolve `prom_schedule` e o app persiste.
7. **Tamanho do implante** (`size`) não existe em `surgery_implant`; não sai no relatório gerado pela API.
8. **Fora do escopo:** telas, PDF/QR, envio de PROM por link ao paciente, protocolos pós-operatórios.
