# Módulos por CNPJ

A central também decide quais módulos cada empresa pode usar. A licença vai na mesma resposta da consulta de versão. O desenho completo está em `goopedir-local/docs/modulos-desenho.md`.

## Painel

Aba **Módulos**:

- **Empresas:** um registro por CNPJ. O registro aparece quando o servidor do cliente consulta a versão, ou pode ser cadastrado antes pelo painel. CNPJ novo nasce **sem plano**, ou seja, sem módulos.
- **Planos:** cada módulo do plano é **incluso** (vem no preço) ou **adicional** (pode ser contratado à parte por quem tem o plano). Os quatro planos Goo são criados na primeira subida (ver "Planos e adicionais").
- **Grupos do CRM:** os grupos do Perfex e o que cada um libera: um plano, uma lista de módulos ou nada.
- **Exceção por empresa:** cada módulo pode seguir o plano, ser ligado ou ser desligado. A exceção ligada aceita limite (ex.: `mensagens` do marketing) e data de validade.
- **Dependências:** ao ligar um módulo, o que ele precisa também é ligado. Ao desligar, o que depende dele é desligado. O painel avisa nos dois casos.
- **Bloqueio real:** fica desligado por padrão, e o servidor só observa. Quando for ligado, o servidor passa a negar o acesso (fase 4).
- **Histórico:** toda alteração fica registrada com o usuário. Também fica registrado quando um CNPJ chega por outro cliente.

Só administradores alteram. Operadores apenas visualizam.

## Consulta de versão

`POST /api/v1/updates/check` aceita o campo opcional `companies`:

```json
{ "client": {}, "terminal": {}, "companies": [{ "document": "12.345.678/0001-90", "name": "Loja" }] }
```

Sem `companies`, vale o documento do `client`. O limite é de 50 empresas por consulta.

A resposta traz `entitlements`, com `available` verdadeiro ou falso:

```json
{
  "entitlements": {
    "alg": "ES256",
    "keyId": "ea70e22ab70aaa7e",
    "payload": "<base64 do JSON>",
    "signature": "<base64, r||s com 64 bytes>"
  }
}
```

O `payload` decodificado:

```json
{
  "schema": 1,
  "issuedAt": "2026-11-03T22:15:12.385Z",
  "expiresAt": "2026-12-03T22:15:12.385Z",
  "client": "id externo do cliente",
  "terminal": "id externo do terminal",
  "companies": {
    "12345678000190": {
      "plan": "completo",
      "enforce": false,
      "modules": { "custo.ficha": true, "marketing": { "limits": { "mensagens": 500 } } }
    }
  }
}
```

- `modules` já vem resolvido: plano, exceções vigentes e dependências. Módulo ausente está desligado.
- As chaves seguem o catálogo de `backend/src/modules.js`. Cada uma tem a chave antiga (`legacy`) que o front ainda lê em `/v2/status.modulos`.
- Se a montagem da licença falhar, a consulta de versão responde normalmente, sem `entitlements`.

## Assinatura

- ECDSA P-256 com SHA-256, sobre os bytes exatos do `payload` decodificado do base64. Não é preciso reserializar o JSON.
- A assinatura está no formato IEEE P1363 (`r||s`, 64 bytes), que é o formato que o `BCryptVerifySignature` espera.
- A chave pública está em `GET /api/v1/modules/public-key`. O campo `publicKeyRaw` traz `X||Y` em 64 bytes, para montar o `BCRYPT_ECCPUBLIC_BLOB`. A chave pública deve ser fixada no servidor Delphi, e não buscada a cada consulta.
- A chave privada vem de `MODULES_SIGNING_KEY` (PEM) ou de `MODULES_SIGNING_KEY_PATH`. Sem nenhuma das duas, ela é gerada em `data/modules-signing-key.pem`, ao lado do banco. **Guarde uma cópia:** trocar a chave invalida todas as licenças já emitidas.

## Rotas do painel

| Método | Rota | Uso |
| --- | --- | --- |
| GET | `/api/v1/admin/modules/catalog` | Catálogo |
| GET, POST | `/api/v1/admin/modules/plans` | Planos |
| PUT | `/api/v1/admin/modules/plans/:id` | Editar plano (inclui as dependências que faltarem) |
| GET, POST | `/api/v1/admin/modules/companies` | Listar (`?search=`) e cadastrar CNPJ |
| GET, PATCH | `/api/v1/admin/modules/companies/:id` | Ver; trocar plano, `enforce`, nome e anotação |
| PUT | `/api/v1/admin/modules/companies/:id/modules/:key` | `enabled` `true`, `false` ou `null` (segue o plano), mais `limits` e `validUntil` |
| GET | `/api/v1/admin/modules/crm` | Grupos do CRM e última sincronização |
| PUT | `/api/v1/admin/modules/crm/groups/:id` | Mapear grupo: `kind` (`plan`, `module`, `ignore`), `planId`, `priority`, `modules`, `unlimited` |

## Planos e adicionais

Criados na primeira subida (`PLAN_SEED` em `backend/src/modules.js`). Cada plano soma o anterior. Depois disso, valem as mudanças feitas no painel.

| Plano | Inclui (além do anterior) |
| --- | --- |
| Goo Site | `whatsapp`, `chat_pedido`, `pagamento_online.pix` |
| Goo Delivery | `venda_balcao`, `caixa`, `motoboy`, `cupom`, `despesa`, `fiado`, `ifood`, `relatorios`, `pdv_maquininha` |
| Goo Salão | `mesas`, `mesas.garcom` (2 aparelhos), `totem` |
| Goo Max | `mesas.garcom` sem limite, `painel_tv`, `financeiro`, `fidelidade`, `roleta`, `marketing` (500 mensagens), `ia` |

| Adicional a partir de | Módulos |
| --- | --- |
| Goo Site | `relatorios`, `fiscal`, `fiscal.nfce`, `fiscal.contabilidade`, `fiscal.dfe`, `fiscal.entrada`, `balanca.peso`, `balanca.comanda`, `filial`, `pagamento_online.stripe`, `dominio_proprio` |
| Goo Delivery | os `custo.*`, `estoque`, `estoque.insumos`, `motoboy.app`, `motoboy.localizacao`, `fiado.nfce`, `recuperacao` |
| Goo Salão | `mesas.garcom` (aparelho extra), `tablet` |

- O plano liga só o que inclui. O adicional liga pelo grupo do CRM ou por exceção no painel.
- Adicional ligado fora do que o plano permite **não é bloqueado**: a empresa aparece com aviso no painel.
- `estoque.insumos` só liga quando a empresa tem estoque e ficha técnica.
- `motoboy.localizacao` substituiu `motoboy.rotas` (chave antiga `rotas`) e exige `motoboy.app`.

## Sincronização com o Perfex

A API (`api-goopedir`, `src/service/corn/SincronizaCentralModulos.js`) roda na subida e a cada 5 minutos. Ela lê os grupos e os clientes do Perfex e envia tudo para `POST /api/v1/integrations/crm/sync`, com `Authorization: Bearer <CRM_SYNC_TOKEN>`. Só envia quando algo mudou, ou uma vez por hora.

Configuração:

- Central: `CRM_SYNC_TOKEN`, com no mínimo 24 caracteres. Sem ele, a rota responde 503.
- API: `CENTRAL_ATUALIZACAO_URL` (ex.: `https://atualizacao.goopedir.com`) e `CENTRAL_CRM_SYNC_TOKEN`, com o mesmo valor. Sem as duas, o job não faz nada.

O que a central faz com cada cliente:

- Usa o CNPJ (`vat`) como chave. Se ainda não existe, cria o **pré-cadastro**, com nome, código GooPedir (campo 1), telefone, e-mail (campo 39), endereço, número (38), bairro (29), cidade, UF e CEP.
- Guarda os grupos. Mudança de grupo vai para o histórico da empresa.
- **Limite:** o campo 24, "Quantidade Mensagem Campanha", vira o limite `mensagens` do `marketing`.
- **Clientes ignorados:** quem está sem CNPJ ou com CNPJ repetido fica de fora e aparece na aba Grupos do CRM.
- **Cliente que sai do Perfex** perde o que vinha do CRM. O cadastro e as exceções manuais continuam.

Ordem que define os módulos de uma empresa:

1. **Plano.** Vale o plano manual, se escolhido no painel. Senão, vale o grupo de plano do CRM com maior prioridade.
2. **Grupos de módulo do CRM.**
3. **Limites do CRM.** Grupo marcado como "ilimitado" tira o limite.
4. **Exceções manuais.** Vencem tudo.

**Grupos novos:** o grupo é reconhecido pelo **nome**, porque o id muda se ele for recriado. Os 18 grupos criados em 03/11/2026 (ids 27 a 44) já chegam mapeados. Grupo com nome desconhecido chega como "ignorar" até ser mapeado no painel.

## O que falta

- **Atualizador e servidor (fase 2):** enviar `companies` e repassar `entitlements`. O servidor também precisa validar a assinatura e ler os módulos em modo observação.
- **Quantidade de aparelhos no Perfex:** não há campo para garçons e tablets extras. Proposta: campos de cliente no Perfex, enviados como `limits` de `mesas.garcom` e `tablet`, como já é feito com as mensagens.
- **Contagem de aparelhos no servidor:** `/garcom/validar` e o cadastro do tablet ainda não contam aparelhos.
- **Vínculo terminal-cliente travado:** hoje só fica registrado no histórico quando um CNPJ muda de cliente. A troca ainda não é bloqueada.
