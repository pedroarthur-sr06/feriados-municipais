/**
 * Aplica decisões de revisão sobre candidatos_nao_verificados: promove para
 * `feriados` (com fonte nova, sempre) ou rejeita, registrando o motivo no
 * log (a rejeição em si só muda o status — não há coluna de motivo na
 * tabela ainda, então o motivo fica só aqui no histórico do script).
 *
 * Padrão de evidência combinado com o usuário: uma citação específica
 * (número + data da norma) corroborada por 2+ fontes independentes é
 * suficiente para promover, mesmo sem ler o texto original da norma —
 * desde que a observação deixe isso explícito para quem revisar depois.
 *
 * Uso: editar o array DECISOES abaixo a cada lote e rodar
 *   npx tsx src/scripts/processar-candidatos.ts
 */
import { sqlite } from "../db/client.js";
import {
  buscarCandidatoPorId,
  criarFeriadoCurado,
  marcarStatusCandidato,
  type TipoFonte,
} from "../services/feriados-service.js";

interface DecisaoPromover {
  candidatoId: number;
  acao: "promover";
  nome: string;
  tipoChave: "estadual" | "municipal" | "ponto_facultativo";
  mes?: number;
  dia?: number;
  regraCalculo?: string;
  autor: string;
  dataVerificacao: string;
  observacao: string;
  fonte: {
    descricao: string;
    url: string | null;
    tipo: TipoFonte;
    dataPublicacao: string | null;
  };
}

interface DecisaoRejeitar {
  candidatoId: number;
  acao: "rejeitar";
  motivo: string;
}

/** Feriado achado na pesquisa mas sem candidato correspondente na fila — cadastro direto. */
interface DecisaoCriarDireto {
  acao: "criar_direto";
  uf: string;
  codigoIbge: number | null;
  nome: string;
  tipoChave: "estadual" | "municipal" | "ponto_facultativo";
  abrangencia: "uf" | "municipio";
  mes?: number;
  dia?: number;
  regraCalculo?: string;
  autor: string;
  dataVerificacao: string;
  observacao: string;
  fonte: {
    descricao: string;
    url: string | null;
    tipo: TipoFonte;
    dataPublicacao: string | null;
  };
}

type Decisao = DecisaoPromover | DecisaoRejeitar | DecisaoCriarDireto;

// -----------------------------------------------------------------------
// LOTE ATUAL — editar aqui a cada rodada (deixar vazio entre rodadas para
// não rodar um lote antigo por engano — já aconteceu uma vez, ver commit).
// Progresso: RO, RR, AP, AC completos. AL, TO, PI, AM, RN, SE, MS, PA, MT, ES, RJ parciais
// (todos com alguns promovidos, resto pendente — ver commits para detalhe por estado). ~28
// feriados ESTADUAIS confirmados (ver commits). NOTA DE LIMITAÇÃO DE SCHEMA: regraCalculo
// só aceita "pascoa±N" — feriados em regra tipo "2º sábado de julho" (ex.: candidato 12479,
// Confresa/MT, Dia do Evangélico) não podem ser cadastrados como data fixa sem inventar um
// dia errado em anos futuros; ficam pendentes até o schema suportar outras regras (ou até
// decidir aproximar com aviso explícito). NOTA: quando um candidato municipal cita uma "Lei
// Estadual" que já bate com um feriado ESTADUAL já curado (abrangencia=uf) para o mesmo
// dia/mês, é quase sempre o dataset comunitário anexando errado a um município — REJEITAR
// como redundante, a camada estadual já cobre automaticamente (ver caso Nova Iguaçu/São
// Jorge, RJ). ~30 feriados ESTADUAIS confirmados agora (São José do Ceará e Dia do Estado
// de Santa Catarina adicionados via criar_direto). GO, PE, SC, RS, PR, BA, SP também
// parciais agora (São Paulo capital, Campinas, Guarulhos, Santo André, São Bernardo,
// Sorocaba, Ribeirão Preto, São José dos Campos/Rio Preto, Osasco, Jundiaí, Piracicaba,
// Bauru, Limeira, Mogi das Cruzes, Rio Claro, São Carlos, São Vicente, Praia Grande, Suzano,
// Taboão da Serra, Taubaté processados — a leva de SP também revelou um caso importante:
// Dia da Consciência Negra (20/11) é feriado NACIONAL desde 2024, então uma lei municipal de
// São Paulo anterior a isso instituindo a mesma data foi REJEITADA por redundância — mesmo
// raciocínio de Sexta-feira Santa, útil lembrar ao revisar outros estados). MG também
// parcial agora (Belo Horizonte capital, Uberlândia, Uberaba, Contagem, Juiz de Fora, Betim,
// Montes Claros, Ribeirão das Neves, Pouso Alegre, Ipatinga, Araxá processados — mesmo
// achado da Consciência Negra confirmado de novo em Betim e Uberaba, rejeitados). MARCO:
// todos os 26 estados + DF já têm pelo menos alguns feriados curados nesta sessão (ver
// commits) — o trabalho que resta agora é aprofundar cada estado, não mais abrir estados
// novos. Maringá/PR tem 1 candidato pendente (antecipação de aniversário "2ª segunda-feira
// de maio" — limitação de regraCalculo só aceitar pascoa±N). Continuar smallest-to-largest
// pelos candidatos restantes de cada estado, sempre olhando primeiro descricao_original por
// citação de lei embutida e depois clusters de data (padroeiro/emancipação compartilhados).
// A veia de "citação de lei embutida" está essencialmente esgotada em todos os estados
// (exceto os 2 bloqueados por schema acima) — o que resta é mais lento: pesquisa de cluster
// de data + corroboração por múltiplas fontes. MA processado agora: confirmado que 08/12
// (Nossa Senhora da Conceição) é feriado ESTADUAL pleno no Maranhão (calendário oficial do
// estado) — resolveu de uma vez um cluster de 28 candidatos municipais que eram só o
// feriado estadual vazando para a lista municipal (mesmo padrão de Nova Iguaçu/RJ, mas em
// escala maior: 1 criar_direto estadual + 28 rejeições em vez de 28 promoções individuais —
// útil replicar essa checagem [feriado municipal ~= feriado estadual já curado na mesma UF]
// antes de pesquisar cluster por cluster). Também promovidos 13 candidatos do cluster de
// emancipação simultânea de 10/11 (onda de criação de municípios maranhenses 1994-1996, ~66
// municípios ainda comemoram aniversário nessa data — mesmo padrão de onda já visto em RO,
// AM, TO, MT, PA). PB (Paraíba) tentada e abandonada nesta sessão: clusters enormes (06/24
// São João ~55 municípios, 12/08 ~32, 06/29 ~17) não renderam achados com as buscas
// tentadas — retomar com estratégia diferente ou mais tarde. TO aprofundado (11 promovidos,
// 1 rejeitado): confirma 3º caso de schema-limitação (Gurupi/TO, Dia do Evangélico = "último
// sábado de setembro", igual Confresa/MT e Maringá/PR — regraCalculo só aceita pascoa±N).
// Achado útil: quando uma fonte oficial municipal afirma explicitamente que uma data NÃO é
// feriado por falta de lei (caso Porto Nacional/TO, aniversário 13/07 vs. padroeira 24/09,
// que É feriado) — REJEITAR citando a própria fonte municipal, não deixar como não-verificado.
// Padrão "padroeiro = data universal do santo" (Santo Antônio 13/06, São João Batista 24/06,
// São Miguel Arcanjo 29/09) é uma boa heurística quando a paróquia do município é confirmada
// mas não há lei específica localizada — 2+ fontes (existência da paróquia + data universal)
// tratado como suficiente. NOTA: script de regeneração do seed (scratch-regenerar-seed.mjs,
// não versionado) tinha bug de longa data — omitia regraCalculo:null em entradas com mes/dia
// fixo e omitia mes/dia:null em entradas com regraCalculo, violando a interface
// FeriadoParaCurar (campos obrigatórios, ainda que anuláveis); corrigido no commit do MA.
// AM aprofundado (27 promovidos, 5 rejeitados): confirma um padrão MUITO recorrente em
// municípios pequenos do Norte — aniversário/emancipação E dia do padroeiro são datas
// DIFERENTES, cada uma com seu próprio feriado municipal (ex.: Codajás 31/03 emancipação +
// 31/05 Nossa Senhora das Graças; Urucará 12/05 criação + 26/07 Sant'Ana) — sempre promover
// as duas separadamente quando confirmadas, não assumir que é a mesma data. Também confirma
// que a frase-padrão de agregadores tipo calendario.online ("aniversário X não é feriado
// oficial, motivo de discórdia, já que o município tem N feriados municipais e o aniversário
// não está entre eles") é um sinal negativo específico e razoavelmente confiável (aparece
// com o mesmo texto-molde em várias cidades, mas cita o N real de feriados de cada uma) —
// tratado como base suficiente para REJEITAR quando não há outra evidência a favor (5 casos
// nesta leva: Lábrea, Barcelos, Humaitá, Iranduba, Presidente Figueiredo — em todos os casos
// a data do padroeiro dessas mesmas cidades, quando encontrada, FOI promovida separadamente).
// Ficaram pendentes ~19 candidatos de AM sem citação/corroboração suficiente (Apuí, Canutama,
// Maués, Carauari, Tapauá, Borba e alguns outros, além de datas "extras" sem padroeiro
// identificado em cidades já parcialmente curadas). PI: início de aprofundamento revelou um
// contraste importante com o caso MA — em Piauí, 08/12 (Nossa Senhora da Conceição) é PONTO
// FACULTATIVO estadual (decreto anual do Governo do PI), não feriado estadual PLENO como no
// Maranhão; e é feriado MUNICIPAL só em Teresina (capital). Isso significa que o cluster de
// 14 candidatos municipais de outras cidades do PI para 08/12 NÃO pode ser resolvido pelo
// mesmo atalho "1 criar_direto estadual + rejeitar todos" usado em MA — cada cidade precisaria
// de confirmação individual de que Nossa Senhora da Conceição é padroeira local. Registrado
// só o ponto_facultativo estadual do PI (criar_direto) + 1 promoção pontual (Uruçuí, que já
// tinha o nome do santo explícito no dataset) — os outros 13 candidatos genéricos do cluster
// ficaram pendentes. Lição para outros estados: sempre checar se o "feriado estadual" é
// PLENO ou apenas ponto_facultativo antes de aplicar o atalho de cluster. PI aprofundado
// (20 promovidos, 2 rejeitados): achado novo — onda de restauração de municípios piauienses
// anexados/desmembrados em 1931 e restaurados em 04/09/1933 (Decreto Estadual nº 1478; ver
// Buriti dos Lopes, Gilbués, Simplício Mendes) — mesmo padrão de "onda simultânea" já visto
// em vários estados, mas aqui por RESTAURAÇÃO de autonomia, não criação original. Também
// reforça o padrão de aniversário/emancipação E padroeiro serem datas distintas (Buriti dos
// Lopes 04/09 + 13/12 Santa Luzia; Ribeiro Gonçalves 24/06 São João Batista + 26/07
// emancipação) — sempre promover separadamente quando ambas confirmadas. PI leva 3 (5
// promovidos, 1 rejeitado): São Miguel do Tapuio e Miguel Alves confirmam de novo o padrão
// "nome do município homenageia o santo" (São Miguel Arcanjo, 29/09) já visto em Xambioá/TO
// e São Gabriel da Cachoeira/AM. Oeiras trouxe outra citação de lei específica (Lei nº
// 1.135/1979). O grande cluster de 08/12 (13 candidatos restantes) permanece pendente — cada
// cidade exigiria confirmação individual de padroeira, como já anotado no ponto_facultativo
// estadual do PI. AL iniciado: confirma que 08/12 (Nossa Senhora da Conceição) já era feriado
// ESTADUAL pleno em Alagoas (curado em leva anterior desta sessão) — resolveu de uma vez um
// cluster de 27 candidatos municipais redundantes (mesmo padrão MA, mas ainda maior em
// contagem). Nenhuma mudança em `feriados`/seed neste commit (só rejeições, que só alteram
// status em `candidatos_nao_verificados`, tabela não versionada) — só o registro do achado
// aqui no comentário. AL leva 2 (12 promovidos, 2 rejeitados): resolveu os clusters de 20/01
// (São Sebastião, inclusive o próprio município de São Sebastião/AL — nome coincide), 24/04
// (onda de emancipação de Maragogi+Santana do Ipanema em 1875, mesma data; Matriz de
// Camaragibe em 1958 no mesmo dia do calendário), 16/05 (São Luís do Quitunde 1892 + Traipu
// 1870, mas Coruripe e Limoeiro de Anadia REJEITADOS pelo padrão de discórdia) e 13/06 (3
// candidatos já rotulados 'Dia de Santo Antônio' no dataset). AL ainda tem candidatos
// pendentes sem citação suficiente (08/09 Batalha, 31/05 Piaçabuçu/Campo Grande, 20/01 dos
// demais municípios do cluster). SE iniciado (20 promovidos, 1 rejeitado): o calendário
// oficial de feriados das comarcas do Tribunal de Justiça de Sergipe (TJSE, PDF anual) se
// revelou uma fonte muito produtiva — cobre feriados municipais de praticamente todas as
// comarcas do estado numa só fonte oficial, resolveu de uma vez os clusters de 19/03 (São
// José), parte de 06/24 (São João) e 06/29 (São Pedro), 15/08 (padroeiras variadas: Nossa
// Senhora da Glória, do Amparo, da Paz, Imperatriz dos Campos, Assunção) e 02/02 (padroeiras
// variadas: Nossa Senhora da Ajuda, do Socorro, da Guia). Vale usar esse tipo de calendário
// de comarca/TJ como fonte primária em outros estados também — geralmente publicado anualmente
// em PDF pelo Tribunal de Justiça estadual. Malhador e Tomar do Geru confirmam mais uma onda
// de criação simultânea (Lei nº 525-A, de 25/11/1953). Cluster de 12/08 (Nossa Senhora da
// Conceição, 7 candidatos) ficou pendente — SE não tem estadual pleno nem ponto_facultativo
// nessa data (só 08/07, Aniversário de Sergipe), precisaria confirmação individual por cidade.
// RN iniciado (15 promovidos): sem citação embutida e sem fonte tipo "calendário de comarca"
// facilmente localizável (TJRN não indexado como o TJSE) — resolvido via clusters de padroeiro
// puro: 01/20 (São Sebastião, 7 de 7 candidatos do cluster confirmados: Caraúbas, Florânia,
// Governador Dix-Sept Rosado, Guamaré, Jucurutu, Nova Cruz, Parelhas) e 06/29 (São Pedro:
// Ceará-Mirim, Touros, Nova Cruz — que também tem São Sebastião em 20/01, cidades podem ter
// 2 feriados de padroeiro/co-padroeiro — e Pedro Avelino, nome do município já homenageia o
// santo). Mais 4 já rotulados no dataset (São José ×3, São João ×1). Cluster de 08/12 (14
// candidatos) e 11/27 (4) ficaram pendentes por falta de fonte específica encontrada. MS
// iniciado (23 promovidos): duas ondas de criação simultânea de municípios muito claras —
// 11/11/1963 (Anaurilândia, Ivinhema, Jateí, Naviraí, Pedro Gomes) e 12/05/1980 (Costa Rica,
// Douradina, São Gabriel do Oeste, Selvíria, Taquarussu, confirmadas pelo Campo Grande News
// com contagem exata "cinco municípios"). Cluster de 24/06 (São João Batista) resolvido quase
// por completo (5 de 6) via uma única reportagem (acritica.net) que lista todas as cidades de
// MS com o feriado. Padrão de datas distintas para emancipação vs. padroeiro confirmado de
// novo em Selvíria (12/05 + 24/06) e Pedro Gomes (11/11 + 20/01 São Sebastião). MT iniciado
// (40 promovidos): leva muito produtiva — 16 candidatos já vinham com nome específico no
// próprio dataset comunitário (Santo Antônio ×7, São Cristóvão ×2, Aniversário/Emancipação
// ×2, São José ×3, Reforma Protestante ×1, Dia do Evangélico ×1). O calendário forense do
// TJMT (PDF anual) confirmou vários casos de padroeiro isolados (Santo Antônio, São João
// Batista, Dia do Evangélico). Onda de emancipação simultânea de 8 municípios em 04/07
// (Campo Novo do Parecis, Campo Verde, Cláudia, Juruena, Matupá, Nova Mutum, São José do
// Povo, Tapurah — 7 dos 8 tinham candidato neste dataset). Cluster de 20/01 (São Sebastião)
// resolvido por completo (5 de 5). Vila Bela da Santíssima Trindade confirma fundação de
// 1752 como primeira capital de MT, com lei estadual de 2016 prevendo transferência simbólica
// anual da capital nesse dia. Único candidato com citação de lei embutida neste estado
// (Confresa, Dia do Evangélico) segue bloqueado por limitação de schema (regra "2º sábado de
// julho"), mesmo caso já documentado. PA iniciado (30 promovidos, 7 rejeitados): já tinha
// estadual pleno de 08/12 (Nossa Senhora da Conceição, curado antes desta sessão) — aplicado
// o atalho de cluster (4 rejeições diretas por redundância, sem precisar criar_direto).
// Clusters de 26/07 (Sant'Ana) e 20/01 (São Sebastião) resolvidos por completo (5 de 5 cada).
// Onda de aniversário simultâneo de 11 municípios paraenses em 29/12 confirmada pela ALEPA
// (Assembleia Legislativa do Pará) — fonte legislativa estadual muito útil, vale reusar em
// outros clusters de aniversário do PA. Também reforça o padrão "fonte afirma explicitamente
// que a data NÃO é feriado oficial" para 3 rejeições (Benevides 29/12, São Miguel do Guamá
// 31/10, Novo Progresso 13/12) — em 2 desses casos o feriado real da cidade (outra data) foi
// identificado e promovido separadamente. São Miguel do Guamá também ilustra o padrão
// "projeto de lei, não confirmado sancionado" (São Miguel Arcanjo, 29/09) — promovido com
// ressalva explícita de confiança menor. ES iniciado (42 promovidos!): achado do dia — o PDF
// oficial anual "Feriados Municipais" do TJES (tjes.jus.br) lista TODOS os feriados de TODAS
// as comarcas do estado, com data, nome E número de lei/decreto de cada um — fonte primária
// completíssima, resolveu praticamente todos os clusters pendentes de uma vez (10/31 Reforma
// Protestante/Luterana/Dia do Evangélico — forte herança de colonização alemã/pomerana no
// interior capixaba —, 06/24 São João, 06/29 São Pedro, 01/20 São Sebastião, 05/13 e 08/15
// padroeiras variadas, 03/19 São José). MUITO recomendado checar se outros TJs estaduais
// publicam PDF equivalente antes de partir para pesquisa cluster-a-cluster (padrão já visto
// com o TJSE em Sergipe, agora confirmado de novo e com MAIS detalhe no TJES — vale futuramente
// checar TJAM, TJPA, TJRN, TJMS, TJPI para os candidatos que ainda restam desses estados).
// RJ iniciado (50 promovidos!): TJRJ publica calendários por "Núcleo Regional" (comarca) em
// PDFs separados (não um único consolidado como TJES/TJSE) — usado o do 8º Núcleo como
// referência. Estado já tinha 23/04 São Jorge (padroeiro do RJ) estadual curado antes desta
// sessão, mas isso NÃO cobre feriados municipais de outros santos — cada cidade tem seu
// próprio padroeiro municipal, sem atalho de cluster aqui (diferente do padrão 08/12 de
// MA/PA). Praticamente todos os clusters grandes resolvidos: 13/06 Santo Antônio (9/9),
// 19/03 São José (5/5), 20/01 São Sebastião (7/7), 15/08 Nossa Senhora da Assunção/variantes
// (10/10), 24/06 São João Batista (7/7), 08/09 padroeiras variadas (6/6), 29/06 São Pedro
// (6/6, com Petrópolis como exceção interessante — não é padroeiro, é Dia da Chegada dos
// Primeiros Colonos Alemães). Cluster de 08/12 (17 candidatos, o maior do estado) ficou
// pendente — sem estadual pleno em RJ nessa data, precisaria confirmação individual.
// MARCO: 1000+ feriados curados nesta sessão. PB retomada com sucesso (47 promovidos, 1
// rejeitado) — a tentativa anterior desta sessão tinha abandonado o cluster de 24/06 (56
// candidatos!) por falta de retorno nas buscas; desta vez, buscando em lotes de 5-6 cidades
// por vez em vez de cidade a cidade, quase todo o cluster foi resolvido (47 de 56) citando a
// mesma reportagem de abrangência nacional (opovo.com.br, "mais de 600 cidades") como fonte
// corroborante compartilhada — tática útil para clusters gigantes de datas populares (São
// João, São Pedro, São Sebastião) quando não há PDF de TJ ou fonte única equivalente: BUSCAR
// EM LOTES pequenos de nomes de cidade, não uma de cada vez. Brejo do Cruz REJEITADO — fonte
// aponta que seu feriado real é 10/07 (aniversário), não 24/06 (erro de atribuição no
// dataset comunitário, distinto do padrão "não é feriado oficial" já visto — aqui é um caso
// de DATA ERRADA atribuída à cidade certa). Restam no cluster de 24/06 do PB: Bonito de
// Santa Fé, Barra de Santa Rosa, Santa Rita, Sapé, Soledade, Sousa, Sumé (7 pendentes, sem
// confirmação clara). Cluster de 08/12 do PB (32 candidatos) parcialmente resolvido (5
// promovidos: Gurinhém, Ingá, Jacaraú, Taperoá, Itaporanga) — colheita bem mais fraca que
// 24/06, já que "existe paróquia dedicada à santa" não confirma automaticamente feriado
// municipal DECRETADO (padrão mais rigoroso aplicado aqui: só promovido quando achada fonte
// oficial da prefeitura ou confirmação explícita de celebração no ano corrente). Cluster de
// 06/29 (17 candidatos, São Pedro) resolvido quase por completo (13 de 17) com a mesma tática
// de busca em lotes pequenos usada no cluster de 24/06 — colheita voltou a ser forte assim
// que a data é uma festa junina popular (São Pedro fecha o ciclo junino, junto com São João).
// Restam pendentes no PB: 27 candidatos de 08/12, 4 de 06/29 (Alagoa Nova, Bonito de Santa
// Fé, Cabaceiras, Coremas) e os 7 remanescentes de 24/06. Mais 3 confirmados em 08/12
// (Itabaiana, Pedras de Fogo, Areia — fontes oficiais/específicas confirmando feriado
// municipal decretado, não só existência de paróquia). Restam 24 candidatos de 08/12 no PB.
// CE iniciado (24 promovidos, 21 rejeitados): já tinha estadual pleno de 19/03 (São José,
// padroeiro do Ceará, curado antes desta sessão) — aplicado o atalho de cluster: 21 rejeições
// diretas por redundância (um dos candidatos, Ararendá, trazia no próprio dataset o nome
// 'Dia de São José, padroeiro do ESTADO', confirmando a leitura). Cluster de 08/12 (30
// candidatos) resolvido com uma fonte excepcional: reportagem do Diário do Nordeste/GC Mais
// lista as 35 cidades cearenses onde Nossa Senhora da Imaculada Conceição é padroeira — bateu
// com 24 dos 30 candidatos do cluster de uma vez (lista nomeada exaustivamente, como um
// "PDF de TJ" informal). Restam pendentes no CE: 6 candidatos de 08/12 (Barbalha, Baturité,
// Brejo Santo, Mombaça, Palmácia, Umirim — não constam na lista de 35) e os demais clusters
// grandes ainda não trabalhados (08/15 com 11, 06/13 com 10, 06/29 com 9). CE aprofundado
// (45 promovidos): reportagens jornalísticas cearenses (opovo.com.br, diariodonordeste,
// metropoles.com) publicam listas NOMEADAS de cidades por data de feriado com regularidade
// impressionante — funcionou de novo para 08/15 (17 cidades listadas, 11 bateram), 06/29
// (São Pedro, lista bateu 100% com o cluster), 07/26 (Sant'Ana, 11 cidades listadas, 8
// bateram), e uma Lei Municipal explícita (nº 335/1968) resolveu Juazeiro do Norte em 09/15.
// 12 candidatos já rotulados no dataset (Santo Antônio ×10, São João ×2) + 1 São Sebastião.
// CE parece ter uma imprensa estadual particularmente ativa em publicar esse tipo de lista —
// vale sempre tentar a busca "[data] é feriado em quantas cidades" / "[santo] X cidades
// celebram" antes de ir cidade por cidade, padrão que se repetiu em quase todo cluster do CE.
// AM (Amazonas) fechado nesta rodada: era o menor estado pendente (20 candidatos, sem
// clusters de data compartilhada — cada município com data própria). 13 promovidos, 1
// rejeitado (Manicoré 08/15 — Lei Orgânica lista os feriados oficiais do município e 15/08
// não está entre eles, só é "dia da elevação à categoria de cidade"), 6 pendentes sem fonte
// suficiente (Tabatinga, Humaitá, Codajás, Tapauá, Borba, Barcelos). Achados úteis: (1) a
// Associação Amazonense de Municípios (aam.org.br) tem ficha por município com data de
// aniversário/emancipação e às vezes padroeiro — boa fonte auxiliar para o Norte, mas nem
// sempre cita a lei; (2) o IDAM (idam.am.gov.br) tem fichas técnicas por município com "Ato
// de Criação: Lei Nº X de DD/MM/AAAA" — quando essa data bate com notícia de câmara/prefeitura
// celebrando aniversário, conta como 2ª fonte independente; (3) heurística "padroeiro = data
// universal do santo" usada de novo com sucesso (São Sebastião 20/01, São João Batista 24/06,
// Santo Elias 20/07 — este último inédito, padroeiro de Novo Airão); (4) quando uma Lei
// Orgânica municipal lista explicitamente os feriados oficiais e a data candidata NÃO está
// nessa lista, é motivo válido de rejeição (não apenas "sem fonte") — mesmo padrão já visto
// com fontes municipais negando data em outros estados.
// TO (Tocantins) aprofundado nesta rodada: 9 promovidos, 2 rejeitados, 15 pendentes (26
// candidatos, quase todos com data própria por município, poucos clusters). Achados úteis:
// (1) confirma de novo o padrão de "onda de instalação simultânea" já visto em RO/AM/MT/PA —
// desta vez 15 municípios tocantinenses instalados em 01/06/1989 (Combinado, Divinópolis do
// Tocantins e outros 13, ver reportagem do Gazeta do Cerrado) e 17 em 14/11/1958 (Xambioá,
// Araguaçu, Gurupi e outros); (2) esse mesmo achado serviu para REJEITAR com segurança 2
// candidatos cuja data não batia com a onda confirmada (Xambioá tinha candidato para 30/11,
// mas a data real e oficialmente decretada é 14/11 — Lei Municipal nº 216/89; Formoso do
// Araguaia tinha candidato para 23/08, mas a data real é 1º de outubro) — quando a fonte
// oficial do município aponta uma data DIFERENTE da do candidato (não apenas "sem fonte"),
// vale rejeitar citando a data correta; (3) portais regionais dedicados ao estado (Gazeta do
// Cerrado, Atitude TO, SECOM-TO) são boas fontes auxiliares para aniversário municipal no
// Norte, similar ao papel da AAM no Amazonas; (4) padroeiro segue rendendo: Nossa Senhora de
// Fátima em Fátima/TO (nome do próprio município já é forte indício) e Nossa Senhora do Carmo
// em Divinópolis do Tocantins, ambos com data universal do santo. Restam pendentes: Arraias
// 20/01, Silvanópolis 20/01, Fátima 21/12, Almas (17/05, 18/05, 10/12 — nenhuma bate com a
// emancipação real de 14/11/1958), Miracema do Tocantins 25/06, Tocantinópolis 07/07,
// Colméia (06/08, 26/12), Natividade 16/08, Colinas do Tocantins 31/10, Palmeirópolis 27/11
// (emancipação real é 10/06/1980, mas nenhuma fonte confirma OU nega 27/11 especificamente),
// Araguaçu 08/12, e o já conhecido Gurupi Dia do Evangélico (limitação de schema).
// AL (Alagoas) aprofundado nesta rodada: 21 promovidos, 3 rejeitados de 75 candidatos
// pendentes (muitos ainda restam — não é o estado inteiro, só uma rodada de pesquisa).
// Achados úteis: (1) primeira rejeição por REDUNDÂNCIA COM SEXTA-FEIRA SANTA nesta sessão —
// candidato de Marechal Deodoro para 03/04/2026 já é Sexta-feira Santa (nacional, calculada
// em código) — vale sempre checar se a data do candidato cai numa Páscoa-derivada do ano antes
// de pesquisar; (2) caso raro de duas cidades VIZINHAS com a MESMA data de emancipação
// (22/08/1962, Canapi e Inhapi, desmembradas juntas) mas com desfechos OPOSTOS — Canapi tem
// lei declarando feriado, Inhapi tem fonte explícita dizendo que NÃO virou feriado por falta
// de lei — reforça que nunca dá para inferir de um município vizinho para outro, mesmo com
// história compartilhada; (3) AL tem portal de notícias municipais muito ativo (Agenda
// Alagoas, AMA, Assembleia Legislativa de Alagoas com página dedicada por município listando
// emancipação/padroeiro/eventos) — a página da ALE-AL por município é uma fonte auxiliar
// muito boa, similar à AAM no Amazonas; (4) caso raro de MUDANÇA DE DATA de comemoração por
// motivo prático (São Miguel dos Campos: emancipação legal é 18/06/1864, mas a comemoração
// foi transferida para 29/09 por causa de chuvas fortes em junho — 29/09 é a data hoje
// efetivamente celebrada e a que promovemos); (5) padroeiro rendeu bastante de novo: São
// Sebastião (Limoeiro de Anadia, Porto Calvo), São Benedito (Coité do Nóia), Nossa Senhora do
// Rosário (Inhapi), Sant'Ana (Santana do Ipanema, nome do município já indica), Santa Maria
// Madalena (União dos Palmares, com lei municipal citada), Nossa Senhora da Penha (Batalha e
// São Sebastião/AL, mesma padroeira em municípios vizinhos) e Nossa Senhora do Ó (São Miguel
// dos Campos). Restam pendentes ~54 candidatos de AL não pesquisados nesta rodada.
// PI (Piauí) iniciado nesta rodada: 6 promovidos de 78 candidatos pendentes, focado no maior
// cluster (13 candidatos para 08/12, Nossa Senhora da Conceição). Achado importante: PI já
// tinha um PONTO FACULTATIVO ESTADUAL curado para 08/12 (só administração pública estadual,
// decreto anual) — MAS isso NÃO torna os candidatos municipais automaticamente redundantes
// (diferente do padrão MA/RJ, onde havia um feriado ESTADUAL PLENO): ponto facultativo
// estadual e feriado municipal pleno são categorias jurídicas diferentes que coexistem, então
// cada candidato municipal ainda precisa de pesquisa individual. Duas reportagens/listas
// nomeadas independentes (Info Newss "17 cidades" e uma lista por diocese "18 municípios")
// identificaram só 3 dos 13 candidatos do cluster como tendo N. Sra. da Conceição como
// padroeira oficial (Corrente, Luís Correia, Pedro II) — os outros 10 NÃO aparecem em nenhuma
// das duas listas apesar de serem candidatos a "Feriado Municipal" na mesma data, reforçando
// que uma data compartilhada por muitos municípios não pode ser promovida em bloco sem
// confirmação nominal por cidade. Também promovidos: São Raimundo Nonato e União (co-padroeiro
// em ambos, 31/08, São Raimundo Nonato) e Guadalupe (12/12, Nossa Senhora de Guadalupe,
// heurística do nome do município). Achado a registrar: São Pedro do Piauí tem candidato para
// 29/06 (fim do festejo de São Pedro), mas fonte oficial diz que o FERIADO MUNICIPAL decretado
// é 21/06 (aniversário da cidade, data não candidatada) — "festejo"/novena terminando num dia
// não implica necessariamente que aquele dia é o feriado decretado; mantido pendente por
// prudência. Restam pendentes a maioria dos 78 candidatos de PI (não é o estado inteiro).
// AL segunda rodada: mais 17 promovidos (0 rejeitados desta vez), quase todos via emancipação
// política confirmada pela AMA (Associação dos Municípios Alagoanos, fonte-mãe para todo AL —
// tem página dedicada por município e também uma "lista de emancipações" central muito útil
// para checar vários municípios de uma vez) cruzada com reportagem/prefeitura local. Também 2
// padroeiros: Santa Rita de Cássia (Boca da Mata, 22/05) e Sant'Ana (Barra de São Miguel,
// 26/07, mesmo padrão já visto em Santana do Ipanema). Caso instrutivo: Piranhas/AL tem duas
// fontes conflitantes sobre a data da padroeira Nossa Senhora da Saúde (uma diz 02/02, outra
// diz 22/03, que era a data candidatada) — como "Nossa Senhora da Saúde" não tem uma data
// universal fixa no calendário católico (varia por devoção local), a divergência não pôde ser
// resolvida com confiança e o candidato ficou pendente. Outro caso: Matriz de Camaragibe tem
// candidatos para 24/05 e 13/12, mas a fonte oficial (AMA) só confirma emancipação em 24/04 e
// aniversário em 19/06 — nenhuma bate com as datas candidatadas, então ambas ficaram pendentes
// (nem confirma nem nega o suficiente pra rejeitar). Restam pendentes ~34 candidatos de AL.
// AL terceira rodada: mais 17 promovidos (0 rejeitados), praticamente esgotando o padrão
// "emancipação via AMA/prefeitura" nesse estado. Achados notáveis: (1) primeiro caso desta
// sessão de um único município com DUAS datas de emancipação candidatadas que na verdade são
// EVENTOS DIFERENTES do mesmo tipo em municípios vizinhos com histórico compartilhado (Olho
// d'Água das Flores e Paulo Jacinto, mesma data exata 02/12/1953 — desmembrados juntos);
// (2) caso Campo Grande/AL: candidato tinha 3 datas (31/05, 01/06, 13/12) — resolvidos 2 das 3
// (31/05 emancipação por lei estadual nº 2.330/1960, 13/12 padroeira Santa Luzia), 01/06 ficou
// pendente por falta de fonte específica (não é claramente nem a emancipação nem a padroeira);
// padrão de "1 município, 2 datas diferentes, ambas confirmáveis separadamente" segue sendo o
// mais comum quando há mais de um candidato pendente para o mesmo município. (3) Major
// Isidoro/AL: candidato de 01/06 é confirmado como feriado municipal REAL por agregadores, mas
// a razão não é a emancipação (17/09/1949) nem foi encontrada — mantido pendente por falta de
// citação específica, mesmo com razoável certeza de que a data existe como feriado. AL está
// essencialmente esgotado com as técnicas de busca tentadas — os ~17 que restam pendentes
// (Traipu, Poço das Trincheiras 20/01, Quebrangulo, São José da Laje, Matriz de Camaragibe,
// Piranhas 22/03, Major Isidoro, Campo Grande 01/06, Porto Calvo 22/07, Taquarana 03/05) não
// renderam fonte suficiente com as buscas tentadas — retomar com estratégia diferente ou mais
// tarde, mesmo padrão de "abandono documentado" já usado para PB.
// PI segunda rodada: 10 promovidos, 1 rejeitado. Achado importante: São Pedro do Piauí —
// candidato de 21/06 CONFIRMADO como o feriado municipal oficial (fonte já achada na rodada
// anterior), resolvendo a dúvida que tinha ficado pendente sobre 29/06 (esse continua
// pendente, é só o fim do festejo/novena, não o feriado decretado). Outro achado importante:
// Parnaíba/PI — candidato de 14/08 REJEITADO com fonte explícita dizendo que, apesar de ser a
// data de aniversário amplamente celebrada, NÃO é oficialmente feriado municipal (mesmo padrão
// "aniversário celebrado ≠ feriado decretado" já visto em Major Isidoro/AL e outros). Confirma
// de novo o padrão robusto de emancipação política via reportagens locais + câmara/prefeitura
// (Fronteiras, Cocal, Angical do Piauí, Castelo do Piauí, Santa Cruz do Piauí) e um caso de
// coincidência de data de fundação entre municípios distintos (Bom Jesus e Canto do Buriti,
// ambos 15/12/1938). Restam pendentes ~60 candidatos de PI.
// PI terceira rodada: 13 promovidos, 1 rejeitado. Padrão dominante segue sendo emancipação
// política via prefeitura/câmara municipal + reportagens locais (portais regionais como
// Cidades na Net, 180graus, Cidades em Foco, Portal R10 são muito ativos no PI, similar ao
// papel do Atitude TO no Tocantins). Segundo caso de "aniversário celebrado ≠ feriado
// decretado" nesta rodada (Luzilândia 10/03, mesmo padrão de Parnaíba 14/08 já visto) — REJEITAR
// com a fonte que nega explicitamente, não deixar pendente. Terceiro caso desta sessão de
// "duas datas diferentes para o mesmo município, ambas confirmáveis separadamente" (Água Branca:
// 01/07 emancipação + 15/08 padroeira; Floriano: 02/07 padroeira + 08/07 emancipação — datas
// próximas mas distintas, cuidado ao não confundir uma pela outra). Restam pendentes ~47
// candidatos de PI, incluindo o cluster de 10 candidatos ainda não resolvidos em 08/12 (Nossa
// Senhora da Conceição) que não bateram com as listas nomeadas de padroeiras já usadas.
// MT (Mato Grosso) iniciado nesta rodada: 5 promovidos de 93 candidatos pendentes. Achado
// principal: confirma mais um caso de "onda de criação simultânea de municípios" (padrão já
// visto em RO/AM/TO/MA/PA) — Nova Ubiratã, Querência e Santa Carmem, todos emancipados em
// 19/12/1991-1993 na mesma região do MT. Sant'Ana confirmada como padroeira de Chapada dos
// Guimarães (26/07), mas os outros 3 candidatos do mesmo cluster de data (Aripuanã,
// Nortelândia, Novo São Joaquim) não têm confirmação individual — mesmo padrão de cautela já
// usado no MA/PI: não promover em bloco só porque a data é compartilhada por vários
// municípios, cada um precisa de confirmação nominal. Mesma cautela aplicada ao cluster de
// 25/07 (Canarana, Denise, Santa Carmem — candidata a São Cristóvão/São Tiago, mas sem
// confirmação por município) e ao cluster de 08/12 (Diamantino confirmado como Nossa Senhora
// da Conceição, Marcelândia e Querência não). Restam pendentes ~88 candidatos de MT.
// MT segunda rodada: mais 7 promovidos, 0 rejeitados. Mais dois pares de municípios vizinhos
// com a MESMA data de emancipação em anos diferentes (Arenápolis + Nortelândia, 05/02/1954,
// desmembrados juntos de Diamantino/Barra do Bugres; Araguaiana + Mirassol d'Oeste, 14/05,
// anos diferentes — 1976 e 1986 — mera coincidência de data, não onda). Caso novo e importante:
// Nova Xavantina tem FUNDAÇÃO (14/04/1944, lançamento de pedra fundamental) e EMANCIPAÇÃO
// POLÍTICA (03/03/1980) como datas diferentes e ambas comemoradas — candidato batia com a
// fundação, não a emancipação; promovido como 'Aniversário de Fundação' distinto de
// 'Aniversário de Emancipação Política' (nomenclatura já usada em outros casos de fundação vs.
// emancipação, ex. Piaçabuçu/AL, Angical do Piauí). Restam pendentes ~81 candidatos de MT.
// MT terceira rodada: mais 5 promovidos. DESCOBERTA IMPORTANTE: existe uma "onda de 13 de
// maio" em MT — pelo menos 23-25 municípios emancipados nessa data em duas leva (1976 e 1986,
// governador Júlio Campos), incluindo São Félix do Araguaia, Tangará da Serra, Barra do
// Bugres, Diamantino, Sorriso, Vera, Marcelândia, Vila Rica, Campinápolis, Porto Alegre do
// Norte, Novo São Joaquim, entre outros (ver reportagem do Diário de Cuiabá). PORÉM: ao
// cruzar essa lista com os candidatos pendentes desses mesmos municípios no dataset, NENHUMA
// data de candidato bate com 13/05 — cada um está candidatado a uma data completamente
// diferente (Vila Rica@10/08, Campinápolis@01/11, Porto Alegre do Norte@24/09, Novo São
// Joaquim@26/07, Marcelândia@08/12). Isso sugere que a data de criação por LEI (13/05) e a
// data efetivamente comemorada/instalação variam muito nesses municípios — NÃO promover por
// associação com a onda sem confirmar a data específica candidatada para cada um. Acrescenta-se
// aos casos "duas datas diferentes, ambas legítimas" já vistos (fundação vs. emancipação,
// emancipação legal vs. instalação efetiva). Também: Sinop tem FUNDAÇÃO (14/09/1974) distinta
// de EMANCIPAÇÃO/autonomia (17/12/1979) — mesmo padrão de Nova Xavantina. Restam pendentes ~76
// candidatos de MT.
// MT quarta rodada: mais 6 promovidos. Caso Cáceres: candidato tinha 2 datas (25/08 padroeiro
// São Luiz, 06/10 fundação), ambas confirmadas via a mesma fonte primária — a própria Câmara
// Municipal publica portaria anual com o calendário completo de feriados/pontos facultativos
// (boa prática a replicar: procurar "portaria feriados pontos facultativos [município]" antes
// de ir atrás de reportagens dispersas, quando existir). Caso Alta Floresta: reforça o padrão
// "data comemorada oficialmente ≠ data da lei" — emancipação/autonomia institucional é
// 18/12/1979, mas o feriado municipal decretado é 19/05 (data da fundação/abertura da estrada
// em 1976). Poconé também é fundação (21/01/1781), não emancipação (25/10, não candidatada).
// Restam pendentes ~70 candidatos de MT.
// MT quinta rodada: mais 4 promovidos. Confresa (29/07, Lei Municipal nº 433/2010) e
// Diamantino (18/09/1728) reforçam o padrão fundação-como-feriado-decretado. Paranatinga
// resolveu as duas datas do mesmo município de uma vez (17/12 emancipação + 03/12 padroeiro
// São Francisco Xavier). Colíder pesquisado mas sem confirmação para nenhuma das 2 datas
// candidatadas (24/06, 18/12) — aniversário real (07/05) nem sequer é feriado, mantido
// pendente. Restam pendentes ~66 candidatos de MT.
// MT sexta rodada: 2 promovidos + 1 cadastro direto. Achado raro e valioso: durante a
// pesquisa de Guiratinga, uma busca lateral revelou que Rondonópolis SANCIONOU em 2026 (Lei
// nº 14.933, 21/07/2026, em vigor 22/07/2026) um feriado municipal NOVO para São João Batista
// (padroeiro, 24/06), após anos de tentativas frustradas de vereadores — não havia candidato
// correspondente no dataset comunitário (que é uma captura estática mais antiga), então foi
// cadastrado via criar_direto com base em cobertura jornalística ampla e recente (7+ fontes
// independentes, incluindo a própria Câmara Municipal). Isso mostra que vale a pena, de vez em
// quando, fazer uma busca geral por "feriado municipal sancionado 2026 [UF]" — o dataset
// comunitário não captura leis municipais recentes, e por isso há uma lacuna estrutural de
// feriados novíssimos que só aparecem se procurados ativamente, fora do fluxo normal de
// revisar candidatos pendentes. Restam pendentes ~64 candidatos de MT.
// MT sétima rodada: 3 promovidos, 0 rejeitados. Barra do Bugres (19/04) e Jauru (20/09)
// resolvidos com fontes fortes de prefeitura própria. Caso muito instrutivo: Lucas do Rio
// Verde — a Câmara de Vereadores, na 1ª sessão de janeiro/1989, DELIBERADAMENTE escolheu a
// data de FUNDAÇÃO do núcleo urbano (05/08/1982) como feriado municipal, em vez da data de
// emancipação política formal (04/07/1988, mesma data também de Tapurah, Nova Mutum e Campo
// Novo do Parecis — outra onda de desmembramento simultâneo de Diamantino, ainda não
// verificada candidato a candidato). Reforça que fundação e emancipação nem sempre coincidem,
// e que a escolha de qual delas vira feriado é uma decisão legislativa específica, não uma
// regra genérica — sempre verificar qual data bate com o candidato real antes de assumir.
// Restam pendentes ~61 candidatos de MT.
// MT oitava rodada: 3 promovidos, 1 rejeitado. Caso muito instrutivo: Ribeirão Cascalheira
// tem candidatos para AMBAS 03/05 (data da Lei Estadual nº 5.267 de criação) e 12/08 (Decreto
// Municipal nº 234/1993, que fixou essa outra data como a comemoração cívica oficial e feriado
// municipal) — promovido só 12/08 (a data efetivamente decretada como feriado), 03/05 ficou
// pendente (é só a data de criação legal, sem confirmação de que também virou feriado
// separado). Confirma de novo o padrão "aniversário celebrado ≠ feriado decretado" com Itiquira
// (01/12, fonte explícita nega status de feriado apesar da comemoração popular) — REJEITADO.
// Vera resolvido como fundação (27/07/1972), distinta da emancipação política-administrativa
// (13/05, mesma onda de 23 municípios de MT em 13 de maio já documentada, ainda não conferida
// candidato a candidato nesta sessão — Vera não tinha candidato para 13/05 na fila). Restam
// pendentes ~58 candidatos de MT.
// PA (Pará) iniciado nesta rodada: 2 promovidos, 1 rejeitado, de 97 candidatos pendentes.
// Achado importante: PA tem PELO MENOS duas ondas grandes de criação/emancipação simultânea de
// municípios já documentadas em reportagens ("15 municípios paraenses" emancipados em
// 10/05/1988: Bom Jesus do Tocantins, Brejo Grande do Araguaia, Concórdia do Pará,
// Curionópolis, Dom Eliseu, Garrafão do Norte, Ourilândia do Norte, Pacajá, Parauapebas,
// Rurópolis, Santa Maria das Barreiras, São Geraldo do Araguaia, São João de Pirabas,
// Tailândia, Tucumã; e "11 municípios" criados pela Lei nº 2.460 em 29/12/1961: Jacundá, Santa
// Maria do Pará, Benevides, Limoeiro do Ajuru, Peixe-Boi, Bonito, Capitão Poço, Colares,
// Senador José Porfírio, São João do Araguaia, Piçarra) — MAS, ao cruzar essas duas listas
// contra os candidatos pendentes reais no banco, NENHUM candidato bate exatamente com 10/05 ou
// 29/12 (os candidatos desses mesmos municípios estão em datas próximas mas diferentes, ex.
// Dom Eliseu candidatado a 12/05 não 10/05, Curionópolis a 27/11 não 10/05) — reforça que o
// dataset comunitário nem sempre reflete a data de emancipação "oficial" pesquisável, podendo
// ser padroeiro, data de instalação (distinta da criação), ou erro de fonte; não force-matchear
// datas de onda contra candidatos que não batem exatamente. Confirma de novo 'aniversário
// celebrado ≠ feriado decretado' com Tucuruí (31/12, aniversário real do município, mas fonte
// nega status de feriado) — REJEITADO; o candidato de Tucuruí para 31/10 (que corresponderia à
// criação da freguesia em 1870, achado histórico à parte) ficou pendente por falta de
// confirmação de que essa é de fato a data comemorada hoje. Restam pendentes ~95 candidatos de
// PA.
// PA segunda rodada: mais 5 promovidos, 0 rejeitados. Benevides (16/07, Nossa Senhora do
// Carmo) tem citação de lei explícita e rara (Lei Municipal nº 194/68) — bom achado. Caso
// instrutivo: Bragança tinha DOIS candidatos (07/08 e 28/08); a fonte confirmou explicitamente
// que o aniversário real é 08/07 ('413 anos... no dia 8 de julho'), então só esse foi
// promovido — 28/08 ficou pendente sem confirmação (mostra de novo a importância de checar
// TODOS os candidatos do mesmo município antes de assumir qual data é a correta, em vez de
// pesquisar a data "óbvia" do cluster). Restam pendentes ~90 candidatos de PA.
// PA terceira rodada: 2 promovidos, 1 rejeitado. Caso raro e muito instrutivo: Oriximiná e
// Cametá comemoram aniversário na MESMA data (24/12), mas com desfechos opostos — Oriximiná
// tem confirmação explícita de status de feriado ('Aniversário da Emancipação Política'
// oficial), Cametá tem fonte explícita negando esse status. Mesmo padrão do caso Canapi/Inhapi
// em AL (duas cidades vizinhas com a mesma data de emancipação, uma virou feriado, outra não)
// — reforça que nunca dá para inferir o status de feriado de uma cidade a partir de outra, por
// mais parecida que seja a história ou a data. São Domingos do Araguaia confirmado via ficha
// da FAPESPA (Fundação Amazônia de Amparo a Estudos e Pesquisas do Pará) — fonte estadual
// oficial nova para esta sessão, boa para MT/PA/estados amazônicos em geral. Restam pendentes
// ~88 candidatos de PA.
// PA quarta rodada: 3 promovidos, 0 rejeitados. Mais uma onda confirmada: Decreto-Lei nº
// 4.505, de 30/12/1943, criou simultaneamente Barcarena, Bujaru, Inhangapi, Nova Timboteua e
// São Francisco do Pará (Melgaço juntou-se ao grupo em 1961 por lei diferente) — Nova
// Timboteua e São Francisco do Pará confirmados (candidatos batiam exatamente com 30/12);
// Barcarena tinha candidato só para 03/12 (não bate com a onda) — mesma cautela de sempre, só
// promover quando a data do candidato bate exatamente. Nova Esperança do Piriá é caso à parte
// (Lei nº 5.707/1991, não relacionada à onda de 1943) — a data de ASSINATURA da lei (27/12)
// bateu com o candidato, distinta da data de PUBLICAÇÃO no Diário Oficial (30/12, mesmo dia da
// onda de 1943 mas por coincidência) — cuidado ao pesquisar esse tipo de caso para não
// confundir assinatura com publicação quando ambas aparecem na mesma fonte. Restam pendentes
// ~85 candidatos de PA.
// MT nona rodada (retomada por engano ao pesquisar "PA" — Nova Monte Verde, Nova Maringá e
// Tabaporã são municípios de MT, não PA; confusão de sigla corrigida antes de aplicar): 2
// promovidos, 1 rejeitado, 1 cadastro direto. Nova Monte Verde (19/08, fundação) e Nova
// Maringá (26/08, data de escolha do nome, celebrada como aniversário) seguem o padrão
// fundação/nome ≠ emancipação já visto muitas vezes nesta sessão. Caso valioso: Tabaporã tinha
// candidato para 20/09, mas a data real é 20/12 (Lei Estadual nº 5.913/1991) — REJEITADO o
// candidato errado e feito CRIAR_DIRETO para a data certa, que tem uma reportagem muito
// específica e recente: a Prefeitura só oficializou esse aniversário como feriado municipal em
// 2025 (Lei Ordinária nº 1.517, de 18/09/2025) — mais um caso do "feriado novíssimo que o
// dataset comunitário não captura", como o de Rondonópolis/São João Batista já visto nesta
// sessão. Vale sempre considerar criar_direto quando a pesquisa aponta pra uma data diferente
// da candidatada, em vez de só rejeitar e deixar a data certa sem registro. Restam pendentes
// ~56 candidatos de MT (contagem não muda o total de PA, que segue ~85).
// PA quinta rodada: 4 promovidos, 0 rejeitados — bom rendimento com as 4 maiores cidades do
// aglomerado metropolitano/polos regionais do PA (Ananindeua, Castanhal, Marabá, Santarém).
// Padrão que se repete: para municípios mais antigos/maiores, a "data de instalação" (não a
// de criação/decreto) costuma ser a celebrada oficialmente — Ananindeua (decreto 30/12/1943,
// instalação 03/01/1944) e Marabá (criação 27/02/1913, instalação 05/04/1913) seguem esse
// padrão. Caso mais rico: Santarém teve PELO MENOS 3 datas históricas candidatas ao longo do
// tempo (14/03/1758 elevação a vila, 24/10/1848 elevação a cidade, 22/06/1661 fundação da
// missão jesuíta) — o poder público municipal formalmente pesquisou e OFICIALIZOU 22/06 como a
// data das comemorações cívicas atuais (após confirmação documental com o Vaticano sobre a
// data de chegada do padre Bettendorf), abandonando as datas anteriores. Quando uma
// cidade tem múltiplas datas históricas plausíveis, procurar a fonte que explica qual foi
// FORMALMENTE ADOTADA como a atual, não assumir a mais antiga ou a mais "óbvia".
// PA sexta rodada: 6 promovidos, 0 rejeitados. Baião resolveu 2 de 3 candidatos de uma vez
// (30/10 aniversário + 01/06 Círio de Santo Antônio padroeiro, 31/08 ficou pendente). Portel
// também 2 de 2 (24/01 instalação da vila + 02/02 Nossa Senhora da Luz padroeira). Rurópolis:
// mais um caso "fundação (12/02/1974, celebrada) ≠ emancipação política formal (10/05/1988,
// Lei Estadual nº 5.446)" — o candidato batia com a fundação. Vigia: padroeira Nossa Senhora
// das Neves confirmada com data universal (05/08) batendo exatamente; o outro candidato
// (14/02, suposto retorno da imagem de Nazaré) ficou pendente por fonte fraca (blog pessoal,
// sem confirmação independente). Restam pendentes ~75 candidatos de PA.
// PA sétima rodada: 4 promovidos, 0 rejeitados. Altamira é o achado mais forte: Lei Municipal
// nº 2.055, de 07/10/2009, institui explicitamente 06/11 como feriado municipal reconhecendo a
// emancipação (Lei Estadual nº 1.234, de 06/11/1911) — citação de lei dupla (estadual +
// municipal) rara e muito sólida. Bonito, Itupiranga e Capanema seguiram o padrão usual
// (padroeiro/emancipação com 2+ fontes). Vários outros candidatos pesquisados nesta rodada
// (Igarapé-Miri, Ourilândia do Norte, Mocajuba, Floresta do Araguaia) NÃO renderam confirmação
// — todos têm datas de emancipação/aniversário conhecidas que não batem com nenhum dos
// candidatos pendentes no banco, reforçando que esses 4 municípios têm candidatos
// provavelmente errados ou de origem obscura (talvez padroeiro secundário não pesquisado, ou
// erro do dataset comunitário) — ficaram todos pendentes. Restam pendentes ~71 candidatos de
// PA.
// PA oitava rodada: 2 promovidos, 1 rejeitado. Santana do Araguaia e Porto de Moz seguiram o
// padrão usual (emancipação com fonte forte da própria prefeitura). Novo Repartimento:
// mais um caso "aniversário celebrado ≠ feriado decretado" — REJEITADO com a fonte que nega
// explicitamente. Barcarena pesquisado de novo (Decreto-Lei nº 4.505, mesma onda de 1943 já
// documentada) mas seu candidato no banco é para 03/12, não 30/12 — não bate, ficou pendente
// (mesma cautela de sempre com a onda). Restam pendentes ~69 candidatos de PA.
// PA nona rodada: 3 promovidos, 0 rejeitados. Placas, Ipixuna do Pará e Itaituba seguiram o
// padrão usual de emancipação com fonte forte (Ipixuna faz parte de mais uma onda de 15
// municípios paraenses em 13/12/1991, já documentada). Curionópolis pesquisado mas seu
// candidato (27/11) não bate com a emancipação real (10/05/1988, mesma onda de 15 municípios
// de 1988 já documentada) — ficou pendente. Restam pendentes ~66 candidatos de PA.
// SE (Sergipe) iniciado nesta rodada: 6 promovidos de 100+ candidatos pendentes, via lista
// nomeada de reportagem sobre 08/12 (Nossa Senhora da Conceição) — Arauá, Canhoba, Canindé de
// São Francisco, Itabaianinha, Japaratuba, Porto da Folha (6 de 7 candidatos do cluster
// batendo; Pinhão não está na lista, ficou pendente). Achado importante: buscas por listas
// nomeadas para os outros dois grandes clusters de SE (06/24 São João Batista, 20 municípios
// nomeados incluindo Aracaju/capital; 06/29 São Pedro) NÃO renderam overlap com os candidatos
// reais do banco — os municípios nomeados nas reportagens (Boquim, Campo do Brito, Canhoba,
// Estância, Indiaroba, Itabaianinha, Itabi, Itaporanga D'Ajuda, Japoatã, Japaratuba, N. Sra.
// Aparecida, N. Sra. das Dores, Pedra Mole, Rosário do Catete, Santo Amaro das Brotas, São
// Cristóvão, Simão Dias, Siriri, Umbaúba) são DIFERENTES dos 10 candidatos do cluster 06/24 no
// banco (Areia Branca, Cristinápolis, Moita Bonita, Neópolis, Nossa Senhora de Lourdes,
// Pacatuba, Poço Redondo, Poço Verde, Salgado, Tomar do Geru) — zero sobreposição, reforçando
// (de novo) que uma lista nomeada só serve para confirmar os municípios que aparecem nela, não
// para promover em bloco os candidatos de uma data compartilhada. Restam pendentes ~94
// candidatos de SE.
// SE segunda rodada: 5 promovidos, 0 rejeitados. Caso raro e valioso: Nossa Senhora de
// Lourdes/SE tinha DOIS candidatos, e a própria página de história do município resolveu os
// dois de uma vez só: 11/02 (padroeira, festa TRANSFERIDA de 02/12 para a data universal da
// santa) e 13/05 (elevação a cidade pela Lei nº 103-A) — mesma fonte única cobrindo dois
// eventos distintos. Feira Nova também 2 de 2: 18/10 (emancipação, IBGE) e 27/11 (padroeira
// Nossa Senhora das Graças, data universal — Medalha Milagrosa). Poço Verde: só a co-padroeira
// (03/05) confirmada; os outros 2 candidatos (20/01, 24/06) ficaram pendentes sem fonte.
// Restam pendentes ~89 candidatos de SE.
// SE terceira rodada: 7 promovidos, 0 rejeitados. Achado de fonte nova: o Calendário Judicial
// do TJSE (Tribunal de Justiça de Sergipe) lista, comarca por comarca, tanto a data de
// emancipação quanto a data da padroeira de vários municípios — fonte auxiliar muito boa para
// SE, seguindo o padrão já visto com TJES/TJSE/TJMT em sessões anteriores. Simão Dias resolveu
// emancipação (12/06) e padroeira Sant'Ana (26/07, data universal) de uma vez. Nesta rodada,
// dois candidatos (Riachão do Dantas/Pedra Mole em 21/11, e Poço Redondo em 23/11) foram
// promovidos citando "o Calendário Judicial do TJSE" como fonte, mas essa citação vinha de um
// resumo de busca, não da leitura direta do PDF — ver CORREÇÃO na nota da quarta rodada abaixo.
// Restam pendentes ~82 candidatos de SE.
// SE quarta rodada: 36 promovidos + 1 cadastro direto, 0 rejeitados. Desta vez o PDF do
// Calendário Judicial do TJSE 2026 foi de fato baixado e lido por inteiro (via Read direto no
// arquivo local, já que o WebFetch não conseguiu extrair o texto do PDF) — ele lista, mês a mês,
// o feriado forense de cada comarca de Sergipe (padroeiro E emancipação), e rendeu 36
// promoções de uma vez, o maior lote de uma fonte única nesta sessão. CORREÇÃO IMPORTANTE: ao
// cruzar o texto real do calendário com os dois lançamentos da terceira rodada citados acima,
// descobriu-se que (a) o calendário NÃO lista Pedra Mole em 21/11 — só Japoatã e Riachão do
// Dantas aparecem nessa data — ou seja, a citação anterior "confirmada pelo TJSE" para Pedra
// Mole era uma síntese de busca não lastreada no documento real, uma fabricação; e (b) o
// calendário lista a emancipação de Poço Redondo em 25/11, não 23/11 como uma fonte secundária
// (blog citando a Lei Orgânica) havia indicado. Os dois lançamentos errados (feriados #70528
// Pedra Mole 21/11 e #70530 Poço Redondo 23/11) foram desativados via SQL direto
// (UPDATE feriados SET ativo=0), os candidatos de origem (15847, 15859) voltaram a
// status='pendente', e Poço Redondo foi recadastrado corretamente em 25/11 via criar_direto
// (sem candidato correspondente na fila para essa data). Pedra Mole permanece genuinamente sem
// fonte e pendente — o calendário não traz nenhuma data para o município. Lição para o
// trabalho futuro: uma citação sintetizada por busca ("o calendário do TJSE confirma X") não é
// o mesmo que ter lido o documento primário — deve ser tratada como não verificada até o PDF
// (ou equivalente) ser de fato aberto e conferido linha a linha. Restam pendentes ~46
// candidatos de SE (~47 contando Pedra Mole, que segue sem fonte para 21/11 ou qualquer outra
// data).
const DECISOES2: Decisao[] = [
];
// RN (Rio Grande do Norte) iniciado nesta sessão: 9 promovidos, de ~15 candidatos revisados
// (dos 109 pendentes). Tentativa de replicar a técnica de "PDF único cobrindo todo o estado"
// (TJSE/SE, TJES/ES) falhou para RN e RJ: TJRN não tem um PDF equivalente facilmente localizável,
// e o domínio tjrj.jus.br bloqueou o WebFetch por certificado SSL inválido, mesmo com múltiplos
// PDFs por núcleo regional disponíveis (10+ núcleos, mais trabalhoso de qualquer forma). Retomado
// com pesquisa individual padrão. Achado: já existia no banco (de sessão anterior a esta janela
// visível) o feriado ESTADUAL \"Mártires de Cunhaú e Uruaçu\" (03/10, Lei Estadual nº 8.913/2006)
// — mas Canguaretama/RN (onde ocorreu o massacre de 1645 na Capela de N. Sra. das Candeias) tem
// um feriado MUNICIPAL distinto na data real do morticínio (16/07), comemorando o evento
// histórico local separadamente da data simbólica estadual — caso raro de um evento histórico
// gerar dois feriados diferentes (estadual E municipal) em datas diferentes. Canguaretama tinha
// todos os 5 candidatos pendentes já auto-rotulados no dataset comunitário com nome específico,
// aproveitados de uma vez. Restam pendentes ~100 candidatos de RN.
// ES terceira leva (mesma sessão): +54 promovidos, de todos os 78 candidatos restantes
// revisados de uma vez. MAIOR LOTE DE PROMOÇÕES DE UMA ÚNICA RODADA EM TODA A SESSÃO (supera o
// lote de 44 de MS). Achado: o TJES publica um PDF único "Feriados Municipais" cobrindo TODOS os
// municípios do ES numa única tabela (comarca, data, motivo, legislação) — mesmo padrão de fonte
// excepcional já visto com o Calendário Judicial do TJSE em Sergipe nesta sessão. A tentativa
// inicial via WebFetch falhou em extrair o texto do PDF (mesmo problema já visto com o TJSE); o
// PDF foi baixado localmente pelo WebFetch mesmo assim, e o Read direto no arquivo local
// funcionou perfeitamente — confirma que essa técnica (WebFetch falha → Read no PDF salvo
// localmente) é replicável e deve ser tentada sempre que uma fonte promissora falhar na extração
// via WebFetch. Cruzando os 78 candidatos pendentes contra a tabela completa: 54 bateram
// exatamente com o motivo e a data oficiais (aproveitamento de 69%), e os outros 24 NÃO bateram
// com nenhuma das datas realmente listadas para aquele município (alguns municípios sequer
// aparecem na tabela do TJES — Brejetuba, Irupi, Ponto Belo, São Roque do Canaã, Sooretama, Vila
// Pavão, Vila Valério — o que sugere que pertencem a uma comarca compartilhada não listada
// separadamente, ou que o PDF simplesmente não os cobre). Todos os 24 sem correspondência foram
// mantidos PENDENTES em vez de rejeitados, já que a ausência da comarca do PDF não é uma negação
// explícita — é só uma fonte que não cobre esses municípios especificamente. Achado interessante:
// Rio Novo do Sul tem 2 feriados-memorial por falecimento de figuras históricas locais (D.
// Angélica Miranda Paixão e Major Caetano Dias da Silva), mesma categoria rara já vista em
// Amarante/PI, Cocal/PI e Mirassol d'Oeste/MT. Também descoberto que São José do Calçado tem
// DOIS padroeiros distintos com feriados separados (São José em 19/03, já curado antes, e N.
// Sra. Imaculada Conceição em 08/12, agora promovida) — lição de não assumir que um único
// padroeiro esgota as datas religiosas de um município. Muqui 01/11 (\"Todos os Santos\")
// confirmado como feriado municipal genuíno, não redundante — 1º de novembro NÃO está na lista
// de feriados nacionais do Brasil (diferente de países católicos europeus). Restam pendentes
// ~24 candidatos de ES.
// ES segunda leva (mesma sessão): +10 promovidos, de mais ~15 candidatos revisados. Achado
// importante: o Tribunal de Justiça do Espírito Santo (TJES) mantém páginas institucionais POR
// MUNICÍPIO com os feriados municipais oficiais (ex.: tjes.jus.br/.../feriados-municipais/
// jeronimo-monteiro) — fonte muito forte, às vezes citando até o número da lei municipal (Lei
// 1.731/2019 em Jerônimo Monteiro, Lei 1.282/1993 em Muniz Freire). Usada também para EXCLUIR
// (não apenas confirmar): a listagem oficial de Atílio Vivácqua não incluía o candidato de 08/12
// entre os feriados municipais reais, então esse ficou pendente, enquanto o de 10/04 (que a
// listagem SIM confirma) foi promovido. Lista nomeada específica de ES para o cluster de 08/12
// (Serra, Viana, Guarapari, Castelo, Linhares) rendeu 1 confirmação nova (Castelo). Itapemirim e
// Domingos Martins tiveram todos os candidatos pendentes confirmados de uma vez via calendário
// oficial/câmara municipal. Restam pendentes ~78 candidatos de ES.
// ES (Espírito Santo) iniciado nesta sessão: 11 promovidos, 6 rejeitados, 1 cadastro direto
// ESTADUAL, de ~35 candidatos revisados (dos 105 pendentes). ACHADO DE MAIOR IMPACTO DESTA
// SESSÃO: descoberto que "Nossa Senhora da Penha" (padroeira do Espírito Santo) é feriado
// ESTADUAL em TODOS os municípios do ES desde a Lei Estadual nº 11.010/2019, que declara seu dia
// "Data Magna" do Estado — data MÓVEL (segunda-feira, 8 dias depois da Páscoa, regra
// "pascoa+8"), verificada numericamente batendo com reportagens de 2026 (Páscoa 05/04 + 8 =
// 13/04, confirmado como a data do feriado nesse ano). Cadastrado uma ÚNICA VEZ como estadual
// (abrangencia='uf', sem codigoIbge) — o resolver aplica automaticamente a todos os ~78
// municípios do ES, então qualquer candidato municipal futuro para "N. Sra. da Penha" deve ser
// REJEITADO por redundância (já feito para Viana nesta rodada). Diferente do padrão usual de
// "feriado nacional vazando pra fila municipal" (Corpus Christi, Sexta-feira Santa) — aqui é um
// feriado ESTADUAL específico de um único estado que a comunidade tinha capturado errado como
// pistas municipais individuais com datas fixas (que ficariam erradas em anos futuros, já que a
// data é móvel). Grande economia de esforço: uma pesquisa resolveu potencialmente ~78 candidatos
// futuros de uma vez, em vez de pesquisar cada município individualmente. Também descoberto:
// "Colonização do Solo Espírito-Santense" (23/05) é feriado municipal APENAS em Vila Velha — em
// outros municípios é no máximo ponto facultativo, e virar feriado estadual ainda está em
// tramitação na Assembleia Legislativa do ES (não aprovado) — candidato de Viana rejeitado.
// Restante do lote: aproveitamento alto de candidatos JÁ auto-rotulados no dataset comunitário
// (Itarana tinha os 3 candidatos com nome+data certos: São Sebastião, Emancipação, N. Sra.
// Auxiliadora; São Mateus e Viana também vinham quase todos rotulados) — 2 casos raros onde o
// próprio campo "nome" do candidato já cita a lei municipal com número e URL (Marataízes: Lei
// 48/1997 e Lei 334/2000, ambos "leismunicipa.is") — citação específica o bastante para promover
// direto. Padrão "padroeiro = data universal" confirmado 3x para Santo Antônio (13/06, em
// Atílio Vivácqua, Iconha e Rio Novo do Sul, todos já rotulados no próprio dataset). 4
// REJEIÇÕES adicionais por redundância com feriados nacionais (Corpus Christi e Sexta-feira
// Santa em São Mateus e Viana) — sexta e sétima instâncias desta sessão. Restam pendentes ~94
// candidatos de ES (havia 105, 1 tornou-se redundante pelo cadastro estadual de N. Sra. da
// Penha mas ainda não foi individualmente eliminado dos outros municípios).
// MS terceira leva (mesma sessão, continuação após "revisar" do usuário): +43 promovidos, 4
// rejeitados, de ~65 candidatos revisados. Maior lote de promoções em uma única rodada desta
// sessão inteira — o dataset comunitário de MS já tinha se mostrado mais confiável nas levas
// anteriores, e aqui o padrão se repetiu com força: praticamente toda prefeitura pequena de MS
// mantém uma página própria "Aniversário da Cidade" ou "Feriados Municipais" fácil de achar via
// busca, e a maioria dos municípios revisados tinha exatamente 2 feriados municipais (padroeiro
// + emancipação), o que tornou a pesquisa dupla eficiente por município. Achado recorrente:
// SETE casos de "aniversário celebrado ≠ feriado decretado" nesta única rodada (Bela Vista
// 20/07, Miranda 16/07, Nova Andradina 30/04, Paranaíba 04/07 — todos rejeitados — mais os já
// vistos em rodadas anteriores) — MS parece ter um padrão cultural forte de comemorar o
// aniversário histórico da cidade mesmo quando ele não é o feriado oficialmente decretado
// (que costuma ser a data da padroeira). Novo padrão de fonte usado com sucesso: o Tribunal de
// Justiça de MS (TJMS) mantém uma página institucional "Feriados" que confirma a EXISTÊNCIA de
// feriados municipais mesmo quando o motivo específico não é encontrado em nenhuma outra fonte
// (usado para promover Caarapó 26/12, Japorã 31/03, Juti 13/12 e 14/12) — aceito como fonte
// institucional válida mesmo sem motivo, diferente do padrão usual de exigir o "porquê". Padrão
// "nome do município = nome do santo" usado de novo com sucesso (Santa Rita do Pardo, Glória de
// Dourados, São Gabriel do Oeste, Aparecida do Taboado) — quando o nome do município já é uma
// homenagem ao santo/santa, a barra de evidência para aceitar a data universal cai bastante.
// Restam pendentes ~42 candidatos de MS.
// MS segunda leva (mesma sessão): +4 promovidos, cluster de 08/12. Descoberta importante e
// distinta de todos os outros clusters de 08/12 já vistos nesta sessão (PI, SE, MT): em MS o
// feriado de 08/12 não é genericamente "Nossa Senhora da Conceição/Imaculada Conceição" — é
// especificamente "Nossa Senhora de Caacupé", padroeira do PARAGUAI, celebrada por 9 municípios
// de MS na região de fronteira (forte influência cultural paraguaia). Uma lista nomeada do Campo
// Grande News (\"Feriado em MS: Nove Municípios Celebram Nossa Senhora de Caacupé\") nomeou
// exatamente os 9 municípios (Aquidauana, Dourados, Iguatemi, Miranda, Rio Brilhante, Ribas do
// Rio Pardo, Coronel Sapucaia, Sete Quedas, Porto Murtinho) — 4 desses batiam com candidatos
// pendentes (Coronel Sapucaia, Porto Murtinho, Ribas do Rio Pardo, Sete Quedas), promovidos de
// uma vez. Ao contrário dos clusters de PI/SE/MT, aqui a lista nomeada funcionou muito bem
// (mesmo padrão de sucesso já visto com o Calendário do TJSE em SE) — mostra que vale sempre
// tentar a lista nomeada primeiro quando o tema tem uma explicação regional específica (aqui,
// fronteira com o Paraguai) em vez de ser um padroeiro genérico espalhado pelo Brasil todo.
// Bela Vista, Paranhos, Tacuru e Vicentina (candidatos de 08/12 que NÃO estavam na lista dos 9)
// ficam pendentes — Vicentina em particular tem padroeira confirmada como N. Sra. Rainha dos
// Apóstolos, sem relação com 08/12.
// MS iniciado nesta sessão: 13 promovidos, 1 rejeitado, de 103 candidatos pendentes (revisados
// os primeiros ~30). Melhor aproveitamento da sessão até agora — o dataset comunitário de MS tem
// qualidade nitidamente superior: muitos candidatos já vêm auto-rotulados com nome específico do
// santo/motivo (não apenas "Feriado Municipal" genérico), e TODOS os 6 candidatos testados
// rotulados como "Aniversário"/"Aniversário da Cidade" (Água Clara, Bonito, Cassilândia,
// Maracaju, Ponta Porã, Três Lagoas) foram CONFIRMADOS com fonte forte (prefeitura, câmara
// municipal ou imprensa regional confirmando explicitamente \"é feriado municipal\") — ao
// contrário do padrão usual de MT/PI/AL onde \"aniversário\" costuma ser rejeitado por não ser
// feriado decretado. Lição: a confiabilidade da autodescrição do dataset varia MUITO por estado
// — vale a pena testar 1-2 candidatos rotulados \"Aniversário\" logo no início de cada estado
// novo para calibrar o quão bom é o dataset local antes de decidir a estratégia (aqui, valeu a
// pena confiar mais rápido). Caso raro: Corumbá teve candidato com descrição tão detalhada
// (\"fundação de Corumbá, ocorrida em 1.778 e por ordem do Capitão General Luiz de Albuquerque
// de Mello Pereira e Cáceres\") que a própria descrição do dataset foi tratada como citação
// primária o bastante para promover sem busca externa adicional — primeira vez nesta sessão que
// isso acontece. Também REJEITADO: Corumbá \"Sexta-feira da Paixão\" (quinta instância de feriado
// NACIONAL vazando pra fila municipal, mesmo com descrição detalhada do dataset). Restam
// pendentes ~90 candidatos de MS, incluindo um grande cluster de 12/08 (N. Sra. da Conceição,
// ~8 municípios) ainda não trabalhado.
// PA retomado: 6 promovidos, 1 rejeitado, de 63 candidatos revisados (46 municípios). Rendeu
// menos que MT/PI mas ainda positivo: Tucuruí 31/10 (Dia do Evangélico / Dia da Consciência
// Evangélica, lei da Câmara Municipal, evento "Marcha para Jesus" com 40 mil+ pessoas), São
// Domingos do Capim 08/08 (padroeiro São Domingos de Gusmão, fim da novena de 4 a 8/08 — mesmo
// padrão de Tomar do Geru/PI e Tomar do Geru/SE), Bragança 26/12 (padroeiro São Benedito, um dos
// 4 feriados oficiais da cidade), Alenquer 06/01 (Reis Magos/Epifania, um dos 4 feriados
// oficiais) e Almeirim 28/06 + 23/08 (padroeiro São Benedito e emancipação, ambos confirmados
// juntos pela mesma busca — raro conseguir os 2 candidatos de um município de uma vez só nesta
// rodada). REJEITADO: Alenquer 10/06 (aniversário, mas fonte nega explicitamente o status de
// feriado — mesmo padrão já visto muitas vezes). ACHADO IMPORTANTE (sem promoção, registrado
// para não repetir o erro): os 3 candidatos de Floresta do Araguaia vinham auto-rotulados no
// dataset comunitário com nomes específicos (\"Dia da Criação da Colônia\" 19/04, \"Dia do
// Evangélico\" 13/08, \"Dia da Padroeira - N. Sra. das Dores\" 15/09, esta última batendo com a
// data universal da santa) — o que normalmente seria evidência boa o bastante para promover por
// analogia ao padrão já usado com Querência/Vera/Nova Xavantina em MT. Mas uma busca específica
// revelou uma fonte que afirma textualmente que Floresta do Araguaia \"não tem atualmente nenhum
// feriado municipal\" e que o aniversário do município (21/04, não 19/04) \"ainda não é feriado
// municipal por falta de lei\" — contradição direta com a autodescrição do dataset. Mantidos os
// 3 candidatos PENDENTES em vez de promovidos por analogia, já que uma fonte específica que nega
// pesa mais que a autodescrição genérica do dataset comunitário sozinha. Lição: autodescrição do
// dataset é um bom sinal para buscar mais, mas não dispensa a checagem — mesmo quando o padrão
// (nome do santo bate com a data universal) parece óbvio. Restam pendentes ~56 candidatos de PA.
// MT retomado (rodada X): 11 promovidos, 4 rejeitados, 2 cadastros diretos, de 54 candidatos
// revisados (34 municípios). Achado de maior impacto metodológico desta rodada: TERCEIRA e
// QUARTA instância de "feriado que EXISTIU mas foi EXTINTO/REVOGADO por lei municipal posterior,
// substituído por outra data" — padrão novo, distinto de "aniversário nunca foi feriado"
// (Amarante/PI, Piripiri/PI, Quebrangulo/AL) e de "feriado nacional vazando pra fila municipal"
// (Parnaíba/PI, Aracaju/SE, e agora também Rondonópolis/MT Corpus Christi + Mirassol d'Oeste/MT
// Sexta-feira Santa, ambos rejeitados aqui): Santa Rita do Trivelato (25/09 revogado por
// decisão da própria prefeitura, substituído por 28/12) e Aripuanã (26/07 extinto por lei da
// câmara municipal em 2013, substituído por 31/12) — em ambos os casos, o candidato antigo foi
// REJEITADO com a fonte que confirma a revogação, e a data NOVA (sem candidato correspondente
// na fila, já que o dataset comunitário é uma foto antiga) foi criada via criar_direto. Lição:
// quando uma busca revela "o feriado MUDOU de data", sempre isso é meio caminho andado para
// resolver DOIS itens de uma vez (rejeitar o antigo + criar_direto o novo), não só um. Também
// bom aproveitamento de candidatos já auto-rotulados no dataset comunitário com nome específico
// (Querência N. Sra. Imaculada Conceição, Vera São Judas Tadeu, Nova Xavantina N. Sra. das
// Graças, Sapezal Dia da Padroeira/Fundação) — quando a descrição original já nomeia o santo/
// motivo e a data bate com o padrão universal, a barra de evidência para promover é mais baixa
// (a autodescrição do dataset conta como uma fonte, mesmo não sendo primária). Confirmado mais
// um feriado-memorial (categoria rara: Mirassol d'Oeste, morte do Padre Thiago Cheza em 1982,
// confirmado pelo próprio portal da prefeitura) e mais um caso de "Dia do Evangélico" com data
// FIXA em vez de regra móvel (Aripuanã 31/10, diferente de Confresa/Gurupi/Uruçuí). Restam
// pendentes ~43 candidatos de MT.
// SE quinta rodada: 4 promovidos, 2 rejeitados, 2 cadastros diretos, de 48 candidatos revisados
// (36 municípios). Retomando os dois grandes clusters (06/24 São João Batista e 06/29 São Pedro)
// cujas listas nomeadas usadas antes tinham zero overlap: confirmação por paróquia individual
// (Arquidiocese de Aracaju tem página própria por paróquia, muito útil) rendeu só 1 caso claro
// no cluster de 06/24 (Areia Branca) e 0 no de 06/29 — a maioria dos municípios pesquisados
// tinha padroeiro CONFIRMADO mas de outro santo (Moita Bonita: N. Sra. da Conceição; Salgado:
// sem info; Poço Verde: São Sebastião, já promovido em outra data; Itaporanga d'Ajuda: N. Sra.
// d'Ajuda, já promovida em outra data; Nossa Senhora de Lourdes: já promovida em 11/02; Pinhão:
// São José, 19/03, não bate com nenhum dos 5 candidatos do município) — confirma que esses
// clusters de SE são mais resistentes que os de outros estados, provavelmente porque municípios
// pequenos do interior sergipano têm padroeiros menos padronizados que se pensava. Tomar do Geru
// 09/08 foi a exceção boa: padroeira N. Sra. do Socorro com festa de 30/08 a 08/09, culminando
// exatamente na data do candidato (achado usando o padrão "fim da novena = data do feriado", já
// visto em Tomar do Geru/PI). Dois REJEITADOS com fonte que nega explicitamente: Aracaju Corpus
// Christi (segunda instância nesta sessão de feriado NACIONAL vazando pra fila municipal, mesmo
// padrão de Parnaíba/PI) e Pirambu 08/08 ("Dia do Pirambuense" — reportagem específica diz
// textualmente que a proposta é reconhecer como marco cultural, "não como mais um feriado", e
// que até 2011 a cidade tratava erroneamente essa data como emancipação política). Dois
// CADASTROS DIRETOS: Japoatã 21/11 (padroeira) e 23/11 (emancipação), ambos confirmados pelo
// Calendário Judicial do TJSE e por matéria da Assembleia Legislativa de SE, mas sem candidato
// correspondente na fila (os 2 candidatos pendentes de Japoatã, 02/06 e 25/11, são datas
// diferentes sem confirmação). São Domingos 07/04 e Feira Nova 14/08 (memorial de ex-prefeito,
// mesma categoria rara de Amarante/PI e Cocal/PI) completam o lote. Restam pendentes ~42
// candidatos de SE, incluindo a maior parte dos clusters de 06/24 e 06/29 ainda sem confirmação.
// PI quarta rodada: 12 promovidos, 5 rejeitados, de 47 candidatos revisados (32 municípios) —
// maior lote de rejeições justificadas desta sessão. Achados principais: (1) cluster de 10
// candidatos de 08/12 (Nossa Senhora da Conceição): a lista nomeada da CNBB Regional Nordeste 4
// (18 municípios do PI com essa padroeira) teve ZERO sobreposição com os candidatos pendentes —
// mas busca de paróquia individual encontrou 1 confirmação que a lista nomeada não pegou
// (Angical do Piauí, Igreja Matriz de N. Sra. da Conceição) — lição: lista nomeada e busca
// individual são técnicas complementares, uma não substitui a outra. (2) DOIS casos de fonte
// que NEGA explicitamente o status de feriado de uma data historicamente importante: Campo
// Maior 13/03 (Batalha do Jenipapo — CNN Brasil explica que Lei Federal nº 9.093/1995 barra a
// criação do feriado; Piauí usa 19/10 para esse fim) e Piripiri 04/07 (aniversário/emancipação,
// mas fonte confirma que não está entre os 2 feriados municipais decretados) — mesmo padrão de
// Amarante 04/08 (também rejeitado nesta rodada). (3) DOIS candidatos municipais que eram na
// verdade duplicatas de feriados NACIONAIS já calculados pelo motor (Parnaíba: Sexta-feira Santa
// e Corpus Christi) — rejeitados por redundância, não por falta de fonte; é a primeira vez nesta
// sessão que um feriado NACIONAL (não estadual) vaza para a fila de candidatos municipais.
// (4) Dois feriados por tragédia/acidente confirmados com fonte específica: Amarante 23/03
// (acidente na BR-343, 2002, 9 professores + 1 motorista) e Cocal 27/05 (rompimento da Barragem
// de Algodões, 2009) — categoria de feriado municipal rara nesta sessão (memorial de tragédia,
// não padroeiro nem emancipação). (5) Padrão robusto de emancipação política via prefeitura
// oficial continua rendendo: José de Freitas 07/04, São João do Piauí 07/05, Jaicós 02/21,
// Pedro II 08/11, São Raimundo Nonato 06/25 — todos confirmados diretamente pelo portal oficial
// da prefeitura ou da Assembleia Legislativa do Piauí. (6) Regeneração 01/10 (padroeiro São
// Gonçalo) e Luzilândia 12/13 (padroeira Santa Luzia) seguem o padrão "padroeiro = data
// universal do santo". (7) Oeiras 01/24: caso raro de feriado histórico-cívico municipal (adesão
// do Piauí à Independência, ocorrida na própria cidade em 1823) decretado anualmente pelo
// prefeito, confirmado pelo próprio portal da prefeitura. (8) Confirmada mais uma instância do
// padrão de schema-limitação (Uruçuí, "Dia do Evangélico" na última sexta-feira de maio, Lei
// Municipal nº 625/2013 — real mas com data variável ano a ano, mesmo padrão de Gurupi/TO,
// Confresa/MT, Maringá/PR já visto) — mantido pendente, não promovido com data fixa errada.
// (9) São Pedro do Piauí 29/06: quase promovido por engano usando o padrão "padroeiro = data
// universal" (São Pedro = 29/06), mas o cabeçalho desta mesma rodada 2 já registrava que esse
// candidato especificamente foi investigado e é apenas o fim do festejo/novena, NÃO o feriado
// decretado (que é 21/06, já promovido antes) — lição: sempre conferir se um candidato específico
// já foi resolvido/descartado em rodada anterior antes de aplicar um padrão geral por analogia.
// Restam pendentes ~30 candidatos de PI.
// AL terceira rodada: 7 promovidos, 1 rejeitado, de 17 candidatos revisados (13 municípios).
// Bom aproveitamento com técnica de paróquia+diocese (Diocese de Palmeira dos Índios cobre boa
// parte do agreste alagoano onde ficam vários destes municípios): Arapiraca 10/30 (Emancipação
// Política, Lei Municipal nº 2.036/99, confirmada pelo calendário oficial da JFAL — Justiça
// Federal em Alagoas, que é uma fonte quase-primária por ser orgão público que literalmente
// fecha expediente na data); Lagoa da Canoa 08/14 (padroeiro São Maximiliano Kolbe, data
// universal do seu martírio, distinta da fundação em 28/08); Poço das Trincheiras 01/20 (dupla
// comemoração Emancipação + padroeiro São Sebastião, confirmada por SECULT-AL e pelo blog da
// Diocese de Palmeira dos Índios); São José da Laje 07/28 (Emancipação Política, Lei nº 896 de
// 28/07/1886); Taquarana 05/03 (padroeira Santa Cruz, confirmada por publicação oficial da
// própria Câmara Municipal de Taquarana — fonte primária, incomum ter tanta precisão);
// Matriz de Camaragibe 05/24 e 12/13 (dois candidatos do mesmo município, ambos confirmados:
// Nossa Senhora Auxiliadora/Patrimônio do Bom Jesus e padroeira Santa Luzia, respectivamente —
// a prefeitura mantém uma página oficial "Feriados Municipais" listando exatamente 3 feriados
// municipais no calendário, o que ajudou a validar que ambas as datas são reais). REJEITADO:
// Quebrangulo 03/16 — mesmo padrão "aniversário celebrado ≠ feriado decretado" já visto
// repetidas vezes: uma fonte confirma explicitamente que o aniversário da cidade NÃO está entre
// os 3 feriados municipais decretados, e o padroeiro confirmado (Bom Jesus dos Pobres) não tem
// relação com essa data. PENDENTES (9): Campo Grande 06/01 (lei de criação é 31/05/1960,
// instalação 14/08/1960 — nenhuma bate exatamente com 01/06), Major Isidoro 06/01 (feriados
// confirmados são 13/06 padroeiro e 17/09 emancipação — 01/06 não bate com nada, mesmo padrão
// de "aniversário/data não-oficial" já visto antes para este município), Maravilha 12/07
// (padroeira Imaculada Conceição confirmada em 12/08, um dia depois da data do candidato — não
// arrisco assumir "véspera"), Piranhas 03/22 (padroeira Nossa Senhora da Saúde parece ser
// celebrada em setembro, não bate com março), Porto Calvo 07/22 (padroeira é Nossa Senhora da
// Apresentação, com festa em 21/11 — não Santa Madalena como o nome do rio sugeriria, e não bate
// com 22/07), Quebrangulo 09/27 (mesma pesquisa do candidato rejeitado — padroeiro Bom Jesus dos
// Pobres não bate com essa data, apesar de 27/09 ser a data histórica pré-1969 de Cosme e
// Damião), São José da Laje 01/06 (Festa dos Santos Reis instituída pela Lei nº 295/1953, mas há
// indício de legislação posterior revogando o feriado — status atual incerto, não promovo sem
// confirmar), São José da Tapera 09/15 (nenhuma fonte revelou motivo — aniversário confirmado é
// 24/12, distinto), Traipu 12/18 (emancipação real é 16/05, sem padroeiro identificado para
// 18/12). Restam pendentes ~9 candidatos de AL (dos 17 revisados nesta rodada; havia mais 0 já
// pendentes de rodadas anteriores neste ciclo de retomada).
// TO segunda rodada (após a de 11 promovidos/1 rejeitado já registrada acima): 1 promovido, 0
// rejeitados, de 15 candidatos revisados. Baixo aproveitamento apesar de pesquisa extensa —
// achado principal: descobri e usei pela primeira vez as páginas de diocese que listam a
// paróquia exata de cada município (Diocese de Cristalândia e Diocese de Porto Nacional cobrem
// o sul do Tocantins) — uma fonte nova e valiosa para o padrão "padroeiro = data universal do
// santo", só que desta vez ela DESCARTOU hipóteses em vez de confirmá-las: Araguaçu 12/08
// promovido (paróquia Nossa Senhora Imaculada Conceição, confirmada por Diocese de Cristalândia
// + gcatholic.org, data universal 08/12 bate exatamente). Mas Arraias 01/20 e Silvanópolis
// 01/20 (ambos candidatos a São Sebastião por coincidência de data comum) foram REFUTADOS pela
// mesma fonte: a paróquia de Arraias é Nossa Senhora dos Remédios (não São Sebastião) e a de
// Silvanópolis é Sant'Ana (não São Sebastião) — nenhuma bate com 20/01. Além disso, uma busca
// anterior havia "confirmado" via resumo que Arraias e Silvanópolis apareciam numa lista
// nomeada de cidades com feriado em 20/01 — ao abrir os dois artigos originais (istoedinheiro e
// brasilturis) diretamente, NENHUM dos dois sequer menciona uma cidade do Tocantins: outra
// fabricação de resumo de busca, mesmo padrão de erro já visto na terceira rodada de SE, pego
// aqui ANTES de promover (não depois). Almas (3 candidatos: 05/17, 05/18, 12/10) tem padroeiro
// confirmado São Miguel Arcanjo (29/09, paróquia "São Miguel e Almas") — não bate com nenhuma
// das 3 datas, ficam pendentes. Fátima 12/21: padroeira N. Sra. de Fátima com festa em 13/05 e
// 13/10 (data dupla, comum para Fátima devido às aparições de Fátima-Portugal), nenhuma bate
// com 21/12. Colinas do Tocantins 10/31 ("Dia do Evangélico"): pesquisa revelou que o evangélico
// estadual no Tocantins é oficialmente 25/04 e o nacional é 30/11 — e uma celebração
// especificamente noticiada em Colinas foi em 14/12/2024, não 31/10 — a hipótese de 31/10 fica
// mais fraca ainda do que apenas "sem lei", parece ser um erro do próprio dataset de origem.
// Miracema do Tocantins 06/25: emancipação real é 25 de AGOSTO (não junho) e padroeira Santa
// Terezinha é 01/10 — 25/06 não bate com nada identificado. Natividade 08/16: padroeira do
// ESTADO (Nossa Senhora da Natividade) tem feriado estadual em 08/09, não 16/08, e não achei
// data de emancipação exata do município. Codajás [já tratado na rodada anterior de AM, não
// aplicável aqui]. Palmeirópolis 11/27, Colméia 08/06 e 12/26, Tocantinópolis 07/07 (que já tem
// emancipação curada em 28/07): nenhuma busca (geral, diocesana, ou de aniversário) revelou
// motivo para essas datas específicas. Restam pendentes 14 candidatos de TO.
// AM rodada final (retomada após pausa por limite de uso): 3 promovidos, 0 rejeitados. Dos 7
// candidatos que restavam em AM, 3 tinham evidência específica o bastante: Apuí 12/30
// (emancipação, Lei Estadual nº 1.826/1987, confirmada por AAM + agregador de aniversários),
// Borba 06/01 (padroeiro Santo Antônio — a "Alvorada de Santo Antônio" na virada de 31/05 para
// 01/06 é tradição de 1756, e a festa é Patrimônio Cultural Imaterial do AM pela Lei Estadual
// nº 5.975/2022) e Tapauá 05/22 (padroeira Santa Rita de Cássia, confirmada pela Wikipédia
// independentemente da lista de feriados usada pela Febraban). Os outros 4 seguem PENDENTES,
// sem evidência específica o bastante para a data exata do candidato: 8880 Tabatinga 09/29
// (padroeiro incerto — colonização ligada a São Francisco Xavier, não a São Miguel Arcanjo),
// 8846 Humaitá 10/31 ("Dia do Evangélico" confirmado por vários agregadores nacionais, mas sem
// lei municipal específica encontrada — mesmo padrão de Manicoré), 8841 Codajás 11/28 (nem o
// "Ato de Criação" via IDAM [01/05/1874 ou 02/08/1894, fontes divergem] nem a data de aniversário
// da AAM [31/03] nem a festa da padroeira Nossa Senhora das Graças [22 a 31/05] batem com a
// data), 8825 Barcelos 08/07 (aniversário oficial é 06/05, decretado em 1977; agregadores
// listam 08/07 como segundo "feriado municipal" sem motivo declarado, e nenhuma busca revelou
// padroeiro ou lei específica para essa segunda data). Amazonas está, portanto, encerrado nesta
// rodada: 4 candidatos permanecem genuinamente sem fonte suficiente, mas não há mais trabalho
// de pesquisa óbvio a fazer sem uma fonte nova (ex.: Diário Oficial dos Municípios do Amazonas,
// se existir um agregador confiável).
const DECISOES: Decisao[] = [];
function main() {
  for (const d of [...DECISOES2, ...DECISOES]) {
    if (d.acao === "criar_direto") {
      const id = criarFeriadoCurado({
        nome: d.nome,
        tipoChave: d.tipoChave,
        abrangencia: d.abrangencia,
        uf: d.uf,
        codigoIbge: d.codigoIbge,
        mes: d.mes ?? null,
        dia: d.dia ?? null,
        regraCalculo: d.regraCalculo ?? null,
        anoInicio: null,
        anoFim: null,
        autor: d.autor,
        dataVerificacao: d.dataVerificacao,
        observacao: d.observacao,
        fonte: d.fonte,
      });
      console.log(`✔ cadastro direto -> feriado #${id} (${d.nome})`);
      continue;
    }

    const candidato = buscarCandidatoPorId(d.candidatoId);
    if (!candidato) {
      console.log(`✗ candidato ${d.candidatoId} não encontrado, pulando.`);
      continue;
    }

    if (d.acao === "promover") {
      const id = criarFeriadoCurado({
        nome: d.nome,
        tipoChave: d.tipoChave,
        abrangencia: candidato.codigoIbge ? "municipio" : "uf",
        uf: candidato.uf,
        codigoIbge: candidato.codigoIbge,
        mes: d.mes ?? null,
        dia: d.dia ?? null,
        regraCalculo: d.regraCalculo ?? null,
        anoInicio: null,
        anoFim: null,
        autor: d.autor,
        dataVerificacao: d.dataVerificacao,
        observacao: d.observacao,
        fonte: d.fonte,
      });
      marcarStatusCandidato(d.candidatoId, "promovido");
      console.log(`✔ candidato ${d.candidatoId} promovido -> feriado #${id} (${d.nome})`);
    } else {
      marcarStatusCandidato(d.candidatoId, "rejeitado");
      console.log(`✗ candidato ${d.candidatoId} rejeitado: ${d.motivo}`);
    }
  }
}

main();
sqlite.close();
