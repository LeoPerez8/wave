import { plural } from "../plural.ts";
import { formatNumber } from "../formatting.ts";
import type { shareEn } from "./shareEn.ts";

export const sharePtBr: typeof shareEn = {
  preview: "Prévia do compartilhamento",
  close: "Fechar",
  lyricsCard: "Cartão da letra",
  changesColour: "Muda a cor do cartão",
  tapToChangeColour: "Toque no cartão para mudar a cor",
  shareLyrics: "Compartilhar Letra",
  shareSong: "Compartilhar Música",
  shareRecap: "Compartilhar Retrospectiva",
  recapSlide: (title: string) => `Slide da Retrospectiva de ${title}`,
  copyLink: "Copiar Link",
  songLink: "Link da música",
  linkCopied: "Link copiado",
  copyFailed: "Não foi possível copiar o link",
  linkShareFailed: "Não foi possível compartilhar o link",
  linkNotes: {
    offline: "Offline",
    failed: "Indisponível",
    notFound: "Nenhum Resultado",
    signedOut: "Sessão finalizada",
  },
  instagramStories: "Stories do Instagram",
  whatsApp: "WhatsApp",
  saveImage: "Salvar imagem",
  more: "Mais",
  savedToGallery: "Salva na galeria",
  instagramFailed: "Não foi possível abrir o Instagram",
  whatsAppFailed: "Não foi possível abrir o WhatsApp",
  saveImageFailed: "Não foi possível salvar a imagem",
  shareImageFailed: "Não foi possível compartilhar a imagem",
  share: "Compartilhar",
  sharing: (playlist: string, service: string) => `Compartilhando ${playlist} no ${service}…`,
  nothingToShare: "Nada para compartilhar",
  nothingFound: {
    ytMusic: "Nenhuma música da playlist está no YouTube Music.",
    spotify: "Nenhuma música da playlist está no Spotify.",
  },
  shareFailed: "Não foi possível compartilhar a playlist",
  found: (found: number, total: number) =>
    plural("pt-BR", total, {
      one: `${formatNumber("pt-BR", found)} de ${formatNumber("pt-BR", total)} música encontrada`,
      other: `${formatNumber("pt-BR", found)} de ${formatNumber("pt-BR", total)} músicas encontradas`,
    }),
  signInTitle: (service: string) => `Iniciar Sessão no ${service}`,
  signInMessage: {
    ytMusic:
      "Compartilhar uma playlist cria uma cópia não listada dela na sua conta do YouTube Music, com um link que qualquer pessoa pode abrir.",
    spotify:
      "Compartilhar uma playlist cria uma cópia pública dela na sua conta do Spotify, com um link que qualquer pessoa pode abrir.",
  },
  signIn: "Iniciar Sessão",
  failures: {
    noSearchAnswer: (service: string) => `O ${service} não respondeu a uma busca. Tente novamente.`,
    offline: () => "Compartilhar requer uma conexão.",
    signedOut: (service: string) =>
      `O ${service} finalizou sua sessão. Inicie a sessão e compartilhe novamente.`,
    changed: (service: string) =>
      `O ${service} mudou alguma coisa. Tente novamente depois de atualizar o Wave.`,
    failed: (service: string) => `O ${service} não aceitou a playlist. Tente novamente.`,
  },
};
