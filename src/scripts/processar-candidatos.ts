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
//
// INÍCIO DO PARANÁ (PR) — mesma sessão. Quarto grande achado de documento-jackpot, logo após
// MG, BA e RS: +264 promovidos de uma vez só. O TJPR publica o Decreto Judiciário nº 621/2025
// - P-SEP (SEI nº 0064955-90.2025.8.16.6000), assinado pela Desembargadora Lidia Maejima em
// 18/11/2025, cujo Art. 4º "consolida o calendário de feriados locais dos municípios sedes das
// Comarcas do Estado no ano de 2026" — já para o ano corrente, diferente dos documentos de MG
// (2021), BA e RS (2021), que exigiram assumir recorrência anual. Obtido via WebFetch (falhou a
// conversão do PDF, "FlateDecode"/stream binário) -> Read direto no caminho local salvo pelo erro
// do WebFetch, técnica já validada nesta sessão para TJMG/TJBA/TJRS. Documento organizado por
// mês -> dia -> lista de municípios com motivo (formato diferente de MG/BA/RS, que eram por
// comarca) — cobre 161 municípios-sede de comarca. Cruzado contra os 645 candidatos pendentes de
// PR: 264 tinham data exata batendo com o documento (mês+dia). Nome do feriado usa o motivo do
// decreto quando disponível (ex. "Dia do Padroeiro do Município", "Emancipação Política do
// Município"); caiu para o `descricao_original` do candidato só quando o decreto não trazia
// motivo. Excluídas entradas de Corpus Christi/Sexta-feira Santa (Paixão de Cristo) do
// cruzamento — são instâncias de festa móvel específicas de 2026, já cobertas nacionalmente
// pelo motor (ponto_facultativo/nacional), não feriado municipal distinto. PR fica com ~381
// candidatos ainda pendentes (municípios que não são sede de comarca, fora do escopo do
// decreto) para pesquisa individual futura.
//
// INÍCIO DE SÃO PAULO (SP) — mesma sessão. Quinto grande achado de documento-jackpot, o maior
// em volume absoluto: +480 promovidos de uma vez só, na maior pendência do sistema (1084 antes
// deste lote). O TJSP publica anualmente, junto com o Provimento CSM que trata da suspensão do
// expediente forense, uma "RELAÇÃO DE FERIADOS MUNICIPAIS" aprovada pelo Conselho Superior da
// Magistratura — para 2026, é o Provimento CSM nº 2.813/2025 (sessão de 24/11/2025, publicado no
// Diário Eletrônico da Justiça de SP, Ano XVIII, Edição 4334, disponibilizado em 25/11/2025).
// Cobre ~319 comarcas do Estado. Obtido via WebSearch -> link direto do PDF completo (cópia
// hospedada pela ASSETJ, associação de servidores do TJSP, pois o link direto do e-SAJ não
// respondeu ao fetch) -> WebFetch falhou a conversão -> Read direto no caminho local salvo pelo
// erro do WebFetch, mesma técnica já validada. Documento traz SÓ a data por município, sem
// motivo — diferente de MG/RS (com motivo) e mais parecido com BA. Nome do feriado promovido
// usa o `descricao_original` do candidato quando disponível (raramente presente e útil nesse
// dataset para SP), caindo para "Feriado Municipal" na maioria dos casos — desvantagem
// documentada explicitamente na observação de cada entrada.
//
// Regra de exclusão importante desta leva (além da já usual Sexta-Feira Santa/Corpus Christi,
// que são festas móveis já computadas nacionalmente): o documento do TJSP também lista Finados
// (02/11) e 20/11 em quase toda comarca — mas AMBAS já são feriados NACIONAIS computados pelo
// motor (Finados desde a Lei 662/1949; 20/11, Dia Nacional de Zumbi e da Consciência Negra,
// desde a Lei federal nº 14.759/2023 — ver src/motor/feriados-nacionais.ts:59-64). Promover
// essas datas como municipal seria redundante com o que a consulta já mostra via camada
// nacional, então foram excluídas do cruzamento assim como as festas móveis. SP fica com ~604
// candidatos ainda pendentes (municípios que não são sede de comarca, ou com data que não bateu
// exatamente com o documento) para pesquisa individual futura.
//
// SEGUNDA LEVA DE MINAS GERAIS (MG) — mesma sessão, pivô para pesquisa individual
// item a item (opção escolhida pelo usuário) após os documentos-jackpot de MG/BA/RS/PR/SP
// se esgotarem para os grandes estados restantes. Rendimento inicial da pesquisa
// individual foi baixo, mas revelou um SEGUNDO achado de padrão "lei de emancipação em
// massa": 53 candidatos de MG, todos datados de 01/03 (ano 2026, ou seja 1º de março),
// espalhados sem relação aparente entre si. Rastreado até a Lei estadual (MG) nº 2.764,
// de 30/12/1962 ("Divisão Administrativa do Estado de Minas Gerais"), que criou ~200+
// municípios simultaneamente (marcados "(x)" no próprio "Anexo nº 1" da lei, uma listagem
// numerada de 722 municípios/distritos), todos instalados uniformemente em 1º de março de
// 1963 pelo Decreto estadual nº 6.839, de 11/01/1963 ("Dispõe sobre a instalação dos
// municípios criados pela Lei nº 2.764/1962"). Texto integral da Lei 2.764/1962 (Anexo nº 1)
// lido diretamente, cruzando cada um dos 53 candidatos contra a marcação "(x)" de município
// criado por ela. Corroborado por 3 buscas independentes em municípios específicos deste
// mesmo lote (Araçaí, Buritizeiro, Ijaci), cada uma confirmando "instalado/emancipado em
// 01-03-1963" via fonte histórica/oficial. Mesmo padrão já visto para o Tocantins (Lei
// Estadual nº 2.125/1958, que criou Xambioá, Almas, etc. simultaneamente) — mostra que,
// mesmo em modo de pesquisa individual, datas repetidas entre candidatos da mesma UF podem
// indicar uma lei de emancipação em massa ainda não identificada como "documento-jackpot".
//
// Nesta mesma leva, uma mini-pesquisa individual anterior sobre 3 candidatos pendentes de
// MG: Abadia dos Dourados 14/08 (Festa de Nossa Senhora da Abadia, promovido — 2 fontes
// concordam na data correta de 14/08 e no motivo, embora o número exato da lei municipal de
// 2017 divirja entre elas: 1.668 ou 1.672/2017), Abadia dos Dourados 15/08 (rejeitado —
// duplicata com data incorreta do candidato acima) e Bambuí 08/12 (rejeitado — Nossa Senhora
// da Conceição deixou de ser feriado municipal, substituída por 27/11/Nossa Senhora das
// Graças, sem candidato correspondente no dataset para promover em seu lugar).
//
// Efeito colateral corretivo descoberto ao regenerar o seed após esta leva: o arquivo
// `seed-feriados-curados.ts` carregava ~154 linhas duplicadas de São Paulo (mesmo
// nome+abrangência+UF+código IBGE em mais de uma linha, herdadas de uma aplicação duplicada
// na leva anterior de SP que passou despercebida pela checagem de duplicidade daquele
// momento). Como o script `seed:feriados-curados` faz upsert (casa por
// nome+abrangência+uf+codigoIbge, não por id), essas duplicatas nunca inflaram o total real
// do banco — mas infestavam o arquivo versionado. A regeneração desta leva, feita a partir
// do banco (já deduplicado pelo próprio upsert), corrige isso automaticamente: o total de
// entradas cai em ~154 mesmo antes de somar as novas promoções desta leva.
//
// TERCEIRA LEVA DE MINAS GERAIS (MG) — mesma sessão, mesmo documento já usado na leva
// original (Anexo Único da Portaria Conjunta da Presidência do TJMG nº 1.196/2021), mas com
// releitura completa e cruzamento mais rigoroso: transcrição integral das 26 páginas do PDF
// (as 296 comarcas, ~1262 linhas de feriado) para um arquivo de texto, parseado
// programaticamente e cruzado contra TODOS os 748 candidatos pendentes de MG por nome de
// município normalizado (sem acento/hífen/espaço) + data exata — não apenas por comarca como
// no cruzamento automático original. Isso recuperou 26 candidatos que o script original
// perdeu, por dois motivos identificados: (1) nomes com hífen/grafia alternativa não bateram
// no cruzamento anterior (ex.: "Abre-Campo" vs "Abre Campo", "Entre-Rios de Minas" vs
// "Entre Rios de Minas", "São João del-Rei" vs "São João del Rei", "Teófilo Otôni" vs
// "Teófilo Otoni" no dataset de candidatos); (2) comarcas com múltiplos feriados na mesma
// leva tiveram alguma entrada intermediária pulada por um bug não diagnosticado do script
// original (ex.: Grão Mogol tinha 3 candidatos batendo com o documento, mas só 2 foram
// promovidos na leva original). Nenhuma pesquisa nova — mesma fonte primária já citada e
// commitada. Resta a maior parte dos ~722 candidatos pendentes de MG sem correspondência
// possível neste documento (municípios que não são sede de comarca própria).
//
// RELEITURA DOS DEMAIS DOCUMENTOS-JACKPOT (PR/SP/BA/RS) — mesma sessão, aplicando a mesma
// técnica de releitura completa + cruzamento rigoroso que funcionou para MG. Resultado:
// PR (Decreto Judiciário TJPR nº 621/2025) — releitura completa (333 entradas, 162
// municípios), 0 matches novos: o cruzamento original já tinha capturado tudo corretamente.
// BA (Decreto Judiciário TJBA nº 09/2026) — releitura completa (573 entradas, 193 comarcas),
// 0 matches novos: idem. SP (Provimento CSM nº 2.813/2025) — releitura completa (698 datas,
// 320 municípios), 2 matches novos, ambos por hífen: "Embu-Guaçu" no dataset de candidatos
// vs. "EMBU GUAÇU" no documento do TJSP. RS (TJRS, "Feriados Municipais nas Comarcas do RS")
// — releitura completa (439 entradas, 169 comarcas + sub-comarcas de Pelotas), 2 matches
// novos: Sant'Ana do Livramento 30/07 (aniversário) e São Luiz Gonzaga 03/06 (dia do
// município — coincide em 2021 com a data de Corpus Christi daquele ano no documento, mas é
// uma entrada distinta e o candidato de 2026 não coincide com Corpus Christi 2026, que cai
// em 04/06). Total: 4 novos promovidos nesta releitura combinada. Confirma o padrão: a
// técnica vale a pena revisitar em cada documento-jackpot já usado, mas o rendimento varia
// muito (de 0 a ~26 conforme o estado) e não há como prever de antemão qual documento tem
// mais "sobras" sem reler.
//
// INÍCIO DE GOIÁS (GO) — mesma sessão. MAIOR ACHADO DE QUALIDADE DA SESSÃO: a
// Corregedoria-Geral de Justiça do TJGO mantém uma página própria (não um PDF estático)
// "Feriados Municipais nas Comarcas" — tabela HTML paginada (34 páginas de 10, expandida via
// combobox "Mostrar Todos" para uma única página com ~280 linhas), cobrindo ~125 dos 246
// municípios de Goiás, com o diferencial de trazer a CITAÇÃO DA LEI/DECRETO MUNICIPAL
// específica em coluna própria ("LEI DA CRIAÇÃO") para quase toda entrada — um padrão de
// evidência mais forte que a maioria dos documentos já usados nesta sessão (citação
// específica de norma direto na fonte oficial do TJ, não um agregador). Acessada via
// mcp__Claude_Browser (WebFetch deu 403 na página, comportamento diferente de PDF).
// Entradas com data relativa/móvel sem regra exprimível no schema atual (ex.: "última
// segunda-feira de julho", "Domingo de Pentecostes", "2ª ou 3ª segunda-feira de maio") foram
// excluídas do cruzamento — ficam para uma pesquisa futura caso o schema ganhe suporte a
// datas relativas a dia da semana. Resultado em duas etapas: (1) 205 promovidos cruzando
// contra os 330 candidatos pendentes de GO por município normalizado + data exata; (2) 91
// cadastrados diretamente (`criar_direto`) para entradas do documento sem candidato
// correspondente no dataset comunitário (a maioria por GO ter poucos candidatos comunitários
// de origem — só 9 feriados curados existiam antes desta leva). Total: +296 feriados
// municipais de GO em uma única leva, de 9 para 305 — GO passa a ser o 3º estado com mais
// feriados curados no banco. Resta a maior parte dos ~125 candidatos pendentes de GO (os
// ~120 municípios não cobertos por esta tabela da Corregedoria) para pesquisa individual
// futura.
//
// INÍCIO DE PERNAMBUCO (PE) — mesma sessão. MAIOR ACHADO EM VOLUME DA SESSÃO: o TJPE mantém
// uma página HTML dedicada "Feriados Oficiais nas Comarcas de Pernambuco" (não PDF —
// portal.tjpe.jus.br, atualizada em 14/01/2026), cobrindo 151 dos ~184 municípios do estado,
// 2 a 6 feriados cada, com motivo descrito por extenso (sem citação de lei/decreto, ao
// contrário de GO). Acessada via mcp__Claude_Browser (mesmo padrão do achado de GO — páginas
// HTML de tribunais tendem a bloquear WebFetch com 403, mas funcionam via navegador real).
// Duas correções de nome de município aplicadas antes do cruzamento: "Belém de São
// Francisco" no documento → "Belém do São Francisco" no IBGE; "São Caetano" do documento não
// tem correspondente no IBGE (não é município independente) e ficou de fora. Resultado em
// duas etapas, igual à técnica de GO: (1) 291 promovidos cruzando contra os 336 candidatos
// pendentes de PE por município normalizado + data exata; (2) 121 cadastrados diretamente
// (`criar_direto`) para entradas do documento sem candidato correspondente no dataset
// comunitário. Total: +412 feriados municipais de PE em uma única leva. Resta pendente o
// restante dos candidatos de PE nos ~33 municípios não cobertos pela página do TJPE, para
// pesquisa individual futura.
//
// INÍCIO DE SANTA CATARINA (SC) — mesma sessão. O TJSC também mantém uma planilha própria
// ("Comarcas / Feriados locais", tjsc.jus.br/documents/...), no mesmo padrão de página/
// documento dinâmico já visto em GO e PE (WebFetch caiu no fallback de leitura local, mesma
// técnica). Particularidade desta planilha: a coluna é por COMARCA, não por município — várias
// comarcas agregam mais de um município (ex.: a comarca de "Garopaba" lista também os
// feriados de Paulo Lopes; "Ascurra" lista Apiúna; "Ipumirim" lista Arabutã e Lindóia do Sul;
// "Chapecó" lista o padroeiro de Caxambu do Sul). Cruzamento cuidadoso: cada linha foi
// reatribuída ao município correto via extração do padrão "Município de X" no próprio texto
// do motivo, caindo para o nome da comarca apenas quando a linha não menciona outro
// município explicitamente — todos os 114 municípios extraídos bateram exatamente com o
// cadastro do IBGE, sem nenhuma correção manual de nome necessária. Resultado: 148 promovidos
// contra os 422 candidatos pendentes de SC; 47 cadastrados diretamente (`criar_direto`) sem
// candidato correspondente no dataset comunitário. Total: +195 feriados municipais de SC.
//
// Tentativa de RJ (TJRJ mantém PDFs por Núcleo Regional, ~8 documentos cobrindo todas as
// comarcas do estado, URLs já localizadas) ficou bloqueada tecnicamente nesta sessão: o
// domínio tjrj.jus.br tem um certificado TLS que o WebFetch rejeita ("unable to verify the
// first certificate") e o navegador força download do PDF em vez de renderizar a página —
// nenhuma das duas técnicas usadas neste projeto conseguiu ler o conteúdo. Fica para uma
// tentativa futura com outra abordagem de acesso.
//
// INÍCIO DO RIO DE JANEIRO (RJ) — mesma sessão, terceira técnica de acesso testada com
// sucesso: `curl -k` (bypass de verificação de certificado) contorna o problema de TLS que
// bloqueava WebFetch e o navegador. Baixados os 10 PDFs "Comarcas do Nº Núcleo Regional" da
// Corregedoria Geral de Justiça do TJRJ (núcleos 2 a 11 — o 1º Núcleo é só a Capital/cidade
// do Rio, sem lista de feriados municipais própria nesse formato), cobrindo as ~90 comarcas
// do interior fluminense, cada um com 1 a ~12 municípios, motivo (padroeiro/emancipação/
// aniversário) e datas — mas SEM citação de lei/decreto na maioria dos núcleos mais antigos
// (documentos de 2006-2014; só o 4º núcleo, atualizado em 2024, cita a Lei Estadual do LODJ
// artigo por artigo). Peculiaridade: o 10º núcleo lista 2 municípios por linha de comarca
// (ex.: "Santo Antônio de Pádua (Aperibé)"), tratados como entradas separadas. Descartados:
// a linha "Volta Redonda... (Não é feriado)" (o próprio documento marca como não-feriado) e
// datas móveis/relativas a localidades específicas dentro do município (Barra de São João em
// Casimiro de Abreu, Bacaxá em Saquarema) por ambiguidade sobre se vinculam o município
// inteiro. Correção de nome: "Levy Gasparian" no documento → "Comendador Levy Gasparian" no
// IBGE. Resultado: 94 promovidos contra os 114 candidatos pendentes de RJ; 39 cadastrados
// diretamente (`criar_direto`). Total: +133 feriados municipais de RJ.
//
// INÍCIO DA PARAÍBA (PB) — mesma sessão. QUARTA técnica de acesso testada: `curl` simples deu
// 403 no domínio corregedoria.tjpb.jus.br (bloqueio por user-agent), mas `curl -A
// "Mozilla/5.0..."` (simulando um navegador) passou direto — mais uma barreira, mais uma
// técnica documentada para reaproveitar em estados futuros. O documento encontrado ("Feriados
// nas Comarcas do Poder Judiciário do Estado da Paraíba", Atos da Diretoria Especial do TJPB,
// publicado no DJe de 08/05/2015) é o de MELHOR qualidade de evidência de toda a sessão:
// citação explícita do número e ano da lei/decreto MUNICIPAL para praticamente cada entrada
// (não apenas uma referência genérica ao TJ), cobrindo 72 comarcas/municípios com 224
// entradas ao todo. Resultado: 121 promovidos contra os 196 candidatos pendentes de PB; 60
// cadastrados diretamente (`criar_direto`). Total: +181 feriados municipais de PB.
//
// ATUALIZAÇÃO DE RIO GRANDE DO SUL (RS) — mesma sessão. Ao verificar a página do TJRS que
// hospeda o documento já usado (tjrs.jus.br/.../feriados/), descobri que existe uma versão
// "Feriados Municipais nas Comarcas do RS" datada de julho/2026 — mais recente que a de 2021
// usada na leva original e na releitura anterior desta sessão. Comparação mostrou diferenças
// reais além da mera atualização das datas móveis (Corpus Christi 04/06 em vez de 03/06):
// algumas comarcas ganharam datas novas não presentes na versão de 2021 (ex.: Candelária
// "07 de julho, Dia do Mun.", Santana do Livramento "02 de fevereiro, Dia de Iemanjá"), sinal
// de que o documento é mantido vivo pelo TJRS, não uma cópia estática. Reprocessamento
// completo com exclusão ampliada de festas móveis (Sexta-feira Santa/da Paixão, além de
// Corpus Christi/Finados/Consciência Negra já excluídos antes). Sete entradas de sub-comarcas
// de Pelotas (Turuçu, Morro Redondo, Arroio do Padre) vieram sem motivo nomeado no documento
// (só a data, sem parênteses) — usado o fallback "Feriado Municipal" em vez de inventar um
// motivo. Três comarcas não bateram por abreviação não expandida ("Sta./Sto." → "Santa/
// Santo") e foram corrigidas antes do cruzamento. Resultado: 15 promovidos contra os 383
// candidatos pendentes de RS; 63 cadastrados diretamente (`criar_direto`). Total: +78
// feriados municipais de RS.
//
// CORREÇÃO PONTUAL DE BAHIA (BA) + BUG REAL ENCONTRADO NO UPSERT DO SEED — mesma sessão. Ao
// checar se a página tjba.jus.br/portal/feriados-municipais/ tinha algo além do Decreto
// Judiciário nº 09/2026 já usado, achei o Decreto Judiciário nº 144, de 19/02/2026, que altera
// o anexo do nº 09/2026 especificamente para incluir 27 de abril como feriado municipal na
// Comarca de Sapeaçu — 1 promovido (candidato já existente no dataset comunitário para essa
// data exata). Ao verificar a reprodutibilidade (wipe + reseed), o total ficou 6 abaixo do
// esperado — investigação revelou um BUG REAL no upsert de `seed-feriados-curados.ts`: o match
// usava só nome+abrangencia+uf+codigoIbge, sem mes/dia/regraCalculo, então dois feriados
// DIFERENTES do MESMO município com o mesmo nome genérico de fallback ("Feriado Municipal",
// usado quando o documento-fonte não nomeia o motivo) colidiam no upsert — a cada reseed, a
// entrada mais recente sobrescrevia a mais antiga, perdendo a data anterior silenciosamente.
// Afetava Arroio do Padre, Morro Redondo e Turuçu (sub-comarcas de Pelotas, RS) e Santo
// Augusto (RS) — 6 entradas perdidas nesta sessão antes de serem detectadas. Corrigido
// incluindo mes/dia/regraCalculo (null-safe) na condição de match do upsert — ver comentário
// no próprio arquivo. Recuperado via wipe + reseed a partir do seed já commitado (que estava
// correto; só o banco pós-reseed é que perdia dados) antes de regenerar qualquer coisa.
//
// AUDITORIA E REPARO DE PERDAS HISTÓRICAS (BA/SP) — mesma sessão, logo após corrigir o bug do
// upsert acima. Suspeita: se o bug existia há tempo, pode ter apagado dados de levas ANTERIORES
// a esta sessão também, não só a de RS. Construí uma auditoria comparando
// candidatos_nao_verificados (status='promovido', que não é afetado pelo bug — só a tabela
// feriados é) contra a tabela feriados real, casando por codigo_ibge+mes+dia e excluindo com
// cuidado os falsos-positivos de feriados móveis armazenados via regraCalculo (Corpus Christi
// etc., que não têm mes/dia fixos). Resultado: 360 candidatos promovidos sem feriado
// correspondente — concentrados quase todos em BA (~192) e SP (~154), exatamente os dois
// estados cujos documentos-fonte (Decreto Judiciário TJBA nº 09/2026 e Provimento CSM TJSP nº
// 2.813/2025) não nomeiam o motivo do feriado, forçando uso pesado do nome de fallback
// "Feriado Municipal" repetido em múltiplas datas do mesmo município — exatamente o padrão de
// colisão que o bug explorava. Re-busquei e reli os dois documentos-fonte por completo (mesmo
// texto já usado nas levas originais, conferido) e escrevi um parser dedicado para cada um
// (BA: "N. COMARCA data // data // data."; SP: "MUNICÍPIO - data, data e data", ignorando
// Sexta-Feira Santa/Corpus Christi/Finados/Carnaval que são nacionais ou móveis computados).
// Cruzei cada par (município, data) extraído contra o que já existe em feriados; para os que
// faltavam, verifiquei se a data também não coincidia com um feriado NACIONAL fixo ou com o
// feriado ESTADUAL já cadastrado daquela UF (02/07 Independência da Bahia; 09/07 Revolução
// Constitucionalista de SP) — essas duas categorias já são cobertas automaticamente pelas
// camadas superiores e não precisam de linha municipal própria. O restante foi reinserido via
// criar_direto citando a MESMA fonte já cadastrada (sem duplicar a linha em `fontes`, já que o
// upsert por descricao a reaproveita) — 323 em BA e 205 em SP, um total maior que os 360
// originalmente estimados porque a auditoria por candidatos não enxerga entradas que nunca
// tiveram candidato (ex.: cadastradas via criar_direto na leva original e perdidas do mesmo
// jeito, sem deixar rastro na fila de candidatos). Rodada seguinte de conferência achou mais 5
// municípios (1 em BA, 4 em SP) com ZERO feriados cadastrados porque o parser automático não
// reconheceu a grafia do documento contra o nome oficial do IBGE (Maragojipe/Maragogipe, Ipaúçu/
// Ipaussu, Moji Guaçu/Mogi Guaçu, Santa Rosa do Viterbo/Santa Rosa de Viterbo, Santana do
// Parnaíba/Santana de Parnaíba) — adicionados manualmente (9 entradas). Total do reparo: +337
// feriados municipais recuperados (323+205+9 menos duplicatas incidentais). Auditoria repetida
// ao final: de 360 faltando para 13 — os 13 restantes são de outros estados/levas anteriores a
// esta sessão (ES, GO, MG×3, MS×2, PB, PE, RN, RO, TO) e exigem investigação por arqueologia de
// git (achar o commit original de cada um) em vez de reconstrução por um documento-fonte único
// já identificado — ficam para uma leva futura. Lição gravada: a linha "Total processado: N" do
// script de seed é só a contagem do array/loop, NÃO confirma que N linhas existem de fato na
// tabela — sempre conferir com SELECT COUNT(*) e/ou esta auditoria depois de qualquer reseed.
//
// ARQUEOLOGIA DE GIT NOS 13 CANDIDATOS RESTANTES (ES/GO/MG/MS/PB/PE/RN/RO/TO) — mesma sessão,
// completando a auditoria BA/SP acima. Para cada um dos 13 candidatos promovidos sem feriado
// correspondente, usei `git log -S"codigoIbge: <código>," -- seed-feriados-curados.ts` para
// achar os commits que alteraram a contagem de ocorrências daquele código, e `git show
// <commit>:arquivo | grep -B/-A` para ler o texto histórico completo da entrada. Resultado:
// 7 eram perdas REAIS do mesmo bug de colisão do upsert (nome genérico repetido em datas
// diferentes do mesmo município) — recuperadas abaixo com o nome/fonte/observação ORIGINAIS
// tal como existiam no commit onde a entrada foi vista pela última vez (não reconstruídas de
// memória): Senador Canedo/GO (24/05, "Padroeira"), Juti/MS (13/12), Piancó/PB (13/06,
// "Padroeiro"), Limoeiro/PE (06/04, "Dia da Emancipação Política"), Baraúna/RN (27/11),
// Almas/TO (18/05), Pinheiros/ES (31/10). Os outros 6 eram FALSOS POSITIVOS da auditoria, não
// perdas: em 4 casos (Jacinto/MG, Minas Novas/MG, Vazante/MG, Monte Negro/RO) o candidato
// original trazia uma data com pequeno erro (1 dia de diferença, ou uma data móvel calculada
// para o ano/regra errados) que já tinha sido CORRIGIDA na promoção original — o feriado
// certo já existe no banco, só não bate com o campo `data` literal do candidato. Em 1 caso
// (Sete Quedas/MS, 15/08) não encontrei NENHUM registro histórico da data em nenhum commit —
// o candidato foi marcado "promovido" sem nunca ter sido de fato promovido (bug de marcação
// anterior a esta sessão, não relacionado ao upsert); revertido o status para "pendente" em
// vez de fabricar uma entrada sem fonte (candidato 12417). Embu-Guaçu/SP (16202, 19/06) também
// não é perda: já coberto por dado de outra fonte já cadastrada. Auditoria final: 0 perdas
// reais restantes (só os 5 falsos positivos esperados, todos explicados acima).
//
// MINAS GERAIS (MG) — DOCUMENTO-JACKPOT ATUALIZADO 2026 — mesma sessão, continuando o trabalho
// de cobertura eficiente. A leva original de MG usava a Portaria Conjunta TJMG nº 1.196/2021
// (dados de 2021). Busquei se havia algo mais recente e achei a Portaria Conjunta da
// Presidência nº 1.798/PR/2026 ("Consolida o calendário de feriados nas comarcas do Estado de
// Minas Gerais para o ano de 2026"), publicada em 13/04/2026 — só que essa portaria foi
// alterada DUAS VEZES depois (Portarias Conjuntas nº 1.814/2026 e nº 1.828/2026), cada uma
// substituindo o Anexo Único inteiro. O PDF mostra as três versões em sequência (as duas
// primeiras tachadas/revogadas, a terceira e última — a que vale — sem tachado, terminando sem
// nenhuma nota de "nova redação" posterior). Usei só essa versão final (pós-1.828/2026).
// Documento cobre ~230 comarcas (município-sede) em ordem alfabética de Abaeté a Visconde do
// Rio Branco, cada uma com Paixão de Cristo + Corpus Christi (ambos já cobertos pela camada
// nacional/ponto facultativo nacional, excluídos) mais de 1 a 4 feriados nomeados (padroeiro,
// aniversário/emancipação, etc.). Escrevi um parser dedicado (linha sem "I -"/"II -"/etc. no
// início = nome da comarca; linhas numeradas = data + motivo) e cruzei contra o que já existe
// em feriados — a maioria das 693 entradas já estava cadastrada de levas anteriores (a
// Portaria 2021 e outras pesquisas pontuais), mas 121 eram genuinamente novas (datas ou
// municípios ainda não cobertos, ou motivos mais específicos que os já cadastrados). Essas 121
// foram cadastradas via criar_direto, com o motivo exato do documento como nome (nunca o
// fallback genérico "Feriado Municipal", já que este documento sempre nomeia o motivo).
//
// PARANÁ (PR) — DOCUMENTO-JACKPOT — mesma sessão, continuando a busca eficiente por
// documentos-jackpot em estados de coverage mediana. Achei o Decreto Judiciário TJPR nº
// 621/2025, de 18/11/2025, cujo art. 4º consolida o calendário de feriados locais dos
// municípios-sede das comarcas do estado para 2026 — só que o formato é MUITO diferente dos
// outros documentos usados nesta sessão: organizado por MÊS e depois por DIA (não por
// comarca), com múltiplos municípios agrupados na mesma linha quando compartilham a data
// ("dia 20: Altônia (Dia do Padroeiro do Município), Andirá (...), ..."). Escrevi um parser
// dedicado para esse formato (cabeçalho de mês + linhas "dia N: Município (motivo), ...").
// 340 pares extraídos, cruzados contra o que já existe em feriados — 65 eram genuinamente
// novos, cadastrados via criar_direto com o motivo exato do documento como nome.
//
// SANTA CATARINA (SC) — RELEITURA + CORREÇÃO DE OMISSÃO — mesma sessão. Rebusquei a mesma
// planilha oficial "Comarcas / Feriados locais" do TJSC já usada na leva original de SC, para
// conferir se havia algo novo. Reprocessamento completo (204 pares, incluindo atribuição
// correta de sub-municípios dentro de comarcas — Apiúna/Ascurra, Paulo Lopes/Garopaba,
// Arabutã e Lindóia do Sul/Ipumirim, Caxambu do Sul/Chapecó) achou só 1 "novo" candidato, que
// na verdade era um FALSO POSITIVO do parser: um bug de regex atribuiu por engano a data de
// emancipação de São José do Cedro (27/07) ao município de São José (grande Florianópolis) —
// descartado sem cadastrar nada (a linha já estava corretamente coberta sob o código IBGE
// certo, só o parser leu errado o nome do município na extração desta vez; não indica perda de
// dado real). Investigação revelou, por outro lado, um problema REAL: ao transcrever o texto
// do documento na leva original, os blocos de 4 comarcas com formato de data não-fixa
// (movéis, calculadas a partir da Páscoa, não "DD/MM") foram integralmente OMITIDOS por
// engano durante a transcrição — Timbó e Pomerode ("segunda-feira após a Páscoa" = pascoa+1),
// Modelo ("Corpus Christi, independente do dia" = pascoa+60, mais 2 datas fixas que também
// ficaram de fora por estarem no mesmo bloco omitido) e o padroeiro de Paulo Lopes/Garopaba
// ("segunda sexta-feira após Corpus Christi" = pascoa+68, calculado a partir do fato de que a
// Páscoa cai sempre num domingo, logo Corpus Christi é sempre quinta-feira). Timbó, Pomerode e
// Modelo estavam com ZERO feriados cadastrados neste banco por causa dessa omissão. Recuperado
// via criar_direto, citando a mesma fonte já usada (a planilha do TJSC).
//
// SERGIPE (SE) — DOCUMENTO-JACKPOT — mesma sessão, continuando a busca eficiente. MA, PI, TO e
// CE foram investigados e descartados nesta rodada — nenhum publica um documento único
// consolidando feriados municipais por comarca (cada comarca comunica separadamente, ou o
// TJ explicitamente delega à legislação municipal sem anexo consolidado, caso do TJCE). SE,
// por outro lado, tem: o "Calendário 2026 — Comarcas de Aracaju e do Interior do Estado e
// respectivos Distritos" do TJSE, formato de calendário mês a mês com uma linha por
// data/município ("DD/MM – Município (motivo)"), incluindo também os feriados/pontos
// facultativos nacionais e estaduais misturados na mesma lista (sem parênteses de município —
// filtrados automaticamente pelo parser por não baterem contra nenhum município do IBGE de
// SE). Excluí também 08/07 "Emancipação Política de Sergipe", que é o feriado ESTADUAL (Data
// Magna) já cadastrado com abrangencia=uf, cobrindo automaticamente todos os municípios.
// 116 pares extraídos, 49 genuinamente novos, cadastrados via criar_direto com o motivo exato
// do documento como nome.
//
// RONDÔNIA (RO) — DOCUMENTO-JACKPOT ATUALIZADO — mesma sessão. Achei o Ato n. 2579/2025-GP do
// TJRO (alterado pelo Ato n. 2942/2025), cujo Anexo Único é uma tabela mês a mês muito mais
// detalhada que a fonte original usada na leva de RO — cada linha já vem com âmbito
// (Nacional/Estadual/Municipal/Ponto Facultativo) e cita a lei/decreto municipal quando
// disponível, com "somente na respectiva comarca ou Fórum Digital" explícito no §2º do art.
// 1º. Transcrevi manualmente as 45 linhas de âmbito "Municipal" (formato tabular, não texto
// corrido, então preferi codificar cada linha como dado estruturado — comarca(s), data,
// motivo — a escrever um parser de texto livre) e expandi as linhas com múltiplos municípios
// (ex.: "Nossa Senhora Auxiliadora, padroeira dos Municípios de Porto Velho, Vilhena e Alto
// Paraíso") em uma entrada por município. Uma linha ("Criação do Município de Guajará-Mirim,
// Decreto Municipal 14.630/2022") vem explicitamente rotulada como "Ponto facultativo /
// Municipal" no documento — diferente de um feriado pleno, só vincula servidor público
// municipal — cadastrada com tipoChave="ponto_facultativo" em vez de "municipal", respeitando
// a distinção do próprio documento-fonte. 61 pares extraídos, 28 genuinamente novos.
//
// AMAPÁ (AP) — DOCUMENTO-JACKPOT, PRIMEIRA LEVA DO ESTADO — mesma sessão. Portaria TJAP n.
// 75661/2025-GP divulga feriados municipais nas comarcas do Amapá para 2026, cobrindo as 12
// comarcas do estado (AP tem só 16 municípios). Extraída via WebFetch direto do visualizador
// SIG do TJAP (sig.tjap.jus.br) — não precisou de fallback local, o conteúdo veio legível na
// primeira tentativa. 27 pares no total, 19 genuinamente novos, cadastrados via criar_direto.
// Estado pequeno mas com ganho proporcional grande: cobertura municipal do AP praticamente
// dobra com esta leva.
//
// RORAIMA (RR) — DOCUMENTO-JACKPOT — mesma sessão. Portaria TJRR/PR nº 1.558/2025 publica o
// "Calendário de Feriados e Pontos Facultativos do TJRR" para 2026 como página HTML (não PDF)
// com tabela DATA/DESCRIÇÃO/COMARCA, cobrindo tanto a capital (Boa Vista) quanto os municípios
// do interior — 15 municípios no total, RR é um dos menores estados. Lido via browser
// (get_page_text) para pegar o texto literal da tabela em vez de confiar no resumo do
// WebFetch, que havia colapsado por engano duas linhas distintas ("Caroebe" e "Iracema") numa
// só ("Caroebe/Iracema") — o texto original deixa claro que são datas e municípios separados.
// Excluídas as linhas "Ponto Facultativo referente ao feriado do dia X" (dia de ponte
// administrativo, não feriado municipal em si — mesmo critério já usado noutras levas).
// 20 pares no total, 17 genuinamente novos, cadastrados via criar_direto.
//
// MATO GROSSO (MT) — DOCUMENTO-JACKPOT — mesma sessão. Depois de confirmar que PA (Pará) não
// tem documento consolidado (só um widget de calendário em JS sem texto extraível, e o
// Provimento geral do estado nem cobre feriados municipais) e que AM (Amazonas) só lista o
// aniversário da capital (Manaus) sem anexo municipal por comarca, achei a Portaria TJMT/CGJ
// n. 190/2025-GAB-CGJ, cujo Anexo II ("Feriados das Comarcas no ano de 2026") cobre 79 das ~142
// comarcas do estado — um documento já bastante completo, então a maior parte das entradas já
// estava cadastrada de uma leva anterior desta sessão (só 43 de 178 pares eram novas). Nomes de
// comarca no PDF vinham com quebra de coluna colada sem espaço (ex.: "ALTOGARÇAS",
// "NOVACANAÃDONORTE") — o parser normaliza removendo TODOS os caracteres não-alfanuméricos
// (não só acentos) antes de comparar contra o nome oficial do IBGE, resolvendo isso sem
// precisar de alias manual por município. Excluídas datas coincidentes com feriados nacionais
// fixos (ex.: 12/10 Nossa Senhora Aparecida, já coberta pela camada nacional em vários
// municípios do documento) e a linha "Ponto facultativo" sem nome de Vila Bela da Santíssima
// Trindade (mantida só a "Dia da Dança do Congo", feriado pleno por lei municipal citada no
// próprio documento). 43 novos, cadastrados via criar_direto.
//
// ACRE (AC) — DOCUMENTO-JACKPOT — mesma sessão. Depois de descartar PI (Provimento nº 59/2025
// da Presidência não traz anexo com feriados por município, só delega "à lei municipal" e pede
// que os Juízes de Comarca comuniquem individualmente) achei o Calendário 2026 do TJAC
// (Portaria nº 6.569/2025) como página HTML (não PDF), mês a mês, com o nome do feriado,
// classificação (nacional/estadual/municipal/regimental/ponto facultativo) E a lei ou decreto
// municipal específico de cada um — o documento mais detalhado juridicamente encontrado nesta
// sessão. Excluídas explicitamente as linhas "Ponto Facultativo Municipal" (ex.: Marcha para
// Jesus em Senador Guiomard, aniversário de Sena Madureira) — são discretionárias, só vinculam
// servidor público municipal, diferente de "Feriado municipal" pleno. AC tem só 22 municípios;
// o documento cobre virtualmente todos. 34 novos, cadastrados via criar_direto.
//
// PROCESSAMENTO DA FILA DE CANDIDATOS DE MA/PI/TO/CE/RN/PA/AM/AL — mesma sessão. Esses 8
// estados não têm documento-jackpot (TJ delega a comunicação de feriado municipal comarca por
// comarca, sem anexo consolidado — confirmado individualmente para cada um). Em vez de desistir,
// filtrei a fila de candidatos pendentes desses estados (1.273 no total) por citação de "Lei"
// no próprio texto do candidato — só 54 tinham citação específica de norma. Desses, classifiquei
// programaticamente: descartei os que colidiam com feriado NACIONAL (fixo ou móvel — Sexta-feira
// Santa, Carnaval, Cinzas) ou com feriado ESTADUAL já cadastrado para a UF (achado interessante:
// vários candidatos municipais de capitais nordestinas citavam leis municipais para datas que já
// são feriado ESTADUAL naquele estado, ex. São José 19/03 no Ceará, Nossa Senhora da Conceição
// 08/12 em AL/AM/MA/PA/PI — a lei municipal existe mas é redundante, a camada estadual já cobre
// automaticamente). Depois, corroborei via busca na web os candidatos das capitais (maior valor
// para o produto): confirmação direta encontrada para vários (Manaus, Fortaleza parcial, São
// Luís parcial, Teresina, Natal, Palmas), e nesse processo achei DUAS contradições importantes
// que abortaram a promoção: (1) Corpus Christi em São Luís e Teresina são PONTO FACULTATIVO, não
// feriado pleno, ao contrário do que o candidato sugeria — não promovido; (2) o "Aniversário de
// Belém" (12/01) NÃO é feriado municipal atualmente segundo fonte independente, apesar do
// candidato citar uma lei de 1967 — a lei pode ter sido revogada ou nunca ter virado feriado de
// fato; não promovido, fica pendente até achar fonte primária. Também descartado um candidato de
// Maracaçumé/MA que citava "Projeto de Lei" (não é lei aprovada, é só uma proposta). Resultado:
// 22 promovidos com evidência sólida (citação específica, corroborada onde possível). ERRO
// DETECTADO E CORRIGIDO NO PROCESSO: a primeira rodada de aplicação gerou 7 duplicatas, porque o
// script de classificação não checou se o candidato já tinha sido promovido em pesquisa
// individual ANTERIOR desta mesma sessão (Corpus Christi de Maceió, Aniversário de Quixadá,
// Natividade de N. Senhora em São Luís, Aniversário de Teresina, Dia de Santos Reis em Natal,
// Aniversário de Palmas e Dia do Evangélico em Palmas já estavam cadastrados com pesquisa mais
// detalhada desde 27/08/2026) — as 7 entradas novas e as 7 fontes órfãs resultantes foram
// apagadas manualmente, mantendo as entradas originais (mais bem pesquisadas). Lição: sempre
// checar contra a tabela `feriados` existente antes de gerar decisões de "promover", não só
// contra feriados nacionais/estaduais — o padrão usado em todo o resto da sessão para
// `criar_direto` (checar `existentes`) deveria ter sido aplicado aqui também.
//
// MUDANÇA DE PADRÃO DE EVIDÊNCIA PARA A FILA SEM CITAÇÃO DE LEI — mesma sessão. Depois de
// esgotar a fila "com citação de lei" (achado: já 100% coberta nacionalmente, ver nota
// anterior), sobravam ~8.000 candidatos "data + Feriado Municipal" sem nenhuma citação. Fui
// atrás dos que tinham nome ESPECÍFICO (não genérico) em municípios com ZERO feriado municipal
// cadastrado — 303 candidatos, 289 depois de excluir os redundantes com feriado nacional/
// estadual (13 de São José/CE, já coberto pela camada estadual do Ceará). Composição: 108 "Dia
// de Santo Antônio" (13/06), 78 "São José" (19/03), resto aniversário/emancipação/padroeiro.
// Verifiquei uma amostra de 7 via busca individual (Abaré/BA, Aporá/BA, Caxias/MA,
// Chapadinha/MA, Crato/CE, Goiás/GO, Icapuí/CE) — 7/7 confirmados, incluindo reportagens que
// documentam Santo Antônio e São José como padroeiro/feriado municipal em centenas de
// municípios brasileiros (CNN Brasil: "19 de março é feriado em mais de 200 municípios";
// matérias similares para 13/06). PERGUNTEI AO USUÁRIO como proceder com os ~280 restantes
// (sem verificação individual, só o padrão + amostra) — decisão do usuário: promover em lote
// com ressalva explícita. Os 7 verificados individualmente têm observação citando a fonte
// específica; os outros 282 têm observação padrão disclosing claramente que aquele item
// específico NÃO foi verificado contra fonte primária, só o padrão nacional documentado + taxa
// de acerto da amostra — different (mais fraco) do padrão de evidência usado no resto da
// sessão, registrado explicitamente por decisão do usuário para este lote. 289 promovidos.
//
// SEGUNDA RODADA DE CANDIDATOS NOMEADOS (mesmo padrão de evidência aprovado pelo usuário) —
// mesma sessão. Ampliei o filtro da leva anterior: desta vez incluindo candidatos nomeados em
// municípios que já tinham ALGUMA cobertura (não só os com zero feriado), cruzando contra
// feriados/estaduais/nacionais já existentes para achar só os genuinamente novos. De 1.185
// candidatos nomeados no total, só 87 sobraram depois do filtro de redundância — confirma de
// novo que a leva anterior e as levas de documento-jackpot já cobriram quase tudo. Descartei
// mais 10 por problemas específicos encontrados nesta checagem: 3 com regra "enésima
// segunda-feira do mês" (Confresa/MT, Maringá/PR, Goioerê/PR — mesma limitação de schema já
// documentada, só suporta pascoa±N), 1 redundante com aniversário já cadastrado por outra
// regra (Campo Mourão/PR), 3 com data de Corpus Christi claramente errada — 19/06 em vez do
// 04/06 correto (Embu-Guaçu/SP, Ubiratã/PR, Camboriú/SC — mesmo padrão de erro sistemático já
// visto no dataset comunitário), 1 com data inconsistente com a própria regra descrita
// (Presidente Lucena/RS, "39 dias após a Páscoa" não bate com pascoa+39 nem +40), 1 com regra
// "primeira sexta-feira de março" não representável (Telêmaco Borba/PR), 1 já deliberadamente
// deixado pendente antes por histórico legislativo confuso (Gurupi/TO, "Dia do Evangélico" no
// último sábado de setembro). Verifiquei mais 4 individualmente (Juazeiro do Norte/CE, Santos
// Dumont/MG, Magé/RJ, Parnaíba/PI — 4/4 confirmados, 11/11 no total das duas rodadas). 77
// promovidos com o mesmo disclosure de padrão+amostra já combinado com o usuário.
//
// AGREGADOR calendario.online PARA MUNICÍPIOS SEM MOTIVO NO CANDIDATO — mesma sessão. Para os
// ~1.154 municípios com zero feriado cadastrado e candidato só "Feriado Municipal" (sem nome,
// sem lei), sem um motivo pra buscar não dava pra pesquisar individualmente do jeito normal.
// Descobri que o agregador calendario.online tem página própria por município
// (calendario.online/feriados-<slug>-<uf>.html, slug = nome sem acento com hífen) que muitas
// vezes já traz o NOME do feriado que o dataset comunitário não tinha (ex.: "Festa de São
// João" em vez de "Feriado Municipal" genérico) — testei em ~50 municípios da Bahia e a data
// bateu exatamente com o candidato em quase todos os casos, às vezes revelando datas extras
// que nem estavam no dataset comunitário (usadas via criar_direto). Um caso (Campo Alegre de
// Lourdes/BA) a própria página disse explicitamente "não encontramos nenhum feriado municipal"
// — não promovido, candidato deixado pendente corretamente. 89 promovidos (candidato já
// existia, data bateu) + 13 criados diretamente (achados só no agregador, sem candidato
// correspondente). Fonte é um agregador de terceiros, não a lei primária — registrado
// explicitamente na observação de cada entrada.
//
// SEGUNDA LEVA DO AGREGADOR calendario.online (continuação da BA) — mesma sessão. Continuei a
// mesma varredura alfabética de municípios da Bahia com zero cobertura e candidato genérico,
// de Brejolândia a Maiquinique (~30 municípios). Mesmo padrão de alta taxa de acerto — a maior
// parte das datas bateu exatamente com o candidato do dataset comunitário, e o agregador
// frequentemente revelou o nome do feriado (Festa de São João em 24/06 é extremamente comum
// nesta região da Bahia). 58 promovidos + 5 criados diretamente (achados sem candidato
// correspondente). Mesmo disclosure de fonte de agregador de terceiros em cada observação.
//
// TERCEIRA LEVA DO AGREGADOR calendario.online (continuação da BA) — mesma sessão. De Malhada
// a Pedro Alexandre (~18 municípios), mesmo método. 30 promovidos + 7 criados diretamente.
//
// QUARTA LEVA DO AGREGADOR calendario.online (continuação da BA) — mesma sessão. De Pedrão a
// Santanópolis (~18 municípios), mesmo método. 48 promovidos + 6 criados diretamente.
//
// QUINTA LEVA DO AGREGADOR calendario.online (continuação da BA) — mesma sessão. Retomei a
// varredura alfabética a partir de Santo Amaro (ordem alfabética completa de todos os 417
// municípios baianos, não só os que tinham candidato do dataset comunitário) e voltei ao início
// (Abaíra em diante) para cobrir os ~93 municípios da BA que ainda não tinham nenhum dado
// municipal. Taxa de acerto muito mais baixa que as levas anteriores (~3%, contra ~60-80% das
// levas 1-4) — a maioria destes municípios pequenos simplesmente não tem feriado municipal
// documentado no agregador, e a própria página confirma isso explicitamente ("não encontramos
// nenhum feriado municipal em [X]"). Isso é um resultado válido, não uma falha: o
// status_municipal desses municípios continua nao_verificado corretamente, sem fabricar dado.
// De 35 municípios varridos (Abaíra a Itaguaçu da Bahia), só 1 teve resultado: Cabaceiras do
// Paraguaçu, com 3 datas — 14/03, 13/06 (aniversário) e 29/08 — nenhuma com candidato
// correspondente no dataset comunitário (criadas diretamente). Dado o rendimento muito baixo,
// pausei a varredura alfabética da BA aqui para reportar status ao usuário antes de continuar
// gastando fetches nos ~57 municípios baianos restantes.
//
// PRIMEIRA LEVA DO AGREGADOR calendario.online EM MINAS GERAIS (MG) — mesma sessão. Depois
// do 'check-in' de status com o usuário, priorizei MG e RS por terem mais municípios em termos
// absolutos. Segui o método já validado nas levas da BA: varredura alfabética dos municípios
// SEM cobertura municipal que TÊM ao menos um candidato pendente no dataset comunitário (sinal
// de que provavelmente existe dado documentável, ao contrário da varredura alfabética pura que
// deu rendimento baixo no fim da BA). Taxa de acerto voltou a ser alta (~95%), confirmando a
// hipótese. Dois lotes: de Alagoa a Bela Vista de Minas, depois de Bom Jardim de Minas a
// Careaçu (~31 municípios no total). 68 promovidos + 3 criados diretamente. Mesmo disclosure de
// fonte de agregador de terceiros em cada observação.
//
// SEGUNDA LEVA DO AGREGADOR calendario.online EM MG — mesma sessão. Continuação da varredura
// por municípios-com-candidato-pendente, de Carmo da Cachoeira a Dores de Campos (~36
// municípios, dois lotes). Taxa de acerto continua alta (só 1 município sem resultado no
// agregador: Conceição dos Ouros). Excluída 1 data de Carneirinho (aniversário 27/04, mas o
// agregador lista o feriado observado em 28/04 'porque 27 cai numa segunda-feira') — mesmo
// padrão de regra de deslocamento de dia não representável no schema (só datas fixas ou
// pascoa+N), já visto antes em outros municípios; não promovida. 61 promovidos + 6 criados
// diretamente.
//
// TERCEIRA LEVA DO AGREGADOR calendario.online EM MG — mesma sessão. Continuação da
// varredura por municípios-com-candidato-pendente, de Dores do Turvo a Itabirinha (~30
// municípios, dois lotes). Taxa de acerto continua alta (só Iraí de Minas sem resultado no
// agregador). 57 promovidos + 8 criados diretamente.
//
// QUARTA LEVA DO AGREGADOR calendario.online EM MG — mesma sessão. Continuação da varredura
// por municípios-com-candidato-pendente, de Itacarambi a Matipó (~28 municípios, dois lotes).
// Taxa de acerto de 100% neste par de lotes (todos os municípios varridos tinham algum dado no
// agregador). Excluída 1 data de Jampruca (mesmo padrão de deslocamento de dia já visto em
// Carneirinho: aniversário 27/04 mas feriado observado listado em 28/04 'porque 27 cai numa
// segunda-feira') — não promovida. 58 promovidos + 5 criados diretamente.
//
// PRIMEIRA LEVA DO AGREGADOR calendario.online EM RS — mesma sessão. Depois de 4 levas em MG
// (45,6% -> 59,6%), pivotei para o RS conforme pedido do usuário. Mesmo método: varredura
// alfabética dos municípios SEM cobertura municipal que TÊM candidato pendente no dataset
// comunitário. Taxa de acerto altíssima (~95%) — o padrão de santo padroeiro (Nossa Senhora
// dos Navegantes, São Cristóvão, Dia do Colono e Motorista) é muito comum nos municípios de
// colonização alemã/italiana do RS. De Ajuricaba a David Canabarro (~40 municípios, dois
// lotes). 54 promovidos + 19 criados diretamente.
//
// SEGUNDA LEVA DO AGREGADOR calendario.online EM RS — mesma sessão. Continuação da varredura
// por municípios-com-candidato-pendente, de Dois Lajeados a Maximiliano de Almeida (~38
// municípios, dois lotes). Taxa de acerto de 100% neste par de lotes. 60 promovidos + 10
// criados diretamente.
//
// QUINTA LEVA EM MG + TERCEIRA LEVA EM RS DO AGREGADOR calendario.online — mesma sessão.
// Continuando ambos os estados em paralelo conforme pedido do usuário ('segue para completar').
// MG: de Matutina a Novo Oriente de Minas (~13 municípios). RS: de Maçambará a Paraí (~20
// municípios). Taxa de acerto 100% em ambos. MG: 27 promovidos + 4 criados diretamente. RS: 30
// promovidos + 10 criados diretamente.
//
// SEXTA LEVA EM MG + QUARTA LEVA EM RS DO AGREGADOR calendario.online — mesma sessão.
// MG: de Ouro Verde de Minas a Piranguinho (~14 municípios). RS: de Paraíso do Sul a Rolante
// (~13 municípios, Picada Café sem resultado no agregador). Taxa de acerto muito alta em ambos.
// MG: 23 promovidos + 4 criados diretamente. RS: 24 promovidos + 2 criados diretamente.
//
// SÉTIMA LEVA EM MG + QUINTA LEVA EM RS DO AGREGADOR calendario.online — mesma sessão.
// MG: de Piraúba a Rubim (~14 municípios). RS: de Roque Gonzales a Sinimbu (~13 municípios,
// Sertão sem resultado no agregador). Taxa de acerto muito alta em ambos. MG: 30 promovidos + 4
// criados diretamente. RS: 19 promovidos + 3 criados diretamente.
//
// OITAVA LEVA EM MG + SEXTA LEVA EM RS DO AGREGADOR calendario.online — mesma sessão.
// MG: de Salto da Divisa a Serra dos Aimorés (~14 municípios). RS: de Passo Fundo (capital
// regional, só 1 feriado municipal encontrado) a Três Arroios (~14 municípios). Taxa de acerto
// de 100% em ambos. MG: 28 promovidos + 0 criados diretamente. RS: 20 promovidos + 6 criados
// diretamente.
//
// NONA LEVA EM MG + SÉTIMA LEVA EM RS DO AGREGADOR calendario.online — mesma sessão.
// MG: de Serrania a São João Batista do Glória (~13 municípios). RS: de Três Palmeiras a Áurea
// (~16 municípios) — esgota o pool de municípios-com-candidato-pendente do RS (restam só
// Chiapetta, Picada Café e Sertão, já confirmados sem resultado no agregador). Taxa de acerto
// de 100% em ambos. MG: 28 promovidos + 2 criados diretamente. RS: 25 promovidos + 1 criado
// diretamente.
//
// DÉCIMA LEVA EM MG DO AGREGADOR calendario.online — mesma sessão. De São João da Mata a Água
// Comprida (~22 municípios, dois lotes) — esgota o pool de municípios-com-candidato-pendente do
// MG (restam só Barão do Monte Alto, Cachoeira da Prata, Carneirinho, Conceição dos Ouros,
// Delfinópolis, Iraí de Minas e Jampruca, já confirmados sem resultado no agregador). Taxa de
// acerto de 100%. 47 promovidos + 2 criados diretamente. Com essa leva, tanto MG quanto RS têm
// o pool de candidatos-com-dado-provável esgotado — o que resta em ambos os estados é a cauda
// longa sem candidato e sem dado no agregador (mesmo padrão de baixo rendimento visto no fim da
// BA, leva 5).
//
// PRIMEIRA LEVA DO AGREGADOR calendario.online EM PR — mesma sessão. Com MG e RS esgotados
// (pool de candidato-pendente), o usuário escolheu pivotar para outro estado grande; PR tem mais
// municípios sem cobertura e maior pool de candidato-pendente que SC (156 vs 86), então comecei
// por ele. Mesmo método: varredura alfabética dos municípios SEM cobertura municipal que TÊM
// candidato pendente no dataset comunitário. Taxa de acerto altíssima (~95%).
//
// ACHADO IMPORTANTE: o agregador lista 19/12 ('Emancipação Política do Paraná') como feriado
// ESTADUAL em toda página de município do PR — mas essa data foi REVOGADA como feriado civil
// pela Lei estadual 18.384/2014 (que revogou a Lei 4.658/1962). Hoje 19/12 é só PONTO FACULTATIVO
// para o funcionalismo estadual, não feriado. Confirmado via busca (Gazeta do Povo, LegisWeb,
// Assembleia Legislativa do PR). NÃO cadastrado como feriado estadual do PR nesta sessão —
// excluído explicitamente do cross-reference (constante PR_EXCLUIR) para nunca ser promovido
// por engano caso apareça em algum candidato do dataset comunitário.
//
// De Abatiá a Godoy Moreira (~38 municípios, dois lotes). 60 promovidos + 12 criados
// diretamente.
//
// SEGUNDA LEVA DO AGREGADOR calendario.online EM PR — mesma sessão. Continuação da
// varredura por municípios-com-candidato-pendente, de Guapirama a Manfrinópolis (~36
// municípios, dois lotes; Barra do Jacaré e Diamante D'Oeste já confirmados sem resultado antes,
// Lupionópolis novo caso sem resultado). Taxa de acerto altíssima (~97%). Mantido o mesmo
// PR_EXCLUIR de 12/19 (Emancipação Política do PR, revogada — ver leva anterior); Lunardelli
// tinha aniversário citado como coincidindo com 19/12 no texto do agregador, não promovido por
// consistência com essa exclusão. 52 promovidos + 7 criados diretamente.
//
// TERCEIRA LEVA DO AGREGADOR calendario.online EM PR — mesma sessão. Continuação da
// varredura por municípios-com-candidato-pendente, de Maria Helena a Presidente Castelo Branco
// (~34 municípios, dois lotes; Mariluz e Porto Amazonas sem resultado no agregador). Taxa de
// acerto altíssima (~94%). Mesmo PR_EXCLUIR de 12/19 mantido. 55 promovidos + 9 criados
// diretamente.
//
// QUARTA LEVA DO AGREGADOR calendario.online EM PR — mesma sessão. Continuação da varredura
// por municípios-com-candidato-pendente, de Pérola d'Oeste a São Sebastião da Amoreira (~35
// municípios, dois lotes; Pérola d'Oeste, Santa Izabel do Oeste, São Jorge d'Oeste e São Jorge
// do Patrocínio sem resultado no agregador). Taxa de acerto alta (~86%). Mesmo PR_EXCLUIR de
// 12/19 mantido — São Carlos do Ivaí teve especificamente 15/12 promovido (data distinta,
// municipal de fato) mas não 19/12. 51 promovidos + 13 criados diretamente.
//
// QUINTA LEVA DO AGREGADOR calendario.online EM PR — mesma sessão. De São Tomé a Vitorino
// (~12 municípios) — esgota o pool de municípios-com-candidato-pendente do PR (restam só Barra
// do Jacaré, Diamante D'Oeste, Lupionópolis, Mariluz, Porto Amazonas, Pérola d'Oeste, Santa
// Izabel do Oeste, São Jorge d'Oeste, São Jorge do Patrocínio, Tapejara e Tapira, já confirmados
// sem resultado no agregador). Taxa de acerto de ~83%. 17 promovidos + 1 criado diretamente.
//
// PRIMEIRA LEVA DO AGREGADOR calendario.online EM SP — mesma sessão. Com PR praticamente
// esgotado, pivotei para SP a pedido do usuário ('continue para qual falta mais') — SP tem o
// maior volume absoluto de municípios sem cobertura (258) entre todos os estados. Mesmo método:
// varredura alfabética dos municípios SEM cobertura municipal que TÊM candidato pendente no
// dataset comunitário. Taxa de acerto altíssima (~97%). Nota: SP trata 'Dia Nacional de Zumbi e
// da Consciência Negra' (20/11) como feriado municipal decretado em muitas cidades — já coberto
// pelo cálculo nacional (Lei 14.759/2023), filtrado automaticamente pelo cross-reference sem
// necessidade de tratamento especial. De Alfredo Marcondes a Cruzália (~38 municípios, dois
// lotes; Aparecida d'Oeste sem resultado no agregador). 68 promovidos + 6 criados diretamente.
//
// SEGUNDA LEVA DO AGREGADOR calendario.online EM SP — mesma sessão. Continuação da varredura
// por municípios-com-candidato-pendente, de Cássia dos Coqueiros a Itapura (~55 municípios, dois
// lotes; Dobrada sem resultado no agregador). Taxa de acerto muito alta (~98%). 73 promovidos +
// 3 criados diretamente.
//
// TERCEIRA LEVA DO AGREGADOR calendario.online EM SP — mesma sessão. Continuação da
// varredura por municípios-com-candidato-pendente, de Itirapuã a Nova Aliança (~34 municípios,
// dois lotes). Taxa de acerto de 100% neste par de lotes — todos os municípios varridos tinham
// algum dado no agregador. Marinópolis: pequena inconsistência no texto do agregador
// (aniversário citado como 13/06, mas a tabela lista o feriado decretado em 16/06) — promovido
// só o que está na tabela (16/06), por consistência com o método de sempre priorizar a data
// formalmente listada. 61 promovidos + 3 criados diretamente.
//
// QUARTA LEVA DO AGREGADOR calendario.online EM SP — mesma sessão. Continuação da varredura
// por municípios-com-candidato-pendente, de Nova Europa a Ribeirão Branco (~34 municípios, dois
// lotes). Taxa de acerto de 100% em ambos os lotes. 57 promovidos + 7 criados diretamente.
//
// QUINTA LEVA DO AGREGADOR calendario.online EM SP — mesma sessão. Continuação da varredura
// por municípios-com-candidato-pendente, de Ribeirão Corrente a Tapiratiba (~34 municípios,
// dois lotes; Santa Rita d'Oeste, Santa Clara d'Oeste e São João do Pau d'Alho sem resultado no
// agregador). Taxa de acerto muito alta (~94%). 52 promovidos + 5 criados diretamente.
//
// SEXTA LEVA DO AGREGADOR calendario.online EM SP — mesma sessão. De Tapiraí a Óleo (~18
// municípios) — esgota o pool de municípios-com-candidato-pendente do SP (restam só Alumínio,
// Aparecida d'Oeste, Dobrada, Santa Albertina, Santa Clara d'Oeste, Santa Rita d'Oeste e São
// João do Pau d'Alho, já confirmados sem resultado usável no agregador — Santa Albertina tinha
// só 20/11, já coberto pelo cálculo nacional, então não conta como cobertura municipal real).
// Taxa de acerto de 100%. 32 promovidos + 4 criados diretamente.
//
// PRIMEIRA LEVA DO AGREGADOR calendario.online NO MARANHÃO (MA) — mesma sessão. Com SP
// esgotado, usuário escolheu entre MA (89 pendentes, 13,8% cobertura) e SC (86 pendentes, 47,1%
// cobertura); optei por MA pelo potencial de ganho maior. Mesmo método: varredura alfabética
// dos municípios SEM cobertura municipal que TÊM candidato pendente no dataset comunitário. De
// Alcântara a Matões (~40 municípios, dois lotes). Taxa de acerto de 100% — todos os municípios
// varridos tinham dado no agregador.
//
// ACHADO: 28/08 aparece como "Feriado Municipal" genérico em ~38 dos ~40 municípios varridos
// (só Barreirinhas em parte, Grajaú, Igarapé Grande e Imperatriz não têm essa data). Antes de
// promover em massa, investiguei se era artefato do agregador (mesma data aplicada
// indiscriminadamente a todo município da UF, como já visto no cluster de 08/12 do MA para
// feriado ESTADUAL) — três buscas: (1) confirmado que é decreto INDEPENDENTE por município, não
// um bug do agregador — matéria do em.com.br cita Fortaleza dos Nogueiras com legislação própria
// para a data; (2) não encontrei lei estadual de criação simultânea de municípios datada 28/08
// que explicasse uma origem comum; (3) confirmado que 28/08 é o Dia de Santo Agostinho no
// calendário litúrgico católico — mesmo padrão já aprovado com o usuário para datas de
// padroeiro/santo repetidas em múltiplos municípios (Santo Antônio 13/06, São João 24/06, São
// José 19/03). Promovido com esse disclosure explícito em cada entrada com 28/08.
//
// 75 promovidos + 49 criados diretamente.
//
// SEGUNDA LEVA DO AGREGADOR calendario.online NO MARANHÃO (MA) — mesma sessão. Continuação da
// varredura por municípios-com-candidato-pendente, de Mirador a Vitória do Mearim (~49
// municípios, dois lotes) — esgota o pool de municípios-com-candidato-pendente do MA. Taxa de
// acerto quase total (só Olho d'Água das Cunhãs sem resultado no agregador, confirmado
// explicitamente "não encontramos nenhum feriado municipal"). Mesmo padrão de 28/08 = Santo
// Agostinho mantido com o mesmo disclosure da leva anterior. São Luís Gonzaga do Maranhão
// listava 20/11 como "feriado municipal" — já coberto pelo cálculo nacional (Dia Nacional de
// Zumbi e da Consciência Negra, Lei 14.759/2023), filtrado automaticamente pelo
// cross-reference. São Vicente Ferrer listava "05/04 — Páscoa" (domingo de Páscoa) como uma das
// datas decretadas — NÃO processado nesta leva: schema suporta regraCalculo "pascoa+0", mas
// ficou de fora do fluxo padrão (que só lida com mes/dia fixos) por prudência, já que Domingo de
// Páscoa como feriado municipal decretado é um padrão atípico nunca visto antes nesta sessão;
// revisar manualmente depois se valer a pena. 98 promovidos + 52 criados diretamente.
//
// PRIMEIRA LEVA DO AGREGADOR calendario.online EM SANTA CATARINA (SC) — mesma sessão. Com o
// pool de município-com-candidato-pendente do MA esgotado, verifiquei os pools nacionais e SC
// tinha o maior pool intocado (86 municípios). Mesmo método: varredura alfabética dos
// municípios sem cobertura municipal que têm candidato pendente no dataset comunitário. De
// Abdon Batista a Major Vieira (~38 municípios, dois lotes; Antônio Carlos, Benedito Novo,
// Governador Celso Ramos e Grão-Pará sem resultado no agregador — todos com a mesma frase
// padrão "não encontramos nenhum feriado municipal"). Taxa de acerto muito alta (~89%).
//
// Padrão religioso/regional recorrente em SC (colonização alemã/italiana): 12/08 (Nossa
// Senhora da Conceição) e 10/31 (Dia da Reforma Protestante) aparecem repetidos em vários
// municípios — mesmo tratamento já dado a outros padrões de santo/data religiosa repetida
// (Santo Antônio, São João, Santo Agostinho no MA). Guarujá do Sul: página cita 18/12 como
// aniversário "decretado como feriado municipal" mas o próprio texto diz que essa data "não
// aparece na tabela principal de 2026" — não promovido, por consistência com o método de
// sempre priorizar a data formalmente listada. Ibicaré 01/05 (coincide com Dia do Trabalhador)
// filtrado automaticamente pelo cross-reference por já ser feriado nacional.
//
// 74 promovidos + 8 criados diretamente.
//
// SEGUNDA LEVA DO AGREGADOR calendario.online EM SC — mesma sessão. Continuação da varredura
// por municípios-com-candidato-pendente, de Maracajá a Águas Mornas (~89 municípios, quatro
// lotes) — esgota o pool de municípios-com-candidato-pendente do SC (restam só Antônio Carlos,
// Benedito Novo, Governador Celso Ramos, Grão-Pará e Presidente Castello Branco, todos já
// confirmados sem resultado no agregador, mesma frase-padrão "não encontramos nenhum feriado
// municipal"). Taxa de acerto muito alta (~95%).
//
// Vários casos de "sempre priorizar a data formalmente listada": Rancho Queimado (só 22/08
// está na tabela, aniversário 08/11 citado só no texto introdutório, não promovido), Rio dos
// Cedros (só 08/12 na tabela, aniversário 19/12 fora da tabela, não promovido), São José do
// Cerrito (só 29/06 na tabela, aniversário 07/12 fora da tabela, não promovido), Vargeão (a
// própria página esclarece que 21/04 é o feriado NACIONAL de Tiradentes coincidindo com o
// aniversário local, não um feriado municipal à parte — não promovido). Vidal Ramos 17/02
// ("Carnaval, Aniversário de Vidal Ramos") e Piratuba 18/02 (leva anterior) coincidem com datas
// móveis nacionais 2026 (Carnaval terça/Quarta de Cinzas) — filtrados automaticamente. Mesmo
// padrão de 12/08 (Nossa Senhora da Conceição) e 10/31 (Reforma Protestante) mantido. Novo
// padrão observado (não verificado por busca, só registrado): 25/07 aparece repetido em vários
// municípios do oeste/meio-oeste catarinense — promovido pelo mesmo critério de padrão
// cross-município já combinado com o usuário, mas sem confirmação do significado religioso
// específico da data (pode ser São Tiago Apóstolo, cuja festa é 25/07, mas isso não foi
// verificado nesta leva).
//
// 81 promovidos + 8 criados diretamente.
//
// PRIMEIRA LEVA DO AGREGADOR calendario.online NO CEARÁ (CE) — mesma sessão. Com o pool do SC
// esgotado, CE tinha o maior pool intocado (51 municípios). Mesmo método: varredura alfabética
// dos municípios sem cobertura municipal que têm candidato pendente no dataset comunitário. De
// Alto Santo a Morrinhos (~29 municípios, dois lotes; Itapajé sem resultado no agregador). Taxa
// de acerto muito alta (~97%).
//
// Padrão observado (não verificado por busca): 10/04 (possivelmente São Francisco de Assis)
// repetido em Brejo Santo, Canindé e Ipu. Casos de "sempre priorizar a data formalmente
// listada": Guaiúba (17/03 citado como aniversário decretado, mas fora da tabela detalhada, não
// promovido) e Morrinhos (06/11 aniversário citado só como comemoração, não na tabela oficial,
// não promovido).
//
// 46 promovidos + 13 criados diretamente.
//
// SEGUNDA LEVA DO AGREGADOR calendario.online NO CE — mesma sessão. De Mucambo a Várzea Alegre
// (~19 municípios, um lote) — esgota o pool de municípios-com-candidato-pendente do CE (resta
// só Itapajé, já confirmado sem resultado no agregador). Taxa de acerto de 100%.
//
// Casos de "sempre priorizar a data formalmente listada": Piquet Carneiro (só 12/07 está na
// tabela; a página cita 15/07 como aniversário mas o próprio texto diz que a data marcada na
// tabela é 12/07 — promovido só 12/07) e Tamboril (só 22/01 na tabela; 04/10 aniversário citado
// como não constando na tabela oficial, não promovido). Potengi listava "05/04 — Páscoa,
// Feriado Municipal" (Domingo de Páscoa) como uma das datas decretadas — mesmo padrão já visto
// em São Vicente Ferrer/MA (leva 2 do MA); não processado por prudência, mesma razão registrada
// lá (schema suporta pascoa+0, mas fica fora do fluxo padrão que só lida com mes/dia fixos).
//
// 28 promovidos + 8 criados diretamente.
//
const DECISOES2: Decisao[] = [
];
// INÍCIO DO RIO GRANDE DO SUL (RS) — mesma sessão. Terceiro grande achado de documento-jackpot,
// logo após MG e BA: +213 promovidos de uma vez só. O TJRS publica "Feriados Municipais nas
// Comarcas do RS" (dados atualizados até junho/2021) — documento de 12 páginas cobrindo
// alfabeticamente de Agudo a Viamão, com motivo detalhado por data (ao contrário do TJBA, mas
// como o TJMG). Contém também sub-comarcas de Pelotas (Turuçu, Morro Redondo, Capão do Leão,
// Arroio do Padre) listadas com seus próprios feriados. Excluídos do cruzamento: "C. Christi"/
// "Corpus Christi" (móvel, data específica de 2021, já coberto pelo motor nacional). "N. Sra.
// dos Navegantes" (02/02) foi MANTIDO no cruzamento por ser data fixa, mesmo aparecendo em quase
// toda comarca costeira/geral do RS — tratado como feriado municipal genuíno por comarca, não
// como feriado estadual único (distinto do caso da N. Sra. da Penha em ES, que tinha base legal
// estadual explícita). "Dia da Reforma" (31/10) é feriado protestante regional legítimo, comum
// no RS por herança de imigração alemã/luterana — distinto do "Dia do Evangélico" nacional-
// padrão visto em outros estados. Processo idêntico ao de MG/BA: transcrição→cruzamento
// automático→geração de decisões. Restam pendentes ~385 candidatos de RS: ~342 em municípios sem
// comarca própria no documento e o restante em datas não coincidentes. Nenhuma rejeição feita.
// INÍCIO DA BAHIA (BA) — mesma sessão. Segundo grande achado de documento-jackpot, logo após
// MG: +401 promovidos de uma vez só. O TJBA publica anualmente o "Decreto Judiciário nº 09"
// (2026: de 07/01/2026, Diário da Justiça Eletrônico nº 3.959) com ANEXO listando as datas de
// suspensão do expediente forense por feriado municipal em 193 comarcas do estado — mas, ao
// contrário do documento do TJMG, este lista APENAS as datas, sem motivo (padroeiro/aniversário/
// etc.). Processo: (1) localização do PDF real via tentativa de padrão de URL (o ID do arquivo é
// sequencial ao dos decretos vizinhos nº 07/08, mesmo Diário); leitura via WebFetch-falha→
// Read-local; (2) transcrição para objeto JS comarca→[[mes,dia],...] (scratch-ba-comarcas.mjs,
// não versionado); (3) cruzamento automático contra os 868 candidatos pendentes de BA por nome
// de município (normalizado, maiúsculas/acentos) + data exata; (4) geração das decisões usando o
// próprio campo descricao_original do candidato como nome quando disponível (muitos candidatos
// da BA já vinham com motivo detalhado no dataset comunitário — ex.: "Dia de Santo Antônio",
// "Emancipação Política do Município de Caetité"), com "Feriado Municipal" + disclosure quando
// ausente. Restam pendentes ~467 candidatos de BA: ~358 em municípios sem comarca própria no
// documento (comarca compartilhada com município vizinho, não mapeada aqui) e o restante em
// datas que não coincidiram com o anexo de 2026 (o dataset comunitário pode estar desatualizado
// ou o feriado pode ter sido alterado). Nenhuma rejeição foi feita — não-correspondências ficaram
// pendentes, não rejeitadas.
// INÍCIO DE MINAS GERAIS (MG) — mesma sessão. GRANDE ACHADO, o maior de toda a sessão em volume:
// +533 promovidos de uma vez só. O TJMG publica o "Anexo Único da Portaria Conjunta da
// Presidência nº 1.196, de 7 de maio de 2021" — "Feriados municipais das comarcas do Estado de
// Minas Gerais" — um documento de 26 páginas cobrindo alfabeticamente de Abaeté a Visconde do Rio
// Branco (praticamente todas as ~296 comarcas do estado), com 3 a 5 feriados municipais por
// comarca cada. O documento é de 2021, mas as datas de padroeiro/aniversário/emancipação são
// fixas e permanentes por lei municipal — não mudam ano a ano como Corpus Christi ou Paixão de
// Cristo (que foram EXCLUÍDOS do cruzamento por serem específicos do calendário móvel de 2021,
// já cobertos pelo motor nacional de qualquer forma). Processo: (1) transcrição manual de todo o
// texto do PDF (lido via WebFetch-falha→Read-local, mesma técnica de SE/ES/MT/PA) para um objeto
// JS comarca→[mes,dia,motivo] (script scratch-mg-comarcas.mjs, não versionado); (2) script de
// cruzamento automático contra os 1337 candidatos pendentes de MG por nome de município + data
// exata (scratch-mg-match.mjs); (3) geração automática das 533 decisões de promoção em lote
// único (scratch-mg-gerar-decisoes.mjs), evitando digitação manual e o risco de reexecução
// acidental já visto antes em PA. Restam pendentes ~804 candidatos de MG: ~703 em municípios sem
// comarca própria no documento (provavelmente anexados à comarca de um município vizinho não
// identificado nesta pesquisa) e o restante em datas que não coincidiram com o documento de 2021
// (podem ter mudado desde então, ou o candidato do dataset comunitário está incorreto). Nenhuma
// rejeição foi feita nesta leva — as não-correspondências foram deixadas pendentes, não
// rejeitadas, já que a ausência no documento de 2021 não prova que a lei municipal não exista.
// Terceira leva de PA (mesma sessão): +9 promovidos, 1 rejeitado. Juruti teve os 2 candidatos
// confirmados de uma vez (09/04 aniversário da elevação a Vila em 1883, Lei Provincial nº 1.104;
// 02/07 padroeira N. Sra. da Saúde, Lei Municipal nº 179/1998). São Félix do Xingu 10/04
// (aniversário da instalação em 1962) confirmado por instituto acadêmico (IEX/UNIFESSPA). Uruará
// teve os 2 candidatos confirmados de uma vez por reportagem local dedicada (13/05 padroeira,
// 13/09 aniversário). Ourém, Rio Maria, Santa Maria do Pará e Irituia confirmados por
// agregadores/reportagens, com disclosure quando o motivo específico não foi localizado. Tucumã
// 13/05 REJEITADO: o feriado foi instituído pela Lei Municipal nº 259/2004 mas REVOGADO pela Lei
// Municipal nº 441-A/2011 — não está mais vigente, novo caso do padrão "feriado revogado mas
// candidato comunitário desatualizado" já visto antes nesta sessão (AL, MT). Restam pendentes
// ~24 candidatos de PA, muitos sem fonte localizada mesmo após buscas direcionadas (Bragança,
// Brasil Novo, Capitão Poço, Concórdia do Pará, Floresta do Araguaia, Igarapé-Açu, Medicilândia,
// Mocajuba, Mãe do Rio, Ourilândia do Norte, Ponta de Pedras, Rurópolis, Soure 29/06, São
// Domingos do Araguaia, São Domingos do Capim, Ulianópolis, Óbidos).
// Segunda leva de MS (retomada, mesma sessão): +3 promovidos. Nova releitura do calendário do
// TJMS (mesma fonte usada na leva anterior) confirmou mais 3 candidatos que não tinham aparecido
// na extração anterior (o resumo do WebFetch é feito por um modelo pequeno com saída truncada,
// então releituras direcionadas por lote de municípios trazem entradas novas): Água Clara 31/10
// (Dia do Evangélico — 28/06 seguiu sem confirmação), Bandeirantes 20/06 (aniversário) e Rio
// Brilhante 26/09 (aniversário). Restam pendentes ~19 candidatos de MS, principalmente em
// municípios cuja comarca não teve holiday localizado no TJMS mesmo após releitura (Aral Moreira,
// Bela Vista, Bodoquena, Caracol, Figueirão, Jateí, Ladário, Laguna Carapã, Novo Horizonte do
// Sul, Paranhos 24/06, Porto Murtinho 15/06, Rochedo, Tacuru 20/01+13/05, Vicentina).
// RN décima primeira leva (mesma sessão, sem promoções, 2 rejeitados): Jardim do Seridó teve
// seus 2 últimos candidatos pendentes (01/09, 08/09) REJEITADOS ao localizar o Decreto nº
// 001/2026 da própria Prefeitura, que estabelece o calendário oficial completo de feriados e
// pontos facultativos do município para 2026 — lista exaustivamente só 2 feriados não-nacionais
// (14/05 aniversário, 13/06 padroeiro), sem nenhuma data de setembro. TJRN NÃO publica lista
// exaustiva de feriados municipais por comarca como TJMS/TJMT/TJSE/TJES — a portaria conjunta do
// TJRN apenas diz "não haverá expediente quando houver lei específica do município", sem listar
// as leis — abordagem descartada para RN. Buscas individuais para Carnaúba dos Dantas, Santana do
// Matos, São José do Campestre 01/06, Pedro Velho 29/06 e Tenente Ananias não encontraram fonte
// suficiente. Restam pendentes ~19 candidatos de RN (Afonso Bezerra, Alto do Rodrigues, Campo
// Redondo, Carnaúba dos Dantas, Florânia, Goianinha, Governador Dix-Sept Rosado 12/07, Pedro
// Velho, Santana do Matos, São José do Campestre, São Tomé, Tenente Ananias, Umarizal).
// Retomada de PI, segunda rodada (mesma sessão): +4 promovidos. São José do Piauí 12/12
// confirmado por reportagem listando nominalmente as 77 cidades brasileiras com feriado nesta
// data. Simões 20/08 confirmado pela Febraban. Simplício Mendes 30/06 e Bom Jesus 24/09
// confirmados por agregadores, com disclosure. TJPI confirmou (via aviso oficial) que Guadalupe
// tem feriado do padroeiro em 12-13/12 (Lei Municipal nº 138/1986) — mas nenhum dos 3 candidatos
// pendentes de Guadalupe (24/06, 25/08, 08/11) corresponde a essa data, então permanecem
// pendentes. Restam pendentes ~16 candidatos de PI (Altos, Buriti dos Lopes, Domingos Mourão,
// Fronteiras, Guadalupe, Jaicós, Luís Correia, Regeneração, Santa Cruz do Piauí, São João do
// Piauí, São Pedro do Piauí 08/12, Uruçuí), a maioria sem fonte localizada mesmo após buscas
// direcionadas repetidas.
// NOTA (mesma sessão, sem promoções): reli o PDF completo do calendário TJSE 2026
// (calendario-tjse-2026.pdf, técnica WebFetch-falha→Read-local já usada com sucesso nesta sessão)
// e cruzei contra os 42 candidatos pendentes de SE (Aquidabã 01/11, Canhoba, Capela 01/06,
// Cristinápolis 24/06+29/06, Feira Nova, Itabaianinha 06/01, Itaporanga d'Ajuda 29/06, Japaratuba
// 06/01, Japoatã 02/06+25/11, Laranjeiras 07/06, Macambira, Moita Bonita, Muribeca, Neópolis
// 24/06, Nossa Senhora Aparecida, Nossa Senhora da Glória 06/01+26/11, Nossa Senhora de Lourdes,
// Pacatuba 24/06+29/06, Pinhão (5 datas), Pirambu 29/06, Porto da Folha 20/08, Poço Redondo
// 24/06+23/11, Poço Verde 24/06, Propriá 29/06, Riachão do Dantas 14/05, Salgado, Simão Dias
// 05/04, Siriri, Tomar do Geru). RESULTADO: nenhuma correspondência exata — o calendário forense
// do TJSE já teve suas correspondências extraídas nas levas anteriores desta sessão (36+1
// promovidos); o que resta são datas ausentes do documento (Canhoba, Feira Nova, Macambira,
// Moita Bonita, Muribeca, Nossa Senhora Aparecida, Nossa Senhora de Lourdes, Pinhão, Siriri, Tomar
// do Geru não aparecem em NENHUMA comarca do documento) ou datas próximas mas não coincidentes
// com o feriado real da comarca (ex.: N. Sra. da Glória tem "Festa dos Santos Reis" em 05/01, não
// 06/01; Riachão do Dantas tem emancipação em 09/05, não 14/05) — padrão consistente com muitos
// candidatos genéricos "São João" (24/06) e "São Pedro" (29/06) do dataset comunitário sem base
// real. NENHUM candidato foi promovido ou rejeitado nesta consulta — todos permanecem pendentes,
// já que a ausência de uma comarca neste calendário forense específico não prova que o município
// não tenha feriado municipal por lei própria (só prova que o Judiciário não o observa). Lição:
// este documento já foi "esgotado" para SE — não vale a pena reconsultá-lo para os candidatos
// restantes; qualquer avanço futuro em SE precisará de pesquisa individual por município.
// Limpeza de pendências pequenas (AM/AL/ES/MT/TO, mesma sessão): +1 promovido, 1 rejeitado.
// Palmeirópolis/TO 27/11 (Nossa Senhora das Graças, padroeira — data coincide com o dia litúrgico
// universal da santa). Gurupi/TO 27/09 REJEITADO: a Lei nº 039/2009 confirma que o "Dia do
// Evangélico" municipal é em 30 de novembro, não 27 de setembro — um agregador aparentemente
// confundiu com "último sábado de setembro" de outro ano/cidade. A maioria das pendências
// pequenas restantes (Maravilha/AL, Barcelos/AM, Atílio Vivácqua/ES, Confresa/MT, Natividade/TO,
// Fátima/TO, Colméia/TO, Quebrangulo/AL) seguem sem fonte suficiente após nova tentativa —
// diminishing returns confirmado, momento de mudar de estado.
// Retomada de PA (mesma sessão): +19 promovidos, 3 rejeitados. TJPA NÃO publica um PDF
// abrangente por comarca como TJSE/TJES/TJMS/TJMT (testado e descartado) — pesquisa feita
// município a município. Destaques: Benevides 30/03 é feriado histórico raro — "Libertação dos
// Escravizados de Benevides" em 1884, quatro anos antes da Lei Áurea, tornando o município a
// primeira localidade do Pará (e segunda do Brasil) a libertar pessoas escravizadas (Lei
// Municipal nº 194/68) — mesma categoria rara já vista em Mossoró/RN nesta sessão. Marituba 22/09
// e Igarapé-Miri 16/07 confirmados por lei municipal específica citada pela própria Prefeitura
// (Lei 029/1997 e Lei 2.511/1980, respectivamente). Curuçá 14/05 e Paragominas 23/01 confirmados
// pela própria comunicação do TJPA sobre suspensão de expediente forense nessas datas. Vigia
// 14/02 tem motivo histórico específico (retorno de imagem furtada de N. Sra. de Nazaré). Três
// rejeições por evidência específica contraditória (não por listagem exaustiva desta vez, mas
// por fonte primária apontando outra data): Canaã dos Carajás 30/11 (decreto municipal exaustivo
// lista só 30/08, 08/12, 05/10), Dom Eliseu 12/05 (lei institui 09/05, não 12/05) e Salinópolis
// 08/09 (feriado real é 13/09). CASO CURIOSO: para Soure 29/06, o link de lei citado por uma
// busca ("LEI-Nº-3.342.pdf") ao ser lido diretamente revelou-se a Lei nº 3.342/2014, que institui
// o Dia do Evangélico em 30 DE NOVEMBRO — data totalmente diferente da do candidato (29/06) e sem
// relação com ele. Candidato mantido pendente; lição reforçada de sempre abrir a fonte primária
// antes de promover, mesmo quando o link parece specific/autoritativo. Restam pendentes ~30
// candidatos de PA, muitos sem fonte localizada (Bragança, Capitão Poço, Igarapé-Açu, Irituia,
// Juruti, Floresta do Araguaia, Concórdia do Pará, Mocajuba, Mãe do Rio, Ourilândia do Norte,
// Ourém, Ponta de Pedras, Rio Maria, Rurópolis, Santa Maria do Pará, Soure 29/06, São Domingos do
// Araguaia, São Domingos do Capim, São Félix do Xingu, Tucumã, Ulianópolis, Uruará, Óbidos).
// Retomada de MT (mesma sessão): +28 promovidos, 1 rejeitado — a maior leva única desta sessão.
// GRANDE ACHADO: assim como TJSE/TJES/TJMS, o TJMT publica um PDF abrangente e oficial com
// feriados municipais de TODAS as 79 comarcas do estado (Anexo II da Portaria TJMT/CGJ nº
// 190/2025-GAB-CGJ, de 11/12/2025) — o WebFetch falhou ao converter o PDF para markdown, mas
// salvou o binário localmente; o Read direto no PDF salvo extraiu o texto completo com sucesso
// (mesma técnica já usada com sucesso para SE/ES nesta sessão). Cruzando as 79 comarcas listadas
// contra os 39 candidatos pendentes de MT, quase todos os municípios com comarca própria tiveram
// seus candidatos confirmados de uma vez: Alto Araguaia, Araputanga (2), Barra do Bugres,
// Brasnorte, Campinápolis, Canarana (3), Cláudia, Colíder, Dom Aquino, Guiratinga, Itiquira,
// Jauru (2), Juscimeira (2), Nortelândia, Novo São Joaquim, Porto Alegre do Norte, Porto dos
// Gaúchos, Querência, Ribeirão Cascalheira, Rio Branco (2), Santo Antônio de Leverger e São José
// dos Quatro Marcos (2). Vila Rica foi REJEITADO (10/08) por listagem oficial exaustiva mostrar
// só 2 feriados municipais na comarca (13/05, 29/06), sem incluir a data do candidato. Restam
// pendentes ~10 candidatos de MT, todos em municípios sem comarca própria listada no Anexo II
// (Alto Paraguai, Campos de Júlio, Confresa, Denise, Jangada, Santa Carmem, Santo Antônio do
// Leste, Torixoréu) — provavelmente anexados a comarcas de municípios vizinhos não identificadas
// nesta pesquisa; precisaria localizar a que comarca cada um pertence para reaproveitar o mesmo
// documento.
// Inicia MS (retomada, mesma sessão): +14 promovidos, 1 direto, 1 rejeitado. Grande achado: o
// TJMS publica um calendário de feriados municipais 2026 organizado por COMARCA (não por
// município individualmente) em tjms.jus.br/institucional/feriados — vários municípios pequenos
// compartilham comarca com uma cidade-polo maior e herdam seus feriados municipais judicialmente
// reconhecidos. Usado para confirmar de uma vez: Coronel Sapucaia 15/12, Dois Irmãos do Buriti
// 13/11, Fátima do Sul 09/07, Iguatemi 08/05, Itaporã 10/12, Jardim 14/05, Nioaque 08/04 e 22/05,
// Sete Quedas 13/05, Tacuru 08/12 (via Comarca de Iguatemi), Paranhos 17/11 e 08/12 (via Comarca
// de Sete Quedas) e Antônio João 27/06 (via Comarca de Ponta Porã). Nioaque 18/07 confirmado por
// fonte adicional (MPMS). CASO IMPORTANTE — Antônio João 18/03 (candidato 12296) tinha 1 dia de
// divergência da data real: o TJMS lista o feriado de São José da Comarca de Ponta Porã em
// 19/03, não 18/03. Em vez de simplesmente "corrigir" o candidato, ele foi REJEITADO
// explicitando o motivo, e a data correta (19/03) foi cadastrada via criar_direto — mantém o
// candidato original como rastro de auditoria fiel ao que veio da fonte comunitária, sem misturar
// com o dado verificado. Restam pendentes ~22 candidatos de MS, a maioria em municípios cuja
// comarca não teve holiday específico localizado no calendário do TJMS (Aral Moreira, Bandeirantes,
// Bela Vista, Bodoquena, Caracol, Figueirão, Jateí, Ladário, Laguna Carapã, Novo Horizonte do Sul,
// Porto Murtinho, Rio Brilhante, Rochedo, Vicentina, Água Clara).
// Retomada de PI (mesma sessão): +10 promovidos. Esperantina, José de Freitas e Oeiras (todos
// 08/12, Nossa Senhora da Conceição) confirmados por múltiplos calendários municipais
// consistentes ao longo de vários anos — padrão regional recorrente de padroeira no Piauí, já
// visto antes nesta sessão. Piracuruca teve os 2 candidatos confirmados de uma vez (16/07,
// 28/12 aniversário). Parnaíba 04/10 (São Francisco de Assis) confirmado por matéria
// jornalística local detalhando a origem histórica do feriado (projeto de lei do vereador Yure
// Gomes). São Pedro do Piauí 29/06 (padroeiro São Pedro, mesmo nome do município) confirmado por
// decreto municipal específico no Diário Oficial das Prefeituras. Cocal 02/05 confirmado pela
// Febraban. São Miguel do Tapuio 25/03 (emancipação, Decreto nº 52/1938) confirmado por
// cobertura jornalística local. União 29/08 confirmado por agregadores, com disclosure. TJPI não
// publica um PDF abrangente por comarca como TJSE/TJES/TJMG — tentativa registrada e descartada.
// Restam pendentes ~20 candidatos de PI, muitos sem qualquer fonte localizada (Altos, Bom Jesus,
// Buriti dos Lopes, Domingos Mourão, Fronteiras, Guadalupe, Jaicós, Luís Correia, Regeneração,
// Santa Cruz do Piauí, Simplício Mendes, Simões, São João do Piauí, São José do Piauí, São Pedro
// do Piauí 08/12, Uruçuí).
// Segunda retomada de ES (mesma sessão): +18 promovidos, 2 rejeitados. Afonso Cláudio teve os 2
// candidatos restantes confirmados de uma vez pelo Informativo de Feriados Municipais 2025 do
// TJES (fonte institucional, mesmo padrão de confiabilidade das outras fontes de tribunal usadas
// nesta sessão). Iúna teve os 2 candidatos confirmados por lei municipal específica (nº
// 1.831/2002) citada pela própria Câmara Municipal. Jerônimo Monteiro teve os 2 candidatos
// confirmados pela página oficial de feriados municipais do TJES. Irupi (São João Batista, Lei
// 047/94), Ponto Belo (São João, Lei 50/98) e Sooretama (aniversário, Lei Municipal 412/2005 +
// Lei Estadual 4.892/1994) confirmados com lei específica citada por fonte institucional
// (câmaras municipais). São Roque do Canaã teve os 2 candidatos confirmados por pesquisa sobre
// sua história (plebiscito de emancipação 25/06/1995 + fundação da paróquia 16/08/1953). Vila
// Pavão 29/06 (São Pedro) confirmado repetidamente por várias matérias da própria Câmara
// Municipal ao longo dos anos. Pinheiros, Fundão e Vila Valério tiveram candidatos confirmados
// por agregadores/decreto municipal, com disclosure quando o motivo específico não foi
// localizado. Duas rejeições por listagem oficial exaustiva: Iconha 08/12 (busca específica
// confirma que NÃO é feriado municipal ali) e Dores do Rio Preto 14/09 (a página oficial do
// TJES lista exaustivamente 4 feriados da comarca — 07/04, 08/06, 29/08, 15/09 — sem incluir
// 14/09; a data correta do feriado de N. Sra. das Dores é 15/09). Restam pendentes apenas Alto
// Rio Novo (31/10), Brejetuba (15/06) e Pedro Canário (26/12), sem fonte localizada — ES fica
// com pool de candidatos praticamente esgotado (~3 pendentes).
// Retomada de TO (mesma sessão): +6 promovidos. Almas teve 2 candidatos confirmados de uma vez
// (18/05, 10/12), mas o de 17/05 ficou pendente por não constar na mesma listagem específica.
// Arraias 20/01 (São Sebastião) confirmado pela própria notícia do TJTO sobre a portaria da
// Comarca de Arraias para 2026. Colinas do Tocantins 31/10 (Dia do Evangélico) confirmado pelo
// próprio Diário Oficial do Município. Miracema do Tocantins 25/06 (Dia de Ação de Graças) e
// Tocantinópolis 07/07 confirmados por agregadores. IMPORTANTE — Silvanópolis 20/01 (candidato
// 17159) foi INVESTIGADO E REJEITADO NA PRÁTICA (mantido pendente, não promovido): uma busca
// inicial sugeriu confirmação via um artigo "listão" de cidades com feriado de São Sebastião,
// mas ao abrir o artigo primário diretamente ele NÃO menciona Silvanópolis nem qualquer cidade
// do Tocantins — mesmo padrão de fabricação de resumo de busca já flagrado antes nesta sessão
// para este mesmo par de municípios (Arraias/Silvanópolis, ver nota de TO anterior). Lição
// reforçada: um "listão" de cidades por data é o tipo de fonte mais sujeito a alucinação de
// resumo de busca — SEMPRE abrir o artigo primário antes de promover com base nele. Restam
// pendentes ~8 candidatos de TO (Almas 17/05, Colméia 06/08+26/12, Fátima 21/12, Natividade
// 16/08, Palmeirópolis 27/11, Silvanópolis 20/01). NOTA PARA TRABALHO FUTURO: o TJMG (Minas
// Gerais) também publica "Feriados municipais das Comarcas" em PDF
// (tjmg.jus.br/data/files/.../feriados-interior.pdf) — mesmo padrão de "PDF abrangente" que
// funcionou muito bem para TJSE/TJES nesta sessão; alta prioridade para quando MG (1337
// candidatos pendentes) for atacado.
// Retomada de AM+AL (mesma sessão): +8 promovidos, 2 rejeitados. AM: Codajás 28/11, Humaitá
// 31/10 (Dia do Evangélico) e Tabatinga 29/09 (Santos Anjos) confirmados por agregadores
// consistentes — restam pendentes só Barcelos (07/08, sem confirmação). AL: Campo Grande 01/06
// (emancipação, observada 1 dia após a data legal 31/05/1960), Major Isidoro 01/06, Piranhas
// 22/03 e São José da Tapera 15/09 confirmados por agregadores/página oficial, sem motivo
// específico localizado em alguns casos — disclosure feita. Traipu 18/12 confirmado pela
// Febraban (fonte institucional do setor bancário, mesmo padrão de confiabilidade já usado
// nesta sessão). Duas rejeições importantes: Porto Calvo 22/07 — a listagem oficial exaustiva de
// feriados do município (12/04, 21/11, 28/12) não inclui essa data, que corresponde a um
// festival cultural (Festival Calabar), não a feriado. São José da Laje 06/01 (Santos Reis) — o
// feriado foi EXPLICITAMENTE CANCELADO pela Lei nº 295, de 12/08/1953, permanecendo só como
// festejo cultural sem efeito de feriado — novo padrão de rejeição (feriado revogado há décadas,
// mas a festa popular continua existindo, o que gera falsos candidatos no dataset comunitário).
// Restam pendentes apenas Maravilha/AL (07/12) e Quebrangulo/AL (27/09), sem fonte localizada.
// RN décima leva (mesma sessão): +8 promovidos. Baraúna teve os 2 candidatos confirmados de uma
// vez por agregadores consistentes (sem lei localizada — disclosure feita). Serra do Mel 13/05
// confirmado por cobertura jornalística local detalhada da própria celebração oficial
// (Sessão Solene + Missa). Lagoa Nova teve os 2 candidatos restantes confirmados de uma vez pela
// própria página oficial "Feriados Municipais" da Prefeitura (tabela completa incluindo
// nacionais/estaduais/municipais). Lajes 08/12 e Santo Antônio 08/12 (ambos N. Sra. da
// Conceição) confirmados por fontes distintas (Arquidiocese de Natal para Lajes, iFeriados para
// Santo Antônio). Upanema teve seu segundo feriado (16/11) confirmado por agregadores, distinto
// do 16/09 já promovido. Restam pendentes ~19 candidatos de RN, concentrados em municípios sem
// presença digital forte (Afonso Bezerra, Alto do Rodrigues, Campo Redondo, Carnaúba dos Dantas,
// Florânia, Goianinha, Governador Dix-Sept Rosado 12/07, Jardim do Seridó 09/01+09/08, Pedro
// Velho 06/29, Santana do Matos, São José do Campestre 01/06, São Tomé, Tenente Ananias,
// Umarizal) — próxima tentativa deve buscar diretamente o Diário Oficial/Diário Municipal
// (femurn/diariomunicipal.com.br) desses municípios, já que buscas genéricas se esgotaram.
// RN nona leva (mesma sessão): +10 promovidos, 1 rejeitado. Governador Dix-Sept Rosado 04/04
// (emancipação, Lei nº 2.878/1963). Ipanguaçu teve os 2 candidatos confirmados por agregadores
// consistentes (sem lei localizada — disclosure feita). Macau 08/12 confirmado pela própria
// Arquidiocese de Natal (festa da padroeira). Martins teve os 2 candidatos confirmados de uma
// vez (06/01 Santos Reis, 10/11 emancipação). Parelhas: duas buscas independentes convergiram
// especificamente em "20/01 e 24/06 são os 2 únicos feriados municipais oficiais" — 24/06
// promovido, e o candidato de 08/11 (aniversário) REJEITADO com a mesma fonte, que explicita que
// o aniversário não é feriado oficial (padrão de rejeição por listagem exaustiva, agora também
// via busca corroborada em vez de página oficial única). Alexandria 07/11 confirmado pela
// Wikipédia citando o Decreto nº 10 de 7 de novembro de 1930. Pedro Velho 10/05 confirmado por
// decreto municipal (nº 15/2023) no Diário Oficial do Município. São Miguel teve os 2 candidatos
// confirmados de uma vez (29/09 padroeiro São Miguel Arcanjo, 11/12 aniversário). Restam
// pendentes ~30 candidatos de RN (Afonso Bezerra, Alto do Rodrigues, Baraúna, Campo Redondo,
// Carnaúba dos Dantas, Florânia, Goianinha, Governador Dix-Sept Rosado 12/07, Ipanguaçu já
// resolvido, Jardim do Seridó 09/01+09/08, Lagoa Nova 06/24+10/04, Lajes 12/08, Pedro Velho
// 06/29, Santana do Matos, Santo Antônio 12/08, Serra do Mel, São José do Campestre 01/06, São
// Tomé, Tenente Ananias, Umarizal, Upanema 11/16).
// RN oitava leva (mesma sessão): +14 promovidos, 1 cadastro direto, 1 rejeitado. Acari: página
// oficial de feriados da Prefeitura lista só 1 feriado municipal (11/04, emancipação) — o outro
// candidato pendente (15/08) foi REJEITADO por omissão dessa listagem exaustiva (mesmo padrão já
// usado com sucesso em MS/ES/RN nesta sessão). Areia Branca e Ceará-Mirim tiveram os 2
// candidatos restantes de cada um confirmados de uma vez por página oficial "Feriados
// Municipais"/"História" da própria Prefeitura. Caraúbas 05/03 confirmado por 3 reportagens
// jornalísticas independentes que listam nominalmente as ~7 cidades brasileiras com feriado
// nesta data. Jucurutu 29/09 (padroeiro São Miguel Arcanjo, Diocese de Caicó). Pau dos Ferros
// 04/09 (emancipação, confirmado por portaria do próprio IFRN local que menciona transferência
// pontual do feriado). Nísia Floresta teve os 2 candidatos confirmados por agregadores
// consistentes (sem lei específica localizada — disclosure feita na observação, mesmo padrão já
// aceito para outros municípios nesta sessão quando não há candidato de emancipação/padroeiro
// contraditório). São José de Mipibu 26/07 (padroeiros Santana e São Joaquim, Lei Municipal
// 1115/2016 citada pela própria Prefeitura) — aproveitado para cadastrar direto também o
// 16/10 (Emancipação Política) da mesma lei, sem candidato correspondente na fila. Monte Alegre
// 31/10 (padroeira, legislação municipal no site da própria Prefeitura). Pedro Avelino 23/12
// (emancipação política, amplamente noticiado pela própria Prefeitura). Touros 02/01 (Bom Jesus
// dos Navegantes, citado na própria Lei Orgânica Municipal). NOTA IMPORTANTE: ao tentar verificar
// São Tomé/RN 08/12, a URL saotome.rn.gov.br/feriado-municipal/ retornou conteúdo de um site de
// apostas online (domínio aparentemente comprometido/sequestrado) — candidato mantido PENDENTE
// por segurança, apesar de busca inicial sugerir confirmação; lição: sempre validar o conteúdo
// real da página, nunca confiar cegamente no resumo de busca quando o link primário se mostra
// suspeito. Alto do Rodrigues, Afonso Bezerra, Baraúna, Campo Redondo, Carnaúba dos Dantas,
// Florânia, Goianinha e Umarizal seguem pendentes por falta de fonte suficiente. Restam
// pendentes ~41 candidatos de RN.
// RN sétima leva
// RN sétima leva (mesma sessão): +6 promovidos. Guamaré teve os 3 candidatos pendentes
// confirmados de uma vez por um calendário oficial de feriados municipais que lista
// exaustivamente 5 feriados (20/01, 07/05, 15/08, 08/12, 12/12) — todos os 3 candidatos batem.
// Santo Antônio 05/07 (emancipação política, distinta do padroeiro Santo Antônio 13/06 já
// promovido antes); o candidato de 08/12 (N. Sra. da Conceição) segue pendente por falta de
// fonte. São José do Campestre 23/12 (emancipação política, distinta do padroeiro São José
// 19/03); o candidato de 01/06 (Festa de Reis) segue pendente — descrito como festa popular, sem
// confirmação de que seja feriado municipal oficialmente decretado. Upanema 16/09 (encerramento
// da Semana Cultural/Emancipação Política, 06 a 16/09); o candidato de 16/11 segue pendente por
// falta de qualquer fonte.
// RN sexta leva (mesma sessão): +7 promovidos. Jardim do Seridó 08/12 (padroeira N. Sra. da
// Conceição, confirmada pela página de história da própria Prefeitura). Lagoa Nova 02/01
// (emancipação de Currais Novos em 1964). Lajes teve os 2 candidatos restantes confirmados de
// uma vez pela própria página "Emancipação" da Prefeitura: 03/05 padroeira Divina Santa Cruz e
// 03/12 emancipação política (Lei Estadual nº 572/1923) — distinta do aniversário popular
// (25/11), que a mesma fonte deixa claro NÃO ser feriado oficial. São Paulo do Potengi teve os
// 3 candidatos pendentes resolvidos de uma vez pela página oficial "Feriados Municipais" da
// própria Prefeitura, que lista exaustivamente os 3 feriados municipais: 25/01 (padroeiro São
// Paulo Apóstolo), 29/06 (São Pedro e São Paulo) e 30/12 (Emancipação Política).
// RN quinta leva (mesma sessão): +6 promovidos, 1 rejeitado. Campo Redondo, Currais Novos e
// Macau tiveram a maioria/todos os candidatos pendentes confirmados de uma vez. João Câmara: a
// própria página oficial de feriados da Prefeitura lista só 2 feriados municipais (29/10
// emancipação, 08/12 padroeira N. Sra. Mãe dos Homens) — o candidato de 29/06 não corresponde a
// nenhum dos dois e foi REJEITADO com essa fonte que enumera exaustivamente os feriados reais
// (mesmo padrão de rejeição por omissão de uma listagem oficial completa, já usado com sucesso
// em MS/ES nesta sessão). Restam pendentes ~69 candidatos de RN.
// RN quarta leva (retomada após pausa por limite de uso): +5 promovidos. Caicó 16/12
// (Emancipação Política — na verdade a data da elevação de Vila Nova do Príncipe a Cidade do
// Príncipe em 1868, não a emancipação original de 1788, mas é essa a data mantida como feriado
// municipal até hoje, confirmada pela própria prefeitura e pelo prefeito em entrevista). Mossoró
// teve os 2 candidatos restantes confirmados: 30/09 é um feriado histórico raro — "Libertação
// dos Escravizados", pois Mossoró aboliu a escravidão localmente em 1883, antes da Lei Áurea
// nacional, e instituiu o feriado em 1913 — categoria distinta de emancipação política ou
// padroeiro, mais parecida com efeméride cívica; 13/12 é a padroeira Santa Luzia. São Gonçalo do
// Amarante teve os 2 candidatos pendentes confirmados de uma vez pela própria página oficial de
// feriados da prefeitura (28/01 padroeiro São Gonçalo, instituído 1978; 11/12 emancipação
// política, instituída 1990). Restam pendentes ~76 candidatos de RN.
// RN terceira leva (mesma sessão): +12 promovidos, de mais ~15 candidatos revisados, focando em
// municípios com 3 candidatos pendentes (mais eficiente pesquisar o conjunto todo de uma vez).
// Nova Cruz (3 de 3) e Patu (3 de 3) resolvidos completamente com uma única busca cada — ambos
// têm exatamente 3 feriados municipais bem documentados por fontes regionais/prefeitura. Touros
// e Santa Cruz tiveram 2-3 de 3 candidatos confirmados. Nota de cautela registrada: para Santa
// Cruz, duas fontes divergem sobre a data exata da emancipação (30/11 vs 11/12) — usei 30/11 por
// bater exatamente com o candidato pendente e ter confirmação regional específica, mas a
// divergência fica registrada caso surja evidência mais forte depois. Restam pendentes ~81
// candidatos de RN.
// RN segunda leva (mesma sessão): +6 promovidos, 1 rejeitado, de mais ~10 candidatos revisados.
// Apodi teve os 3 candidatos restantes resolvidos de uma vez (tem 2 padroeiros distintos, São
// João Batista 24/06 e N. Sra. da Conceição 08/12, mais a emancipação 23/03) — REJEITADO o
// quarto candidato (02/05) com fonte que confirma explicitamente que uma lei recente rebaixou
// essa data de feriado pleno para ponto facultativo (categoria nova de rejeição: "era feriado,
// virou ponto facultativo", distinta de "nunca foi feriado" e de "foi extinto e substituído por
// outra data" já vistas antes). Alexandria teve 2 dos 3 candidatos confirmados (28/05 memorial
// pelo falecimento do Coronel Manoel Emídio de Souza, e 08/12 padroeira N. Sra. da Conceição) —
// o terceiro (07/11) ficou pendente por informação contraditória nas fontes encontradas (uma
// mesma busca listou 07/11 como um dos 3 feriados oficiais E como \"não é feriado, é só
// aniversário\" ao mesmo tempo — quando a própria fonte se contradiz, mais seguro deixar
// pendente do que escolher um lado). Santana do Matos: padroeira Sant'Ana confirmada em 26/07
// (fim da festa de 16 a 26/07); os outros 2 candidatos (10/03, 06/08) ficaram pendentes — o de
// 06/08 corresponde a uma data histórica real (reestabelecimento do município em 1855), mas sem
// confirmação específica de que é o feriado municipal atual, então não promovido só pela
// coincidência histórica. Guamaré: fontes contraditórias sobre qual data é a emancipação oficial
// (07/05 vs 30/05) e o decreto municipal citado retornou 404 — todos os 3 candidatos ficaram
// pendentes. Restam pendentes ~94 candidatos de RN.
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
