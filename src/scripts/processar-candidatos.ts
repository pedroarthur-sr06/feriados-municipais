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
// tentadas — retomar com estratégia diferente ou mais tarde.
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
