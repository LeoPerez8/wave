import type { djEn } from "./djEn.ts";

export const djPtBr: typeof djEn = {
  title: "DJ",
  cardDetail: "Escolha os artistas que iniciam sua fila",
  done: "Concluído",
  close: "Fechar",
  starting: "Iniciando sua fila",
  artistTile: (name: string) => `Artista, ${name}`,
  nothingToPick: "Nada para escolher ainda. Ouça algumas músicas e volte depois.",
  noSongsFound: "Nenhuma música encontrada para esses artistas.",
  adjust: "Ajustar",
  backToGrid: "Voltar para DJ",
  artistVariety: "Variedade de artistas",
  varietySteps: { low: "Baixa", medium: "Média", high: "Alta" },
  varietyNotes: {
    low: "Quase só os artistas que você escolheu.",
    medium: "Os artistas que você escolheu e os próximos deles.",
    high: "Um círculo maior de artistas, cada um aparecendo menos.",
  },
  musicDiscovery: "Descoberta de música",
  discoverySteps: { familiar: "Conhecidas", blend: "Misturar", discover: "Descobrir" },
  filters: "Filtros",
  filterNames: {
    trending: "Em alta",
    lesserKnown: "Músicas pouco conhecidas",
    newReleases: "Lançamentos",
  },
  magicQueueFromDj: "Fila Mágica · de DJ",
};
