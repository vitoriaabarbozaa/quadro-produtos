# Quadro de Produtos

Painel semanal da programação ao vivo da Rede Globo Nordeste (BDPE, NE1, GE, Boletim, NE2, Jogo, GCO, Descomplica, Evento), pensado pra ficar exibido em tela e ser atualizado pelo Jornalismo.

## Funcionalidades

- **Visualização livre**, sem login: o quadro da semana fica visível pra qualquer pessoa que abrir a página (ideal pra ficar espelhado em telas).
- **Tempo real**: os dados ficam no Firebase (Firestore), então qualquer alteração aparece na hora em todos os dispositivos que estiverem com o quadro aberto.
- **Navegação por semana** (anterior, "Hoje" e próxima) e **filtro por turno** (Manhã, Tarde, Noite), com destaque pro turno atual.
- **Em exibição / Próximo**: o cabeçalho mostra o produto que está no ar agora e o próximo, com contagem regressiva, no horário de Recife (UTC-3).
- **Visão do dia**: clicando no dia, abre uma linha do tempo com os produtos, a linha de "Agora" e o detalhe de cada talento.
- **Modo Admin** (botão no cabeçalho): login com nome + senha libera criar, editar e excluir produtos da programação.
- **Formulário de produto** com campos obrigatórios: Nome, Início, Fim, Estúdio / Local, Canal / Transmissão (quando o produto é um jogo) e Equipe (ao menos uma pessoa). Só **Observações** é opcional. Os campos obrigatórios aparecem com `*` e o formulário avisa o que falta antes de salvar.
- **Equipe por função**: ao criar/editar, dá pra montar a equipe marcando pessoas em caixinhas separadas por função (Apresentador(a), Câmera, Direção, Narrador etc.), com opção de cadastrar gente ou função nova na hora.
- **Histórico de alterações**: botão "Histórico", no canto superior direito, abre as últimas 100 alterações (quem criou, editou ou excluiu, quando e o que mudou). É público e compartilhado entre dispositivos.
- **Modo noturno**: botão 🌙/☀️ no cabeçalho. A escolha fica salva no navegador e, na primeira visita, o app segue o tema do sistema.
- **Responsivo**: grade de 7 colunas no desktop, 3 no tablet e 1 no celular.
- **Instalável (PWA)**: dá pra instalar no celular, tablet ou computador e abrir como um app, em tela cheia e com ícone próprio. Veja a seção "Instalar como app".

## Stack

- React 19 + TypeScript
- Vite 8
- Tailwind CSS v4
- Firebase (Firestore)

## Rodando localmente

Pré-requisito: [Node.js](https://nodejs.org) instalado (versão LTS).

```
npm install
npm run dev
```

O terminal vai mostrar um link (por padrão `http://localhost:8443`). Se a porta estiver ocupada, rode com outra:

```
# Windows (PowerShell)
$env:PORT=3000; npm run dev

# macOS/Linux
PORT=3000 npm run dev
```

### Build de produção

```
npm run build
```

Gera os arquivos finais em `dist/`. Pra testar o build localmente: `npm run preview`.

## Deploy

- **Vercel**: importe o repositório, com comando de build `npm run build` e pasta de saída `dist`. Cada push na `main` gera um novo deploy.
- **GitHub Pages**: o workflow `.github/workflows/deploy.yml` faz build e publica a cada push na `main`, definindo `VITE_BASE` com o nome do repositório. Atenção: no plano gratuito do GitHub, o Pages não funciona com repositório privado.

## Estrutura do projeto

```
src/
  App.tsx       # UI principal: cabeçalho, grade semanal, visão do dia, modais, formulário de produto, modo noturno
  index.css     # Estilos globais, responsividade, cores de status e tema noturno
  data.ts       # Tipos, cores dos produtos e modelo padrão de programação
  storage.ts    # Persistência no Firestore (programação e histórico)
  firebase.ts   # Configuração e inicialização do Firebase
  roster.ts     # Tipos de produto, funções e pessoas pré-cadastradas
  auth.ts       # Contas e senhas de acesso ao Modo Admin
  hooks.ts      # Utilitários de hora/formatação
  main.tsx      # Entrada do React + registro do service worker
public/
  manifest.webmanifest  # Nome, cores e ícones do app instalável
  sw.js                 # Service worker (cache da "casca" do app)
  icons/                # Ícones do app (192, 512, maskable, iOS e favicon)
```

## Firebase

Os dados ficam em duas coleções do Firestore:

- `schedule`: um documento por dia (`AAAA-MM-DD`) com a lista de produtos. Quando o dia ainda não existe, ele é criado a partir do modelo padrão em `src/data.ts` e depende do dia da semana: de segunda a sexta entram BDPE, NE1, GE, Boletim e NE2; no sábado, só NE1, GE e NE2; no domingo, nenhum. Jogo, GCO, Descomplica e Evento são adicionados manualmente pelo admin, só nos dias em que acontecem. Mudar o modelo não altera dias que já foram criados no Firestore.
- `editLogs`: um documento por alteração, usado pelo Histórico.

As regras do Firestore precisam permitir leitura e escrita nessas duas coleções. Se o Histórico mostrar um aviso de bloqueio ou o app avisar que "o histórico não foi registrado", é isso que falta. A configuração do projeto fica em `src/firebase.ts`.

## Instalar como app

O site é um PWA, então o navegador oferece a instalação (precisa estar em HTTPS, como no Vercel e no GitHub Pages):

- **Android (Chrome)**: menu ⋮ → **Instalar app** (ou **Adicionar à tela inicial**). Em alguns casos o Chrome também mostra um aviso de instalação sozinho.
- **iPhone/iPad (Safari)**: botão de compartilhar → **Adicionar à Tela de Início**. O iOS não mostra aviso automático.
- **Computador (Chrome/Edge)**: ícone de instalar na barra de endereço.

Detalhes do funcionamento:

- O `public/sw.js` guarda a "casca" do app (HTML, JS, CSS e ícones). Sem internet o app abre, mas **a programação não carrega**, porque os dados vêm do Firebase em tempo real e não ficam salvos offline.
- O HTML é sempre buscado na rede primeiro, e quando sai uma versão nova o app recarrega sozinho. Assim, um quadro que fica ligado numa tela não fica preso numa versão antiga.
- O service worker só roda no build de produção (`npm run build`), não no `npm run dev`.
- Pra trocar o ícone, substitua os arquivos em `public/icons/` mantendo os nomes. Nome e cores ficam em `public/manifest.webmanifest`. Se mudar o cache e quiser forçar todo mundo a baixar de novo, altere `VERSION` em `public/sw.js`.
- Quem já instalou o app precisa reabrir uma vez pra pegar atualizações do manifesto. Mudança de ícone no celular pode exigir reinstalar.

## Modo noturno

O tema é controlado pela classe `dark` no elemento `<html>`, e a escolha fica salva no `localStorage` (chave `theme`). Em vez de duplicar cada classe do Tailwind, o `src/index.css` redefine as variáveis de cor do tema dentro de `html.dark`. Pra ajustar as cores do modo noturno, edite esse bloco. As cores dos badges de status (Confirmado, Previsto, Alterado, Cancelado) ficam nas variáveis `--st-*`, no mesmo arquivo.

## Acesso de Admin

As contas com acesso de edição ficam em `src/auth.ts`, no array `ACCOUNTS`. Pra trocar a senha ou adicionar um novo setor com acesso, edite esse arquivo:

```ts
export const ACCOUNTS: Account[] = [
  { label: "Admin", password: "<sua-senha>", role: "admin" },
  // { label: "COT", password: "<outra-senha>", role: "admin" },
];
```

O nome digitado no login aparece no Histórico como autor da alteração, e a sessão fica salva no navegador até clicar em "Sair".

> **Atenção:** como é um projeto 100% front-end, essa senha vai dentro do JavaScript que o navegador baixa, então fica visível pra qualquer pessoa que inspecione o site, mesmo com o repositório privado. O mesmo vale pra configuração do Firebase. Não é uma segurança "à prova de bala": serve pra evitar que alguém mexa na programação sem querer, não pra proteger informação sigilosa. Não use uma senha que você usa em outros lugares.

## Super Admin

Além do admin comum, existe um usuário **Super Admin**, que faz tudo o que o admin faz e ainda pode **apagar o histórico de alterações** (um registro por vez, com o botão "Apagar", ou tudo de uma vez, com "Limpar histórico").

Ele entra pelo mesmo botão **Modo Admin**: no campo "Seu nome" vai o usuário (definido em `SUPER_USERNAME`, em `src/auth.ts`) e no campo "Senha" vai a senha dele. O nome desse usuário fica reservado, então um admin comum não consegue entrar com ele.

A senha **não fica escrita no código**: só o hash dela (`SUPER_PASSWORD_HASH`, PBKDF2-SHA256). Pra trocar a senha, gere um hash novo abrindo o site no navegador, apertando `F12`, indo na aba **Console** e colando o código abaixo (troque `MINHA-SENHA-NOVA` pela senha desejada):

```js
(async () => {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode("MINHA-SENHA-NOVA"), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode("quadro-produtos:super:v1"), iterations: 210000 }, key, 256);
  console.log(Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join(""));
})();
```

Copie o texto que aparecer e cole no lugar de `SUPER_PASSWORD_HASH` em `src/auth.ts`.

> Apagar o histórico exige que as regras do Firestore permitam `delete` na coleção `editLogs`. Se aparecer o aviso "O Firebase bloqueou a exclusão", é isso que precisa ser liberado.

## Cadastrando pessoas e funções

As sugestões de pessoas por função (usadas nas caixinhas do formulário) ficam em `src/roster.ts`, no objeto `PEOPLE_BY_CATEGORY`. Também é possível adicionar pessoas e funções novas direto pela interface, no Modo Admin. Essas adições ficam salvas só no navegador (`localStorage`) e **não** sincronizam entre dispositivos; pra uma pessoa aparecer pra todo mundo, inclua-a no `roster.ts`.
