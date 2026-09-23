# DocSholder

Registro clínico de ombro e cotovelo: episódios, cirurgia com vários procedimentos, mapa artroscópico,
implantes por código GS1, relatório cirúrgico **determinístico** (sem IA) com assinatura e verificação
pública, escores (PROMs) com seguimento automático e link para o paciente.

```
src/clinical/   núcleo clínico (schemas, motor de relatório, métricas, GS1, escores) — testado, não reescrever
server/         API Express + Postgres; a RLS do banco é a barreira de acesso
web/            app React (Vite)
db/             migrações, seed do catálogo, testes de RLS, setup
tests/          Jest: núcleo, auth, API com Postgres real
e2e/            Playwright: fluxo completo pela interface (desktop e celular)
```

## Rodar localmente (Postgres puro, sem Supabase)

Requisitos: Node 22+, PostgreSQL 15+ e `psql`.

```bash
npm run setup                                                  # dependências do servidor e do web
createdb docsholder
STANDALONE=1 DATABASE_URL=postgres://usuario:senha@localhost/docsholder npm run db:setup
npm run build                                                  # compila o frontend em web/dist

DATABASE_URL=postgres://usuario:senha@localhost/docsholder \
SUPABASE_JWT_SECRET=qualquer-segredo-com-32-ou-mais-caracteres \
DEV_LOGIN=1 npm start                                          # http://localhost:3000
```

`DEV_LOGIN=1` libera um login **sem senha** (e-mail + nome + CRM) só para desenvolvimento.
O servidor se recusa a subir com `DEV_LOGIN=1` e `NODE_ENV=production`.

Para desenvolver o frontend com recarga: `npm run dev:api` (porta 3000) e `npm run dev:web` (porta 5173, com proxy para a API).

## Produção com Supabase

1. **Tabelas de paciente/clínica.** Se o seu projeto já tem `public.patient` e `public.clinic_member`,
   ajuste os nomes em `db/migrations/001_docsholder_core.sql` (ver `REPLIT_INTEGRACAO.md`) e **não** aplique
   `000_base_patient.sql`. Se não tem, aplique-a.
2. **Migrações** (sem `STANDALONE`): `DATABASE_URL=<conexão direta como postgres> npm run db:setup`.
   Teste antes num banco descartável: `PGURL=... npm run db:test` (12 testes de RLS).
3. **Variáveis de ambiente:**

| Variável | Obrigatória | Para quê |
|---|---|---|
| `DATABASE_URL` | sim | Conexão direta. O usuário precisa poder `SET ROLE authenticated`, `anon` e `docsholder_public` (o `postgres` do Supabase pode; a 004 concede o último). |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | sim | Login no frontend e verificação dos tokens pelo JWKS do projeto. |
| `SUPABASE_JWT_SECRET` | se o projeto usa o segredo JWT legado (HS256) | Os dois modos são aceitos: HS256 pelo segredo, ES256/RS256 pelo JWKS. |
| `PUBLIC_BASE_URL` | recomendado | Endereço público usado no QR do PDF e nos links de PROM. |
| `NODE_ENV=production`, `PORT` | — | |

4. `npm run setup && npm run build && npm start`.
5. Nome e CRM do cirurgião vêm de `user_metadata.full_name` / `crm` do usuário (editáveis em **Perfil**).

## Testes

```bash
npm run typecheck && npm run lint:no-recommend
npm test                                                     # núcleo + auth; API é pulada sem TEST_PGURL
TEST_PGURL=postgres://superusuario:senha@localhost/postgres npm test   # + 32 testes de API (cria/derruba banco próprio)
E2E_BASE_URL=http://localhost:3000 npm run e2e               # app rodando com DEV_LOGIN=1
```

O CI (`.github/workflows/ci.yml`) roda tudo isso com Postgres 16, incluindo o e2e.

## Como a segurança funciona

- Cada request roda numa transação com `SET LOCAL ROLE authenticated` + `sub` do JWT: as políticas RLS
  decidem o acesso. Há teste de mutação: sem o `SET ROLE`, os testes de isolamento falham. Recurso alheio → **404**.
- Relatório assinado é imutável até para `service_role` (trigger). O hash SHA-256 é recalculável
  (`GET /api/reports/:id/integrity`) e `/verify/:hash` confirma só validade e data — nenhum dado clínico.
- Link de PROM: token de 256 bits exibido uma única vez; o banco guarda só o SHA-256. As rotas públicas
  rodam como `docsholder_public`, role que só executa as duas funções de convite e não é alcançável pelo
  PostgREST. A pontuação é sempre calculada no servidor; o paciente não vê o escore.
- CSP restritiva **sem `unsafe-eval`**: o navegador usa validadores ajv pré-compilados
  (`web/src/generated/validators.js`, gerado por `scripts/generate-validators.ts` a cada build; um teste falha se
  estiver desatualizado em relação aos schemas). `Referrer-Policy: no-referrer` (o token de PROM está na URL), `X-Frame-Options: DENY`.
- Guarda de produto: `lint:no-recommend` falha se aparecer texto de indicação de conduta no núcleo, na API ou nas telas.

## Decisões que você precisa conferir

1. **Só o cirurgião da cirurgia gera e assina o relatório.** Membros da clínica leem. Mude se houver assinatura delegada.
2. **Protocolos pós-operatórios são texto seu** (tela Protocolos). O sistema não traz conteúdo clínico; use o
   código padrão da patologia (ex.: `PROT_RCR_STANDARD`) para pré-seleção no relatório.
3. **ASES e MEPS continuam bloqueados** (`license_status: 'pending'`) até você confirmar a licença.
   Por isso o único instrumento enviável ao paciente hoje é o SANE.
4. **Constant sem dinamômetro** fica sobre 75, em série separada — nunca normalizado para 100.
5. **ISIS pede a idade na cirurgia**, digitada no painel; o sistema não estima.
6. Rascunhos (núcleo e procedimentos) salvam incompletos com autosave; gerar e assinar exigem 100% válido.

## Limites conhecidos

- Não testado contra um projeto Supabase real (não há acesso daqui). O modo JWKS foi testado com um
  servidor de chaves local; o caminho `/auth/v1/.well-known/jwks.json` é o documentado pela Supabase
  até a data deste código — confira no painel do seu projeto.
- Leitura por câmera (html5-qrcode) não foi testada com um DataMatrix físico; o e2e usa o código digitado.
- Sem limitação de taxa nas rotas públicas (tokens de 256 bits tornam força bruta inviável, mas não há proteção contra volume).
- O PDF é apresentação; a prova de integridade é o hash.
- Envio automático de link por WhatsApp/e-mail não existe: o médico copia o link (há atalho para o WhatsApp).
