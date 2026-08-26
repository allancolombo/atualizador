# Central de Atualização

Plataforma independente para distribuir atualizações. O back-end usa Express + SQLite, o painel usa Next.js + Material UI e o Nginx Windows entrega o front, encaminha `/api` e serve `/downloads`.

## Recursos

- Autocadastro de cliente e terminal na primeira consulta.
- Produtos e canais `test`, `beta` e `production`.
- Upload ZIP bruto pelo painel, manifesto raiz e SHA-256 automático.
- Liberação para todos ou clientes selecionados.
- Dashboard, clientes, terminais, produtos e releases.
- Cliente Delphi inicial com download, backup e rollback.

## Desenvolvimento local

Na raiz do projeto, execute:

```bash
npm run setup
npm run dev
```

O painel fica em `http://localhost:3000` e encaminha `/api` e `/downloads`
para o backend em `http://localhost:3333`. Na primeira preparação, o arquivo
`backend/.env` é criado a partir de `backend/.env.example`; altere as credenciais
antes de usar fora do ambiente local.

## GitHub Codespaces

O repositório contém `.devcontainer/devcontainer.json`. Ao criar um Codespace:

1. As dependências do backend e do frontend são instaladas automaticamente.
2. O arquivo local `backend/.env` é criado se ainda não existir.
3. Execute `npm run dev` no terminal.
4. Abra a porta **Painel web (3000)** na aba **Ports**.

Mantenha as portas privadas. A porta 3333 não precisa ser aberta no navegador,
pois o painel acessa a API pelo proxy da porta 3000.

O Codespace é um ambiente de desenvolvimento, não hospedagem permanente. O
SQLite e os pacotes em `packages/` não são versionados e podem ser perdidos ao
excluir o Codespace. Para produção, mantenha banco, artefatos e segredos em
armazenamento persistente.

## Publicação no GitHub

Banco de dados, arquivos `.env`, dependências, builds e pacotes de atualização
são ignorados pelo Git. Depois de criar um repositório vazio no GitHub:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin URL_DO_REPOSITORIO
git push -u origin main
```

Não use `git add -f` para enviar banco, `.env` ou ZIPs de atualização. O código
Delphi pode ser editado no Codespace, mas sua compilação continua sendo feita no
Windows com o RAD Studio.

## Windows

Execute `windows/build-and-deploy.bat`. O destino padrão é `C:\UpdaterCentral`. Copie `nginx/updater-windows.conf` para o Nginx, ajuste o domínio e o `.env`. Mantenha o Node executando com NSSM ou PM2.

## Autocadastro

`POST /api/v1/updates/check`, com `Authorization: Bearer <INSTALLATION_KEY>`:

```json
{"client":{"id":"uuid-cliente","name":"Cliente Exemplo","document":"12345678000190"},"terminal":{"id":"uuid-terminal","name":"CAIXA 01","computerName":"PC-01","osVersion":"Windows 11"},"product":"pdv","channel":"production","currentVersion":"1.0.0"}
```

O UUID do terminal deve ser persistido. Uma release global atende clientes novos; a direcionada aparece para clientes que já fizeram uma consulta.

## Pacote de atualização

Ao publicar uma versão do tipo pacote, envie o ZIP bruto gerado pelo build do
front. O backend remove uma pasta raiz comum, quando houver, e grava um ZIP final
com este formato:

```text
manifest.json
nginx/html/index.html
nginx/html/static/...
```

O `manifest.json` contém produto, canal, versão, `releaseId` e a lista de
arquivos com `source`, `destination`, `sha256` e tamanho em bytes. O SHA-256
cadastrado na release continua sendo o hash do ZIP final servido em `/downloads`.

## Documentação da API

Com o backend em execução, acesse o Swagger UI em `http://localhost:3333/docs/`.
A especificação OpenAPI também está disponível em `http://localhost:3333/api-docs.json`.

## Segurança

- Use HTTPS e troque todas as credenciais.
- Restrinja escrita em `packages` ao back-end.
- Nunca sobrescreva um ZIP publicado.
- Evolua a chave global para uma chave por cliente.
- Adicione assinatura digital; SHA-256 valida integridade, não autoria.
