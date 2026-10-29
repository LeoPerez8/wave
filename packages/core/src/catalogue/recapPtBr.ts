import { plural } from "../plural.ts";
import type { RecapPeriod } from "../recap.ts";
import type { recapEn } from "./recapEn.ts";

const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

const WEEKDAYS = [
  "domingos",
  "segundas-feiras",
  "terças-feiras",
  "quartas-feiras",
  "quintas-feiras",
  "sextas-feiras",
  "sábados",
];

/** "outubro de 2026", or "2026" for the year; a title capitalises it. */
const inSentence = (period: RecapPeriod) =>
  period.kind === "month" ? `${MONTHS[period.month - 1]} de ${period.year}` : String(period.year);

const title = (period: RecapPeriod) => {
  const text = inSentence(period);
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const hour = (value: number) => `${value}h`;

export const recapPtBr: typeof recapEn = {
  title,
  kinds: { month: "Retrospectiva", year: "Ano na música" },
  tileLabel: (period: RecapPeriod) =>
    period.kind === "month"
      ? `Retrospectiva de ${inSentence(period)}`
      : `Seu ano na música, ${period.year}`,
  ready: {
    month: "Sua Retrospectiva está pronta",
    year: "Seu ano na música está pronto",
  },
  tapToWatch: "Toque para assistir",
  listenedIn: (period: RecapPeriod) => `Em ${inSentence(period)}, você ouviu por`,
  minutes: (count: number) =>
    plural("pt-BR", count, { zero: "minutos", one: "minuto", other: "minutos" }),
  topSongs: "Suas músicas mais tocadas",
  topArtists: "Seus artistas mais tocados",
  topAlbum: "Seu álbum mais tocado",
  topGenres: "Seus gêneros mais tocados",
  shareOfPlays: (percent: string) => `${percent} das suas reproduções`,
  listenedMost: "Você ouviu mais",
  weekdays: WEEKDAYS,
  hour,
  // Saturdays and Sundays are masculine: "aos sábados", "às sextas-feiras".
  onWeekday: (weekday: number) =>
    `${weekday === 0 || weekday === 6 ? "aos" : "às"} ${WEEKDAYS[weekday]}`,
  aroundHour: (value: number) =>
    value === 0
      ? "por volta da meia-noite"
      : value === 12
        ? "por volta do meio-dia"
        : `por volta ${value === 1 ? "da" : "das"} ${hour(value)}`,
  longestStreak: "Sua maior sequência",
  streakDays: (count: number) =>
    plural("pt-BR", count, { zero: "dias seguidos", one: "dia", other: "dias seguidos" }),
  discovered: "Você descobriu",
  newArtists: (count: number) =>
    plural("pt-BR", count, {
      zero: "novos artistas",
      one: "novo artista",
      other: "novos artistas",
    }),
  summaryTopArtists: "Artistas mais tocados",
  summaryTopSongs: "Músicas mais tocadas",
  minutesListened: "Minutos ouvidos",
  topGenre: "Gênero mais tocado",
  slidePosition: (period: RecapPeriod, index: number, count: number) =>
    `${title(period)}, slide ${index} de ${count}`,
  recap: "Retrospectiva",
  paused: "Pausado",
  playing: "Reproduzindo",
  previousSlide: "Slide anterior",
  nextSlide: "Próximo slide",
  resumeStories: "Retomar stories",
  pauseStories: "Pausar stories",
  shareSlide: "Compartilhar slide",
  close: "Fechar Retrospectiva",
  unavailable: "Esta Retrospectiva não está disponível.",
  loading: "Carregando Retrospectiva",
};
