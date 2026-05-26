# Analise Para Versao Android

Resumo direto: e viavel criar uma versao Android, mas nao como "build e pronto". O app ja esta em Tauri 2 e o backend tem `#[cfg_attr(mobile, tauri::mobile_entry_point)]` em `src-tauri/src/lib.rs`, entao a base tecnica ajuda. A dificuldade esta nas funcionalidades desktop: terminal do sistema, launchers RDP/VNC externos, binario RDP interno, keychain/SQLCipher e UI pensada para mouse/tela larga.

## O Que Deve Funcionar Com Menos Atrito

- Frontend React/Vite/Tailwind: portavel para WebView Android.
- Cadastro de hosts, grupos, tags, credenciais, settings, backup/sync, TOTP, health checks simples.
- SSH/Telnet dentro do app via Rust + `xterm.js`, porque ja usam `russh`, `tokio::net` e eventos Tauri, nao dependem do OpenSSH do sistema.
- SFTP via `russh-sftp`, em principio, desde que compilacao Rust/Android e file picker sejam resolvidos.
- Sync via `reqwest` com `rustls-tls`, boa escolha para mobile.

## Principais Bloqueios

- `system_terminal.rs`: a opcao "abrir no terminal do sistema" depende de `ssh`, `telnet`, `gnome-terminal`, `cmd`, `Terminal.app`, etc. Isso nao existe no Android. Essa opcao teria que ser escondida/desativada ou substituida por terminal integrado.
- `rdp.rs`: o modo nativo chama `mstsc`, `open`, `xfreerdp`, `wlfreerdp`, `remmina`, `krdc`; nada disso se aplica ao Android. O viewer RDP interno tambem e um binario separado empacotado em `src-tauri/resources/internal-rdp-client/`, usa `minifb` no projeto `clients/internal-rdp-client/Cargo.toml`, e precisaria virar componente Android/WebView/canvas, nao processo desktop.
- `vnc.rs`: mesmo problema do RDP. Hoje ele delega para TigerVNC, Remmina, KRDC, Vinagre, `xdg-open`, `cmd start` ou `open`. No Android teria que abrir app externo via intent/deep link ou implementar viewer VNC interno.
- `database.rs`: usa `keyring` para guardar a chave SQLCipher. O `Cargo.toml` habilita backends Apple/Windows/Linux, mas nao ha integracao Android explicita. Provavelmente precisa trocar para plugin mobile/Kotlin usando Android Keystore, ou usar Stronghold/plugin seguro.
- `rusqlite` com `bundled-sqlcipher-vendored-openssl`: pode ser uma das partes mais chatas de cross-compile para Android por envolver SQLCipher/OpenSSL nativos.
- UI: `AppLayout.tsx` e desktop-first, com sidebar, abas, splits, hover menus e varias telas densas. Funciona em tablet com ajustes; em celular exigiria layout mobile real.

## O Que E Necessario

1. Inicializar o target Android do Tauri:
   - Instalar Android Studio, SDK Platform, Platform Tools, NDK, Build Tools e Command-line Tools.
   - Definir `JAVA_HOME`, `ANDROID_HOME`, `NDK_HOME`.
   - Adicionar targets Rust Android: `aarch64-linux-android`, `armv7-linux-androideabi`, `i686-linux-android`, `x86_64-linux-android`.
   - A documentacao oficial atual do Tauri lista esses requisitos para Android: <https://v2.tauri.app/start/prerequisites/>

2. Rodar `npm run tauri android init` e depois `npm run tauri android dev` / `npm run tauri android build`.
   - O Tauri recomenda comandos especificos `tauri android dev` para mobile: <https://v2.tauri.app/develop/>

3. Criar uma camada de compatibilidade mobile:
   - `#[cfg(mobile)]` para desativar `system_terminal`, launchers RDP/VNC e binarios externos.
   - No frontend, esconder opcoes como "terminal do sistema", clientes Linux RDP/VNC, multimonitor desktop e janelas dedicadas quando estiver em Android.
   - Definir um `PlatformCapabilities` simples: `supportsSystemTerminal`, `supportsExternalRdpLauncher`, `supportsExternalVncLauncher`, `supportsStandaloneWindows`, etc.

4. Resolver persistencia segura:
   - Android Keystore via plugin Kotlin/Tauri mobile, ou migracao para plugin seguro compativel.
   - Validar SQLCipher no Android. Se travar, avaliar `tauri-plugin-sql`/SQLite normal + criptografia de payloads sensiveis em nivel de aplicacao.

5. Adaptar UX mobile:
   - Sidebar vira drawer/bottom navigation.
   - Tabelas e paginas densas viram listas/cards.
   - Terminal precisa toolbar touch: Ctrl, Esc, Tab, setas, paste, resize.
   - Splits terminal/SFTP devem virar tabs internas ou painel alternavel em celular.

## MVP Android Realista

Eu faria o primeiro MVP com:

- Dashboard, hosts, grupos, credenciais, chaves SSH.
- Terminal SSH/Telnet integrado.
- SFTP integrado.
- Sync/backup/TOTP/logs basicos.
- Sem terminal do sistema.
- Sem RDP/VNC nativos no primeiro corte, ou apenas "abrir app externo" via intent se houver cliente instalado.

## Dificuldade Por Area

- Build Tauri Android basico: media.
- SSH/Telnet integrado: media.
- SFTP: media para alta, por permissoes/file picker.
- Banco criptografado + keychain Android: alta.
- RDP Android: alta se for viewer interno; baixa/media se so delegar para app externo.
- VNC Android: alta se viewer interno; media se abrir app externo.
- UI celular bem feita: alta, porque o produto e denso e operacional.
- Publicacao Play Store: media, com assinatura e AAB. Fonte oficial sobre assinatura Android: <https://v2.tauri.app/distribute/sign/android/>

## Estimativa

Um MVP Android util levaria algo como 2 a 4 semanas de engenharia focada se o escopo for SSH/SFTP/sync.

Uma versao completa mantendo paridade de RDP/VNC/desktop provavelmente vira projeto de 2 a 4 meses, porque os protocolos graficos deixam de ser launchers desktop e passam a exigir integracao mobile de verdade.
