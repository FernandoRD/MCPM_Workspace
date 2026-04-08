# Internal RDP Client Prototype

Protótipo isolado para iniciar o desenvolvimento do cliente RDP interno sem tocar no código da aplicação principal.

## Objetivo

Este diretório existe para permitir experimentação técnica em paralelo ao app atual.

Escopo desta primeira base:

- modelagem de configuração de sessão RDP
- abstração de transporte mockável
- transporte TCP real para laboratório local
- serialização de `TPKT`
- serialização de `X.224 Connection Request`
- parsing de `X.224 Connection Confirm`
- máquina de estados inicial da sessão
- framebuffer simples para servir de base ao renderer futuro
- binário MVP para conexão real e captura de screenshot via RDP

## MVP atual

O protótipo já consegue:

- abrir conexão TCP real com um servidor RDP
- negociar a sessão usando a stack do `IronRDP`
- autenticar com usuário e senha
- processar a sessão ativa tempo suficiente para receber frames
- abrir uma janela local simples para visualizar o desktop remoto
- enviar input básico de teclado e mouse para a sessão remota
- salvar um screenshot `.png` do desktop remoto
- ajustar resolução e profundidade de cor pelo CLI
- usar um perfil de sessão mais leve por padrão para melhorar responsividade
- aplicar redraw parcial no viewer local para melhorar fluidez
- controlar preferências visuais/performance da sessão por configuração de perfil e flags de CLI

Binário atual:

- `src/bin/screenshot_mvp.rs`
- `src/bin/viewer_mvp.rs`

Execução:

```bash
cargo run --manifest-path experiments/internal-rdp-client/Cargo.toml --bin screenshot_mvp -- \
  --host <HOST> \
  --username <USERNAME> \
  --password <PASSWORD> \
  --output experiments/internal-rdp-client/out/screenshot.png
```

Viewer local:

```bash
cargo run --manifest-path experiments/internal-rdp-client/Cargo.toml --bin viewer_mvp -- \
  --host <HOST> \
  --username <USERNAME> \
  --password <PASSWORD>
```

Atalho via `package.json` na raiz do projeto:

```bash
npm run rdp:viewer -- \
  --host <HOST> \
  --username <USERNAME> \
  --password <PASSWORD>
```

Opções úteis para desempenho:

- `--width 1280 --height 720` é o default atual
- `--width 1024 --height 768` pode ajudar em máquinas mais lentas
- `--color-depth 16` é o default atual e reduz o volume de dados
- `--no-lossy` desliga a compressão com perda, priorizando fidelidade em vez de fluidez

Opções visuais configuráveis da sessão:

- `--show-wallpaper`
- `--full-window-drag`
- `--menu-animations`
- `--theming`
- `--cursor-shadow`
- `--cursor-settings`
- `--font-smoothing`
- `--desktop-composition`

Sem essas flags, o protótipo usa um perfil mais agressivo de responsividade, desabilitando os efeitos visuais para reduzir custo de render no host remoto.

## O que este protótipo ainda não faz

- UI interativa embutida
- integração com `src-tauri`, `React` ou a UI atual
- gerenciamento de reconexão e lifecycle de janela
- canais virtuais como clipboard, áudio e redirecionamentos
- controle fino de render incremental fora do pipeline do `IronRDP`
- mapeamento completo de todas as teclas especiais

## Contrato interno atual do protótipo

O laboratório já está dividido em quatro blocos mais claros:

- `mvp_runtime.rs`
  conexão, negociação, perfil de sessão, preferências visuais e loop ativo com coleta de regiões alteradas
- `viewer_input.rs`
  tradução de teclado e mouse do `minifb` para eventos FastPath do RDP
- `viewer_renderer.rs`
  buffer local do viewer e aplicação de redraw total/parcial
- `bin/*.rs`
  composição final dos fluxos `viewer` e `screenshot`

Essa separação é a base planejada para uma integração futura com `Tauri`, sem obrigar o app principal a depender do binário MVP como está hoje.

## Input suportado no viewer MVP

- teclado alfanumérico
- `Tab`, `Enter`, `Backspace`, `Space`, `Escape`
- setas, `Home`, `End`, `Insert`, `Delete`, `PageUp`, `PageDown`
- `Shift`, `Ctrl`, `Alt`, `Super`, `CapsLock`, `NumLock`, `ScrollLock`
- `F1` a `F12`
- teclado numérico
- movimento de mouse
- clique esquerdo, direito e botão do meio
- scroll vertical e horizontal do mouse/trackpad

Para encerrar o viewer, feche a janela local.
O viewer oculta o cursor local e passa a renderizar o ponteiro remoto na própria sessão quando o servidor fornecer esse update.

## Estrutura

```text
experiments/internal-rdp-client/
  Cargo.toml
  README.md
  src/
    bin/
      screenshot_mvp.rs
      viewer_mvp.rs
    config.rs
    framebuffer.rs
    lib.rs
    mvp_runtime.rs
    session.rs
    transport.rs
    viewer_input.rs
    viewer_renderer.rs
    protocol/
      mod.rs
      tpkt.rs
      x224.rs
```

## Como validar

```bash
cargo test --manifest-path experiments/internal-rdp-client/Cargo.toml
```

## Como gerar um screenshot real

```bash
mkdir -p experiments/internal-rdp-client/out

cargo run --manifest-path experiments/internal-rdp-client/Cargo.toml --bin screenshot_mvp -- \
  --host <HOST> \
  --username <USERNAME> \
  --password <PASSWORD> \
  --output experiments/internal-rdp-client/out/screenshot.png
```

Atalho via `package.json` na raiz do projeto:

```bash
npm run rdp:screenshot -- \
  --host <HOST> \
  --username <USERNAME> \
  --password <PASSWORD> \
  --output experiments/internal-rdp-client/out/screenshot.png
```

## Como abrir o viewer local

```bash
cargo run --manifest-path experiments/internal-rdp-client/Cargo.toml --bin viewer_mvp -- \
  --host <HOST> \
  --username <USERNAME> \
  --password <PASSWORD>
```

## Próximos passos sugeridos

1. Ampliar o mapeamento de teclas especiais e atalhos do viewer.
2. Refinar lifecycle de janela, shutdown e reconexão.
3. Consolidar uma API interna estável para sessão, input e render.
4. Definir o contrato de integração futura com `src-tauri`.
5. Só então começar a plugar isso na aplicação principal.
