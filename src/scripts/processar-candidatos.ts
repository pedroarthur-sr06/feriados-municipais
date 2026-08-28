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
const DECISOES2: Decisao[] = [
];
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
