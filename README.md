# MPCM Workspace

MPCM Workspace é um `Multi-Protocol Connection Manager` local-first para organizar conexões remotas e operar infraestrutura a partir de um único workspace.

Stack principal: `Tauri 2` + `Rust` + `React 19` + `TypeScript` + `Zustand` + `Tailwind CSS`.

## Versão atual

`0.4.3`

## Novidades da 0.4.3

- Menus de subgrupos no dashboard agora fecham com atraso breve no hover, facilitando mover o mouse do grupo pai até um subgrupo sem a lista sumir
- Tela `Logs` ganhou filtros de visualização por texto, nível (`error`, `warn`, `info`, `debug`, `trace`) e opção de diferenciar maiúsculas/minúsculas, com contador de linhas filtradas
- A criação/edição de host agora abre o gerenciamento de credenciais em modal sobre a própria tela, evitando perder o formulário do host ao criar, editar, selecionar ou remover credenciais
- O formulário de credencial foi extraído para um componente reutilizável e continua alimentando tanto a rota dedicada de credenciais quanto o novo modal no editor de host

## Novidades da 0.4.2

- Filtros de grupos do dashboard ficaram mais compactos: a faixa principal mostra apenas grupos raiz e expande subgrupos em menu flutuante ao passar o mouse ou focar o grupo pai
- Seleção de subgrupo continua filtrando com herança, e o grupo pai fica destacado quando algum descendente está ativo
- Auto-sync agora é bloqueado sem senha mestra configurada, com aviso direto na tela de sincronização
- Auto-sync não dispara mais push inicial em instalações novas sem `lastSyncAt`, evitando sobrescrever um repositório remoto existente com um vault vazio
- Quando o sync de credenciais está ativo, a senha mestra informada no sync manual fica apenas em memória da sessão e é reutilizada pelo auto-sync para gerar payload cifrado

## Novidades da 0.4.1

- Suporte a grupos hierárquicos com subgrupos, usando caminhos como `Produção/Web/API` para organizar melhor a árvore de hosts
- Tela `Groups` reformulada para criar subgrupos, renomear ramos inteiros e excluir um grupo pai junto com sua hierarquia
- Filtros do dashboard e seleção de grupos agora entendem hierarquia: ao escolher um grupo pai, os hosts dos subgrupos entram automaticamente no resultado
- Campo de grupo no editor de host passou a aceitar e sugerir caminhos hierárquicos, mantendo compatibilidade com grupos simples já existentes

## Novidades da 0.4.0

- Modo "janela separada" para `SSH` e `Telnet` migrado de WebviewWindow para terminal do sistema: ao abrir em janela separada, o app detecta e lança o emulador de terminal instalado (`gnome-terminal`, `konsole`, `xfce4-terminal`, `alacritty`, `wezterm`, `kitty`, `xterm` no Linux; `Terminal.app` no macOS; `wt` ou `cmd` no Windows) com o comando `ssh` ou `telnet` correto
- Chaves privadas exportadas para o terminal do sistema são convertidas automaticamente para o formato nativo OpenSSH (`-----BEGIN OPENSSH PRIVATE KEY-----`), resolvendo o erro `error in libcrypto: unsupported` que ocorria com chaves geradas no formato PKCS#8
- Arquivos de chave temporários são escritos com permissão `0600` e limpos automaticamente na próxima inicialização do app
- Diretório `experiments/` renomeado para `clients/` em todo o projeto (código, configs e documentação)
- Log persistente do app em `mpcm-workspace/logs/ssh_vault.log`, com rotação simples para `ssh_vault.log.1`
- Erros globais do frontend e falhas de SFTP agora entram no mesmo arquivo de log com contexto de host, sessão e operação
- O `Connection Log` passou a armazenar e exibir a mensagem do erro quando uma sessão falha
- Instrumentação de logs ampliada para `SSH`, `Telnet`, `RDP` e `VNC` nos fluxos principais de conexão, erro e lifecycle
- Nova tela `Logs` no app, com visualização dos arquivos de log, troca do diretório de saída e reset para o caminho padrão da plataforma
- O `stderr` do viewer RDP interno também passa a usar o diretório de logs configurado no app

## Novidades da 0.3.8

- Suporte a múltiplos monitores no viewer RDP interno experimental: o servidor renderiza um único desktop cobrindo todos os monitores e o viewer fatia por tela
- Modo janela com multimon usa uma única janela escalada para o tamanho configurado, sem necessidade de clicar para o mouse aparecer
- Modo fullscreen com multimon abre uma janela por monitor; no Windows as janelas são posicionadas automaticamente, no Linux/Wayland o posicionamento manual é necessário (limitação do protocolo xdg_toplevel)
- Estado de mouse isolado por janela, eliminando oscilação de cursor entre janelas sobrepostas
- Redirecionamento de stderr do viewer para `/tmp/ssh_vault_viewer.log` facilitando diagnóstico de falhas de inicialização

## Novidades da 0.3.7

- Rate limiter de conexões SSH agora opera por host individual em vez de global, evitando que um único alvo sobrecarregue outros
- Código compartilhado de SSH e SFTP extraído para módulo `ssh_common`, eliminando ~300 linhas de duplicação entre `ssh.rs` e `sftp.rs`
- Logging estruturado com crate `log`: `eprintln!` substituídos por `log::warn!`/`log::error!`, com `log::info!` em eventos operacionais chave (conexão SSH e operações de sync)
- Semáforo de sincronização remota: múltiplas chamadas simultâneas de sync são recusadas imediatamente com mensagem clara em vez de ficar enfileiradas
- Validação de payload de sync: `push` rejeita dados com campos sensíveis em texto claro, exigindo criptografia com senha mestra antes de sincronizar
- Auto-prune de logs de conexão: a tabela `connection_logs` mantém automaticamente apenas os 1000 registros mais recentes, impedindo crescimento ilimitado
- Features do tokio reduzidas de `full` para a lista exata usada pelo projeto, diminuindo tamanho do binário e tempo de compilação incremental

## Novidades da 0.3.6

- Barra de abas das sessões agora permite reorganização por drag and drop, facilitando ajustar a ordem de trabalho sem fechar e reabrir conexões
- Bump de versão e documentação atualizados para refletir o comportamento novo das abas

## Novidades da 0.3.5

- Edição manual do inventário `known_hosts` interno da aplicação pela tela `Health`, com criação, atualização e remoção de entradas
- Tratamento explícito de entradas órfãs no inventário de fingerprints, facilitando revisão e limpeza do estado local
- Health page agora diferencia melhor o inventário interno do app em `known_hosts.json`, sem confundir com o `~/.ssh/known_hosts` do sistema

## Novidades da 0.3.4

- Viewer `RDP` interno experimental integrado ao app principal como modo opcional de abertura, sem substituir o launcher nativo como caminho oficial recomendado
- Empacotamento do viewer interno no build desktop atual, com ponte de configurações entre o app e o binário experimental
- Página e configurações de `RDP` atualizadas para refletir melhor o modo ativo de abertura e as limitações específicas do viewer interno
- Campo de busca do dashboard agora tem ação rápida para limpar o filtro atual

## Novidades da 0.3.3

- Consolidação da frente `RDP`, com checklist técnico de fechamento, matriz de compatibilidade por launcher e cobertura de testes para geração de argumentos e serialização `.rdp`
- Preferências visuais de sessão RDP agora documentadas com clareza por nível de suporte, incluindo `Melhor com FreeRDP` e `Somente viewer interno`
- Ajuste do texto do modo experimental do viewer interno para uma mensagem mais objetiva na UI

## Novidades da 0.3.2

- Importação em massa de hosts via `.csv`, com template, exemplo, preview por linha e aplicação controlada
- Novo fluxo de criação com `split button` em `+ Nova Conexão`, mantendo o cadastro individual rápido e adicionando atalhos para importações
- Tela dedicada para importação em massa por CSV, com modos `Adicionar novos` e `Atualizar existentes`
- Centralização prática do versionamento: `package.json` passou a ser a fonte principal e o projeto agora inclui um script de sincronização para `Cargo.toml`, `Cargo.lock` e `package-lock.json`
- Cliente RDP interno em `clients/internal-rdp-client`, com viewer local, screenshot, input básico e tuning de fluidez sem impacto no app principal
- Decisão atual de produto para RDP: o launcher nativo continua sendo o caminho oficial recomendado; o viewer interno também pode ser empacotado junto com o app compilado

## Novidades da 0.3.0

- Suporte nativo a `RDP` com abertura por launcher externo, mantendo `SSH` e `Telnet` no mesmo workspace
- `Quick Connect` para `rdp://usuario@host:porta`, além dos fluxos já existentes para `SSH` e `Telnet`
- Seleção de cliente RDP no Linux entre `Automático`, `xfreerdp`, `wlfreerdp`, `Remmina` e `KRDC`
- Opções globais de sessão RDP para resolução, fullscreen, multimonitor, clipboard, áudio e política de certificado
- Integração com `mstsc` no Windows e tentativa de pré-carregar credenciais antes da abertura da sessão
- Migração automática do diretório de dados legado `ssh-vault` para `mpcm-workspace`

## O que o app faz hoje

- Cadastro de hosts com protocolo `SSH`, `Telnet`, `RDP` ou `VNC`, além de `grupos`, `tags`, `notas`, `cores`, `jump host` e presets de compatibilidade SSH
- Credenciais reutilizáveis separadas dos hosts
- Chaves SSH próprias, com geração de fingerprint e vínculo por credencial
- Terminal integrado com `xterm.js`, múltiplas abas com reorganização por drag and drop, split pane e reanexação de sessão por aba
- Página dedicada para sessões `RDP` e `VNC`, com monitoramento completo para clientes gerenciados pelo app e comportamento explícito quando a sessão é repassada para um launcher externo
- SFTP integrado para hosts `SSH`, com navegação remota, upload, download, rename, delete e mkdir
- `Quick Connect` na command palette para conexões temporárias `SSH`, `Telnet`, `RDP` e `VNC` sem salvar host
- Opção para abrir sessões na `mesma janela` ou no `terminal do sistema` (SSH/Telnet) e em `janelas dedicadas` (RDP/VNC)
- Dashboard com filtros compactos por grupo/subgrupo, tag, ordenação e edição em massa de `credencial`, `grupo` e `tags`
- Importação em massa de hosts via `.csv`, com template/export de exemplo, preview e merge controlado
- Acesso às importações direto pelo `+ Nova Conexão`, sem atrapalhar o fluxo principal de cadastro individual
- Operações com snippets, túneis e workspaces com compatibilidade por protocolo
- `Health check` de hosts e inventário de fingerprints salvas para hosts `SSH`, com edição manual do `known_hosts` interno do app
- Backup/restore com arquivo `.sshvault`, preservando o protocolo de cada host
- Sincronização remota com `GitHub Gist`, `S3/MinIO`, `WebDAV/Nextcloud` ou endpoint customizado
- Auto-sync periódico de estado portátil, bloqueado até existir senha mestra configurada e uma primeira sincronização manual
- MFA/TOTP por host `SSH`
- Interface traduzida para `pt-BR` e `en-US`

Hoje o app já opera como `Multi-Protocol Connection Manager`, com `SSH` e `Telnet` compartilhando a infraestrutura de terminal, `RDP` usando uma rota própria para abrir o launcher nativo da plataforma ou o viewer interno empacotado com o app, e `VNC` usando um fluxo dedicado para acionar clientes externos com transparência sobre o que o app consegue ou não monitorar.

O cliente RDP interno está em [clients/internal-rdp-client/README.md](/home/fernando/Documentos/ssh_vault/clients/internal-rdp-client/README.md). Esse cliente já consegue conectar, autenticar, renderizar a sessão remota, enviar input e capturar screenshots, e pode ser acionado pelo app principal quando o modo de abertura interno está ativo.

## Escopo por protocolo

- `SSH`
  Terminal completo, SFTP, snippets remotos, batch execution, túneis, health check, inventário de fingerprints com edição manual do `known_hosts` interno do app, MFA/TOTP, import de `~/.ssh/config`, importação em massa via `.csv`, jump host e presets de compatibilidade.
- `Telnet`
  Terminal interativo com múltiplas abas, quick connect, workspaces, preservação de sessão entre trocas de aba e suporte ao cadastro/import em massa via `.csv`.
- `RDP`
  Sessão gráfica via launcher nativo ou viewer interno experimental, quick connect, abertura em aba ou janela dedicada, escolha de cliente no Linux para o modo nativo, opções globais de resolução, fullscreen, multimonitor, clipboard, áudio e certificado, além de suporte ao cadastro/import em massa via `.csv`.
- `VNC`
  Sessão gráfica via launcher externo, quick connect, abertura em aba ou janela dedicada, escolha de cliente preferido no Linux, opções globais de fullscreen e view-only, além de indicação explícita quando o cliente foi apenas delegado ao sistema e não pode ser monitorado pelo app.
- `SFTP`
  Continua sendo um recurso derivado de `SSH`, então não aparece para hosts `Telnet`.

## Arquitetura em alto nível

- `Frontend`
  React Router organiza as páginas, Zustand mantém estado local e persistido, e a UI roda dentro do WebView do Tauri. O terminal do frontend foi neutralizado para servir `SSH` e `Telnet` com a mesma infraestrutura visual, enquanto `RDP` usa uma página de sessão própria para orquestrar o launcher nativo ou o viewer interno experimental. Os fluxos de onboarding agora incluem cadastro único, importação de `~/.ssh/config` e importação em massa por `.csv`.
- `Backend`
  O backend em Rust expõe comandos Tauri para terminal `SSH`/`Telnet`, SFTP, `RDP`, sync, criptografia, TOTP e persistência.
- `Persistência`
  Hosts, credenciais, chaves SSH, logs e settings ficam em SQLite; o host persiste o `protocol`; estado volátil de sessão fica em memória por janela; arquivos temporários `.rdp` e metadados de sessão ficam no diretório de dados da aplicação.
- `Segredos`
  Segredos sensíveis podem ser exportados/sincronizados de forma cifrada com senha mestra usando `Argon2id + AES-256-GCM`.

## Branding e compatibilidade

- O nome visível do produto é `MPCM Workspace`
- A classificação usada na documentação é `Multi-Protocol Connection Manager`
- O diretório de dados atual é `mpcm-workspace`, com migração automática do legado `ssh-vault`
- Identificadores internos legados como `name`, `identifier` e alguns marcadores de compatibilidade continuam preservados para evitar quebra de instalações e dados existentes

## Diagnóstico e logs

- O arquivo principal de diagnóstico do app fica dentro do diretório de dados local em `logs/ssh_vault.log`
- Quando o arquivo principal passa de ~5 MB, ele é rotacionado para `logs/ssh_vault.log.1`
- Eventos do backend em Rust, erros globais do frontend e falhas de `SSH`, `SFTP`, `Telnet`, `RDP` e `VNC` passam pelo mesmo logger persistente
- O diretório de logs pode ser alterado pela tela `Logs`; o padrão continua sendo o diretório de dados local do sistema operacional
- A visualização de logs permite filtrar o conteúdo carregado por termo livre, nível e sensibilidade a maiúsculas/minúsculas sem alterar os arquivos no disco
- O viewer RDP interno grava em `ssh_vault_viewer.log` dentro do mesmo diretório configurado
- O `Connection Log` da interface continua mostrando o histórico de sessões, agora com a mensagem do erro quando aplicável

## Sync e backup

### Sync

- O payload de sync inclui hosts, credenciais, chaves SSH e configurações portáveis
- O protocolo do host viaja no payload portátil e é restaurado em import, restore e sync
- O `push` publica o snapshot local atual no provider
- O `pull` importa/mescla o conteúdo remoto no estado local
- Auto-sync faz `push` em background sem prompt de senha mestra, então segredos cifrados dependentes da senha não entram nesse fluxo

### Backup

- Exporta para arquivo `.sshvault`
- Preserva o protocolo de cada host no backup
- Pode incluir segredos cifrados quando a senha mestra é informada
- Restore preserva IDs de hosts, credenciais e chaves, evitando quebrar vínculos internos

## Estrutura principal

```text
src/
  components/
    NewConnectionSplitButton.tsx
  hooks/
  lib/
    csvHostImport.ts
  locales/
  pages/
    CsvImportPage.tsx
    RdpPage.tsx
  store/
  themes/
  types/
src-tauri/
  src/
    crypto.rs
    database.rs
    rdp.rs
    sftp.rs
    ssh.rs
    ssh_config.rs
    storage.rs
    sync.rs
    telnet.rs
    totp.rs
scripts/
  sync-version.mjs
clients/
  internal-rdp-client/
    README.md
    src/
      bin/
        screenshot_mvp.rs
        viewer_mvp.rs
      mvp_runtime.rs
      viewer_input.rs
      viewer_renderer.rs
```

## Rodando o projeto

### Requisitos

- `Node.js 18+`
- `Rust stable`
- Dependências nativas exigidas pelo Tauri para a sua plataforma

No `Zorin OS 18.1`, além de instalar `Rust` e `Node.js`, instale as dependências nativas de build com:

```bash
sudo apt install libgtk-3-dev libglib2.0-dev pkg-config libsoup-3.0-dev libjavascriptcoregtk-4.1-0 libjavascriptcoregtk-4.1-dev gir1.2-javascriptcoregtk-4.1 libwebkit2gtk-4.1-dev build-essential curl wget libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

### Instalação

```bash
npm install
```

### Desenvolvimento web

```bash
npm run dev
```

### Desenvolvimento desktop com Tauri

```bash
npm run tauri dev
```

### Build do frontend

```bash
npm run build
```

### Build desktop

```bash
npm run tauri build
```

## Versionamento

O projeto agora usa o [package.json](/home/fernando/Documentos/ssh_vault/package.json) como fonte principal da versão da aplicação.

Arquivos sincronizados a partir dele:

- [package-lock.json](/home/fernando/Documentos/ssh_vault/package-lock.json)
- [src-tauri/Cargo.toml](/home/fernando/Documentos/ssh_vault/src-tauri/Cargo.toml)
- [src-tauri/Cargo.lock](/home/fernando/Documentos/ssh_vault/src-tauri/Cargo.lock)
- [src-tauri/tauri.conf.json](/home/fernando/Documentos/ssh_vault/src-tauri/tauri.conf.json) já aponta para o `package.json`
- [src/lib/appInfo.ts](/home/fernando/Documentos/ssh_vault/src/lib/appInfo.ts) lê a versão direto do `package.json`

Fluxo recomendado para atualizar a versão:

1. Edite o campo `version` em [package.json](/home/fernando/Documentos/ssh_vault/package.json).
2. Rode `npm run version:sync`.
3. Se quiser validar o pacote final, rode `npm run build`.

## Arquivos de referência

- [README.md](/home/fernando/Documentos/ssh_vault/README.md)
- [TECHNICAL_REFERENCE.md](/home/fernando/Documentos/ssh_vault/TECHNICAL_REFERENCE.md)
- [clients/internal-rdp-client/README.md](/home/fernando/Documentos/ssh_vault/clients/internal-rdp-client/README.md)
- [melhorias.txt](/home/fernando/Documentos/ssh_vault/melhorias.txt)

## Situação atual

O projeto já cobre o núcleo operacional multi-protocolo atual e inclui:

- Quick Connect
- janelas dedicadas de sessão
- suporte consolidado a `Telnet`
- suporte a `RDP` via launcher nativo e viewer interno experimental
- importação em massa via `.csv`
- fluxo de `+ Nova Conexão` com menu de ações
- seleção de cliente RDP no Linux
- opções globais de sessão RDP
- health check, inventário de fingerprints e edição manual do `known_hosts` interno
- edição em massa de hosts
- sync/backup alinhados com hosts, credenciais, chaves SSH, protocolo e settings portáveis
- página `About` com identidade e posicionamento do produto

## Licença

Uso interno / conforme a política do repositório.
