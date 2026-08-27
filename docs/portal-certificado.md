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

    ssl_certificate /etc/letsencrypt/live/cert.atualizacao.goopedir.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cert.atualizacao.goopedir.com/privkey.pem;

    ssl_client_certificate /etc/nginx/client-ca/icp-brasil-chain.pem;
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

Observacao: o exemplo acima encaminha o subject inteiro em
`X-Client-Cert-Document` apenas como ponto de partida. Em producao, extraia
somente o CPF/CNPJ do certificado e envie esse numero limpo nesse cabecalho.
