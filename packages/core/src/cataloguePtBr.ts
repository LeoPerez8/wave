import { desktopShortcutsPtBr } from "./catalogue/desktopShortcutsPtBr.ts";
import { libraryPtBr } from "./catalogue/libraryPtBr.ts";
import { playlistsPtBr } from "./catalogue/playlistsPtBr.ts";
import { importsPtBr } from "./catalogue/importsPtBr.ts";
import { homePtBr } from "./catalogue/homePtBr.ts";
import { arrangementPtBr } from "./catalogue/arrangementPtBr.ts";
import { discoverPtBr } from "./catalogue/discoverPtBr.ts";
import { statsPtBr } from "./catalogue/statsPtBr.ts";
import { recapPtBr } from "./catalogue/recapPtBr.ts";
import { listeningHistoryPtBr } from "./catalogue/listeningHistoryPtBr.ts";
import { sharePtBr } from "./catalogue/sharePtBr.ts";
import { downloadNoticePtBr } from "./catalogue/downloadNoticePtBr.ts";
import { nativePtBr } from "./catalogue/nativePtBr.ts";
import { autoPtBr } from "./catalogue/autoPtBr.ts";
import { playbackTextPtBr } from "./catalogue/playbackTextPtBr.ts";
import { lyricsLanguagesPtBr } from "./catalogue/lyricsLanguagesPtBr.ts";
import { showsPtBr } from "./catalogue/showsPtBr.ts";
import { upcomingShowsPtBr } from "./catalogue/upcomingShowsPtBr.ts";
import { settingsPtBr } from "./catalogue/settingsPtBr.ts";
import { downloadStatusPtBr } from "./catalogue/downloadStatusPtBr.ts";
import { alertPtBr } from "./catalogue/alertPtBr.ts";
import { fixSongsPtBr } from "./catalogue/fixSongsPtBr.ts";
import { downloadsPtBr } from "./catalogue/downloadsPtBr.ts";
import { itemActionsPtBr } from "./catalogue/itemActionsPtBr.ts";
import { songDeletionPtBr } from "./catalogue/songDeletionPtBr.ts";
import { appUpdatesPtBr } from "./catalogue/appUpdatesPtBr.ts";
import { whatsNewPtBr } from "./catalogue/whatsNewPtBr.ts";
import { versionHistoryPtBr } from "./catalogue/versionHistoryPtBr.ts";
/**
 * Wave's interface text in Brazilian Portuguese, entry for entry with
 * `catalogueEn.ts`. Terms follow the spec's glossary; until it's approved,
 * Apple Music's pt-BR wording.
 */

import type { Catalogue } from "./catalogueEn.ts";

export const ptBR: Catalogue = {
  desktopLayout: {
    brand: "Wave",
    home: "Início",
    search: "Buscar",
    library: "Biblioteca",
    playlists: "Playlists",
    artists: "Artistas",
    albums: "Álbuns",
    songs: "Músicas",
    genres: "Gêneros",
    favorites: "Favoritas",
    settings: "Ajustes",
    back: "Voltar",
    forward: "Avançar",
    newPlaylist: "Nova playlist",
    time: "Tempo",
    favorite: "Favorita",
    play: "Reproduzir",
    pause: "Pausar",
    shuffle: "Aleatório",
    previous: "Anterior",
    next: "Próxima",
    repeat: "Repetir",
    repeatOff: "Repetição desativada",
    repeatAll: "Repetir tudo",
    repeatOne: "Repetir uma",
    lyrics: "Letras",
    queue: "Fila",
    volume: "Volume",
    mute: "Silenciar",
    unmute: "Ativar som",
    seek: "Posição de reprodução",
    sleep: "Timer",
    menu: "Menu da música",
    player: "Barra de reprodução",
    nothingPlaying: "Escolha uma música para reproduzir",
    noResults: "Nenhuma música encontrada.",
    loading: "Carregando…",
    unavailableSection: "Esta seção estará disponível em uma atualização futura.",
    window: "Janela",
    playback: "Reprodução",
    lyricsAndTags: "Letras e tags",
    downloads: "Downloads",
    accounts: "Contas",
    versionHistory: "Histórico de versões",
    album: "Álbum",
    artist: "Artista",
    playlist: "Playlist",
    genre: "Gênero",
    minutes: (n: number) => `${n} min`,
    jump: "Ir para uma letra",
    open: "Abrir",
    songCount: (n: number) => `${n.toLocaleString("pt-BR")} ${n === 1 ? "música" : "músicas"}`,
    ytMusic: "YT Music",
    discover: "Descobrir",
    magicQueue: "Fila Mágica",
    youTubeMusic: "YouTube Music",
    ytOffline: "O YouTube Music volta quando você estiver online.",
    ytFailed: "O YouTube Music não respondeu. Tente de novo daqui a pouco.",
    similarArtists: "Artistas parecidos",
    youMightAlsoLike: "Você também pode gostar",
    magicQueueIdle:
      "Comece uma Fila Mágica com uma destas músicas ou pelo menu de qualquer música.",
    sidePanel: "Painel lateral",
    removeFromQueue: (title: string) => `Remover “${title}” da Fila`,
  },
  desktopLibrary: {
    refresh: "Atualizar",
    refreshKey: "F5",
    unavailableFolder: "Pasta indisponível",
    driveDisconnected: "A unidade não está conectada. Reconecte e tente de novo.",
    actionFailed: "Não foi possível concluir essa ação. Tente de novo.",
    titleColumn: "Título",
    artistColumn: "Artista",
    albumColumn: "Álbum",
    previous: "Página anterior",
    next: "Próxima página",
    page: (first: number, last: number, total: number) => `${first}–${last} de ${total}`,
    songMenu: (title: string) => `Ações de “${title}”`,
    chooseArtist: "Escolha um Artista",
    noPlaylists: "Nenhuma playlist ainda",
    checkSong: (title: string) => `Selecionar “${title}”`,
  },
  desktopAccount: {
    finishInBrowser: "Termine de iniciar sessão no navegador.",
    keyringMissing:
      "Este computador não tem um chaveiro, então a sessão dura até o Wave fechar. Inicie sessão novamente na próxima vez.",
    browserTitle: "Volte ao Wave",
    browserMessage: "Você pode fechar esta aba. O Wave termina de iniciar sessão.",
  },
  desktopShortcuts: desktopShortcutsPtBr,
  downloadNotice: downloadNoticePtBr,
  native: nativePtBr,
  auto: autoPtBr,
  library: libraryPtBr,
  playlists: playlistsPtBr,
  imports: importsPtBr,
  lyricsLanguages: lyricsLanguagesPtBr,
  playbackText: playbackTextPtBr,
  recognizeTile: {
    tryAgain: playbackTextPtBr.tryAgain,
    useMicrophone: playbackTextPtBr.useMicrophone,
  },
  shows: showsPtBr,
  upcomingShows: upcomingShowsPtBr,
  home: homePtBr,
  arrangement: arrangementPtBr,
  discover: discoverPtBr,
  stats: statsPtBr,
  recap: recapPtBr,
  listeningHistory: listeningHistoryPtBr,
  share: sharePtBr,
  settings: settingsPtBr,
  downloadStatus: downloadStatusPtBr,
  alert: alertPtBr,
  fixSongs: fixSongsPtBr,
  downloads: downloadsPtBr,
  itemActions: itemActionsPtBr,
  songDeletion: songDeletionPtBr,
  whatsNew: whatsNewPtBr,
  versionHistory: versionHistoryPtBr,
  appUpdates: appUpdatesPtBr,
  tabs: {
    index: "Início",
    library: "Biblioteca",
    search: "Buscar",
    playlists: "Playlists",
    artists: "Artistas",
    albums: "Álbuns",
    songs: "Músicas",
    genres: "Gêneros",
    favorites: "Favoritas",
  },
  newReleases: {
    title: "Novidades dos Artistas que Você Segue",
    single: "Single",
    ep: "EP",
    album: "Álbum",
    unavailable: "Ainda não está no YouTube Music",
    ytMusicOff: "O YT Music está desativado em Ajustes",
    noAnswer: "Sem resposta online. Tente novamente em instantes.",
    hideFailed: "Não foi possível ocultar este lançamento. Tente novamente.",
    hide: "Ocultar",
    goToArtist: "Ir para o Artista",
    addToPlaylist: "Adicionar à Playlist",
    today: "Hoje",
    yesterday: "Ontem",
    daysAgo: (days: number) => `Há ${days} dias`,
    absoluteDate: (month: number, day: number, year: number | null) =>
      `${day} de ${["jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."][month - 1]}${year === null ? "" : ` de ${year}`}`,
  },
  followArtistSearch: {
    placeholder: "Buscar artistas para seguir",
    searching: "Buscando no Deezer…",
    unavailable:
      "Não foi possível acessar o Deezer. Os resultados da Biblioteca continuam disponíveis.",
    empty: "Nenhum artista encontrado.",
  },
  tabBar: {
    editHint: "Mantenha pressionado para editar a barra de abas",
    edit: "Editar a barra de abas",
  },
};
