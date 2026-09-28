# DocKnee — código-fonte da plataforma

Exportação do workspace em 17/09/2026, preparada para um repositório GitHub.
Este pacote contém o código atual; não é uma cópia do banco de produção
nem inclui o histórico de commits.

## Conteúdo

- artifacts/docknee: interface web, recursos públicos, PWA e testes.
- artifacts/api-server: API, autenticação, módulos clínicos e integrações.
- artifacts/mockup-sandbox: ambiente de componentes e protótipos.
- lib: banco/schema/migrações, contrato OpenAPI, clientes gerados e bibliotecas.
- scripts: verificações, configuração e scripts de dados de referência.
- attached_assets: somente os dois documentos de referência usados/citados pelo código.
- Configurações de workspace, lockfile pnpm e configurações dos serviços Replit.

## Enviar ao GitHub

1. Extraia o ZIP.
2. Crie um repositório PRIVADO e vazio no GitHub.
3. No GitHub Desktop, use File > Add local repository e selecione a pasta
   DocKnee extraída. Se solicitado, escolha criar um repositório nessa pasta.
4. Faça o primeiro commit e use Publish repository, mantendo o repositório privado.
   Confira a lista de arquivos antes de enviar.

Alternativa pelo terminal, dentro da pasta extraída:

```bash
git init
git add .
git commit -m "Importar plataforma DocKnee"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
git push -u origin main
```

Substitua a URL pelo endereço real do seu repositório. Use o fluxo de
autenticação do GitHub, nunca inclua tokens em arquivos ou URLs versionadas.
Não envie o ZIP como único arquivo: envie seu conteúdo, preservando subpastas
e arquivos ocultos, como .replit-artifact/artifact.toml.

## Instalação e verificação

O projeto usa Node.js e pnpm em workspace, preparado para o ambiente Linux
do Replit. Existem exclusões de dependências nativas de outras plataformas;
rodar diretamente em macOS/Windows pode exigir adaptar essas exclusões.

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
pnpm run test:web
```

Os testes de integração da API exigem banco de TESTE dedicado. Não execute
scripts de teste/seed contra a base de produção.

## Configuração para executar

Versionar no GitHub não publica o site e não transfere automaticamente os
serviços externos. Reconfigure no provedor de hospedagem os segredos,
PostgreSQL, armazenamento, e-mail, IA, Stripe e demais integrações utilizadas.
As configurações dos serviços estão nos arquivos
artifacts/*/.replit-artifact/artifact.toml.

Exemplos de nomes de variáveis usados pelo código (nenhum valor é incluído):
DATABASE_URL, SESSION_SECRET, PORT, APP_URL, STRIPE_SECRET_KEY,
CONTACT_EMAIL, GMAIL_USER, GMAIL_APP_PASSWORD e variáveis dos provedores de IA
e armazenamento. Consulte os módulos e configurações para a lista aplicável.
Não basta criar um .env: disponibilize as variáveis ao processo conforme o
ambiente de execução. Integrações gerenciadas pelo Replit podem exigir
adaptação para rodar fora dele.

As migrações/schema estão incluídas. A inicialização da API verifica o
schema; não restaura dados nem substitui uma migração revisada.
scripts/post-merge.sh é exclusivo de desenvolvimento e pode alterar schema:
nunca o use para migrar produção.

## Privacidade e limites

Não foram incluídos: credenciais do ambiente, banco/prontuários, arquivos
privados do armazenamento, anexos gerais do chat, memória interna do agente,
histórico Git, node_modules, builds, caches e relatórios temporários.
Os recursos públicos já usados pelo site foram preservados.

Faça uma revisão de segurança, direitos sobre imagens e privacidade antes
de tornar o repositório público. A busca automatizada por padrões de
credenciais no pacote não substitui uma auditoria completa.

EXPORT-MANIFEST.json registra os arquivos e seus hashes SHA-256.
