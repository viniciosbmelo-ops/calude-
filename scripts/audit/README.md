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
