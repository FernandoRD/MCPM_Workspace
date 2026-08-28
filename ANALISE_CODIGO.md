# Análise técnica do código

Data da análise: 27 de agosto de 2026

## Resumo executivo

O MPCM Workspace possui uma base local-first coerente, com frontend React/TypeScript, estado em Zustand e backend Tauri/Rust responsável por persistência, criptografia, processos e protocolos remotos. O banco usa SQLCipher, a chave é mantida no keychain do sistema e existem controles como rate limiting, zeroização de algumas credenciais e confirmação de fingerprint no SSH principal.

Os riscos mais importantes estão na fronteira entre dados importados e operações externas: montagem de comandos no macOS, política inconsistente de fingerprints no SFTP, aplicação não transacional de sync/restore e configuração RDP permissiva.

## Melhorias priorizadas

| Prioridade | Melhoria | Impacto | Esforço |
|---|---|---|---|
| P0 | Corrigir quoting e escaping do terminal no macOS | Evitar execução local de comandos por dados maliciosos | Médio |
| P0 | Exigir confirmação explícita de fingerprints no SFTP e jump hosts | Evitar MITM silencioso na primeira conexão | Médio |
| P1 | Tornar sync, restore e importação transacionais | Evitar vault parcialmente apagado ou divergência entre UI e banco | Médio |
| P1 | Usar certificado estrito no RDP e retirar senha da linha de comando | Reduzir exposição de credenciais e MITM | Médio |
| P1 | Validar integralmente payloads de backup e sincronização | Impedir entrada de estruturas inválidas ou maliciosas | Baixo/médio |
| P2 | Executar testes, lint e auditorias no CI | Reduzir regressões | Médio |
| P2 | Dividir módulos grandes e aplicar code splitting | Melhorar manutenção e carregamento inicial | Médio |

## P0 — terminal do macOS

Em `src-tauri/src/system_terminal.rs`, o lançamento no macOS transforma os argumentos em uma única linha de shell usada por `Terminal.app`. Atualmente, argumentos só recebem aspas quando contêm espaço ou aspas. Metacaracteres como `;`, `|`, `$()`, crases e quebras de linha podem, portanto, alterar o comando executado.

Os campos `host` e `username` recebem apenas `trim()` e podem ser originados de dados cadastrados, importados ou sincronizados.

Correção proposta:

- aplicar quoting POSIX a cada argumento, sem exceções;
- escapar separadamente a string incorporada ao AppleScript;
- validar entradas sem rejeitar IPv6 e nomes de host legítimos;
- cobrir metacaracteres, aspas, espaços e quebras de linha com testes unitários.

## P0 — fingerprints no SFTP

O fluxo SSH principal consulta a fingerprint de um host desconhecido e retorna `HOST_KEY_UNKNOWN:<fingerprint>` para que a interface peça confirmação. O fluxo SFTP utiliza um handler TOFU que aceita e armazena automaticamente a primeira chave encontrada, inclusive para jump hosts.

Correção proposta:

- aplicar ao SFTP a mesma política explícita usada no SSH;
- verificar separadamente jump host e destino;
- nunca persistir fingerprint antes da confirmação;
- continuar bloqueando fingerprints divergentes;
- garantir que a interface consiga confirmar e repetir a conexão.

## Estado das correções P0

As duas correções foram iniciadas e implementadas em 27 de agosto de 2026:

- o terminal do macOS agora aplica quoting POSIX a todos os argumentos e escape específico para o literal AppleScript;
- foram adicionados seis testes de regressão para argumentos comuns, IPv6, espaços, aspas, metacaracteres e quebras de linha;
- o SFTP passou a rejeitar chaves desconhecidas no jump host e no destino;
- o erro SFTP identifica explicitamente host, porta e fingerprint em um payload JSON validado pela interface;
- a fingerprint só é persistida depois da confirmação do usuário por `ssh_trust_host`;
- jump host e destino podem ser confirmados sequencialmente, e fingerprints divergentes continuam bloqueadas;
- foram adicionados testes para classificação de fingerprints e serialização do erro SFTP.

## P1 — atomicidade de sync e restore

As stores de hosts, credenciais e chaves SSH atualizam a memória e iniciam persistência assíncrona sem rollback. Nas operações `replace*`, cada tabela é apagada e seus registros são inseridos individualmente. Uma falha intermediária pode deixar o banco incompleto enquanto a memória ainda contém o conjunto integral.

Correção proposta: criar um comando Rust único, por exemplo `db_apply_portable_state`, que valide o payload e aplique todas as entidades dentro de uma transação SQLite. O Zustand deve ser atualizado somente após o commit.

Estado em 27 de agosto de 2026: implementado.

- `db_apply_portable_state` substitui hosts, credenciais, chaves SSH e settings em uma única transação;
- qualquer falha executa rollback e preserva o estado anterior, incluindo settings;
- logs de conexão não são afetados;
- Zustand, tema e idioma só são atualizados depois da confirmação do commit;
- pull de sync, restore de backup e importação CSV usam a mesma fronteira transacional;
- a importação de `~/.ssh/config` também passou a gravar hosts, credenciais e chaves em uma única transação;
- o espelho auxiliar de configurações RDP é atualizado depois do commit e uma eventual falha é reportada separadamente.

## P1 — segurança do RDP

A configuração padrão usa `certificateMode: "ignore"`. No FreeRDP, a senha também é passada como argumento `/p:...`, podendo ficar visível para outros processos locais.

Correção proposta:

- usar certificado estrito como padrão;
- exigir consentimento claro para exceções;
- transmitir credenciais por mecanismo que não apareça na linha de comando.

## P1 — validação de dados externos

O parser de sincronização verifica apenas o identificador da aplicação antes de fazer cast para o tipo esperado. O parser de backup valida versão e hosts, mas não valida integralmente credenciais, chaves SSH, configurações ou estruturas criptografadas.

Correção proposta:

- introduzir schemas de runtime versionados;
- rejeitar campos e tipos inválidos antes da hidratação;
- validar timestamps, IDs e payloads criptografados;
- no merge, comparar `updatedAt` e apresentar conflitos em vez de substituir sempre o valor local.

Estado em 27 de agosto de 2026: validação estrutural implementada; resolução visual de conflitos por `updatedAt` permanece como melhoria futura.

- arquivos de sync e backup são validados antes da hidratação;
- a validação cobre versão, timestamps, hosts, credenciais, chaves, settings, tombstones e envelopes criptografados;
- payloads decifrados também são validados antes de restaurar segredos;
- campos de segredo em texto claro são rejeitados na parte pública do arquivo;
- chaves de prototype pollution são rejeitadas recursivamente;
- limites de tamanho, profundidade e quantidade de itens foram adicionados;
- casts cegos de JSON externo foram removidos desses fluxos.

## P2 — testes e integração contínua

O `package.json` não declara scripts de teste ou lint. O workflow atual compila o projeto, mas não executa a suíte Rust nem uma suíte frontend. A cobertura armazenada indica 60,16% de linhas e 49,12% de branches, porém não é reproduzível pelos scripts declarados.

Correção proposta:

- declarar e fixar as dependências da suíte frontend;
- adicionar scripts `test`, `test:coverage` e `lint`;
- executar testes TypeScript e Rust no CI;
- priorizar sync/restore, credenciais, fingerprints, lançadores de sessão e sanitização;
- separar testes TCP de integração quando o runner não permitir sockets locais.

## P2 — modularidade e desempenho

O projeto contém aproximadamente 30 mil linhas. Há arquivos que concentram responsabilidades demais, como `src-tauri/src/ssh.rs`, `src-tauri/src/rdp.rs`, `src/pages/Operations.tsx`, `src/pages/Dashboard.tsx` e `src/pages/Settings.tsx`.

O build frontend foi concluído, mas gerou um chunk JavaScript de aproximadamente 1,14 MB.

Correção proposta:

- separar autenticação, conexão, sessão e comandos Tauri no backend;
- extrair hooks, services e componentes por domínio no frontend;
- carregar páginas com `React.lazy()` e imports dinâmicos;
- introduzir limites de complexidade e tamanho de bundle no CI.

## Validação executada durante a análise

- `npm run build`: aprovado, com alerta de chunk acima de 500 KB;
- cliente RDP: 20 testes passaram e 2 não puderam abrir sockets TCP devido às restrições do ambiente;
- nenhuma falha funcional foi inferida apenas a partir dessa restrição de sockets;
- a modificação preexistente no binário `src-tauri/resources/internal-rdp-client/viewer_mvp` e a pasta não rastreada `coverage/` foram preservadas.

Após as correções P0:

- `npm run build`: aprovado;
- testes do quoting do terminal macOS: 6 aprovados;
- testes de classificação de fingerprints: 3 aprovados;
- teste do payload de erro SFTP: 1 aprovado;
- suíte Rust completa: 30 testes aprovados e 1 falha preexistente em TOTP; o teste usa um segredo de 80 bits, enquanto a dependência atual exige no mínimo 128 bits;
- não foi possível executar smoke test contra servidores SFTP reais neste ambiente.

Após as correções P1:

- `npm run build`: aprovado;
- testes de commit e rollback do estado portátil: 2 aprovados;
- teste de rollback da importação de `~/.ssh/config`: aprovado;
- smoke tests do schema: 7 aprovados, cobrindo payload válido, versão incompatível, segredo em texto claro, data inválida, IDs duplicados, chave de prototype pollution e segredos decifrados;
- suíte Rust completa: 33 testes aprovados e a mesma falha preexistente no teste TOTP de segredo curto.

## Ordem recomendada

1. Corrigir os dois P0 e adicionar testes de regressão.
2. Implementar aplicação transacional de sync/restore.
3. Endurecer o RDP.
4. Validar integralmente formatos externos.
5. Tornar testes e cobertura reproduzíveis no CI.
6. Refatorar módulos grandes e aplicar code splitting.
