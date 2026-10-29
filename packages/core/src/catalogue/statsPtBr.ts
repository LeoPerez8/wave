import { plural } from "../plural.ts";
import { formatNumber } from "../formatting.ts";
import type { AgoUnit, statsEn } from "./statsEn.ts";

const AGO_UNITS: Record<AgoUnit, readonly [string, string]> = {
  year: ["ano", "anos"],
  month: ["mês", "meses"],
  week: ["semana", "semanas"],
  day: ["dia", "dias"],
  hour: ["hora", "horas"],
  minute: ["minuto", "minutos"],
};

const plays = (count: number) =>
  plural("pt-BR", count, {
    zero: "Nenhuma reprodução",
    one: `${formatNumber("pt-BR", count)} reprodução`,
    other: `${formatNumber("pt-BR", count)} reproduções`,
  });

export const statsPtBr: typeof statsEn = {
  recaps: "Retrospectivas",
  loadingListeningStats: "Carregando estatísticas de audição",
  loadingRanking: "Carregando classificação",
  rankings: {
    songs: "Músicas mais tocadas",
    albums: "Álbuns mais tocados",
    artists: "Artistas mais tocados",
  },
  rankingGoneTitle: "Nada por aqui",
  rankingGoneMessage: "Esta classificação não existe.",
  periods: {
    week: { label: "Últimos 7 dias", tab: "7 dias" },
    month: { label: "Últimos 30 dias", tab: "30 dias" },
    year: { label: "Últimos 12 meses", tab: "12 meses" },
    all: { label: "Todo o período", tab: "Todo o período" },
  },
  noPlays: {
    week: "Nenhuma reprodução nos últimos 7 dias",
    month: "Nenhuma reprodução nos últimos 30 dias",
    year: "Nenhuma reprodução nos últimos 12 meses",
    all: "Nenhuma reprodução ainda",
  },
  countedHint: "As músicas que você ouve por mais de 15 segundos são contadas aqui.",
  plays,
  facts: {
    timeListened: "Tempo de audição",
    plays: "Reproduções",
    songsListened: "Músicas ouvidas",
    songs: "Músicas",
    albums: "Álbuns",
    artists: "Artistas",
  },
  albumNotFound: "Álbum não encontrado",
  albumNotFoundMessage: "Não foi possível encontrar este álbum online.",
  albumFailed: "Não foi possível abrir o álbum",
  albumFailedMessage: "Tente novamente quando estiver online.",
  notPlayedYet: "Ainda não reproduzido",
  mostPlayed: "Mais tocadas",
  minutesListened: (count: number) =>
    plural("pt-BR", count, {
      zero: "Nenhum minuto ouvido",
      one: `${formatNumber("pt-BR", count)} minuto ouvido`,
      other: `${formatNumber("pt-BR", count)} minutos ouvidos`,
    }),
  songsListened: (listened: number, total: number) =>
    plural("pt-BR", total, {
      one: `${formatNumber("pt-BR", listened)} de ${formatNumber("pt-BR", total)} música`,
      other: `${formatNumber("pt-BR", listened)} de ${formatNumber("pt-BR", total)} músicas`,
    }),
  lastPlayed: (ago: string) => `Última reprodução ${ago}`,
  justNow: "agora mesmo",
  yesterday: "ontem",
  ago: (count: number, unit: AgoUnit) => {
    const [one, other] = AGO_UNITS[unit];
    return `há ${plural("pt-BR", count, { one: `${formatNumber("pt-BR", count)} ${one}`, other: `${formatNumber("pt-BR", count)} ${other}` })}`;
  },
};
