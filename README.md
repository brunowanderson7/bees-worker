# BEES Worker

Para VPS com Docker/Coolify, volumes externos, Chromium remoto e jobs pelo n8n,
consulte [DEPLOY.md](DEPLOY.md). Arquivos de implantação: `Dockerfile`, `compose.yaml`
e `.env.example`.

Requer Node.js >= 24. Usa SQLite nativo do Node, sem instalar um servidor de banco.
Os resumos, detalhes completos (trips/visitas) e histórico de alterações ficam em
`data/bees.sqlite`. Os payloads completos são preservados como JSON dentro das
tabelas SQLite; ID, data, CD, status e displayId possuem colunas próprias.
Defina `BEES_DB_PATH` para usar outro caminho.

## Comandos

- `npm run login`: salva a sessão do navegador.
- `npm run migrate:json`: importa o snapshot atual e os detalhes dos JSONs existentes.
  Não altera os arquivos originais, não sobrescreve rotas já no SQLite e pode ser
  executado novamente. O snapshot anterior e o relatório JSON antigo permanecem
  nos arquivos originais; o novo histórico começa com as sincronizações no SQLite.
- `npm run sync:tours -- 2026-09-29`: consulta os resumos, compara com o banco e
  busca os detalhes das rotas novas, alteradas ou ainda sem detalhes.
- `npm run analyze:tours -- 2026-09-29`: executa a mesma análise e atualização
  consultando a API. Exibe os campos alterados e salva o histórico no banco.
- `npm run sync:tour -- 178555 2026-09-29`: força a atualização de uma rota pelo
  ID completo ou displayId, usando o resumo atual da API.
- `npm run remove:finalized -- 2026-09-29`: remove rotas POST_ROUTE/FINISHED/CLOSED da data
  e do CD configurado, junto com detalhes e histórico.
- `npm run remove:finalized`: remove POST_ROUTE/FINISHED/CLOSED de todas as datas e CDs.
- `npm test` e `npm run typecheck`: validação local.

Sem data, os comandos de sincronização usam o dia atual no fuso configurado.
CANCELED não é tratado como finalizado. A limpeza é explícita: uma sincronização
posterior pode importar novamente uma rota removida se ela ainda vier na API.

A comparação considera todos os campos do resumo, incluindo lastUpdateTimestamp.
Mudanças apenas nos detalhes que não se reflitam no resumo exigem `sync:tour`.
Cada rota é gravada em uma transação após a consulta de detalhes ter sucesso.
Falhas preservam o estado anterior e geram saída de erro; as demais rotas continuam.
Rotas ausentes da resposta não são apagadas, pois a consulta é limitada à data.
Datas e CDs têm estados separados. Execute apenas um sincronizador por vez.

A sessão de autenticação continua em `session/browser-profile`; ela não é um
arquivo de dados das rotas. Não há geração de novos snapshots ou relatórios JSON.

## Devoluções de hoje

Execute `npm run --silent returns:today` para receber JSON no stdout. O comando
consulta os resumos de hoje e força a consulta dos detalhes de todos esses tours
e dos tours já conhecidos no SQLite, incluindo os de datas anteriores. Atualiza
os detalhes no banco e verifica todas as visitas, inclusive de rotas finalizadas.
Tours históricos que nunca foram importados ou já foram removidos e não aparecem
na consulta de hoje não podem ser descobertos por esse comando.

O resultado contém `metadata`, `content`, `issues` e `failures`. Cada item de
`content` informa tour, data da rota, motorista, trip, cliente, status e
`returnedAt` em ISO UTC. Hoje é calculado em `BEES_CONFIG.timezone`, também usado
para filtrar os timestamps. A data da rota não limita a data da devolução.

A visita precisa estar atualmente com status de devolução. O timestamp é o do
evento mais recente desse status em `updates`; `updatedAt` não é usado como
substituto. Uma visita aparece uma vez; o mesmo cliente pode aparecer em visitas
ou trips diferentes. Sem timestamp confiável ou com falha ao consultar algum tour,
o relatório indica `complete: false` e o processo termina com código 1.

O código padrão confirmado para Devolvido é `DEFINITELY_RETURNED` (sem diferenciar
maiúsculas). Para configurar outros códigos no PowerShell:
`$env:BEES_RETURN_STATUSES = "DEFINITELY_RETURNED"`.

Use `npm run --silent returns:today -- --offline` para consultar apenas o SQLite,
sem navegador. Nesse modo `complete` indica cobertura dos dados locais, não
atualização em tempo real. Logs operacionais vão para stderr; nenhum arquivo de
relatório é criado automaticamente.

## API HTTP

Defina `BEES_API_KEY` com pelo menos 32 caracteres e inicie com `npm start`.
Endereço padrão local: `http://127.0.0.1:3000` (Docker usa o proxy na porta 8080).
Todas as rotas de dados e operações exigem `Authorization: Bearer <chave>`.

- `GET /returns/today`: consulta os dados já armazenados no SQLite.
- `GET /returns/today?refresh=true`: atualiza todos os tours conhecidos e os de hoje
  na BEES antes de retornar. Requer a sessão criada por `npm run login` e pode
  demorar, pois consulta os detalhes de cada tour. O navegador roda sem janela.

A resposta usa o mesmo JSON do comando de terminal. HTTP 200 indica relatório
completo para a fonte consultada; 502 indica resultado parcial (`issues` ou
`failures`), e 500 indica falha na consulta. A consulta ao SQLite não garante que
os dados estejam atualizados na BEES. Requisições simultâneas com `refresh=true`
compartilham a mesma atualização dentro deste processo. Não execute outro comando
de sincronização/login usando o mesmo perfil enquanto a atualização estiver ativa.

Exemplo de consumo em outra aplicação:

```javascript
const response = await fetch('http://127.0.0.1:3000/returns/today', {
  headers: { Authorization: `Bearer ${process.env.BEES_API_KEY}` }
});
const report = await response.json();
if (!response.ok) throw new Error(JSON.stringify(report));
console.log(report.content);
```

Configure `PORT` para alterar a porta. Para acesso por outra máquina, configure
`HOST=0.0.0.0` e use o IP da máquina servidora. A variável obrigatória `BEES_API_KEY`
define a autenticação: envie `Authorization: Bearer <chave>` em cada requisição.
Essas variáveis são lidas do ambiente do processo; não há carregamento de `.env`.
O consumo direto de um frontend em outra origem requer um proxy na aplicação
consumidora; esta API não habilita CORS.
