# Portal com certificado digital

O portal publico fica em:

```text
https://atualizacao.goopedir.com/cliente/portal/
```

O login por certificado deve usar outro host, porque o navegador negocia o
certificado durante o TLS, antes da rota HTTP existir:

```text
https://cert.atualizacao.goopedir.com/api/v1/portal/auth/certificate
```

Configure no backend:

```env
PORTAL_CERTIFICATE_BASE_URL=https://cert.atualizacao.goopedir.com
```

No `docker-compose.yml` do projeto essa variavel ja fica com esse valor por
padrao.

Sem esse host separado exigindo certificado de cliente, o backend responde:

```json
{"error":"certificate_required"}
```

## Exemplo de Nginx para o host de certificado

Este bloco deve ficar no proxy que termina TLS para
`cert.atualizacao.goopedir.com`. Os caminhos dos certificados da CA precisam ser
ajustados para a cadeia aceita em producao.

```nginx
server {
    listen 443 ssl;
    server_name cert.atualizacao.goopedir.com;

    ssl_certificate /etc/nginx/certs/server/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/server/privkey.pem;

    ssl_client_certificate /etc/nginx/certs/client-ca/icp-brasil-chain.pem;
    ssl_verify_client on;
    ssl_verify_depth 5;

    location /api/v1/portal/auth/certificate {
        proxy_pass http://backend:3333/api/v1/portal/auth/certificate;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_set_header X-Client-Cert-Verify $ssl_client_verify;
        proxy_set_header X-Client-Cert-Subject $ssl_client_s_dn;
        proxy_set_header X-Client-Cert-Issuer $ssl_client_i_dn;
        proxy_set_header X-Client-Cert-Serial $ssl_client_serial;
        proxy_set_header X-Client-Cert-Fingerprint $ssl_client_fingerprint;

        # O backend espera somente numeros no documento. Se o proxy nao
        # conseguir extrair CPF/CNPJ com mapa/regex, pode encaminhar um valor
        # extraido por camada propria aqui.
        proxy_set_header X-Client-Cert-Document $ssl_client_s_dn;
    }
}
```

## Arquivos esperados no deploy

O container do frontend monta `./certs/nginx` em `/etc/nginx/certs`.

```text
certs/
  nginx/
    server/
      fullchain.pem
      privkey.pem
    client-ca/
      icp-brasil-chain.pem
```

Observacao: a regra atual tenta extrair CPF/CNPJ do subject do certificado pelos
nomes `CPF`, `CNPJ` e pelos OIDs mais comuns da ICP-Brasil. Se a cadeia/proxy
entregar esses dados em outro formato, ajuste o `map $ssl_client_s_dn
$client_cert_document` no `nginx.conf`.
