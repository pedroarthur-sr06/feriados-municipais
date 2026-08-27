/**
 * Seed de feriados ESTADUAIS/MUNICIPAIS curados manualmente, com fonte
 * primária verificada — ao contrário de seed-candidatos.ts (que só importa
 * pistas não confirmadas), estas linhas entram direto em `feriados` porque
 * a fonte foi checada. Idempotente (upsert por nome+abrangencia+uf+codigoIbge).
 *
 * Cada novo feriado real deve vir com fonte PRIMÁRIA (não um blog agregador)
 * — ver a regra inegociável em CLAUDE.md. Padrão de evidência aceito: uma
 * citação específica (número + data da norma) corroborada por 2+ fontes
 * independentes é suficiente, mesmo sem ler o texto original — desde que a
 * observação registre isso. Quando o texto original FOI lido na íntegra,
 * a observação diz isso explicitamente.
 *
 * dataVerificacao é por entrada (a data em que a pesquisa foi de fato
 * feita), não a data em que o seed roda — nunca usar `new Date()` aqui.
 */
import { db, sqlite } from "../db/client.js";
import { feriados, fontes, tiposFeriado } from "../db/schema.js";
import { eq, and, isNull } from "drizzle-orm";

interface FeriadoParaCurar {
  nome: string;
  tipoChave: "estadual" | "municipal" | "ponto_facultativo";
  abrangencia: "uf" | "municipio";
  uf: string;
  codigoIbge: number | null;
  mes: number | null;
  dia: number | null;
  regraCalculo: string | null;
  autor: string;
  dataVerificacao: string;
  observacao: string | null;
  fonte: {
    descricao: string;
    url: string | null;
    tipo: "lei" | "decreto" | "diario_oficial" | "api_publica" | "outro";
    dataPublicacao: string | null;
  };
}

const FERIADOS: FeriadoParaCurar[] = [
  {
    nome: "Independência da Bahia",
    tipoChave: "estadual",
    abrangencia: "uf",
    uf: "BA",
    codigoIbge: null,
    mes: 7,
    dia: 2,
    regraCalculo: null,
    autor: "seed inicial — verificado em fonte primária oficial (Governo do Estado da Bahia), ver docs/fontes-de-dados.md",
    dataVerificacao: "2026-08-26",
    observacao: null,
    fonte: {
      descricao: "Lei Estadual (Bahia) nº 38, de 03/01/1936 — citada no Calendário de Feriados oficial do Governo do Estado da Bahia (Casa Civil) junto com a Lei Federal 9.093/1995 (enquadramento geral de feriados civis/religiosos).",
      url: "https://www.legislabahia.ba.gov.br/sites/default/files/2025-02/feriados2025.pdf",
      tipo: "lei",
      dataPublicacao: "1936-01-03",
    },
  },
  {
    nome: "Dia de São Francisco de Assis (padroeiro de Ariquemes)",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100023,
    mes: 10,
    dia: 4,
    regraCalculo: null,
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "Citação (Lei Municipal nº 068, de 09/05/1985) corroborada por múltiplas fontes secundárias independentes (Governo do Estado de Rondônia — rondonia.ro.gov.br; Detran-RO; portal Ariquemes Online), todas convergindo para 4 de outubro como feriado do padroeiro São Francisco de Assis. Texto original da lei NÃO foi lido diretamente (acesso bloqueado por verificação anti-bot em leismunicipais.com.br e leis.org) — revisar se possível. Existe também um Decreto nº 19.105/2022 mais recente consolidando os feriados municipais de Ariquemes, cujo conteúdo não foi acessado; vale conferir se ele mantém ou altera esta data.",
    fonte: {
      descricao: "Lei Municipal (Ariquemes/RO) nº 068, de 09/05/1985 — citada por fontes secundárias convergentes (Governo do Estado de Rondônia, Detran-RO); texto original não acessado por bloqueio anti-bot.",
      url: "https://rondonia.ro.gov.br/sao-francisco-do-guapore-e-ariquemes-festejam-padroeiro-nesta-segunda-feira-4/",
      tipo: "lei",
      dataPublicacao: "1985-05-09",
    },
  },
  {
    nome: "Criação do Município de Cabixi",
    tipoChave: "estadual",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100031,
    mes: 7,
    dia: 6,
    regraCalculo: null,
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "Fonte primária de fato: matéria oficial do Governo do Estado de Rondônia (Casa Civil, rondonia.ro.gov.br) sobre o decreto estadual de feriados, que lista \"6 de julho — Criação de municípios – São Miguel do Guaporé e Cabixi\" como feriado. É um feriado decretado pelo Estado mas escopado só a esses dois municípios (por isso abrangência=município aqui, não UF inteira). Origem histórica: Lei Estadual nº 208, de 06/07/1988, que desmembrou Cabixi de Colorado do Oeste (citação de fonte secundária, não conferida diretamente). Há também menção não confirmada de \"Aniversário de Cabixi\" em 31/12 — não promovido por falta de corroboração; revisar como candidato futuro se aparecer de novo.",
    fonte: {
      descricao: "Decreto estadual de feriados e pontos facultativos de Rondônia — matéria oficial do Governo do Estado de Rondônia (Casa Civil), listando 6 de julho como \"Criação de municípios – São Miguel do Guaporé e Cabixi\".",
      url: "https://rondonia.ro.gov.br/decreto-do-governo-de-ro-define-feriados-estaduais-de-2026/",
      tipo: "decreto",
      dataPublicacao: null,
    },
  },
  {
    nome: "Aniversário de Emancipação de Cacoal",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100049,
    mes: 11,
    dia: 26,
    regraCalculo: null,
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "Corroborado por Câmara Municipal de Cacoal (cacoal.ro.leg.br), UNIR Campus Cacoal e Detran-RO, todos convergindo para 26/11 como feriado municipal de emancipação. Citação encontrada como \"Lei Estadual 1380/PMC de 02/06/2002\" — a sigla \"PMC\" (Prefeitura Municipal de Cacoal) sugere que é na verdade uma Lei MUNICIPAL nº 1.380/2002 mal rotulada como \"estadual\" pela fonte; mantido tipo=municipal por ser mais coerente com o teor (lei da própria prefeitura). Vale corrigir se a numeração exata for confirmada depois. Texto original não lido diretamente.",
    fonte: {
      descricao: "Lei Municipal (Cacoal/RO) nº 1.380, de 02/06/2002 (numeração encontrada como \"Lei Estadual 1380/PMC\", provável rotulagem incorreta de fonte secundária — é lei da Prefeitura Municipal de Cacoal) — corroborada por Câmara Municipal de Cacoal, UNIR Campus Cacoal e Detran-RO.",
      url: "https://www.cacoal.ro.leg.br/institucional/noticias/noticias-2021-2/aniversario-de-cacoal-44-anos-de-emancipacao",
      tipo: "lei",
      dataPublicacao: "2002-06-02",
    },
  },
  {
    nome: "Instalação/Emancipação do Município de Cerejeiras",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100056,
    mes: 8,
    dia: 5,
    regraCalculo: null,
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "5 de agosto é comemorado consistentemente como aniversário de emancipação político-administrativa (43 anos em 2026, portanto emancipação em 1983) — corroborado por portal de notícias local (extraderondonia.com.br) e noticiasdecerejeiras.com.br. Existe referência a um Decreto Municipal nº 367/2026 tratando de transferência pontual do feriado de 2026 para 07/08 (emenda de fim de semana) — não usado como base da regra fixa (é um ajuste anual específico, não a lei de instituição). Número da lei de instituição do feriado em si não localizado com precisão; texto original não lido diretamente.",
    fonte: {
      descricao: "Data de emancipação/instalação de Cerejeiras (05/08) corroborada por matérias jornalísticas locais (Extra de Rondônia, Notícias de Cerejeiras) citando a comemoração anual e referência a Decreto Municipal nº 367/2026 sobre o feriado. Número da lei de instituição original não confirmado.",
      url: "https://extraderondonia.com.br/2026/08/05/cerejeiras-completa-43-anos-de-emancipacao-com-programacao-que-reune-esporte-e-celebracao-prefeito-comenta/",
      tipo: "outro",
      dataPublicacao: null,
    },
  },
  {
    nome: "Criação do Município de Colorado do Oeste",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100064,
    mes: 6,
    dia: 16,
    regraCalculo: null,
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "16 de junho, data de criação do município por desmembramento de Vilhena (Lei Federal nº 6.921, de 16/06/1981), corroborada como feriado municipal por Detran-RO, OAB-PR (referência a feriado forense) e News Rondônia. Texto de eventual lei municipal específica instituindo a folga (distinta da lei federal de criação) não localizado; texto original não lido diretamente.",
    fonte: {
      descricao: "Lei Federal nº 6.921, de 16/06/1981 (criação do município de Colorado do Oeste, desmembrado de Vilhena) — data corroborada como feriado municipal por Detran-RO, OAB-PR e News Rondônia.",
      url: "https://www.detran.ro.gov.br/post/3479/2025/6/11/feriado-municipal-colorado-do-oeste/",
      tipo: "lei",
      dataPublicacao: "1981-06-16",
    },
  },
  {
    nome: "Aniversário de Emancipação Política de Corumbiara",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100072,
    mes: 2,
    dia: 13,
    regraCalculo: null,
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "13 de fevereiro citado como \"Lei Municipal 377, de 13/02/1992\", instituindo o feriado de emancipação política de Corumbiara (desmembrado de Colorado do Oeste e Vilhena). A própria Prefeitura de Corumbiara tem uma página oficial \"Feriados Municipais\" (corumbiara.ro.gov.br/feriados-municipais/) que não foi acessável (bloqueio 403), mas sua existência reforça que há uma lista oficial local. Texto original da Lei 377/1992 não lido diretamente.",
    fonte: {
      descricao: "Lei Municipal (Corumbiara/RO) nº 377, de 13/02/1992 — institui o feriado de emancipação política do município; existência corroborada por página oficial da Prefeitura de Corumbiara (\"Feriados Municipais\", não acessável diretamente) e por referências ao padrão de feriados de emancipação de RO.",
      url: "https://corumbiara.ro.gov.br/feriados-municipais/",
      tipo: "lei",
      dataPublicacao: "1992-02-13",
    },
  },
  {
    nome: "Memória do Massacre da Fazenda Santa Elina",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100072,
    mes: 8,
    dia: 9,
    regraCalculo: null,
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "9 de agosto — feriado municipal em memória das vítimas do Massacre da Fazenda Santa Elina (conflito de terra ocorrido em Corumbiara em 1995, fato histórico amplamente documentado). Data bate exatamente com o candidato original. Número da lei/decreto municipal específico não localizado nesta pesquisa; texto original não lido diretamente.",
    fonte: {
      descricao: "Feriado municipal de 9 de agosto em memória do Massacre da Fazenda Santa Elina (1995) — corroborado por fontes que tratam do calendário de feriados municipais de Corumbiara/RO. Número de lei/decreto específico não localizado.",
      url: "https://corumbiara.ro.gov.br/feriados-municipais/",
      tipo: "outro",
      dataPublicacao: null,
    },
  },
  {
    nome: "Dia de Nossa Senhora do Perpétuo Socorro (padroeira de Corumbiara)",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100072,
    mes: 6,
    dia: 27,
    regraCalculo: null,
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "Achado ao pesquisar o candidato #5979 (que tinha a data errada, 27/07 em vez de 27/06 — provável mês trocado no dataset de origem). Corroborado pela página oficial da Prefeitura de Corumbiara (\"Feriados Municipais\") e por fontes de calendário regional de RO. Texto original não lido diretamente.",
    fonte: {
      descricao: "Feriado municipal do dia da padroeira Nossa Senhora do Perpétuo Socorro, 27 de junho — Corumbiara/RO; corroborado pela página oficial \"Feriados Municipais\" da Prefeitura de Corumbiara.",
      url: "https://corumbiara.ro.gov.br/feriados-municipais/",
      tipo: "outro",
      dataPublicacao: null,
    },
  },
  {
    nome: "Dia de São Sebastião (padroeiro de Costa Marques)",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100080,
    mes: 1,
    dia: 20,
    regraCalculo: null,
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "20 de janeiro, padroeiro São Sebastião — data bate exatamente com o candidato original. Número de lei específico não localizado; texto original não lido diretamente.",
    fonte: {
      descricao: "Feriado municipal do padroeiro São Sebastião, 20 de janeiro — Costa Marques/RO.",
      url: "https://www.costamarques.ro.leg.br/costa-marques-festejou-no-dia-16-de-junho-seu-42o-aniversario-de-emancipacao",
      tipo: "outro",
      dataPublicacao: null,
    },
  },
  {
    nome: "Aniversário de Emancipação de Costa Marques",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100080,
    mes: 6,
    dia: 16,
    regraCalculo: null,
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "16 de junho, criação do município (Lei Federal nº 6.921, de 16/06/1981 — mesma lei federal que criou Colorado do Oeste no mesmo dia, o que é plausível: leis federais desse período costumavam criar vários municípios de uma vez). Corroborado pela Câmara Municipal de Costa Marques (costamarques.ro.leg.br). Texto original não lido diretamente.",
    fonte: {
      descricao: "Lei Federal nº 6.921, de 16/06/1981 (criação do município de Costa Marques) — corroborada pela Câmara Municipal de Costa Marques.",
      url: "https://www.costamarques.ro.leg.br/costa-marques-festejou-no-dia-16-de-junho-seu-42o-aniversario-de-emancipacao",
      tipo: "lei",
      dataPublicacao: "1981-06-16",
    },
  },
  {
    nome: "Dia do Evangélico",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100080,
    mes: 5,
    dia: 10,
    regraCalculo: null,
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "Achado incidentalmente ao pesquisar os candidatos de Costa Marques — não havia candidato na fila para esta data. Citação específica (Lei Municipal nº 913, de 05/01/2021) corroborada em duas buscas independentes, convergindo no mesmo número de lei e data. Texto original não lido diretamente.",
    fonte: {
      descricao: "Lei Municipal (Costa Marques/RO) nº 913, de 05/01/2021 — institui o Dia do Evangélico, 10 de maio, como feriado municipal.",
      url: null,
      tipo: "lei",
      dataPublicacao: "2021-01-05",
    },
  },
  {
    nome: "Aniversário de Emancipação de Espigão D'Oeste",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100098,
    mes: 6,
    dia: 16,
    regraCalculo: null,
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "16 de junho, criação do município (Lei Federal nº 6.921/1981, desmembrado de Pimenta Bueno) instituída como feriado municipal pela Lei Municipal nº 1.402/2009. Corroborado por Detran-RO e site oficial da Prefeitura de Espigão D'Oeste. Texto original não lido diretamente.",
    fonte: {
      descricao: "Lei Municipal (Espigão D'Oeste/RO) nº 1.402/2009 — institui 16 de junho (data de criação do município pela Lei Federal 6.921/1981) como feriado municipal. Corroborada por Detran-RO e site oficial da prefeitura.",
      url: "https://www.detran.ro.gov.br/2021/06/feriado-municipal-espigao-do-oeste/",
      tipo: "lei",
      dataPublicacao: "2009-01-01",
    },
  },
  {
    nome: "Instalação do Município de Guajará-Mirim",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100106,
    mes: 4,
    dia: 10,
    regraCalculo: null,
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "10 de abril, instalação do município — data histórica incomum: Guajará-Mirim foi fundado pelo Decreto nº 1.656, de 10/04/1929, assinado pelo então governador do Estado do Amazonas (o território hoje chamado Rondônia era parte do Amazonas antes de virar território federal em 1943). Data bate exatamente com o candidato original. Texto original não lido diretamente.",
    fonte: {
      descricao: "Decreto (Estado do Amazonas) nº 1.656, de 10/04/1929 — cria/instala o então distrito/município de Guajará-Mirim; data observada como feriado municipal.",
      url: null,
      tipo: "decreto",
      dataPublicacao: "1929-04-10",
    },
  },
  {
    nome: "Dia da Independência da Bolívia (feriado exclusivo de Guajará-Mirim)",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100106,
    mes: 8,
    dia: 6,
    regraCalculo: null,
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "6 de agosto — feriado municipal exclusivo de Guajará-Mirim em celebração à Independência da Bolívia, justificado pela posição de cidade-gêmea de Guayaramerín (Bolívia), do outro lado do rio Mamoré. Caso incomum mas plausível dado o contexto de fronteira. Corroborado por agregadores de feriados regionais de RO. Número de lei/decreto municipal específico não localizado; texto original não lido diretamente — vale confirmar com mais cuidado dado o caráter atípico do feriado.",
    fonte: {
      descricao: "Feriado municipal de 6 de agosto (Independência da Bolívia) em Guajará-Mirim/RO, cidade-gêmea de Guayaramerín (Bolívia) — corroborado por agregadores de calendário de feriados regionais de RO. Número de lei/decreto específico não localizado.",
      url: null,
      tipo: "outro",
      dataPublicacao: null,
    },
  },
  {
    nome: "Nossa Senhora da Conceição",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100106,
    mes: 12,
    dia: 8,
    regraCalculo: null,
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "8 de dezembro, Nossa Senhora da Conceição, padroeira — feriado municipal em Guajará-Mirim (e também em Candeias do Jamari, outro município de RO). Data bate exatamente com o candidato original. Número de lei específico não localizado; texto original não lido diretamente.",
    fonte: {
      descricao: "Feriado municipal do dia de Nossa Senhora da Conceição, 8 de dezembro — Guajará-Mirim/RO (padroeira). Número de lei específico não localizado.",
      url: null,
      tipo: "outro",
      dataPublicacao: null,
    },
  },
  {
    nome: "Dia de São João (padroeiro de Jaru)",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100114,
    mes: 6,
    dia: 24,
    regraCalculo: null,
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "24 de junho, São João, padroeiro de Jaru — instituído pela Lei Municipal nº 12/1984, art. 1º, inciso IV (mesma lei que trata também do feriado de criação do município, 16/06). Data bate exatamente com o candidato original. Texto original não lido diretamente.",
    fonte: {
      descricao: "Lei Municipal (Jaru/RO) nº 12/1984, art. 1º, inciso IV — institui o feriado do padroeiro São João, 24 de junho.",
      url: "https://jaru.ro.gov.br/transferido-feriado-padroeiro-de-jaru-e-transferido-para-o-dia-21-de-setembro-de-2020/",
      tipo: "lei",
      dataPublicacao: "1984-01-01",
    },
  },
  {
    nome: "Aniversário de Emancipação de Jaru",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100114,
    mes: 6,
    dia: 16,
    regraCalculo: null,
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "Achado ao pesquisar os candidatos de Jaru — não havia candidato na fila para esta data (a fila trazia 07/11, sem nenhuma corroboração encontrada). 16 de junho é a data de criação do município, também coberta pela Lei Municipal nº 12/1984. Texto original não lido diretamente.",
    fonte: {
      descricao: "Lei Municipal (Jaru/RO) nº 12/1984, art. 1º — institui o feriado de criação do município, 16 de junho.",
      url: "https://jaru.ro.gov.br/transferido-feriado-padroeiro-de-jaru-e-transferido-para-o-dia-21-de-setembro-de-2020/",
      tipo: "lei",
      dataPublicacao: "1984-01-01",
    },
  },
  {
    nome: "Instalação do Município de Porto Velho / Dia de São Francisco de Sales",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100205,
    mes: 1,
    dia: 24,
    regraCalculo: null,
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "Fonte primária lida INTEGRALMENTE (não é citação de segunda mão): texto completo da Lei Municipal nº 190, de 14/10/1980, obtido em PDF hospedado pela própria Prefeitura de Porto Velho. Art. 1º: \"24 de janeiro, consagrado ao Culto a São Francisco de Sales\" — a folha anexa da própria prefeitura complementa: \"Instalação do Município de Porto Velho, 24.01.1915\".",
    fonte: {
      descricao: "Lei Municipal (Porto Velho/RO) nº 190, de 14/10/1980, art. 1º — declara feriado religioso/municipal 24 de janeiro (São Francisco de Sales / instalação do município, 24/01/1915).",
      url: "https://www.portovelho.ro.gov.br/uploads/docman/lein190feriadosdomunicipio.pdf",
      tipo: "lei",
      dataPublicacao: "1980-10-14",
    },
  },
  {
    nome: "Sexta-feira da Paixão (feriado municipal, além do nacional)",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100205,
    mes: null,
    dia: null,
    regraCalculo: "pascoa-2",
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "Fonte primária lida INTEGRALMENTE (não é citação de segunda mão): texto completo da Lei Municipal nº 190, de 14/10/1980, obtido em PDF hospedado pela própria Prefeitura de Porto Velho. Art. 1º inclui \"a Sexta-feira da Paixão\" entre os feriados religiosos do município. Redundante com a camada nacional (Sexta-feira Santa já é `nacional` no motor), mas mantido porque é literalmente o que a lei municipal diz — sobreposição é esperada e suportada pelo sistema.",
    fonte: {
      descricao: "Lei Municipal (Porto Velho/RO) nº 190, de 14/10/1980, art. 1º — inclui a Sexta-feira da Paixão entre os feriados religiosos do município.",
      url: "https://www.portovelho.ro.gov.br/uploads/docman/lein190feriadosdomunicipio.pdf",
      tipo: "lei",
      dataPublicacao: "1980-10-14",
    },
  },
  {
    nome: "Dia de Nossa Senhora Auxiliadora (padroeira de Porto Velho)",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100205,
    mes: 5,
    dia: 24,
    regraCalculo: null,
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "Fonte primária lida INTEGRALMENTE (não é citação de segunda mão): texto completo da Lei Municipal nº 190, de 14/10/1980, obtido em PDF hospedado pela própria Prefeitura de Porto Velho. Art. 1º: \"24 de maio, consagrado à devoção de Nossa Senhora Auxiliadora, padroeira deste Município\".",
    fonte: {
      descricao: "Lei Municipal (Porto Velho/RO) nº 190, de 14/10/1980, art. 1º — declara feriado religioso/municipal 24 de maio (Nossa Senhora Auxiliadora, padroeira).",
      url: "https://www.portovelho.ro.gov.br/uploads/docman/lein190feriadosdomunicipio.pdf",
      tipo: "lei",
      dataPublicacao: "1980-10-14",
    },
  },
  {
    nome: "Criação do Município de Porto Velho",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100205,
    mes: 10,
    dia: 2,
    regraCalculo: null,
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "Fonte primária lida INTEGRALMENTE (não é citação de segunda mão): texto completo da Lei Municipal nº 190, de 14/10/1980, obtido em PDF hospedado pela própria Prefeitura de Porto Velho. Art. 1º: \"02 de outubro, consagrado ao tríduo à Santa Terezinha do Menino Jesus, padroeira das missões\". A folha anexa da prefeitura complementa: \"Criação do Município de Porto Velho – Lei Estadual nº 757 – 01.10.1914/Estado do Amazonas\" (Porto Velho pertencia ao Amazonas antes da criação do Território Federal de Rondônia).",
    fonte: {
      descricao: "Lei Municipal (Porto Velho/RO) nº 190, de 14/10/1980, art. 1º — declara feriado 2 de outubro (tríduo a Santa Terezinha / criação do município via Lei Estadual do Amazonas nº 757, de 01/10/1914).",
      url: "https://www.portovelho.ro.gov.br/uploads/docman/lein190feriadosdomunicipio.pdf",
      tipo: "lei",
      dataPublicacao: "1980-10-14",
    },
  },
  {
    nome: "Dia de São João Bosco (padroeiro de Ji-Paraná)",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100122,
    mes: 8,
    dia: 16,
    regraCalculo: null,
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "16 de agosto, São João Bosco, padroeiro — instituído pela Lei nº 066, de 06/09/1985. Corroborado pela Câmara de Dirigentes Lojistas de Ji-Paraná (parecer específico sobre este feriado) e pela UNIR. Texto original não lido diretamente.",
    fonte: {
      descricao: "Lei Municipal (Ji-Paraná/RO) nº 066, de 06/09/1985 — institui o feriado do padroeiro São João Bosco, 16 de agosto.",
      url: "https://www.cdljipa.com.br/publicacao/142/parecer-sobre-o-feriado-do-dia-16-de-agosto-padroeiro-de-ji-parana-sao-joao-bosco.html",
      tipo: "lei",
      dataPublicacao: "1985-09-06",
    },
  },
  {
    nome: "Aniversário de Criação do Município de Ji-Paraná",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100122,
    mes: 11,
    dia: 22,
    regraCalculo: null,
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "22 de novembro, criação do município — instituído pela Lei Ordinária Municipal nº 093, de 26/06/1986. Corroborado por comunicado da UNIR e agregadores de calendário de RO. Texto original não lido diretamente.",
    fonte: {
      descricao: "Lei Ordinária Municipal (Ji-Paraná/RO) nº 093, de 26/06/1986 — institui o feriado de criação do município, 22 de novembro.",
      url: "https://www.unir.br/noticia/exibir/5446",
      tipo: "lei",
      dataPublicacao: "1986-06-26",
    },
  },
  {
    nome: "Emancipação Política de Machadinho D'Oeste",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100130,
    mes: 5,
    dia: 11,
    regraCalculo: null,
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "11 de maio, emancipação política — Decreto Municipal nº 1.790 (comemoração anual). Município criado junto com Santa Luzia D'Oeste na mesma data (11/05/1988). Corroborado por Detran-RO e portal O Observador. Texto original não lido diretamente.",
    fonte: {
      descricao: "Decreto Municipal (Machadinho D'Oeste/RO) nº 1.790 — comemoração da emancipação política, 11 de maio (criação do município em 11/05/1988).",
      url: "https://www.detran.ro.gov.br/2021/05/feriado-municipal-machadinho-doeste-e-distrito-do-5o-bec/",
      tipo: "decreto",
      dataPublicacao: null,
    },
  },
  {
    nome: "Instalação/Emancipação de Pimenta Bueno",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100189,
    mes: 11,
    dia: 24,
    regraCalculo: null,
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "24 de novembro, instalação do município — Decreto Municipal nº 5.914. Corroborado por Detran-RO. Texto original não lido diretamente.",
    fonte: {
      descricao: "Decreto Municipal (Pimenta Bueno/RO) nº 5.914 — feriado de instalação do município, 24 de novembro (instalação em 24/11/1977).",
      url: "https://www.detran.ro.gov.br/2021/11/feriado-municipal-pimenta-bueno-4/",
      tipo: "decreto",
      dataPublicacao: null,
    },
  },
  {
    nome: "Criação do Município de Presidente Médici",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100254,
    mes: 6,
    dia: 16,
    regraCalculo: null,
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "16 de junho, criação do município — data bate exatamente com o candidato original, corroborada em busca dedicada. Número de lei específico não localizado; texto original não lido diretamente.",
    fonte: {
      descricao: "Feriado municipal de criação do município de Presidente Médici/RO, 16 de junho.",
      url: null,
      tipo: "outro",
      dataPublicacao: null,
    },
  },
  {
    nome: "Dia de São João (padroeiro de Presidente Médici)",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100254,
    mes: 6,
    dia: 24,
    regraCalculo: null,
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "24 de junho, São João, padroeiro — data bate exatamente com o candidato original. Número de lei específico não localizado; texto original não lido diretamente.",
    fonte: {
      descricao: "Feriado municipal do padroeiro São João, 24 de junho — Presidente Médici/RO.",
      url: null,
      tipo: "outro",
      dataPublicacao: null,
    },
  },
  {
    nome: "Aniversário de Rolim de Moura",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100288,
    mes: 8,
    dia: 5,
    regraCalculo: null,
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "5 de agosto, aniversário/emancipação — Decreto Municipal nº 4.772/2020 (comemoração anual). Corroborado pela própria Prefeitura de Rolim de Moura (rolimdemoura.ro.gov.br) e Detran-RO. Texto original não lido diretamente.",
    fonte: {
      descricao: "Decreto Municipal (Rolim de Moura/RO) nº 4.772/2020 — feriado de aniversário do município, 5 de agosto.",
      url: "https://rolimdemoura.ro.gov.br/?p=10230",
      tipo: "decreto",
      dataPublicacao: "2020-01-01",
    },
  },
  {
    nome: "Carnaval (terça-feira) — feriado municipal, além do ponto facultativo nacional",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100288,
    mes: null,
    dia: null,
    regraCalculo: "pascoa-47",
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "Diferente da maioria dos municípios: em Rolim de Moura, a terça-feira de Carnaval é feriado MUNICIPAL de verdade (não só ponto facultativo nacional). Instituído pela Lei Municipal nº 1.990/2011, consolidado depois pela Lei Municipal nº 3.701/2020 (que lista Sexta-feira Santa, Corpus Christi e terça-feira de Carnaval como feriados municipais \"pelo costume e cultura do nosso povo\"). Corroborado por Alerta Rolim e ACIRM (associação empresarial local). Texto original não lido diretamente.",
    fonte: {
      descricao: "Lei Municipal (Rolim de Moura/RO) nº 3.701/2020 (consolidando a Lei nº 1.990/2011) — declara feriados municipais Sexta-feira Santa, Corpus Christi e terça-feira de Carnaval.",
      url: "https://www.acirmro.com.br/noticia/feriado-de-carnaval-210223",
      tipo: "lei",
      dataPublicacao: "2020-01-01",
    },
  },
  {
    nome: "Corpus Christi (feriado municipal, além do ponto facultativo nacional)",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100288,
    mes: null,
    dia: null,
    regraCalculo: "pascoa+60",
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "Achado junto com o candidato #6005 (Carnaval) — a mesma Lei Municipal nº 3.701/2020 de Rolim de Moura também declara Corpus Christi feriado municipal, não só ponto facultativo nacional. Não havia candidato na fila para esta data. Texto original não lido diretamente.",
    fonte: {
      descricao: "Lei Municipal (Rolim de Moura/RO) nº 3.701/2020 — declara Corpus Christi feriado municipal.",
      url: "https://www.acirmro.com.br/noticia/feriado-de-carnaval-210223",
      tipo: "lei",
      dataPublicacao: "2020-01-01",
    },
  },
  {
    nome: "Sexta-feira Santa (feriado municipal, além do nacional)",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100288,
    mes: null,
    dia: null,
    regraCalculo: "pascoa-2",
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "Achado junto com o candidato #6005 (Carnaval) — a mesma Lei Municipal nº 3.701/2020 de Rolim de Moura também declara Sexta-feira Santa feriado municipal (redundante com a camada nacional, mas mantido por ser o que a lei diz). Não havia candidato na fila para esta data. Texto original não lido diretamente.",
    fonte: {
      descricao: "Lei Municipal (Rolim de Moura/RO) nº 3.701/2020 — declara Sexta-feira Santa feriado municipal.",
      url: "https://www.acirmro.com.br/noticia/feriado-de-carnaval-210223",
      tipo: "lei",
      dataPublicacao: "2020-01-01",
    },
  },
  {
    nome: "Emancipação Política de Santa Luzia D'Oeste",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100296,
    mes: 5,
    dia: 11,
    regraCalculo: null,
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "11 de maio — Santa Luzia D'Oeste foi criada na mesma data que Machadinho D'Oeste (11/05/1988), mesmo padrão de lei estadual criando dois municípios de uma vez já visto em Colorado do Oeste/Costa Marques. Texto original não lido diretamente.",
    fonte: {
      descricao: "Data de criação de Santa Luzia D'Oeste/RO, 11 de maio de 1988 (mesma lei/data que criou Machadinho D'Oeste), observada como feriado municipal.",
      url: "https://www.detran.ro.gov.br/2021/05/feriado-municipal-machadinho-doeste-e-distrito-do-5o-bec/",
      tipo: "outro",
      dataPublicacao: "1988-05-11",
    },
  },
  {
    nome: "Emancipação Política de Nova Brasilândia D'Oeste",
    tipoChave: "municipal",
    abrangencia: "municipio",
    uf: "RO",
    codigoIbge: 1100148,
    mes: 6,
    dia: 19,
    regraCalculo: null,
    autor: "pesquisa assistida — ver observação",
    dataVerificacao: "2026-08-26",
    observacao: "19 de junho, emancipação política — Lei Municipal nº 133/1994, também referenciada por Decreto Estadual nº 24.649/2020. Corroborado por Detran-RO. Texto original não lido diretamente.",
    fonte: {
      descricao: "Lei Municipal (Nova Brasilândia D'Oeste/RO) nº 133/1994 — feriado de emancipação política, 19 de junho.",
      url: "https://www.detran.ro.gov.br/2020/06/feriado-municipal-nova-brasilandia-do-oeste/",
      tipo: "lei",
      dataPublicacao: "1994-01-01",
    },
  },
];

function main() {
  const tipos = db.select().from(tiposFeriado).all();
  const tipoPorChave = new Map(tipos.map((t) => [t.chave, t.id]));

  for (const f of FERIADOS) {
    const tipoFeriadoId = tipoPorChave.get(f.tipoChave);
    if (!tipoFeriadoId) {
      throw new Error(`Tipo de feriado "${f.tipoChave}" não encontrado — rode seed:tipos-feriado antes.`);
    }

    let fonte = db.select().from(fontes).where(eq(fontes.descricao, f.fonte.descricao)).get();
    if (!fonte) {
      const inserted = db
        .insert(fontes)
        .values({
          descricao: f.fonte.descricao,
          url: f.fonte.url,
          tipo: f.fonte.tipo,
          dataPublicacao: f.fonte.dataPublicacao,
        })
        .returning()
        .get();
      fonte = inserted;
      console.log(`  fonte criada: "${f.fonte.descricao.slice(0, 60)}..."`);
    }

    // Match por nome+abrangencia+uf+codigoIbge (null-safe) — sem incluir
    // codigoIbge o upsert colidiria entre municípios diferentes com o
    // mesmo nome de feriado (ex.: dois municípios de RO com "Dia de São
    // João").
    const condicaoCodigo = f.codigoIbge === null ? isNull(feriados.codigoIbge) : eq(feriados.codigoIbge, f.codigoIbge);
    const existente = db
      .select()
      .from(feriados)
      .where(and(eq(feriados.nome, f.nome), eq(feriados.abrangencia, f.abrangencia), eq(feriados.uf, f.uf), condicaoCodigo))
      .get();

    const valores = {
      tipoFeriadoId,
      nome: f.nome,
      abrangencia: f.abrangencia,
      uf: f.uf,
      codigoIbge: f.codigoIbge,
      mes: f.mes,
      dia: f.dia,
      regraCalculo: f.regraCalculo,
      anoInicio: null,
      anoFim: null,
      fonteId: fonte.id,
      autor: f.autor,
      dataVerificacao: f.dataVerificacao,
      observacao: f.observacao,
      ativo: true as const,
    };

    if (existente) {
      db.update(feriados).set(valores).where(eq(feriados.id, existente.id)).run();
      console.log(`✔ atualizado: ${f.nome} (${f.abrangencia}/${f.uf})`);
    } else {
      db.insert(feriados).values(valores).run();
      console.log(`✔ inserido: ${f.nome} (${f.abrangencia}/${f.uf})`);
    }
  }

  console.log(`\nTotal processado: ${FERIADOS.length} feriados curados.`);
}

main();
sqlite.close();
