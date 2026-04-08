# Plano de Implementação — Viewer RDP Como Launcher

Documento de referência para uma abordagem futura em que o viewer RDP próprio é tratado como **mais um launcher**, ao lado dos clientes nativos já suportados.

## Objetivo

Desenvolver um viewer RDP próprio sem colocar em risco o fluxo estável já existente com:

- `mstsc` no Windows
- `xfreerdp` / `wlfreerdp` / `remmina` / `krdc` no Linux
- cliente associado no macOS

A ideia é que o app principal continue funcionando normalmente com launcher nativo enquanto o viewer próprio amadurece em um projeto separado.

## Princípio de arquitetura

O viewer próprio **não deve nascer acoplado ao app principal**.

Ele deve ser tratado como:

- um processo separado
- com contrato claro de entrada e saída
- podendo ser selecionado como launcher alternativo

Em vez de tentar “embutir” a engine RDP dentro do `MPCM Workspace` desde o início, o app principal só decide:

- abrir no cliente nativo
- ou abrir no viewer próprio

## Benefícios dessa abordagem

- reduz o risco de quebrar o que já funciona
- permite evoluir o viewer com ciclo de debug mais curto
- facilita testes isolados de render, teclado, mouse e resize
- desacopla crash do viewer do app principal
- transforma a integração futura em um problema de contrato, não de experimentação

## Resultado esperado

Ao final, o `MPCM Workspace` deve conseguir usar o viewer próprio do mesmo jeito que hoje escolhe um launcher nativo.

Exemplo de decisão futura:

- `launcherMode: "system" | "embedded-viewer"`

ou, no Linux:

- `auto`
- `xfreerdp`
- `wlfreerdp`
- `remmina`
- `krdc`
- `mpcm-rdp-viewer`

## Escopo recomendado

### Fase 1 — Definir a fronteira do viewer

Antes de codar, decidir o formato do viewer separado.

Opções:

- aplicativo desktop pequeno independente
- binário/helper gráfico com janela própria
- biblioteca nativa com demo própria

Recomendação:

- começar por **aplicativo/binário separado com janela própria**

Motivo:

- é o formato com melhor isolamento
- mais fácil de testar
- mais simples de empacotar depois como launcher alternativo

### Fase 2 — Definir o contrato com o app principal

O viewer precisa ter uma interface de chamada estável.

Contrato mínimo sugerido:

- host
- porta
- username
- password ou referência de credencial temporária
- largura
- altura
- fullscreen
- clipboard
- áudio
- política de certificado
- título da sessão

Formas viáveis de integração:

- argumentos de linha de comando
- arquivo temporário JSON de sessão
- socket local / named pipe

Recomendação inicial:

- **arquivo temporário JSON + argumentos simples**

Motivo:

- fácil de depurar
- portátil
- baixo acoplamento

### Fase 3 — Criar o projeto separado do viewer

Criar um repositório ou subprojeto próprio para o viewer.

Estrutura mínima sugerida:

- engine RDP
- janela gráfica
- render do framebuffer
- loop de conexão
- mouse
- teclado
- resize
- logs locais

Entrega mínima do viewer isolado:

- conectar em um host RDP com usuário e senha
- abrir janela própria
- mostrar desktop remoto
- aceitar mouse e teclado básicos
- encerrar corretamente

### Fase 4 — Criar uma demo e suíte de validação isolada

Antes de integrar ao app principal, validar o viewer sozinho.

Checklist:

- conexão bem-sucedida
- reconexão simples
- resize da janela
- clique esquerdo/direito
- teclado básico
- alt/tab e teclas especiais definidas
- comportamento em erro de autenticação
- comportamento em erro de certificado
- consumo de CPU e memória

Meta:

- só integrar depois que o viewer estiver funcional e previsível sozinho

### Fase 5 — Integrar como novo launcher no app principal

Quando o viewer estiver maduro, o `MPCM Workspace` passa a tratá-lo como mais um launcher.

Arquivos com impacto provável:

- `src/types/index.ts`
- `src/store/settings.ts`
- `src/pages/Settings.tsx`
- `src/pages/RdpPage.tsx`
- `src-tauri/src/rdp.rs`

Mudanças esperadas:

- nova opção de launcher RDP
- chamada do binário do viewer próprio
- logs específicos de qual launcher foi usado
- fallback opcional para launcher nativo

### Fase 6 — Empacotamento e distribuição

Depois da integração, decidir como distribuir o viewer.

Opções:

- empacotar junto com o app principal
- baixar sob demanda
- distribuir como componente separado

Recomendação inicial:

- **empacotar junto quando estiver estável**

Pontos críticos:

- path do binário por plataforma
- permissões de execução
- assinatura / notarização
- tamanho final do pacote

## Reaproveitamento do que já existe

### Pode ser reaproveitado bem

- cadastro de hosts RDP
- quick connect
- credenciais
- opções de sessão RDP
- logs de conexão
- janela/aba dedicada
- backend que orquestra o launcher
- escolha de launcher nas configurações

### Não deve ser confundido com reaproveitamento de engine

O que existe hoje ajuda como **camada de produto e integração**, não como implementação do viewer.

Ou seja:

- reaproveitamos o orquestrador
- não reaproveitamos o motor gráfico do launcher nativo

## Contrato sugerido entre app principal e viewer

### Entrada

- `sessionId`
- `host`
- `port`
- `username`
- `password` ou token temporário
- `width`
- `height`
- `fullscreen`
- `clipboard`
- `audioMode`
- `certificateMode`

### Saída mínima

- código de saída do processo
- logs legíveis
- status simples: `started`, `connected`, `error`, `closed`

### Evolução futura opcional

- canal IPC para eventos de estado
- reconexão controlada
- telemetria local
- métricas de desempenho

## Estratégia de desenvolvimento recomendada

1. Criar o viewer como projeto separado
2. Fazer o viewer funcionar sozinho
3. Definir contrato estável de entrada
4. Integrar ao `MPCM Workspace` como novo launcher
5. Adicionar fallback para cliente nativo
6. Só depois avaliar experiência realmente embutida

## Regra de decisão

O app principal só deve passar a usar o viewer próprio quando estas condições forem verdadeiras:

- abre sessão com confiabilidade aceitável
- não quebra em operações básicas de mouse e teclado
- trata erro de credencial e certificado de forma clara
- fecha sem deixar processos órfãos
- funciona pelo menos nas plataformas prioritárias do produto

## Risco principal

O maior risco é tentar integrar cedo demais.

Se o viewer ainda estiver instável e já virar parte do fluxo principal:

- o RDP inteiro passa a parecer quebrado
- fica difícil separar bug do viewer de bug do produto
- a confiança no recurso cai

## Recomendação final

Sim, essa abordagem é viável e é a mais segura para perseguir um viewer próprio.

Resumo prático:

- desenvolver separado
- integrar como launcher
- manter o nativo como fallback
- só pensar em “viewer realmente embutido” depois que o viewer separado estiver maduro
