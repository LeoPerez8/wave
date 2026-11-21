import { desktopShortcutsPtBr } from "./catalogue/desktopShortcutsPtBr.ts";
import { desktopWindowPtBr } from "./catalogue/desktopWindowPtBr.ts";
import { desktopOutputPtBr } from "./catalogue/desktopOutputPtBr.ts";
import { libraryPtBr } from "./catalogue/libraryPtBr.ts";
import { playlistsPtBr } from "./catalogue/playlistsPtBr.ts";
import { importsPtBr } from "./catalogue/importsPtBr.ts";
import { homePtBr } from "./catalogue/homePtBr.ts";
import { arrangementPtBr } from "./catalogue/arrangementPtBr.ts";
import { discoverPtBr } from "./catalogue/discoverPtBr.ts";
import { djPtBr } from "./catalogue/djPtBr.ts";
import { statsPtBr } from "./catalogue/statsPtBr.ts";
import { recapPtBr } from "./catalogue/recapPtBr.ts";
import { listeningHistoryPtBr } from "./catalogue/listeningHistoryPtBr.ts";
import { collaborativePagePtBr } from "./catalogue/collaborativePagePtBr.ts";
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
import { collaborativeMenuPtBr } from "./catalogue/collaborativeMenuPtBr.ts";
import { songDeletionPtBr } from "./catalogue/songDeletionPtBr.ts";
import { appUpdatesPtBr } from "./catalogue/appUpdatesPtBr.ts";
import { inviteJoinPtBr } from "./catalogue/inviteJoinPtBr.ts";
import { whatsNewPtBr } from "./catalogue/whatsNewPtBr.ts";
import { versionHistoryPtBr } from "./catalogue/versionHistoryPtBr.ts";
/**
 * Wave's interface text in Brazilian Portuguese, entry for entry with
 * `catalogueEn.ts`. Terms follow the spec's glossary; until it's approved,
 * Apple Music's pt-BR wording.
 */

import type { Catalogue } from "./catalogueEn.ts";

export const ptBR: Catalogue = {
  desktopWindow: desktopWindowPtBr,
  desktopOutput: desktopOutputPtBr,
  desktopLayout: {
    language: "Idioma",
    languages: { system: "Sistema", en: "English", "pt-BR": "Português (Brasil)" },
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
    downloadsProgress: (percent: number) => `Downloads, ${percent}% concluído`,
    nothingDownloading: "As músicas que você baixar aparecem aqui até chegarem à Biblioteca.",
    downloadsOffline:
      "Os downloads pausam enquanto você está offline e continuam quando você voltar.",
    downloadsFolder: "Os downloads vão para",
    changeFolder: "Mudar Pasta",
    similarArtists: "Artistas parecidos",
    youMightAlsoLike: "Você também pode gostar",
    magicQueueIdle:
      "Comece uma Fila Mágica com uma destas músicas ou pelo menu de qualquer música.",
    sidePanel: "Painel lateral",
    closeSidePanel: "Fechar painel lateral",
    removeFromQueue: (title: string) => `Remover “${title}” da Fila`,
  },
  desktopLibrary: {
    refresh: "Atualizar",
    refreshKey: "F5",
    unavailableFolder: "Pasta indisponível",
    driveDisconnected: "A unidade não está conectada. Reconecte e tente de novo.",
    actionFailed: "Não foi possível concluir essa ação. Tente de novo.",
    releaseDateKnown: (date) => `Lançada em ${date}`,
    releaseDateUnknown: "Nenhuma data de lançamento conhecida.",
    showInFolder: "Mostrar na Pasta",
    fileGone:
      "O arquivo da música não está mais lá. Atualize a Biblioteca para encontrá-lo de novo.",
    downloadStarted: (count) => (count === 1 ? "Baixando a música" : `Baixando ${count} músicas`),
    downloading: (title) => `Baixando ${title}`,
    nothingToPlay:
      "Nenhuma destas músicas está neste computador ainda. Baixe-as para tocá-las aqui.",
    leftOut: (count) =>
      count === 1
        ? "1 música não está neste computador, então ficou de fora."
        : `${count} músicas não estão neste computador, então ficaram de fora.`,
    fileFailed: "Não foi possível reproduzir este arquivo",
    titleColumn: "Título",
    artistColumn: "Artista",
    albumColumn: "Álbum",
    /** The column of a playlist's own order and of an artist's Popular ranks. */
    orderColumn: "#",
    releaseDateColumn: "Data de lançamento",
    previous: "Página anterior",
    next: "Próxima página",
    page: (first: number, last: number, total: number) => `${first}–${last} de ${total}`,
    songMenu: (title: string) => `Ações de “${title}”`,
    chooseArtist: "Escolha um Artista",
    noPlaylists: "Nenhuma playlist ainda",
    collaborativeOnPhone: "Edite playlists colaborativas no Wave do celular",
    checkSong: (title: string) => `Selecionar “${title}”`,
    showMoreSongs: "Mostrar mais músicas",
  },
  desktopAccount: {
    finishInBrowser: "Termine de iniciar sessão no navegador.",
    keyringMissing:
      "Este computador não tem um chaveiro, então a sessão dura até o Wave fechar. Inicie sessão novamente na próxima vez.",
    browserTitle: "Volte ao Wave",
    browserMessage: "Você pode fechar esta aba. O Wave termina de iniciar sessão.",
    confirmDeletionInBrowser: "Inicie sessão no Google no navegador para confirmar que é você.",
    browserDeletionMessage: "Você pode fechar esta aba. O Wave termina de apagar a conta.",
    deletionSent: "O Wave está apagando a conta. Não dá mais para cancelar.",
    closeBrowserWhenDone:
      "Inicie sessão na janela do navegador que abriu e depois feche a janela. O Wave recebe a sessão quando ela é fechada.",
    noBrowser:
      "Iniciar sessão no YouTube precisa do Chrome, Edge, Brave ou Chromium neste computador. Instale um deles e tente novamente.",
    spotifyUnavailable: "O início de sessão no Spotify não está configurado nesta versão do Wave.",
    spotifyNote:
      "Inicie sessão para o Wave ler suas playlists do Spotify e compartilhar as que você criou no Wave.",
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
  dj: djPtBr,
  stats: statsPtBr,
  recap: recapPtBr,
  listeningHistory: listeningHistoryPtBr,
  share: sharePtBr,
  invitePage: {
    title: "Convite do Wave",
    heading: "Este é um convite do Wave",
    body: "Abra este link no seu celular com o Wave atualizado.",
  },
  collaborativePage: collaborativePagePtBr,
  /** Opening an invite link in Wave: the join screen and why it can't join. */
  inviteJoin: inviteJoinPtBr,
  settings: settingsPtBr,
  downloadStatus: downloadStatusPtBr,
  alert: alertPtBr,
  fixSongs: fixSongsPtBr,
  downloads: downloadsPtBr,
  itemActions: itemActionsPtBr,
  collaborativeMenu: collaborativeMenuPtBr,
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
    playSection: (title: string) => `Reproduzir ${title}`,
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
