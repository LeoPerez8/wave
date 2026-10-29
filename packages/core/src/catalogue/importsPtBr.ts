import { formatNumber } from "../formatting.ts";
import { plural } from "../plural.ts";
import type { importsEn } from "./importsEn.ts";

const n = (count: number): string => formatNumber("pt-BR", count);

const songs = (count: number): string =>
  plural("pt-BR", count, {
    zero: "Nenhuma música",
    one: `${n(count)} música`,
    other: `${n(count)} músicas`,
  });

/** "0 músicas" reads oddly after "de"; this keeps the number where a phrase goes on. */
const counted = (count: number): string =>
  plural("pt-BR", count, { one: `${n(count)} música`, other: `${n(count)} músicas` });

export const importsPtBr: typeof importsEn = {
  import: "Importar",
  importDownload: "Importar e Baixar",
  imported: "Importada",
  cancel: "Cancelar",
  continue: "Continuar",
  ok: "OK",
  show: "Mostrar",
  dismiss: "Dispensar",
  tryAgain: "Tentar Novamente",
  reading: "Lendo…",
  signInAgain: "Iniciar Sessão Novamente",
  fromLink: "De um Link",
  fromFiles: "De Arquivos",
  fromYtMusic: "Do YT Music",
  fromSpotify: "Do Spotify",
  importFromLink: "Importar de um link",
  playlistLink: "Link da playlist",
  linkPlaceholder: "Link de uma playlist do YouTube Music ou do Spotify",
  importPlaylist: "Importar playlist",
  importFromYtMusic: "Importar do YouTube Music",
  importFromSpotify: "Importar do Spotify",
  couldntImportPlaylist: "Não foi possível importar a playlist",
  couldntImportPlaylists: "Não foi possível importar as playlists",
  pasteLink: "Cole o link de uma playlist do YouTube Music ou do Spotify.",
  otherSite: "O Wave importa playlists de links do YouTube Music e do Spotify.",
  songLink: "Este é o link de uma música, não de uma playlist.",
  notPlaylistLink: "Este link não é de uma playlist.",
  ytMusicOff: "O YT Music está desativado",
  ytMusicOffMessage:
    "Ative o YT Music em Ajustes para importar playlists de links do YouTube Music e do Spotify.",
  cantImport: "Não é possível importar isto",
  offline: "Você está offline. Tente novamente quando estiver online.",
  playlistFailed:
    "Não foi possível ler esta playlist. Ela pode ser privada ou ter sido apagada, ou não houve resposta online.",
  ytMusicOffInSettings: "O YT Music está desativado em Ajustes.",
  playlistMissing: "Esta playlist não existe ou não é pública.",
  spotifyUnreachable: "Não foi possível acessar o Spotify. Verifique sua conexão e tente novamente.",
  spotifyFailed: "Não foi possível ler esta playlist. O Spotify não respondeu como esperado.",
  readingPlaylist: "Lendo a playlist…",
  noSongsToImport: "Ela não tem músicas para importar.",
  songs,
  inLibrary: (count: number, total: number): string =>
    count === 0
      ? "nenhuma na sua Biblioteca"
      : count === total
        ? "todas na sua Biblioteca"
        : `${n(count)} na sua Biblioteca`,
  onService: (count: number, service: string): string => `${counted(count)} no ${service}`,
  listedTwiceGoInOnce: (count: number): string =>
    plural("pt-BR", count, {
      one: `${n(count)} listada duas vezes entra uma vez`,
      other: `${n(count)} listadas duas vezes entram uma vez`,
    }),
  notSongs: (count: number): string =>
    plural("pt-BR", count, {
      one: `${n(count)} não é música`,
      other: `${n(count)} não são músicas`,
    }),
  truncated: (count: number): string =>
    `Ela passa de ${counted(count)}. Só essas são importadas.`,
  onlyFirst: (count: number, service: string): string =>
    plural("pt-BR", count, {
      one: `Só a primeira música veio do ${service}`,
      other: `Só as primeiras ${n(count)} músicas vieram do ${service}`,
    }),
  notFound: "Não encontradas",
  listedTwice: "Listadas duas vezes",
  wereNotFound: (count: number): string =>
    plural("pt-BR", count, {
      one: `${n(count)} música não foi encontrada`,
      other: `${n(count)} músicas não foram encontradas`,
    }),
  wereListedTwice: (count: number): string =>
    plural("pt-BR", count, {
      one: `${n(count)} música foi listada duas vezes`,
      other: `${n(count)} músicas foram listadas duas vezes`,
    }),
  notFoundAndTwice: (missing: string, twice: number): string =>
    `${missing} · ${n(twice)} ${twice === 1 ? "listada" : "listadas"} duas vezes`,
  importedWithout: (name: string, count: number): string =>
    `${name} foi importada sem ${count === 1 ? "ela" : "elas"}.`,
  eachWentInOnce: (name: string): string => `Cada uma entrou em ${name} uma vez.`,
  importedWithoutBoth: (name: string): string =>
    `${name} foi importada sem as músicas não encontradas. Cada música listada duas vezes entrou uma vez.`,
  waiting: "Aguardando",
  waitingSongs: (count: number): string => `Aguardando · ${counted(count)}`,
  readingCount: (done: string): string => `Lendo ${done}`,
  readingOf: (done: string, total: string): string => `Lendo ${done} de ${total}`,
  matching: "Comparando com a Biblioteca…",
  addingOf: (done: string, total: string): string => `Adicionando ${done} de ${total}`,
  importingPlaylists: (done: string, total: string): string =>
    `Importando playlists · ${done} de ${total}`,
  importPaused: (why: string): string => `Importação pausada · ${why}`,
  pausedOffline: "offline",
  pausedYtMusicOff: "YT Music desativado",
  pausedSignedOut: "sessão do Spotify finalizada",
  couldntReadOnline: "Não foi possível lê-la online",
  readingYtMusicLibrary: "Lendo sua biblioteca do YouTube Music",
  readingSpotifyLibrary: "Lendo sua biblioteca do Spotify",
  likedSongs: "Músicas Curtidas",
  selectAll: "Selecionar Tudo",
  deselectAll: "Desmarcar Tudo",
  alsoFavorites: "Adicionar também às Favoritas",
  ytLibraryFailed: "Não foi possível ler sua biblioteca do YouTube Music. Sem resposta online.",
  ytSignedOut: "Sua sessão do YouTube terminou. Inicie a sessão novamente para ver suas playlists.",
  spotifyLibraryFailed: "Não foi possível ler sua biblioteca do Spotify. Sem resposta online.",
  spotifySignedOut:
    "Sua sessão do Spotify terminou. Inicie a sessão novamente para ver suas playlists.",
  spotifyChanged: "O Spotify mudou algo. Tente novamente depois de atualizar o Wave.",
  replaceTitle: (name: string): string => `Substituir ${name}?`,
  replaceMessage: (name: string): string =>
    `Você já tem uma playlist chamada ${name}. Substitua as músicas dela pelas importadas ou mantenha as duas playlists.`,
  replace: "Substituir",
  keepBoth: "Manter as Duas",
  replaced: "Substituída",
  notInLibrary: (count: number): string => `${n(count)} fora da sua biblioteca`,
  listsNoSongs: "Ela não lista nenhuma música",
  noneInLibrary: (count: number): string =>
    plural("pt-BR", count, {
      one: `A ${n(count)} música listada não está na sua biblioteca`,
      other: `Nenhuma das ${n(count)} músicas está na sua biblioteca`,
    }),
  notM3u: "Não é uma playlist M3U",
  couldntBeRead: "Não foi possível ler",
  importedName: (name: string): string => `${name} importada`,
  nothingImported: "Nada importado",
  importedPlaylists: (count: number): string =>
    plural("pt-BR", count, {
      one: `${n(count)} playlist importada`,
      other: `${n(count)} playlists importadas`,
    }),
  couldntImportBlackPlayer: "Não foi possível importar as estatísticas do BlackPlayer",
};
