/**
 * Tela administrativa (Fase 4): incluir/corrigir feriados estaduais e
 * municipais manualmente, sempre registrando fonte, autor e data da
 * alteração. Sem login nesta versão (ver README) — qualquer pessoa com
 * acesso à rede onde o app roda pode editar; não é um controle de acesso.
 */
import type { FastifyInstance } from "fastify";
import {
  atualizarFeriadoCurado,
  buscarCandidatoPorId,
  buscarFeriadoCuradoPorId,
  buscarMunicipioPorCodigo,
  contarCandidatos,
  contarFeriadosCurados,
  criarFeriadoCurado,
  definirAtivoFeriadoCurado,
  listarCandidatos,
  listarFeriadosCurados,
  listarUfsComCandidatos,
  listarUfsComFeriadosCurados,
  marcarStatusCandidato,
  type DadosFeriadoCurado,
  type TipoFonte,
} from "../services/feriados-service.js";
import { janelaDePaginas } from "../web/paginacao.js";

const UFS = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI",
  "RJ","RN","RS","RO","RR","SC","SP","SE","TO",
] as const;

const TIPOS_FONTE: TipoFonte[] = ["lei", "decreto", "diario_oficial", "api_publica", "outro"];

/** Quantos feriados curados a listagem administrativa mostra por página. */
const FERIADOS_POR_PAGINA = 50;

function ufValida(uf: string | undefined): string | undefined {
  const normalizada = uf?.trim().toUpperCase();
  return normalizada && UFS.includes(normalizada as (typeof UFS)[number]) ? normalizada : undefined;
}

/**
 * Devolve a pessoa à mesma fatia da listagem depois de uma ação de linha —
 * sem isso, desativar um feriado da página 120 jogaria de volta na página 1.
 */
function voltarParaListagem(query: { uf?: string; pagina?: string }): string {
  const params = new URLSearchParams();
  const uf = ufValida(query.uf);
  if (uf) params.set("uf", uf);
  const pagina = Number(query.pagina);
  if (Number.isInteger(pagina) && pagina > 1) params.set("pagina", String(pagina));
  const queryString = params.toString();
  return queryString ? `/admin?${queryString}` : "/admin";
}

interface CorpoFormularioFeriado {
  nome?: string;
  tipoChave?: string;
  abrangencia?: string;
  uf?: string;
  codigoIbge?: string;
  modoData?: string; // "fixa" | "regra"
  mes?: string;
  dia?: string;
  regraCalculo?: string;
  anoInicio?: string;
  anoFim?: string;
  autor?: string;
  dataVerificacao?: string;
  observacao?: string;
  fonteDescricao?: string;
  fonteUrl?: string;
  fonteTipo?: string;
  fonteDataPublicacao?: string;
}

function validarFormulario(corpo: CorpoFormularioFeriado): DadosFeriadoCurado | { erro: string } {
  const nome = corpo.nome?.trim();
  const tipoChave = corpo.tipoChave;
  const abrangencia = corpo.abrangencia;
  const uf = corpo.uf?.trim().toUpperCase();
  const autor = corpo.autor?.trim();
  const dataVerificacao = corpo.dataVerificacao?.trim();
  const fonteDescricao = corpo.fonteDescricao?.trim();
  const fonteTipo = corpo.fonteTipo;

  if (!nome) return { erro: "Informe o nome do feriado." };
  if (tipoChave !== "estadual" && tipoChave !== "municipal" && tipoChave !== "ponto_facultativo") {
    return { erro: "Tipo inválido." };
  }
  if (abrangencia !== "uf" && abrangencia !== "municipio") return { erro: "Abrangência inválida." };
  if (!uf || !UFS.includes(uf as (typeof UFS)[number])) return { erro: "UF inválida." };
  if (!autor) return { erro: "Informe quem está cadastrando/confirmando (autor)." };
  if (!dataVerificacao || !/^\d{4}-\d{2}-\d{2}$/.test(dataVerificacao)) {
    return { erro: "Informe a data de verificação (a data em que a fonte foi conferida)." };
  }
  if (!fonteDescricao) return { erro: "Informe a fonte (lei, decreto, Diário Oficial...) — obrigatória." };
  if (!fonteTipo || !TIPOS_FONTE.includes(fonteTipo as TipoFonte)) return { erro: "Tipo de fonte inválido." };

  let codigoIbge: number | null = null;
  if (abrangencia === "municipio") {
    codigoIbge = Number(corpo.codigoIbge);
    if (!corpo.codigoIbge || !Number.isInteger(codigoIbge)) {
      return { erro: "Selecione um município na busca (abrangência municipal exige um município)." };
    }
    const municipio = buscarMunicipioPorCodigo(codigoIbge);
    if (!municipio) return { erro: "Município selecionado não encontrado na base do IBGE." };
    if (municipio.uf !== uf) return { erro: `O município selecionado é de ${municipio.uf}, mas a UF informada foi ${uf}.` };
  }

  let mes: number | null = null;
  let dia: number | null = null;
  let regraCalculo: string | null = null;
  if (corpo.modoData === "regra") {
    regraCalculo = corpo.regraCalculo?.trim() || null;
    if (!regraCalculo || !/^pascoa([+-]\d{1,3})?$/.test(regraCalculo)) {
      return { erro: 'Regra de cálculo inválida. Use "pascoa", "pascoa+60", "pascoa-47" etc.' };
    }
  } else {
    mes = Number(corpo.mes);
    dia = Number(corpo.dia);
    if (!corpo.mes || !corpo.dia || mes < 1 || mes > 12 || dia < 1 || dia > 31) {
      return { erro: "Informe mês e dia válidos (ou use uma regra baseada na Páscoa)." };
    }
  }

  const anoInicio = corpo.anoInicio?.trim() ? Number(corpo.anoInicio) : null;
  const anoFim = corpo.anoFim?.trim() ? Number(corpo.anoFim) : null;

  return {
    nome,
    tipoChave,
    abrangencia,
    uf,
    codigoIbge,
    mes,
    dia,
    regraCalculo,
    anoInicio,
    anoFim,
    autor,
    dataVerificacao,
    observacao: corpo.observacao?.trim() || null,
    fonte: {
      descricao: fonteDescricao,
      url: corpo.fonteUrl?.trim() || null,
      tipo: fonteTipo as TipoFonte,
      dataPublicacao: corpo.fonteDataPublicacao?.trim() || null,
    },
  };
}

export default async function rotasAdmin(app: FastifyInstance) {
  app.get<{ Querystring: { uf?: string; pagina?: string } }>("/admin", async (req, reply) => {
    const limite = FERIADOS_POR_PAGINA;
    const filtro = { uf: ufValida(req.query.uf) };
    const total = contarFeriadosCurados(filtro);
    const totalPaginas = Math.max(1, Math.ceil(total / limite));
    const pagina = Math.min(totalPaginas, Math.max(1, Number(req.query.pagina) || 1));
    return reply.view("admin.ejs", {
      titulo: "Administração — Feriados Municipais",
      feriadosCurados: listarFeriadosCurados(filtro, limite, (pagina - 1) * limite),
      total,
      // A métrica do topo conta a base inteira, independente do filtro da tabela.
      totalCurados: contarFeriadosCurados(),
      pagina,
      totalPaginas,
      paginas: janelaDePaginas(pagina, totalPaginas),
      ufs: listarUfsComFeriadosCurados(),
      ufSelecionada: filtro.uf ?? "",
      totalCandidatosPendentes: contarCandidatos({ status: "pendente" }),
    });
  });

  app.get<{ Querystring: { erro?: string; codigoIbge?: string; municipioNome?: string; municipioUf?: string; candidatoId?: string } }>(
    "/admin/feriados/novo",
    async (req, reply) => {
      let prefill: Partial<CorpoFormularioFeriado & { municipioNome?: string }> = {};
      if (req.query.candidatoId) {
        const candidato = buscarCandidatoPorId(Number(req.query.candidatoId));
        if (candidato) {
          const [, mesStr, diaStr] = candidato.data.split("-");
          prefill = {
            nome: candidato.nome,
            tipoChave: candidato.tipoSugerido,
            abrangencia: candidato.codigoIbge ? "municipio" : "uf",
            uf: candidato.uf,
            codigoIbge: candidato.codigoIbge ? String(candidato.codigoIbge) : undefined,
            municipioNome: candidato.municipioNome ?? undefined,
            modoData: "fixa",
            mes: mesStr,
            dia: diaStr,
            observacao: candidato.descricaoOriginal
              ? `Candidato importado de ${candidato.fonteDataset}: "${candidato.descricaoOriginal}" — confirmar/corrigir antes de salvar.`
              : `Candidato importado de ${candidato.fonteDataset} — confirmar fonte primária antes de salvar.`,
          };
        }
      }
      return reply.view("admin-form.ejs", {
        titulo: "Novo feriado — Administração",
        ufs: UFS,
        tiposFonte: TIPOS_FONTE,
        erro: req.query.erro,
        candidatoId: req.query.candidatoId ?? null,
        feriado: null,
        prefill,
      });
    },
  );

  app.post<{ Body: CorpoFormularioFeriado; Querystring: { candidatoId?: string } }>(
    "/admin/feriados/novo",
    async (req, reply) => {
      const dados = validarFormulario(req.body);
      if ("erro" in dados) {
        return reply.view("admin-form.ejs", {
          titulo: "Novo feriado — Administração",
          ufs: UFS,
          tiposFonte: TIPOS_FONTE,
          erro: dados.erro,
          candidatoId: req.query.candidatoId ?? null,
          feriado: null,
          prefill: req.body,
        });
      }
      criarFeriadoCurado(dados);
      if (req.query.candidatoId) {
        marcarStatusCandidato(Number(req.query.candidatoId), "promovido");
      }
      return reply.redirect("/admin");
    },
  );

  app.get<{ Params: { id: string } }>("/admin/feriados/:id/editar", async (req, reply) => {
    const feriado = buscarFeriadoCuradoPorId(Number(req.params.id));
    if (!feriado) return reply.code(404).view("admin-form.ejs", { erro: "Feriado não encontrado.", feriado: null, ufs: UFS, tiposFonte: TIPOS_FONTE, prefill: {}, candidatoId: null, titulo: "Editar feriado" });
    return reply.view("admin-form.ejs", {
      titulo: `Editar: ${feriado.nome}`,
      ufs: UFS,
      tiposFonte: TIPOS_FONTE,
      erro: null,
      candidatoId: null,
      feriado,
      prefill: {},
    });
  });

  app.post<{ Params: { id: string }; Body: CorpoFormularioFeriado }>("/admin/feriados/:id/editar", async (req, reply) => {
    const id = Number(req.params.id);
    const dados = validarFormulario(req.body);
    if ("erro" in dados) {
      const feriado = buscarFeriadoCuradoPorId(id);
      return reply.view("admin-form.ejs", {
        titulo: "Editar feriado",
        ufs: UFS,
        tiposFonte: TIPOS_FONTE,
        erro: dados.erro,
        candidatoId: null,
        feriado,
        prefill: req.body,
      });
    }
    atualizarFeriadoCurado(id, dados);
    return reply.redirect("/admin");
  });

  app.post<{ Params: { id: string }; Querystring: { uf?: string; pagina?: string } }>(
    "/admin/feriados/:id/desativar",
    async (req, reply) => {
      definirAtivoFeriadoCurado(Number(req.params.id), false);
      return reply.redirect(voltarParaListagem(req.query));
    },
  );

  app.post<{ Params: { id: string }; Querystring: { uf?: string; pagina?: string } }>(
    "/admin/feriados/:id/reativar",
    async (req, reply) => {
      definirAtivoFeriadoCurado(Number(req.params.id), true);
      return reply.redirect(voltarParaListagem(req.query));
    },
  );

  app.get<{ Querystring: { uf?: string; pagina?: string } }>("/admin/candidatos", async (req, reply) => {
    const pagina = Math.max(1, Number(req.query.pagina) || 1);
    const limite = 30;
    const filtro = { uf: req.query.uf || undefined, status: "pendente" as const };
    return reply.view("admin-candidatos.ejs", {
      titulo: "Candidatos não verificados — Administração",
      candidatos: listarCandidatos(filtro, limite, (pagina - 1) * limite),
      total: contarCandidatos(filtro),
      pagina,
      limite,
      ufs: listarUfsComCandidatos(),
      ufSelecionada: req.query.uf ?? "",
    });
  });

  app.post<{ Params: { id: string } }>("/admin/candidatos/:id/rejeitar", async (req, reply) => {
    marcarStatusCandidato(Number(req.params.id), "rejeitado");
    return reply.redirect(req.headers.referer || "/admin/candidatos");
  });
}
