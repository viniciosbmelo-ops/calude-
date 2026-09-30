# Auditorias do DocKnee (somente leitura)

Scripts SQL para rodar **manualmente** no banco de produção do DocKnee. Todos
usam só `SELECT`, rodam em `BEGIN TRANSACTION READ ONLY` e terminam em
`ROLLBACK`: nenhum contém `UPDATE`, `DELETE` ou `INSERT`, e nenhum chama a API
da Stripe ou do WhatsApp.

| Script | Para quê |
|--------|----------|
| [`docknee-shifted-dates.sql`](#auditoria--datas-do-docknee-possivelmente-gravadas-1-dia-à-frente) | Datas gravadas 1 dia à frente (bug do "hoje em UTC"). |
| [`docknee-pending-rehab-red-flags.sql`](#alertas-de-red-flags-da-reabilitação-não-entregues) | Alertas de sinais de alerta da reabilitação que o cirurgião pode não ter recebido. |
| [`docknee-physio-stripe-subscriptions.sql`](#assinaturas-stripe-de-fisioterapeutas) | Fisioterapeutas com assinatura Stripe para cancelar. |

Recomendações gerais:

- Rode com `psql` (o script da Stripe usa `\if`); prefira uma réplica de
  leitura ou um horário de pouco uso. Cada consulta tem limite de 120 s.
- Para guardar o resultado: `psql "$DATABASE_URL" -f <script> > resultado.txt`.
  O arquivo contém **dados de pacientes** (nomes, telefones, sinais
  clínicos): guarde-o em local protegido e apague quando terminar.
- Se alguma tabela não existir no banco, o script para com erro (nada é
  alterado).

---

# Auditoria — datas do DocKnee possivelmente gravadas 1 dia à frente

`docknee-shifted-dates.sql` estima quantos registros do banco de produção do
DocKnee podem ter sido gravados com a data de **amanhã** por causa do antigo
"hoje em UTC" (`new Date().toISOString().slice(0, 10)`): entre 21:00 e 23:59
no horário de Brasília o dia UTC já é o seguinte.

**Assinatura do bug:** `created_at` em America/Sao_Paulo entre 21:00 e 23:59
**e** data gravada = dia de `created_at` (em BRT) + 1.

## Como rodar

```sh
psql "$DATABASE_URL" -f scripts/audit/docknee-shifted-dates.sql
```

- Só `SELECT`: tudo roda em `BEGIN TRANSACTION READ ONLY` e termina em
  `ROLLBACK`. O script não contém `UPDATE`, `DELETE` nem `INSERT`.
- Prefira uma réplica de leitura ou um horário de pouco uso; cada consulta tem
  limite de 120 s.
- Se alguma tabela não existir no banco, o script para com erro (nada é
  alterado); comente o bloco correspondente.

## O que cada consulta verifica

| # | Coluna | Critério |
|---|--------|----------|
| 0 | todas | Resumo por coluna: linhas criadas 21:00–23:59 BRT, quantas têm o dia BRT (corretas), quantas têm dia BRT + 1 (suspeitas) e um **controle** (dia + 1 criado antes das 21:00, que não é o bug — mostra a taxa "natural" de datas de amanhã). |
| 1 | `regen_cases.data_caso` | Data do caso (padrão "hoje" no formulário) = dia BRT da criação + 1. |
| 2 | `regen_followup_notifications.scheduled_date` | a) data base implícita (`scheduled_date − days_after_procedure`) = dia BRT da criação + 1; b) agenda que herdou a `data_caso` de um caso suspeito da consulta 1. |
| 3 | `followup.data_avaliacao` | Data da avaliação = dia BRT + 1 de `created_at` (preenchida automaticamente) ou de `updated_at` (formulário do médico). |
| 4 | `scheduled_surgeries.data` | Data da cirurgia agendada = dia BRT da criação + 1. |
| 5 | `physio_followups.due_date` | Vencimento = dia BRT da criação + 1 (foco em `source = 'manual'`). |
| 6 | `regen_lab_results.collected_at` | Informativo: distribuição de dias entre a coleta e o registro. |

Cada lista traz `id`, médico/fisioterapeuta, paciente, a data gravada e
`created_at` em BRT para revisão.

## Falsos positivos

Uma linha que bate com a assinatura **não é necessariamente um erro**: o
usuário pode ter digitado de propósito a data de amanhã.

- **`scheduled_surgeries.data`** — alto risco de falso positivo: marcar a
  cirurgia para o dia seguinte é comum.
- **`physio_followups.due_date` com `source = 'protocol'`** — calculado a partir
  da data de início do protocolo; quase certamente falso positivo.
- **`followup.data_avaliacao` pelo critério `updated_at`** — `updated_at` muda a
  cada edição; é só um indício.
- **`regen_followup_notifications` motivo b)** — só está errada se a
  `data_caso` do caso estiver de fato errada.
- **`regen_lab_results.collected_at`** — só se o servidor da API rodava fora de
  UTC; nesse caso a data ficava 1 dia **antes**, em qualquer horário. Não há
  assinatura segura; um acúmulo anormal em "1 dia" na distribuição é o sinal.
- `regen_cases.data_caso` e `followup.data_avaliacao` (critério `created_at`)
  são os casos mais prováveis de erro real, principalmente quando o controle
  (antes das 21:00) é baixo.

Compare sempre com o controle da consulta 0: se "suspeitas" for muito maior que
o controle proporcional, o bug é a explicação provável.

## Correção

**Não há correção automática.** Qualquer ajuste deve ser:

1. feito só depois de **backup** (ou snapshot) do banco;
2. **manual e revisado caso a caso**, de preferência confirmando com o médico
   ou fisioterapeuta responsável (prontuário, agenda, WhatsApp enviado);
3. registrado (quem alterou, quando, valor anterior e novo).

Atenção: mudar `data_caso` não recalcula a agenda de follow-up do caso
(`regen_followup_notifications`), e follow-ups já enviados ao paciente não
devem ser alterados retroativamente sem avaliação clínica.

---

# Alertas de red flags da reabilitação não entregues

`docknee-pending-rehab-red-flags.sql` lista os sinais de alerta registrados
por fisioterapeutas que talvez não tenham chegado ao cirurgião.

Quando o fisioterapeuta salvava uma avaliação (`rehab_assessments`) com red
flags de um paciente vinculado a um cirurgião (`care_links`), a API colocava
um alerta WhatsApp na fila `whatsapp_outbox` com
`event_type = 'rehab_red_flag'`. Com a remoção do portal do fisioterapeuta, o
worker da fila **deixou de enviar** esse tipo de alerta: o que estava
`pending` fica parado para sempre. Além disso, o cirurgião não vê mais essas
avaliações na tela.

## Como rodar

```sh
psql "$DATABASE_URL" -f scripts/audit/docknee-pending-rehab-red-flags.sql
```

## O que cada consulta retorna

| # | Conteúdo |
|---|----------|
| 1 | Linhas `rehab_red_flag` da fila com status ≠ `sent` (`pending`, `processing`, `failed`, `uncertain`), mais recentes primeiro: `outbox_id`, status, tentativas, último erro, `created_at` em horário de Brasília, cirurgião (id, nome, telefone de destino), paciente (id, nome, telefone), fisioterapeuta (id, nome, celular), avaliação (id, tipo, red flags) e o **texto da mensagem** que deveria ter sido enviada. |
| 2 | Resumo da fila `rehab_red_flag` por status (inclui `sent` para comparação), com a data mais antiga e a mais recente. |
| 3 | Avaliações com red flags **sem alerta confirmado**, com o motivo: `sem_vinculo_cirurgiao` (paciente próprio do fisioterapeuta, nunca houve alerta), `vinculo_inativo` (vínculo revogado/encerrado), `sem_alerta_na_fila` ou `alerta_<status>`. Traz os mesmos dados de cirurgião, paciente e fisioterapeuta, mais `computed` e `payload` da avaliação. |
| 4 | Resumo de todas as avaliações com red flags por motivo (inclui `alerta_sent`). |

Status `uncertain` significa que o provedor pode ter entregue ou não: confirme
com o cirurgião antes de tratar como não recebido.

## O que fazer com o resultado

1. **Leia cada mensagem e cada lista de red flags manualmente**, começando
   pelas mais recentes. Não há reenvio automático e o script não reenvia
   nada.
2. Para cada caso, avalie com o cirurgião responsável (ou, na falta dele, com
   o médico da equipe) se o sinal ainda é relevante. Se for, **entre em contato
   com o paciente** pelo telefone listado para verificar o estado atual e
   orientar consulta/avaliação presencial ou pronto-socorro quando indicado.
3. Casos `sem_vinculo_cirurgiao` eram pacientes próprios do fisioterapeuta:
   o contato é com o fisioterapeuta (celular listado), que responde pelo
   paciente.
4. Registre quem foi contatado, quando e a conduta (prontuário do paciente).
5. **Não** altere o status das linhas da fila para "sent" nem apague linhas:
   elas ficam como registro de auditoria.

---

# Assinaturas Stripe de fisioterapeutas

`docknee-physio-stripe-subscriptions.sql` lista as contas de fisioterapeuta
com cobrança Stripe (atual ou passada), para cancelar manualmente as
assinaturas que continuam ativas depois da remoção do portal.

A tabela `physiotherapists` guarda `plan`, `subscription_status` e
`stripe_customer_id` (não guarda o ID da assinatura). O ID `sub_…` vem da cópia
sincronizada da Stripe (`stripe.subscriptions`); se esse schema não existir no
banco, o script avisa e mostra só as consultas 1 e 2.

## Como rodar

```sh
psql "$DATABASE_URL" -f scripts/audit/docknee-physio-stripe-subscriptions.sql
```

## O que cada consulta retorna

| # | Conteúdo |
|---|----------|
| 1 | Fisioterapeutas com cliente Stripe, status ≠ `none` ou plano ≠ `free`: id, nome, e-mail, celular, plano, status local, `precisa_cancelar` (status `active`, `trialing` ou `past_due`), `stripe_customer_id`, `cliente_tambem_medico`, datas em horário de Brasília. Os que precisam de ação aparecem primeiro. |
| 2 | Resumo de todos os fisioterapeutas por status local e plano, com quantos têm cliente Stripe. |
| 3 | (se houver `stripe.subscriptions`) Cada assinatura ligada ao fisioterapeuta pelo cliente ou pelo `metadata.physio_id`: `stripe_subscription_id`, status na Stripe, `producao` (livemode), `cancela_no_fim_do_periodo`, fim do período atual e data de criação. |
| 4 | (se houver `stripe.subscriptions`) Resumo por status na Stripe: assinaturas e fisioterapeutas. |

O status local e a cópia da Stripe podem estar desatualizados: a fonte da
verdade é o **Stripe Dashboard**.

## O que fazer com o resultado

1. Para cada linha com `precisa_cancelar = t` (ou status Stripe `active`,
   `trialing`, `past_due`, `unpaid` ou `paused`), abra o **Stripe Dashboard →
   Customers**, busque pelo `stripe_customer_id` (`cus_…`) ou pelo e-mail,
   abra a assinatura (`sub_…`) e use **Cancel subscription**.
2. Escolha o momento do cancelamento:
   - **Imediato** — encerra agora; decida se gera crédito/reembolso
     proporcional (*prorate*) do período não usado;
   - **No fim do período** — o fisioterapeuta não é mais cobrado, mas o
     período já pago segue até o fim (`cancela_no_fim_do_periodo = t` indica
     que isso já foi pedido).
3. Decida sobre **reembolsos**: como o portal saiu do ar, cobranças de
   períodos em que o serviço não estava disponível podem ser reembolsadas em
   **Payments → (pagamento) → Refund**. Considere avisar cada
   fisioterapeuta por e-mail.
4. **Atenção a `cliente_tambem_medico = t`**: o mesmo cliente Stripe está num
   cadastro de médico. Confirme no Dashboard qual assinatura é do
   fisioterapeuta antes de cancelar, para não cancelar a do médico.
5. Use o modo certo do Dashboard: `producao = f` são assinaturas de teste
   (*Test mode*).
6. Depois de cancelar, o webhook da Stripe atualiza `subscription_status`
   no banco. Rode o script de novo para conferir: a consulta 1 não deve ter
   mais `precisa_cancelar = t`.
