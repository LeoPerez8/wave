import { plural } from "../plural.ts";
import { formatNumber } from "../formatting.ts";
import type { discoverEn } from "./discoverEn.ts";

export const discoverPtBr: typeof discoverEn = {
  rows: {
    "magic-queue": "Fila Mágica",
    "artist-mixes": "Mixes de artistas",
    "genre-mixes": "Mixes de gêneros",
  },
  refresh: {
    "artist-mixes": "Gerar novos mixes de artistas",
    "genre-mixes": "Gerar novos mixes de gêneros",
  },
  otherSongs: "Mostrar outras músicas",
  updating: "Atualizando…",
  buildingMixes: "Criando seus mixes",
  findingSongs: "Procurando músicas",
  mixTitle: (name: string) => `Mix de ${name}`,
  songs: (count: number) =>
    plural("pt-BR", count, {
      zero: "Nenhuma música",
      one: `${formatNumber("pt-BR", count)} música`,
      other: `${formatNumber("pt-BR", count)} músicas`,
    }),
  startMagicQueue: (title: string, artist: string, album: string | null) =>
    `${title}, de ${artist}${album ? `, ${album}` : ""}, iniciar Fila Mágica`,
  newMixes: "Novos mixes",
  newSongs: "Novas músicas",
  undo: "Desfazer",
  searchLimit: (minutes: number) =>
    `Limite de buscas atingido · novos mixes em cerca de ${formatNumber("pt-BR", minutes)} min`,
  recommendationsFailed: "Não foi possível carregar as recomendações.",
  tryAgain: "Tentar Novamente",
  openMixFailed: "Não foi possível abrir as ações do mix",
  saveMixFailed: "Não foi possível salvar o mix como playlist",
  saved: (name: string) => `${name} salvo`,
  actions: {
    playNext: "Reproduzir a Seguir",
    addToQueue: "Adicionar à Fila",
    saveAsPlaylist: "Salvar como Playlist",
    downloadAlbum: "Baixar Mix",
    cancelAlbumDownload: "Cancelar Download",
    retryFailed: "Tentar Falhas Novamente",
  },
  goneTitle: "Este mix não existe mais",
  goneMessage: "O Início tem os mixes de hoje enquanto o YT Music estiver ativado.",
  settings: "Ajustes de Descobrir",
  settingsNeedsYtMusic: "Ajustes de Descobrir, requer o YT Music",
  newMusic: "Músicas novas",
  genreFaithfulness: "Fidelidade ao gênero",
  popularity: "Popularidade",
  faithfulnessNote:
    "Mesmos gêneros exclui os gêneros conhecidos sem relação. Próximos, Equilibrado e Vizinhos os reduzem menos a cada passo. Explorar ignora o gênero. Gêneros desconhecidos sempre ficam.",
  levels: {
    1: "Quase só conhecidas",
    2: "Mais conhecidas",
    3: "Equilibrado",
    4: "Mais novidades",
    5: "Só novidades",
  },
  newShare: (percent: number) => `${formatNumber("pt-BR", percent)}% novas`,
  faithfulnessSteps: {
    1: "Mesmos gêneros",
    2: "Próximos",
    3: "Equilibrado",
    4: "Vizinhos",
    5: "Explorar",
  },
  popularitySteps: {
    1: "Sucessos",
    2: "Populares",
    3: "Equilibrado",
    4: "Menos conhecidas",
    5: "Lado B",
  },
};
