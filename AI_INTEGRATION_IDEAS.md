# Ideias de Integracao de IA para o ssh_vault

Documento de referencia para avaliar como adicionar recursos de IA ao ssh_vault sem comprometer seguranca, privacidade e previsibilidade operacional.

## Contexto do produto

O ssh_vault ja atua como um gerenciador multi-protocolo para `SSH`, `Telnet`, `SFTP`, `RDP` e `VNC`, com inventario de hosts, credenciais, chaves SSH, grupos, tags, notas, importacao de `~/.ssh/config`, importacao CSV, health check, fingerprints, logs persistentes, backup/restore e sync remoto.

Isso cria um bom ponto de partida para IA porque o app possui tres tipos de contexto valiosos:

- Inventario estruturado: hosts, protocolos, portas, grupos, tags, notas, jump hosts, presets SSH e metadados de credenciais.
- Contexto operacional: sessoes, comandos executados, logs persistentes, erros de conexao, status de health check e historico local.
- Fluxos de administracao: SFTP, backup, sync, importacao, troubleshooting e operacoes repetitivas em multiplos hosts.

## Principios de design

- IA deve ser opt-in por padrao. Nenhum host, credencial, log ou comando deve sair da maquina sem confirmacao explicita.
- Segredos nunca devem ser enviados para modelos. Senhas, chaves privadas, passphrases, tokens, TOTP e payloads cifrados precisam ser mascarados antes de qualquer chamada.
- A IA deve sugerir e explicar; execucao destrutiva deve exigir confirmacao humana.
- Recursos locais devem ser preferidos quando possivel. Um provedor local via Ollama/LM Studio ou modelo embarcado reduz risco em ambientes sensiveis.
- O app precisa manter modo sem IA totalmente funcional.
- Toda resposta de IA que dependa de contexto do vault deve mostrar quais dados foram usados, em formato resumido e auditavel.

## Arquitetura sugerida

Criar uma camada `ai` separada, sem acoplar diretamente os componentes de tela aos provedores.

Componentes propostos:

- `src/lib/ai/redaction.ts`: mascaramento de segredos e normalizacao de contexto antes de enviar a um modelo.
- `src/lib/ai/context.ts`: builders de contexto para hosts, logs, health checks, sessoes e SFTP.
- `src/lib/ai/providers.ts`: interface comum para provedores `disabled`, `local`, `openai-compatible` e futuro `enterprise`.
- `src-tauri/src/ai.rs`: comandos Tauri para chamadas seguras, configuracao do provedor e logging de auditoria.
- `src/pages/AiAssistant.tsx` ou painel lateral reutilizavel: interface de chat/contexto, historico local e acoes sugeridas.
- Settings dedicadas: provedor, endpoint, modelo, politica de envio de dados, retencao local e nivel de redacao.

Interface minima de provedor:

```ts
type AiProvider = {
  id: string;
  label: string;
  complete(request: AiRequest): Promise<AiResponse>;
};

type AiRequest = {
  task: string;
  locale: "pt-BR" | "en-US";
  context: RedactedAiContext;
  allowCloud: boolean;
};
```

## Capacidades recomendadas

### 1. Diagnostico assistido de erros

Usar logs, status da sessao e configuracao do host para explicar falhas de conexao.

Exemplos:

- "Por que este SSH falhou?"
- "Explique este erro de RDP e sugira proximos passos."
- "Compare as falhas recentes deste host."
- "Este problema parece ser credencial, rede, fingerprint, algoritmo SSH ou launcher externo?"

Valor:

- Alto impacto para troubleshooting.
- Baixo risco se o contexto for redigido corretamente.
- Aproveita a tela `Logs`, os connection logs e os health checks existentes.

Primeira versao:

- Botao `Analisar erro` em terminal, RDP, VNC, SFTP e Logs.
- Enviar apenas trecho selecionado ou ultimas linhas filtradas.
- Retornar causa provavel, evidencias e proximas verificacoes.

### 2. Copiloto de comandos SSH

Um assistente dentro do terminal que gera comandos, explica comandos existentes e sugere alternativas seguras.

Exemplos:

- "Gerar comando para encontrar arquivos maiores que 1GB em /var."
- "Explique este comando antes de executar."
- "Transforme estes passos em um script idempotente."
- "Gerar comando para verificar uso de disco, memoria e servicos."

Regras importantes:

- Nunca executar automaticamente.
- Mostrar diff/preview do comando.
- Destacar comandos destrutivos como `rm`, `dd`, `mkfs`, alteracoes de firewall, usuarios, permissoes e servicos.
- Permitir uma lista local de comandos bloqueados ou que sempre exigem confirmacao.

Primeira versao:

- Campo `Gerar comando` no painel de terminal.
- A resposta insere o comando no prompt, mas nao envia `Enter`.
- Acao secundaria `Explicar comando selecionado`.

### 3. Sumario de logs e linha do tempo operacional

Gerar resumo de eventos por host, protocolo, severidade e periodo.

Exemplos:

- "Resuma os erros das ultimas 24h."
- "Quais hosts tiveram mais falhas?"
- "O que mudou depois da ultima versao?"
- "Mostre uma linha do tempo desta sessao."

Valor:

- Usa uma base que o app ja coleta.
- Pode funcionar com IA local ou ate com heuristicas sem IA para a primeira camada.

Primeira versao:

- Botao `Resumir logs filtrados` na tela `Logs`.
- Resultado com categorias: conexao, autenticacao, rede, launcher, SFTP, sync e app.

### 4. Health check inteligente

Ampliar o health check para sugerir diagnosticos e correcoes por protocolo.

Para `SSH`:

- Interpretar fingerprint mismatch.
- Sugerir ajustes de preset de compatibilidade.
- Explicar falhas de algoritmo, porta, DNS, timeout e autenticacao.

Para `RDP`:

- Sugerir checagens de porta 3389, NLA, certificado, cliente instalado e argumentos gerados.

Para `VNC`:

- Sugerir checagens de display, porta 5900+n, senha, cliente externo e modo view-only/fullscreen.

Para `Telnet`:

- Sugerir validacao de porta, banner, timeout e negociacao.

Primeira versao:

- Gerar um diagnostico textual a partir do resultado de health check atual e dados basicos do host.
- Nao precisa executar probes novos no inicio.

### 5. Inventario assistido

Usar IA para organizar hosts, tags, grupos e notas.

Exemplos:

- "Sugira grupos e tags para estes hosts."
- "Encontre hosts duplicados ou suspeitos."
- "Padronize nomes e descricoes."
- "Crie notas tecnicas resumidas a partir de logs recentes."

Valor:

- Ajuda em vaults grandes.
- Baixo risco se operar apenas sobre metadados redigidos.

Primeira versao:

- Tela de preview com sugestoes em lote.
- Usuario escolhe quais mudancas aplicar.
- Aplicacao via patch estruturado, nao texto livre.

### 6. Importacao inteligente

Melhorar importacao de CSV e `~/.ssh/config`.

Exemplos:

- Mapear colunas desconhecidas de CSV para campos do app.
- Detectar protocolo, porta e grupo provaveis.
- Sugerir presets SSH com base em nomes, portas e erros anteriores.
- Explicar linhas rejeitadas em linguagem natural.

Primeira versao:

- Assistente opcional na tela de importacao CSV.
- IA retorna um plano estruturado: campo origem, campo destino, confianca e justificativa.

### 7. Playbooks operacionais

Criar uma biblioteca local de playbooks para tarefas repetitivas.

Exemplos:

- Coletar diagnostico Linux basico.
- Validar certificados.
- Verificar espaco em disco.
- Reiniciar servico com checagem antes/depois.
- Auditar usuarios e chaves autorizadas.

Uso da IA:

- Gerar playbooks a partir de uma descricao.
- Adaptar playbooks ao SO remoto.
- Explicar riscos antes da execucao.

Regras:

- Execucao em lote deve ter dry-run quando aplicavel.
- Operacoes destrutivas ou de mudanca de estado exigem confirmacao por host.
- Resultado deve ser salvo como log ou relatorio local.

### 8. Assistente de SFTP

Adicionar IA ao navegador SFTP para tarefas de arquivos.

Exemplos:

- "Quais arquivos parecem logs?"
- "Sugira arquivos seguros para compactar antes de baixar."
- "Gerar comando remoto para arquivar estes diretorios."
- "Explique permissoes e donos destes arquivos."

Primeira versao:

- IA trabalha apenas com listagem de arquivos, tamanhos e timestamps.
- Conteudo de arquivos so deve ser enviado se o usuario selecionar explicitamente.

### 9. Explicador de configuracao e seguranca

Um painel que explica configuracoes do host e aponta riscos.

Exemplos:

- Credencial compartilhada por muitos hosts.
- Host sem grupo/tag.
- Telnet em uso.
- RDP/VNC sem notas de acesso.
- Sync com credenciais desativado ou sem senha mestra.
- Hosts SSH sem fingerprint registrada.

Primeira versao:

- Relatorio local de "postura do vault".
- IA opcional para transformar achados em recomendacoes.

### 10. Busca semantica local

Permitir busca por intencao, nao apenas por texto.

Exemplos:

- "servidores de banco de producao"
- "hosts que deram problema de certificado"
- "maquinas Windows acessadas por RDP"
- "servidores com notas sobre backup"

Implementacao:

- Primeiro, busca hibrida simples sobre label, host, tags, grupo, notas e logs.
- Depois, embeddings locais ou provedor configuravel.
- Indice deve ser local, recriavel e excluivel.

## Priorizacao sugerida

### Fase 1: Baixo risco, alto valor

1. Redacao de dados sensiveis e contrato de contexto de IA.
2. Configuracao de provedor desativado/local/cloud.
3. `Analisar erro` em Logs, Terminal, SFTP, RDP e VNC.
4. `Explicar comando` e `Gerar comando` sem execucao automatica.
5. Sumario de logs filtrados.

### Fase 2: IA integrada aos fluxos existentes

1. Health check inteligente.
2. Sugestoes de tags, grupos e notas.
3. Importacao CSV assistida.
4. Relatorio de postura do vault.
5. Playbooks com preview e execucao controlada.

### Fase 3: Recursos avancados

1. Busca semantica local.
2. RAG local sobre logs, notas e documentacao operacional.
3. Deteccao de anomalias por host.
4. Correlacao entre falhas de sync, logs e sessoes.
5. Assistente multi-etapa com acoes estruturadas e confirmacao humana.

## Modelo de seguranca e privacidade

Dados que nunca devem ser enviados:

- Senhas.
- Chaves privadas.
- Passphrases.
- Tokens de sync.
- Codigo TOTP ou segredo TOTP.
- Payloads cifrados de backup/sync.
- Conteudo de clipboard sem confirmacao explicita.

Dados que podem ser enviados apos redacao e confirmacao:

- Protocolo, porta, sistema operacional presumido, cliente RDP/VNC usado.
- Mensagens de erro.
- Logs selecionados.
- Nomes de grupos/tags, se permitido.
- Notas do host, se permitido.
- Comandos selecionados pelo usuario.

Redacoes recomendadas:

- IPs privados podem virar `10.x.x.x` ou `private-ip-1`, conforme politica.
- Hostnames podem virar `host-1`, mantendo consistencia dentro da mesma analise.
- Usuarios podem virar `user-1`.
- Caminhos locais podem mascarar nomes de usuario.
- Tokens longos devem virar `[REDACTED_TOKEN]`.
- Chaves e blocos PEM devem virar `[REDACTED_PRIVATE_KEY]`.

## UX recomendada

- Usar painel lateral ou modal contextual, nao uma landing page separada.
- Toda acao de IA deve partir de um contexto claro: host atual, log selecionado, comando selecionado, importacao ou health check.
- Mostrar chip de contexto: `Host atual`, `Logs filtrados`, `Comando selecionado`, `Importacao CSV`.
- Mostrar aviso quando o provedor for cloud.
- Botao de acao deve ser explicito: `Analisar`, `Explicar`, `Gerar sugestoes`, `Aplicar selecionados`.
- Sugestoes que alteram dados devem aparecer como checklist/diff.

## Estrutura de resposta desejada da IA

Para diagnosticos:

```json
{
  "summary": "Causa provavel em uma frase",
  "confidence": "low | medium | high",
  "evidence": ["linha ou fato usado"],
  "nextChecks": ["passo verificavel"],
  "suggestedActions": [
    {
      "label": "Executar health check",
      "risk": "low",
      "requiresConfirmation": true
    }
  ]
}
```

Para sugestoes de inventario:

```json
{
  "suggestions": [
    {
      "hostId": "id",
      "changes": {
        "group": "prod/linux",
        "tags": ["database", "critical"]
      },
      "confidence": "medium",
      "reason": "Baseado em nome, porta e notas"
    }
  ]
}
```

## Pontos de integracao no app atual

- `LogsPage.tsx`: resumir logs filtrados e analisar erros.
- `TerminalPage.tsx`: explicar/gerar comandos e diagnosticar falhas SSH/Telnet.
- `SftpPage.tsx`: explicar falhas SFTP e sugerir operacoes seguras de arquivos.
- `RdpPage.tsx`: explicar launcher, argumentos, certificado, cliente usado e falhas.
- `VncPage.tsx`: explicar suporte por cliente, autenticacao e lifecycle.
- `Health.tsx`: diagnostico assistido com base no resultado do health check.
- `CsvImportPage.tsx`: mapeamento inteligente de colunas e explicacao de rejeicoes.
- `HostEditor.tsx`: sugestao de tags, grupo, notas e preset SSH.
- `Settings.tsx`: configuracao de provedor, privacidade e retencao de historico.
- `Sync.tsx` e `Backup.tsx`: alertas explicativos sobre seguranca, senha mestra e risco de sobrescrita.

## Riscos principais

- Vazamento de segredos para provedor externo.
- Sugestoes de comandos destrutivos.
- Respostas convincentes mas incorretas em troubleshooting.
- Custo e latencia em ambientes com muitos logs.
- Dependencia de rede em um app que deve continuar util offline.
- Complexidade adicional em uma base que ja lida com protocolos sensiveis.

Mitigacoes:

- Redacao obrigatoria antes de qualquer envio.
- Confirmacao humana para execucao e aplicacao de mudancas.
- Logs de auditoria locais para chamadas de IA.
- Limites de tamanho e selecao explicita de contexto.
- Modo local/offline.
- Testes unitarios para redacao e builders de contexto.

## MVP recomendado

O MVP mais pragmatico e seguro seria:

1. Settings de IA com provedor `disabled` por padrao.
2. Camada de redacao com testes.
3. Botao `Analisar erro` na tela `Logs`.
4. Botao `Explicar comando` no terminal.
5. Botao `Gerar comando` que preenche o prompt sem executar.
6. Auditoria local registrando horario, tipo de tarefa, provedor e quais categorias de contexto foram usadas, sem salvar prompt bruto com segredos.

Esse MVP entrega valor direto para operacao diaria, usa superficies que ja existem e evita iniciar por automacoes arriscadas.
