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
const DECISOES2: Decisao[] = [
];
// Permanecem PENDENTES no AM (sem evidência suficiente para promover, nem
// contrária o bastante para rejeitar — não incluídos em DECISOES2):
// 8880 Tabatinga 09/29 (padroeiro incerto — colonização ligada a São
// Francisco Xavier, não a São Miguel Arcanjo), 8846 Humaitá 10/31 ("Dia do
// Evangélico" confirmado por agregadores e por padrão regional similar em
// Manicoré, mas sem lei municipal específica encontrada), 8841 Codajás
// 11/28 (nem aniversário [31/03] nem emancipação [02/08/1894] batem com a
// data, sem padroeiro identificado), 8881 Tapauá 05/22 (só agregadores
// genéricos, emancipação é 19/12/1955), 8830 Borba 06/01 (aniversário é
// 26/09, sem padroeiro identificado), 8825 Barcelos 08/07 (aniversário é
// 06/05 e não é feriado, sem padroeiro identificado).
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
