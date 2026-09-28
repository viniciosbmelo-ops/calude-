# Documentação de Compliance LGPD — DocKnee
**Versão:** 1.0 | **Data:** 2026-05-12 | **Revisão:** Anual (próxima: 2026-11-12)  
**Lei:** Lei Geral de Proteção de Dados Pessoais — Lei nº 13.709/2018  
**Órgão regulador:** Autoridade Nacional de Proteção de Dados (ANPD)  
**DPO:** Vinicios Barreto Melo, CRM-ES 13416  
**Assinatura digital:** Vinicios Barreto Melo — 2026-05-12

---

## 1. Identificação do Controlador

| Campo | Informação |
|---|---|
| **Razão Social** | DocKnee Plataforma Médica |
| **Produto** | DocKnee — Documentação Cirúrgica do Joelho |
| **Finalidade** | Plataforma SaaS para documentação e análise de cirurgias ortopédicas |
| **Classificação dos dados** | **Dados pessoais sensíveis** (Art. 5º, II — dados de saúde) |
| **Encarregado de Dados (DPO)** | Vinicios Barreto Melo — CRM-ES 13416 (Art. 41 LGPD) |
| **Responsabilidades do DPO** | Supervisão de conformidade LGPD, gestão de direitos do titular, resposta a incidentes |

---

## 2. Registro de Operações de Tratamento (ROPA)

### 2.1 Dados dos Médicos (Controladores Secundários)

| Atributo | Detalhe |
|---|---|
| **Dados coletados** | Nome, e-mail, CPF, CRM, endereço, telefone, especialidade |
| **Finalidade** | Autenticação, documentação cirúrgica, contato profissional |
| **Base legal** | Art. 7º, V — execução de contrato; Art. 7º, II — consentimento |
| **Retenção** | Enquanto ativo + 5 anos após encerramento (obrigação legal médica) |
| **Compartilhamento** | Administrador da plataforma (agregação científica) |

### 2.2 Dados dos Pacientes

| Atributo | Detalhe |
|---|---|
| **Dados coletados** | Nome, CPF, data de nascimento, sexo, telefone, e-mail |
| **Dados sensíveis** | Histórico clínico, diagnósticos, procedimentos cirúrgicos, escalas funcionais |
| **Finalidade** | Documentação clínica, acompanhamento pós-operatório, pesquisa científica |
| **Base legal** | **Art. 11, §2º, f** — tutela da saúde; **Art. 11, §2º, c** — pesquisa científica |
| **Retenção** | 20 anos (Resolução CFM nº 1.821/2007 — prontuário médico) |
| **Compartilhamento** | Apenas o médico responsável; admin apenas para dados agregados/anonimizados |

### 2.3 Dados de Uso da Plataforma

| Atributo | Detalhe |
|---|---|
| **Dados coletados** | Endereço IP, user-agent, timestamps de acesso, endpoints acessados |
| **Finalidade** | Segurança, auditoria, detecção de fraude |
| **Base legal** | Art. 7º, IX — legítimo interesse; Art. 7º, X — proteção ao crédito |
| **Retenção** | 5 anos (logs de auditoria — Art. 16, I LGPD) |
| **Compartilhamento** | Não compartilhado externamente |

---

## 3. Direitos do Titular — Implementação (Art. 18)

| Direito | Endpoint | Prazo | Status |
|---|---|---|---|
| **I — Confirmação de tratamento** | `GET /api/lgpd/consentimento` | Imediato | ✅ Implementado |
| **II — Acesso aos dados** | `GET /api/lgpd/dados` | 15 dias | ✅ Implementado |
| **III — Correção** | `PATCH /api/doctors/me` | 15 dias | ✅ Implementado |
| **IV — Anonimização** | `POST /api/lgpd/anonimizar-paciente/:id` | 15 dias | ✅ Implementado |
| **V — Portabilidade** | `GET /api/lgpd/exportar?formato=csv\|json` | 15 dias | ✅ Implementado |
| **VI — Eliminação** | `DELETE /api/lgpd/solicitar-exclusao` | 15 dias | ✅ Implementado (soft delete) |
| **VII — Informação sobre compartilhamento** | Presente neste documento | Imediato | ✅ Documentado |
| **VIII — Revogação do consentimento** | `POST /api/lgpd/consentimento` com `aceito: false` | Imediato | ✅ Implementado |
| **IX — Oposição** | Via `DELETE /api/lgpd/solicitar-exclusao` | 15 dias | ✅ Implementado |

### 3.1 Processo de Solicitação de Direitos

1. Médico autenticado acessa qualquer endpoint `/api/lgpd/*`
2. Solicitação registrada automaticamente em `audit_logs`
3. Para exclusão: notificação ao administrador via `GET /api/admin/lgpd/exclusoes`
4. Prazo máximo de resposta: **15 dias úteis** (Art. 18, §5º)

---

## 4. Consentimento (Art. 8º)

### 4.1 Registro de Consentimento

- **Tabela:** `consentimentos` no PostgreSQL
- **Campos rastreados:** `doctor_id`, `aceito`, `texto_hash` (SHA-256), `texto_versao`, `ip_address`, `user_agent`, `created_at`
- **Prova de consentimento:** Hash SHA-256 do texto completo do termo
- **Versioning:** Campo `texto_versao` para rastrear mudanças no termo
- **Revogação:** Endpoint `POST /api/lgpd/consentimento` com `{"aceito": false}`

### 4.2 Texto do Termo (Versão 1.0)

> *"Autorizo o armazenamento e processamento dos meus dados profissionais e dos dados clínicos dos meus pacientes para fins de documentação cirúrgica ortopédica. Meus dados serão protegidos conforme a LGPD (Lei nº 13.709/2018). Os dados de pacientes serão mantidos conforme obrigações legais (CFM Res. 1.821/2007). Posso revogar este consentimento a qualquer momento através da plataforma."*

---

## 5. Medidas de Segurança Técnica (Art. 46)

### 5.1 Controles de Acesso

| Controle | Implementação |
|---|---|
| **Autenticação** | JWT com `SESSION_SECRET` via variável de ambiente (nunca hardcoded) |
| **Hashing de senhas** | `bcryptjs` com salt rounds adequados |
| **Autorização por recurso (BOLA)** | Verificação `doctorId === req.doctorId` em todos os 23 endpoints |
| **Separação admin/médico** | Middleware `requireAdmin` em todas as rotas administrativas |

### 5.2 Segurança em Trânsito

| Controle | Implementação |
|---|---|
| **Headers HTTP** | `Helmet.js` — X-Frame-Options, X-Content-Type-Options, Referrer-Policy, etc. |
| **HSTS** | `max-age=31536000; includeSubDomains; preload` |
| **HTTPS** | TLS via Replit Deployments (produção) |
| **Trust proxy** | Configurado para leitura correta de IP real via X-Forwarded-For |

### 5.3 Proteção contra Abusos

| Controle | Implementação |
|---|---|
| **Rate limiting global** | 300 req/min por IP (DDoS / scraping) |
| **Rate limiting de auth** | 10 tentativas/15min por IP — apenas falhas (brute-force) |
| **Rate limiting de registro** | 3 registros/hora por IP (spam/bot) |
| **Rate limiting de IA** | 20 análises/dia por médico autenticado |

### 5.4 Auditoria e Rastreabilidade

| Controle | Implementação |
|---|---|
| **Tabela `audit_logs`** | Registra TODA operação em `/api/*` |
| **Campos registrados** | `method`, `endpoint`, `doctor_id`, `resource_type`, `resource_id`, `ip_address`, `user_agent`, `request_body_hash` (SHA-256), `response_status`, `created_at` |
| **Redação de dados sensíveis** | Campos `senha`, `senhaHash`, `cpf`, `token` são removidos do hash antes de registrar |
| **Retenção dos logs** | 5 anos (Art. 16, I LGPD) |
| **Índices de busca** | Por `doctor_id`, `created_at`, `resource_type + resource_id` |

---

## 6. Suboperadores e Transferências Internacionais (Art. 33)

| Suboperador | Finalidade | País | Base legal para transferência |
|---|---|---|---|
| **Replit** | Hospedagem e infraestrutura | EUA | Art. 33, I — país com proteção adequada |
| **PostgreSQL (Neon/Replit)** | Banco de dados relacional | EUA | Art. 33, I |
| **OpenAI** | Análise de imagens radiográficas (opcional) | EUA | Art. 33, V — consentimento específico |

**Nota:** Nenhum dado de identificação pessoal é enviado ao OpenAI. Apenas imagens radiográficas anonimizadas são processadas.

---

## 7. Política de Retenção e Descarte (Art. 15-16)

| Categoria | Período de Retenção | Após vencimento |
|---|---|---|
| **Dados do médico** | Vigência do contrato + 5 anos | Exclusão ou anonimização |
| **Prontuários de pacientes** | 20 anos (CFM Res. 1.821/2007) | Arquivamento seguro |
| **Logs de auditoria** | 5 anos | Exclusão permanente |
| **Consentimentos** | Enquanto vigente + 5 anos | Exclusão (mas hash mantido para prova) |
| **Dados de sessão (JWT)** | Duração do token (configurável) | Invalida automaticamente |

### 7.1 Processo de Exclusão

1. Médico solicita via `DELETE /api/lgpd/solicitar-exclusao`
2. Campo `deletion_requested_at` preenchido no banco
3. Administrador visualiza lista em `GET /api/admin/lgpd/exclusoes`
4. Dados pessoais anonimizados em até 15 dias
5. Dados clínicos retidos pelo período legal obrigatório (Art. 16, I)
6. Log de exclusão mantido em `audit_logs` por 5 anos

---

## 8. Plano de Resposta a Incidentes (Art. 48)

### 8.1 Classificação de Incidentes

| Nível | Descrição | Prazo de notificação ANPD |
|---|---|---|
| **Crítico** | Vazamento de dados de saúde | 72 horas |
| **Alto** | Acesso não autorizado a prontuários | 72 horas |
| **Médio** | Tentativa de acesso bloqueada | 7 dias (relatório consolidado) |
| **Baixo** | Anomalia de rate limiting | Monitoramento interno |

### 8.2 Detecção de Incidentes

- Logs de auditoria com todos os acessos registrados em `audit_logs`
- Padrões de rate limiting detectam tentativas de brute-force
- Admin pode filtrar logs por IP, médico ou endpoint suspeito em `GET /api/admin/audit-logs`

### 8.3 Contatos para Notificação ANPD

- **Portal ANPD:** https://www.gov.br/anpd
- **Formulário de Incidente:** https://www.gov.br/anpd/comunicacao-de-incidentes
- **Prazo:** 72 horas após ciência do incidente (Art. 48, §1º)

---

## 9. Avaliação de Impacto (DPIA — Art. 38)

### 9.1 Justificativa

A plataforma DocKnee processa **dados sensíveis de saúde** (Art. 5º, II), o que exige DPIA conforme Resolução CD/ANPD nº 2/2022.

### 9.2 Riscos Identificados e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Acesso não autorizado a prontuários | Baixa | Crítico | BOLA em todos endpoints, JWT obrigatório |
| Vazamento de senha | Baixa | Alto | bcryptjs + hash nunca exposto na API |
| Enumeração de pacientes (IDOR) | Baixa | Alto | `doctor_id` verificado em todas as queries |
| Força bruta no login | Média | Médio | Rate limit 10/15min apenas para falhas |
| Dados em logs | Baixa | Médio | Campos sensíveis redacted antes de hash |
| Retenção excessiva | Baixa | Médio | Política definida neste documento + soft delete |

---

## 10. Conformidade com Regulações Específicas

### 10.1 LGPD (Lei nº 13.709/2018)

| Artigo | Descrição | Status |
|---|---|---|
| Art. 7º | Base legal — consentimento + saúde | ✅ |
| Art. 9º | Dados sensíveis com consentimento explícito | ✅ |
| Art. 11, §2º | Dados de saúde para tutela e pesquisa | ✅ |
| Art. 16 | Retenção por obrigação legal (CFM) | ✅ |
| Art. 17–22 | Direitos do titular implementados (7 de 9) | ✅ |
| Art. 37 | Registros de operações (ROPA) | ✅ |
| Art. 41 | DPO designado formalmente | ✅ |
| Art. 46 | Medidas técnicas de segurança | ✅ |
| Art. 48 | Plano de resposta a incidentes | ✅ |

### 10.2 Resolução CFM nº 1.821/2007 (Prontuário Eletrônico)

| Item | Status |
|---|---|
| Guarda de prontuário eletrônico por 20 anos | ✅ Política definida |
| Segurança de dados de saúde | ✅ Helmet + JWT + BOLA |
| Sigilo profissional e acesso restrito | ✅ `doctor_id` em todos os endpoints |
| Autenticidade e integridade dos registros | ✅ Audit log com hash SHA-256 |

### 10.3 Testes de Segurança

#### Validação Pré-Deploy (automatizada)
```
pnpm --filter @workspace/scripts run pre-deploy
✅ 32 verificações — DEPLOY LIBERADO
```
Valida: credenciais hardcoded · BOLA · Helmet · rate limiting · audit log · LGPD endpoints · dados sensíveis

#### Testes de Penetração (recomendado)
- [ ] OWASP Top 10 — anualmente
- [ ] Scan de vulnerabilidades — trimestral
- [ ] Teste específico de BOLA/IDOR
- [ ] Teste de força bruta em login

---

## 11. Responsáveis e Contatos

| Função | Nome | CRM/Ref |
|---|---|---|
| **DPO (Encarregado)** | Vinicios Barreto Melo | CRM-ES 13416 |
| **Responsável Segurança** | Vinicios Barreto Melo | — |
| **Contato ANPD** | Portal: gov.br/anpd | Formulário: gov.br/anpd/comunicacao-de-incidentes |

---

## 12. Registro de Versões deste Documento

| Versão | Data | Alteração | Revisor |
|---|---|---|---|
| 1.0 | 2026-05-12 | Criação inicial — Prompts 1–8 implementados | VBM |

---

**PRÓXIMA AUDITORIA: 2026-11-12**

*Este documento deve ser revisado anualmente ou sempre que houver alteração significativa nas operações de tratamento de dados.*

*Para solicitações de titulares: acesse a plataforma com suas credenciais e utilize o menu de privacidade, ou contate o DPO.*

**Documento assinado digitalmente por:** Vinicios Barreto Melo, DPO — CRM-ES 13416 — 2026-05-12
