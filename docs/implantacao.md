# Como deixar a ferramenta no ar

Duas formas, da mais simples para a mais robusta. Escolha pelo uso real, não
pelo que parece mais profissional.

## Sob demanda: dois cliques (é o caminho atual)

Na pasta do projeto existe **`Abrir Feriados Municipais.cmd`**. Dois cliques
nele e pronto: ele prepara o que falta, sobe o sistema e abre no navegador.
A janela mostra o endereço para passar aos outros:

```
  Feriados Municipais está no ar.

  Neste computador:   http://localhost:3000
  Para compartilhar:  http://192.168.1.149:3000
```

Quem estiver na mesma rede abre pelo segundo endereço — **sempre com o dado
atual**, porque todos olham a mesma base. Fechar a janela derruba o sistema.

Serve quando a ferramenta é usada por períodos, não o dia inteiro: alguém do
DP abre, trabalha, compartilha o endereço com quem precisar naquele momento e
fecha no fim.

Três coisas que valem saber:

- **A primeira execução demora alguns minutos** (instala dependências). As
  seguintes levam segundos.
- **O endereço muda** se o IP da máquina mudar. Por isso ele é mostrado na
  janela toda vez, em vez de ficar anotado em algum lugar que envelhece.
- **Na primeira vez o Windows pode perguntar** se libera o Node.js na rede.
  Precisa responder que sim, senão só funciona no próprio computador. Se a
  pergunta não aparecer e mesmo assim ninguém conseguir abrir de fora, veja
  a liberação de porta na seção 6.

**Atalho na área de trabalho:** clique direito no `.cmd` → Enviar para → Área
de trabalho. Dá para trocar o ícone nas propriedades do atalho.

## Sempre no ar: serviço do Windows

Quando o uso virar diário e a ferramenta passar a ser consultada o tempo
todo, vale subir como serviço numa máquina que fica ligada — aí o endereço
responde sem ninguém precisar abrir nada. Não precisa ser uma VM da TI: um
computador da empresa que não desliga já resolve.

O resto deste documento descreve esse caminho.

---

# Implantação em Windows Server (rede interna)

Como tirar a aplicação da máquina de quem desenvolve e deixá-la de pé num
servidor da empresa, acessível pelo time de DP pela rede interna.

Decisões que moldam este documento, para quem for revisar depois:

- **Rede interna, sem exposição pública.** Não há HTTPS nem domínio externo;
  o acesso é por `http://<servidor>:3000` dentro da rede.
- **Sem login**, inclusive na tela administrativa — é decisão explícita do
  projeto (ver `CLAUDE.md`). Quem alcança o endereço pode editar feriado.
  Isso é aceitável enquanto o endereço não sair da rede interna; se um dia
  sair, login deixa de ser opcional.
- **Um processo Node, um arquivo SQLite.** Não há banco separado, fila,
  Redis ou container. É o que torna esta página curta.

---

## 1. O que a VM precisa

| Item | Valor |
| --- | --- |
| SO | Windows Server 2016 ou mais novo |
| CPU / RAM | 2 vCPU e 4 GB sobram com folga (o processo fica abaixo de 200 MB) |
| Disco | 2 GB para a aplicação; o banco tem ~6 MB e cresce devagar |
| Node.js | **20 LTS ou 22 LTS** — ver o aviso abaixo |
| Porta | 3000 na rede interna (configurável) |
| Fuso | America/Sao_Paulo |

**Não instale Node 24 ou mais novo.** O `better-sqlite3` ainda não publica
binário pré-compilado para essa ABI; sem Python e Visual Studio Build Tools
na máquina, o `npm ci` trava tentando compilar do zero. Com o 20 ou o 22 o
binário vem pronto e a instalação leva segundos.

**O fuso importa.** Os documentos de exportação levam carimbo de data e hora
gerado pelo relógio do servidor. Uma VM em UTC vai carimbar três horas à
frente no PDF que o DP anexa ao fechamento. Confira com `tzutil /g` e
ajuste com `tzutil /s "E. South America Standard Time"`.

---

## 2. Levar o código para o servidor

Copie a pasta do projeto **sem** `node_modules` e **sem** `dist` (ambos são
regerados no servidor e o `node_modules` sequer é portável entre máquinas,
por causa do binário nativo do SQLite).

Destino sugerido: `C:\apps\feriados-municipais`.

Se o servidor tiver Git e acesso ao repositório, `git clone` é melhor —
atualizar depois vira um `git pull`.

---

## 3. Instalar, construir e preparar o banco

Num PowerShell **como administrador**, na pasta do projeto:

```bash
npm ci
```

```bash
npm run build
```

Agora o banco. São dois caminhos, e o certo depende do que você quer levar:

**a) Levar os dados que já existem** (8.626 feriados curados, com fonte) —
é o caso normal. Gere um backup consistente na máquina de origem e copie o
arquivo resultante para `C:\apps\feriados-municipais\data\holidays.db`:

```bash
node dist/scripts/backup.js
```

Use o arquivo gerado em `backups\`, **não** o `data\holidays.db` direto: o
banco roda em modo WAL e uma cópia crua feita com o servidor no ar sai
desatualizada ou corrompida. O script resolve isso (seção 7).

**b) Começar do zero** — só faz sentido se a curadoria for refeita:

```bash
node dist/db/migrate.js
```

```bash
npm run seed
```

---

## 4. Variáveis de ambiente

Defina no nível da máquina, para o serviço enxergar:

```bash
setx /M DATABASE_PATH "C:\apps\feriados-municipais\data\holidays.db"
```

```bash
setx /M PORT "3000"
```

**Use caminho absoluto no `DATABASE_PATH`.** O padrão (`data/holidays.db`)
é relativo à pasta de onde o processo subiu; um serviço do Windows nem
sempre sobe de onde você espera, e o resultado seria a aplicação criar um
banco vazio em outro canto do disco em vez de abrir o que tem os dados — sem
erro nenhum, só uma tela dizendo que não há feriado cadastrado.

---

## 5. Subir como serviço

### Opção A — NSSM (recomendada)

O NSSM (`nssm.cc`, ferramenta livre de um executável só) transforma o
processo Node em serviço de verdade: sobe no boot e **reinicia sozinho** se
o processo morrer. É o que vale a pena para algo que o DP vai depender.

```bash
nssm install FeriadosMunicipais "C:\Program Files\nodejs\node.exe" "C:\apps\feriados-municipais\dist\server.js"
```

```bash
nssm set FeriadosMunicipais AppDirectory "C:\apps\feriados-municipais"
```

```bash
nssm set FeriadosMunicipais AppStdout "C:\apps\feriados-municipais\logs\saida.log"
```

```bash
nssm start FeriadosMunicipais
```

### Opção B — Tarefa Agendada (sem instalar nada)

Serve se a TI não aceitar software de terceiro. Não reinicia sozinho em caso
de queda — só no boot.

```bash
schtasks /create /tn "FeriadosMunicipais" /tr "'C:\Program Files\nodejs\node.exe' 'C:\apps\feriados-municipais\dist\server.js'" /sc onstart /ru SYSTEM /rl HIGHEST
```

---

## 6. Liberar a porta e conferir

```bash
netsh advfirewall firewall add rule name="Feriados Municipais" dir=in action=allow protocol=TCP localport=3000
```

Do próprio servidor:

```bash
curl http://localhost:3000/health
```

Deve responder `{"status":"ok"}`. De uma máquina qualquer do DP, abra
`http://<nome-ou-ip-do-servidor>:3000` — a tela de Consulta tem que aparecer.

Vale testar as quatro telas pelo menos uma vez: Consulta, Operação em lote
(subindo uma planilha pequena), Exportação (baixando um PDF) e Administração
(abrindo a listagem e uma tela de edição).

---

## 7. Backup

O banco é um arquivo só, mas **"backup = copiar o arquivo" só vale com o
serviço parado**. Em modo WAL, parte das gravações recentes vive no arquivo
`-wal`; uma cópia crua com o servidor no ar sai desatualizada, ou corrompida
se pegar um checkpoint no meio.

Por isso existe o script, que usa `VACUUM INTO` — o próprio SQLite escreve
um banco novo, íntegro e compactado, sem travar quem está consultando:

```bash
node dist/scripts/backup.js
```

Grava em `backups\holidays-AAAA-MM-DD-HHMM.db` e mantém os 30 mais recentes
(ajustável em `BACKUP_MANTER`; pasta de destino em `BACKUP_DIR`).

Agende para rodar diariamente:

```bash
schtasks /create /tn "FeriadosMunicipais-Backup" /tr "'C:\Program Files\nodejs\node.exe' 'C:\apps\feriados-municipais\dist\scripts\backup.js'" /sc daily /st 22:00 /ru SYSTEM
```

Aponte a rotina de backup da empresa para a pasta `backups\`, não para
`data\`. E teste a restauração pelo menos uma vez: parar o serviço, copiar
um arquivo de `backups\` por cima de `data\holidays.db`, apagar os `-wal` e
`-shm` que sobrarem, subir de novo.

---

## 8. Atualizar a aplicação

```bash
nssm stop FeriadosMunicipais
```

Depois, na pasta do projeto: `git pull` (ou copiar os arquivos novos),
`npm ci`, `npm run build` e — se a atualização trouxer migration nova —
`node dist/db/migrate.js`. Então:

```bash
nssm start FeriadosMunicipais
```

Faça um backup antes de qualquer atualização que mexa no banco.

---

## 9. O que esta implantação não resolve

Para não virar surpresa depois:

- **Não há login.** Qualquer pessoa com acesso à rede e ao endereço pode
  criar, editar ou desativar feriado. O campo `autor` é digitado, não
  verificado — serve como anotação, não como prova de quem fez.
- **Não há HTTPS.** O tráfego anda em claro dentro da rede.
- **Não há histórico de versões.** Editar um feriado grava uma fonte nova e
  mantém as antigas na tabela `fontes`, mas não há como ver o estado
  anterior de um registro nem desfazer uma alteração.
- **Um processo só, sem alta disponibilidade.** Se a VM cair, a consulta sai
  do ar até ela voltar. Com NSSM, uma queda só do processo se recupera
  sozinha.
- **A curadoria continua manual.** Municípios sem feriado cadastrado
  respondem `nao_verificado` — o que é o comportamento correto, não uma
  falha de implantação.
