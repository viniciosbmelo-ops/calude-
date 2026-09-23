# docsholder-core

Núcleo clínico do DocSholder (ombro e cotovelo). Ver `REPLIT_INTEGRACAO.md`.

```bash
npm install
npm test            # 118 testes
npm run typecheck
npm run seed:sql    # regenera db/seeds/002_pathology_catalog.sql a partir do catálogo
PGURL=postgres://.../banco_descartavel ./db/test/run.sh   # testes de RLS em Postgres real
```
