# VPS / Coolify / n8n

## 1. Preparar a VPS

O deploy usa `compose.yaml`, uma única réplica e uma única porta interna, 8080.
Nginx encaminha a API e o desktop remoto. Chromium e Node rodam como usuário
`node`; os serviços gráficos são supervisionados no mesmo container.

No terminal da VPS, crie os volumes externos uma vez:

```sh
docker volume create bees-worker-data
docker volume create bees-worker-session
openssl rand -hex 32
```

Guarde o valor gerado como `BEES_API_KEY`. Não coloque a chave no repositório.
O servidor recusa iniciar sem uma chave de pelo menos 32 caracteres.
SQLite, WAL e histórico dos jobs ficam em `/app/data`; o perfil do Chromium fica
em `/app/session`. Não use filesystem de rede para o SQLite. Não use duas réplicas,
rolling deployment com sobreposição ou dois serviços compartilhando esses volumes.
Pare o container antigo antes de iniciar seu substituto; use deploy com parada.

## 2. Criar a aplicação no Coolify

1. Envie este projeto ao seu repositório Git, sem `data`, `session`, `.env` ou `node_modules`.
2. Crie uma aplicação a partir do repositório e escolha o build pack **Docker Compose**.
3. Selecione `/compose.yaml` como arquivo Compose, com diretório base `/`.
4. Configure as variáveis de runtime no Coolify:

   | Variável | Valor |
   | --- | --- |
   | `BEES_API_KEY` | Chave gerada acima, obrigatória |
   | `BEES_DISTRIBUTION_CENTER_ID` | `0730882` ou seu CD |
   | `BEES_COUNTRY` | `BR` |
   | `BEES_TIMEZONE` | `America/Fortaleza` |
   | `BEES_RETURN_STATUSES` | `DEFINITELY_RETURNED` |
   | `BEES_DATA_VOLUME` | `bees-worker-data` |
   | `BEES_SESSION_VOLUME` | `bees-worker-session` |

5. No serviço `bees`, associe seu domínio HTTPS à porta interna **8080**.
   Se a interface usar a notação de porta na URL, informe `https://bees.seudominio.com:8080`;
   o acesso público continua por HTTPS na porta 443.
6. Faça o deploy. O healthcheck é `GET /health`, sem autenticação e sem dados de negócio.

Não publique as portas internas 3000, 5900 ou 6080. API, noVNC e WebSocket passam
pelo Nginx na porta 8080 e pelo HTTPS do Coolify. Os volumes estão definidos no
Compose; não crie mounts duplicados pela interface. Volumes externos sobrevivem
ao redeploy e ao `docker compose down`, mas não substituem backup.

O build instala o Chromium correspondente ao Playwright do lockfile, compila o
TypeScript e executa os testes. Docker não estava disponível no ambiente de
desenvolvimento: o primeiro build Linux e o teste visual do noVNC devem ser
confirmados no deploy. O projeto não foi publicado automaticamente nesta VPS.

## 3. Fazer login no Chromium remoto

Nos exemplos abaixo, defina `BEES_URL` e `BEES_API_KEY` no seu terminal:

```sh
export BEES_URL=https://bees.seudominio.com
# Defina BEES_API_KEY com a chave privada já configurada no Coolify.

curl -X POST "$BEES_URL/browser/login" \
  -H "Authorization: Bearer $BEES_API_KEY" \
  -H 'Content-Type: application/json' -d '{}'
```

Abra no navegador:

```text
https://bees.seudominio.com/desktop/vnc.html?autoconnect=true&resize=scale&path=desktop/websockify
```

O navegador solicita Basic Auth: usuário **bees**, senha **o mesmo BEES_API_KEY**.
Faça o login BEES normalmente, incluindo MFA se solicitado. Ao chegar na tela
de rotas, encerre o navegador para salvar a sessão e liberar as automações:

```sh
curl -X POST "$BEES_URL/browser/close" \
  -H "Authorization: Bearer $BEES_API_KEY" \
  -H 'Content-Type: application/json' -d '{}'
```

`GET /browser/status` informa `loginOpen` e `active`. A abertura do navegador não
comprova autenticação na BEES: confirme visualmente e execute uma sincronização.
O login fecha automaticamente após 30 minutos. Fechar somente a aba noVNC não
fecha o Chromium; use `/browser/close`. Enquanto o login está aberto, jobs e
atualizações ao vivo retornam **409**. A consulta ao SQLite continua disponível.
Se a sessão expirar, repita esse procedimento. Não copie o perfil Windows para
Linux: faça um novo login na VPS.

## 4. Invocar operações pelo n8n

Crie uma credencial **Header Auth** no n8n:

- Name: `Authorization`
- Value: `Bearer SUA_CHAVE_LONGA`

No nó **HTTP Request**, use essa credencial, método POST, URL
`https://bees.seudominio.com/jobs`, Body Content Type JSON e um dos corpos:

| Operação | Corpo JSON |
| --- | --- |
| Sincronizar tours | `{"type":"sync:tours"}` |
| Analisar e atualizar | `{"type":"analyze:tours"}` |
| Sincronizar uma data | `{"type":"sync:tours","date":"2026-09-29"}` |
| Atualizar tour específico | `{"type":"sync:tour","tourId":"178555","date":"2026-09-29"}` |
| Atualizar todos os detalhes e listar devoluções | `{"type":"returns:today"}` |
| Remover finalizadas do dia | `{"type":"remove:finalized"}` |
| Remover finalizadas de uma data | `{"type":"remove:finalized","date":"2026-09-29"}` |

Sem data, usa hoje no fuso configurado. A limpeza HTTP sempre limita a uma data
e ao CD configurado; não limpa todos os dias por omissão. Os únicos scripts
permitidos são os tipos acima; a API não executa comandos arbitrários.

A resposta é **202**, por exemplo:

```json
{"id":"uuid-do-job","state":"running","statusUrl":"/jobs/uuid-do-job"}
```

No n8n, preserve o ID, use um nó **Wait** (por exemplo, 5 segundos), depois um
**HTTP Request** GET para `https://bees.seudominio.com/jobs/ID`, com a mesma
credencial. Use IF/Switch para repetir somente enquanto `state` for `running`,
com limite de tentativas definido no workflow.

- `succeeded`: resultado em `result`.
- `partial`: relatório de devoluções parcial, com `result.issues`/`result.failures`.
- `failed`: operação falhou; detalhes técnicos nos logs do Coolify.
- `interrupted`: container reiniciou durante o job; avalie e faça nova tentativa.

Para o job `returns:today`, as devoluções estão em `result.content`.
O GET de status retorna 200 mesmo quando o job falhou: verifique **state**.
Os jobs e resultados persistem no SQLite. Não há retomada automática de jobs
interrompidos nem fila: uma segunda operação recebe 409 e deve aguardar.
Não reenvie um POST aceito apenas porque o job ainda está rodando; consulte seu ID.

Consulta rápida ao último estado salvo:

```sh
curl "$BEES_URL/returns/today" -H "Authorization: Bearer $BEES_API_KEY"
```

Para automações, prefira o job `returns:today` ao GET com `refresh=true`, que
pode demorar além do timeout do proxy. `GET /returns/today` retorna 502 se faltarem
dados; um array vazio não deve ser interpretado como relatório completo sem
verificar `metadata.complete`.

## 5. Dados existentes e backup

A imagem nunca inclui seus dados locais. Para transferir o banco existente,
pare as gravações na origem, produza uma cópia consistente do SQLite (backup
SQLite, ou banco fechado com checkpoint) e transfira para `bees-worker-data`
como `bees.sqlite` com o serviço de destino parado. Não copie só o `.sqlite`
de um banco ativo ignorando seu WAL. A inicialização ajusta a propriedade para
o usuário `node` (UID 1000). Faça login novo na VPS para criar sua sessão Linux.

Para um backup simples dos volumes, pare o serviço, faça o backup de ambos os
volumes e reinicie. Trate o backup da sessão como credencial de acesso. Não
remova os volumes ao atualizar. Cada instância independente precisa de nomes
de volumes próprios. O histórico de jobs não tem expiração automática.

## Referências de implantação

- [Docker Compose no Coolify](https://coolify.io/docs/applications/builds/docker-compose)
- [Persistência no Coolify](https://coolify.io/docs/applications/configuration/persistent-storage)
- [Playwright em Docker](https://playwright.dev/docs/docker)
- [noVNC](https://github.com/novnc/noVNC)
