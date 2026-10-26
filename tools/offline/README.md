# HTML offline

Gera um arquivo único que responde as mesmas consultas sem servidor nenhum.

```bash
npm run html          # compila e gera offline/feriados-municipais.html (~1,2 MB)
```

Depois é só copiar o arquivo para uma pasta da rede ou para o computador de
quem consulta e abrir com dois cliques. Não instala nada, não precisa do
Node, funciona sem internet.

## O que ele faz e o que não faz

| | Servido | HTML offline |
| --- | --- | --- |
| Consulta por dia, com a norma citada | sim | sim |
| Consulta por período + calendário | sim | sim |
| Exportar o período em CSV | sim | sim |
| Exportar em PDF | sim | não |
| Planilha em lote | sim | não |
| Cadastrar/corrigir feriado | sim | não |

O que falta no offline depende de escrever no banco ou de biblioteca pesada,
e não compensaria carregar em cada cópia do arquivo.

**O arquivo é um retrato.** Ele traz a base do dia em que foi gerado, e diz
isso na tela, em cima. Feriado cadastrado depois não aparece — quando a
curadoria andar, rode de novo e redistribua.

## Como ele não diverge do servidor

Esta é a parte que exige cuidado: duas interfaces respondendo a mesma
pergunta tendem a divergir na primeira correção feita só de um lado. Três
coisas seguram isso:

1. **O motor não é reescrito.** `gerar-html.mjs` embute os módulos compilados
   de `dist/` (Páscoa, feriados nacionais, resolução em camadas). Se algum
   deles passar a usar um `import` que o empacotador não entende, a geração
   falha em vez de produzir um arquivo quebrado.
2. **A frase do veredito e as classes do calendário moram em módulos
   compartilhados** (`src/web/veredito.ts` e `src/web/calendario.ts`), usados
   tanto pelos templates EJS quanto pelo arquivo offline. Antes disso, a
   frase estava dentro do EJS e o calendário foi reimplementado à mão no
   offline — e saiu errado na primeira tentativa.
3. **Há uma verificação que compara os dois.**

```bash
node tools/offline/verificar.mjs          # servidor precisa estar no ar
AMOSTRAS=500 node tools/offline/verificar.mjs
```

Ela extrai o núcleo do arquivo gerado, roda em Node e compara com o que a
rota `/consulta` devolve, para uma amostra aleatória de município × data
mais alguns casos de borda fixos (Páscoa móvel, feriado estadual, município
sem curadoria). Compara **veredito, fontes citadas e as classes de cada
célula do calendário** — rode depois de mexer no motor, nos módulos
compartilhados ou no gerador.

## Peso

Os dados vão como tuplas, com tabela de textos repetidos (a mesma descrição
de fonte serve dezenas de municípios). O JSON com uma chave por campo em cada
linha passa de 4 MB; assim fica em torno de 1,2 MB, e a diferença aparece no
tempo de abrir.

Tudo precisa estar dentro do HTML porque, aberto por `file://`, o navegador
bloqueia `fetch` de arquivos vizinhos — dados, motor, estilo e imagens vão
embutidos.

A fonte Geist vem do Google Fonts por `<link>`: com internet o arquivo fica
igual ao sistema servido; sem internet, cai no `system-ui` do próprio
sistema. Nenhuma outra parte depende de rede.
