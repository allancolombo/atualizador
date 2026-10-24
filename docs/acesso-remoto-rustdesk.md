# Acesso remoto com RustDesk

A central guarda, por cliente e terminal, o ID do RustDesk e a senha permanente
de acesso. Os dados chegam por dois caminhos:

1. **Link de instalação** gerado no painel: instala o RustDesk apontando para o
   servidor próprio, cria a senha, grava o registro do Windows e se registra na
   central usando o token do link.
2. **`servidor.exe`**: a cada `POST /api/v1/updates/check`, lê o registro do
   Windows e envia `remoteAccess`. É isso que liga o acesso ao terminal.

## 1. Servidor RustDesk

Use `docs/rustdesk-server-compose.yml` na VPS (fora do Traefik, com
`network_mode: host`). Troque `remoto.goopedir.com` pelo DNS apontado para a VPS.

Portas que precisam estar liberadas no firewall da VPS:

| Porta | Protocolo | Serviço |
|-------|-----------|---------|
| 21115 | TCP | hbbs (teste de NAT) |
| 21116 | TCP e UDP | hbbs (ID / rendezvous) |
| 21117 | TCP | hbbr (relay) |

As portas 21118 e 21119 só são necessárias para o cliente web e podem ficar fechadas.

Na primeira subida o `hbbs` gera `id_ed25519` e `id_ed25519.pub` no volume
`rustdesk-data`. Com `-k _`, clientes sem a chave são recusados. Copie o conteúdo
do `.pub` para `RUSTDESK_KEY`. Faça backup do par de chaves: se ele mudar, todos
os clientes instalados param de conectar.

## 2. Configuração da central

Variáveis do backend (ver `backend/.env.example`):

| Variável | Uso |
|----------|-----|
| `REMOTE_ACCESS_SECRET` | Segredo (32+ caracteres) que cifra as senhas no banco com AES-256-GCM. Não pode mudar depois de usado. |
| `PUBLIC_BASE_URL` | URL pública da central usada nos links. Sem ela, usa o host da requisição. |
| `REMOTE_ACCESS_LINK_DAYS` | Validade padrão do link (1 a 30 dias, padrão 7). |
| `RUSTDESK_ID_SERVER` | Host do `hbbs`. |
| `RUSTDESK_RELAY_SERVER` | Host do `hbbr`. Padrão: o mesmo do ID server. |
| `RUSTDESK_KEY` | Conteúdo do `id_ed25519.pub`. |
| `RUSTDESK_INSTALLER_URL` | URL do instalador oficial do RustDesk (`.exe` x64). Pode ficar em `packages/rustdesk/` e ser servido por `/downloads/rustdesk/...`. |
| `RUSTDESK_INSTALLER_SHA256` | Opcional, mas recomendado: o script recusa o instalador se o hash não conferir. |

Sem `REMOTE_ACCESS_SECRET`, `RUSTDESK_ID_SERVER`, `RUSTDESK_KEY` e
`RUSTDESK_INSTALLER_URL` as rotas de link respondem `503 remote_access_not_configured`.
O `/updates/check` continua funcionando normalmente.

## 3. Link de instalação

`POST /api/v1/admin/clients/{id}/remote-access/links` com `{ "note": "...", "days": 7 }`
devolve `{ id, url, expiresAt }`. O token aparece só nessa resposta; o banco guarda o hash.

O link baixa `instalar-acesso-remoto-goopedir.cmd`, que:

1. pede elevação (UAC) e usa o PowerShell 64 bits;
2. baixa o script do próprio link (`/install/{token}/script`);
3. instala o RustDesk com `--silent-install`, se ainda não estiver instalado;
4. aplica `custom-rendezvous-server`, `relay-server` e `key` com `--option`;
5. gera uma senha aleatória de 16 caracteres e aplica com `--password`;
6. lê o ID com `--get-id`;
7. grava o registro do Windows (seção 4);
8. envia `POST /api/v1/remote-access/register` com o token, ID, senha e nome do computador.

O link vale até ser usado no passo 8, expirar ou ser revogado
(`DELETE /api/v1/admin/remote-access/links/{linkId}`). Se a instalação falhar
antes do registro, o mesmo link pode ser executado de novo.

Os comandos `--option` e `--password` exigem RustDesk 1.2.x ou mais novo. Valide
a versão escolhida numa máquina de teste antes de distribuir.

## 4. Registro do Windows (contrato com o `servidor.exe`)

Chave: `HKEY_LOCAL_MACHINE\SOFTWARE\Goopedir\AcessoRemoto`, sempre na visão
**64 bits**. Se o `servidor.exe` for 32 bits, abra a chave com `KEY_WOW64_64KEY`
(em Delphi: `TRegistry.Create(KEY_READ or KEY_WOW64_64KEY)`); sem isso o Windows
redireciona para `WOW6432Node` e a chave não é encontrada.

| Valor | Tipo | Conteúdo |
|-------|------|----------|
| `RemoteId` | REG_SZ | ID do RustDesk. |
| `Password` | REG_SZ | Senha cifrada com DPAPI (`LocalMachine`) em Base64. |
| `UpdatedAt` | REG_SZ | Data UTC ISO 8601 da última gravação. |

A senha é protegida com DPAPI no escopo da máquina e entropia
`Goopedir.AcessoRemoto.v1` (bytes UTF-8). Para ler: decodificar o Base64 e chamar
`CryptUnprotectData` passando a mesma entropia. O resultado são os bytes UTF-8 da senha.

## 5. Envio no `/updates/check`

O `servidor.exe` acrescenta ao corpo atual:

```json
{
  "remoteAccess": { "id": "123456789", "password": "senha-em-texto" }
}
```

- Se a chave do registro não existir, não envie o campo.
- O ID precisa ter 6 a 32 caracteres (`A-Z`, `a-z`, `0-9`, `_`, `-`); espaços são removidos.
- A senha tem de 6 a 128 caracteres. Sem senha, só o ID é atualizado.
- A central só recifra a senha quando ela muda (comparação por HMAC) e registra o evento `password_changed`.
- O terminal do check passa a apontar para esse ID; se ele tinha outro ID antes, o antigo fica sem terminal.

A resposta do check ganha `remoteAccess` quando o campo foi enviado:
`{ "stored": true, "passwordChanged": false }` ou `{ "stored": false, "error": "..." }`.
Erro no acesso remoto nunca impede a resposta da atualização.

## 6. Rotas do painel

| Rota | Quem | Uso |
|------|------|-----|
| `GET /api/v1/admin/remote-access/config` | todos | Mostra se a integração está configurada. |
| `GET /api/v1/admin/clients/{id}/remote-access` | escopo do cliente | Lista IDs, terminal, origem e datas. Não devolve senha. |
| `GET /api/v1/admin/clients/{id}/remote-access/links` | escopo do cliente | Lista links com status `active`, `used`, `expired` ou `revoked`. |
| `POST /api/v1/admin/clients/{id}/remote-access/links` | escopo do cliente | Gera link. |
| `DELETE /api/v1/admin/remote-access/links/{linkId}` | escopo do cliente | Revoga link. |
| `POST /api/v1/admin/remote-access/{id}/password` | só `admin` | Revela a senha e registra `password_revealed`. |
| `GET /api/v1/admin/remote-access/{id}/events` | escopo do cliente | Auditoria do acesso. |

No painel, essas rotas aparecem no diálogo de terminais do cliente, na seção
**Acesso remoto**. O botão **Conectar** abre `rustdesk://connection/new/{id}` no
RustDesk instalado no computador do suporte. A senha não vai na URI, porque o
RustDesk não documenta esse parâmetro. Se ela já foi revelada, é copiada para a
área de transferência para colar quando o RustDesk pedir.

## Segurança

- Use uma versão do RustDesk posterior à 1.4.5 nos clientes. Até a 1.4.5 o handler de URI `rustdesk://password/` permite trocar a senha permanente sem confirmação (CVE-2026-30793).

- A senha trafega em texto dentro do HTTPS, tanto no registro quanto no check. Use sempre HTTPS.
- O `INSTALLATION_KEY` é global: quem tiver essa chave consegue enviar `remoteAccess` em nome de qualquer cliente. Migrar para chave por cliente reduz esse risco.
- Qualquer administrador local da máquina do cliente consegue decifrar a senha DPAPI. Isso é esperado, porque esse usuário já controla o RustDesk instalado.
