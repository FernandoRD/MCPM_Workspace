# Release Pelo GitHub CLI

Passo a passo para publicar uma release do MPCM Workspace usando a CLI oficial do GitHub (`gh`).

## 1. Pre-requisitos

Instale e autentique a GitHub CLI:

```bash
gh auth login
```

Confirme que a autenticacao e o repositorio estao corretos:

```bash
gh auth status
gh repo view
```

## 2. Validar o estado local

Confira se a versao ja foi atualizada nos manifests e na documentacao:

```bash
rg "0\\.4\\.6" package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock README.md TECHNICAL_REFERENCE.md
```

Rode o build web:

```bash
npm run build
```

Para gerar os pacotes desktop do Tauri:

```bash
npm run tauri build
```

Os artefatos normalmente ficam em:

```text
src-tauri/target/release/bundle/
```

## 3. Commitar as mudancas

Veja o que sera incluido:

```bash
git status
git diff --stat
```

Adicione os arquivos da release:

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock README.md TECHNICAL_REFERENCE.md src/components/ui/Input.tsx src/components/CommandPalette.tsx
```

Crie o commit:

```bash
git commit -m "Release 0.4.6"
```

Envie a branch:

```bash
git push
```

## 4. Criar e enviar a tag

Crie uma tag anotada:

```bash
git tag -a v0.4.6 -m "MPCM Workspace 0.4.6"
```

Envie a tag para o GitHub:

```bash
git push origin v0.4.6
```

## 5. Criar as notas da release

Crie um arquivo temporario com as notas:

```bash
$EDITOR RELEASE_NOTES.md
```

Sugestao de conteudo:

```md
# MPCM Workspace 0.4.6

## Novidades

- Campos de senha baseados no componente `Input` agora exibem um botao de visibilidade com icone de olho.
- `Quick Connect` ganhou o mesmo controle de visibilidade para senhas `SSH`, `RDP`, `VNC` e passphrase de chave privada.
- O botao de visibilidade preserva o foco do campo e alterna corretamente entre senha oculta e texto visivel.

## Validacao

- `npm run build`
```

## 6. Publicar a release

Crie a release a partir da tag:

```bash
gh release create v0.4.6 \
  --title "MPCM Workspace 0.4.6" \
  --notes-file RELEASE_NOTES.md
```

## 7. Enviar artefatos de build

Liste os artefatos disponiveis:

```bash
find src-tauri/target/release/bundle -type f
```

Envie os arquivos desejados para a release. Exemplos:

```bash
gh release upload v0.4.6 src-tauri/target/release/bundle/appimage/*.AppImage
```

```bash
gh release upload v0.4.6 src-tauri/target/release/bundle/deb/*.deb
```

```bash
gh release upload v0.4.6 src-tauri/target/release/bundle/rpm/*.rpm
```

Se precisar substituir um artefato ja enviado:

```bash
gh release upload v0.4.6 caminho/do/arquivo --clobber
```

## 8. Conferir a release publicada

Abra a release no navegador:

```bash
gh release view v0.4.6 --web
```

Ou veja no terminal:

```bash
gh release view v0.4.6
```

## 9. Limpeza opcional

Depois de publicar, remova as notas temporarias se nao quiser versiona-las:

```bash
rm RELEASE_NOTES.md
```

## Fluxo rapido

```bash
npm run build
npm run tauri build
git status
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock README.md TECHNICAL_REFERENCE.md src/components/ui/Input.tsx src/components/CommandPalette.tsx
git commit -m "Release 0.4.6"
git push
git tag -a v0.4.6 -m "MPCM Workspace 0.4.6"
git push origin v0.4.6
gh release create v0.4.6 --title "MPCM Workspace 0.4.6" --notes-file RELEASE_NOTES.md
gh release upload v0.4.6 src-tauri/target/release/bundle/appimage/*.AppImage
gh release view v0.4.6 --web
```
