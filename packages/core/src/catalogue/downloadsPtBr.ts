import { formatNumber } from "../formatting.ts";
import { plural } from "../plural.ts";
import type { downloadsEn } from "./downloadsEn.ts";

const n = (count: number): string => formatNumber("pt-BR", count);
const songs = (count: number): string =>
  plural("pt-BR", count, { one: `${n(count)} música`, other: `${n(count)} músicas` });

export const downloadsPtBr: typeof downloadsEn = {
  albumActions: {
    downloadAlbum: "Baixar Álbum",
    retryFailed: "Tentar Falhas Novamente",
    cancelAlbumDownload: "Cancelar Download do Álbum",
  },
  playlistActions: {
    downloadPlaylist: "Baixar Playlist",
    retryFailed: "Tentar Falhas Novamente",
    cancelPlaylistDownload: "Cancelar Download da Playlist",
  },
  buttons: {
    download: "Baixar",
    retryFailed: "Tentar Falhas Novamente",
    cancel: "Cancelar",
  },
  downloaded: "Baixado",
  progress: (saved, total) => `Baixando · ${saved} de ${total}`,
  songsGroup: "Músicas",
  songsLeft: (count) =>
    plural("pt-BR", count, {
      one: `${n(count)} música restante`,
      other: `${n(count)} músicas restantes`,
    }),
  qualityGroups: {
    upgrade: "Melhoria de qualidade",
    downgrade: "Liberar espaço",
  },
  megabytes: (size) => `${size} MB`,
  gigabytes: (size) => `${size} GB`,
  quality: {
    upgradeTitle: (count) => `Substituir ${songs(count)} pela melhor qualidade?`,
    upgradeRow: (count) => `Substituir ${songs(count)} pela melhor qualidade`,
    upgradeEstimate: (size) => `Cerca de +${size}`,
    downgradeTitle: (size, count) =>
      `Liberar cerca de ${size} substituindo ${songs(count)} por cópias do YouTube Music?`,
    downgradeRow: (count) => `Liberar espaço: substituir ${songs(count)}`,
    downgradeEstimate: (size) => `Libera cerca de ${size}`,
    copies: (kbps, exact) =>
      `As cópias do YouTube Music são AAC a ${exact ? "" : "cerca de "}${kbps} kbps.`,
    mobileData: (size) => `Baixa cerca de ${size}, e o celular não está no Wi-Fi.`,
    replace: "Substituir",
    notNow: "Agora não",
  },
};
