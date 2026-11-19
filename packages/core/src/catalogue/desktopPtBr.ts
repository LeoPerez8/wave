import { formatNumber } from "../formatting.ts";
import type { CatalogueVariants } from "../localisation.ts";
import { plural } from "../plural.ts";

/** `desktopEn.ts` in Brazilian Portuguese, key for key. */
export const desktopPtBr = {
  home: {
    noSections:
      "As seções do Início estão ocultas. Organize o Início no celular para adicioná-las de volta.",
  },
  playbackText: {
    thisPhone: "Este computador",
  },
  settings: {
    missingSongs: {
      missing: (n: number) =>
        `${formatNumber("pt-BR", n)} ${plural("pt-BR", n, { one: "música não está", other: "músicas não estão" })} neste computador`,
    },
    waveAccountNote:
      "Opcional. Com a sessão iniciada, sua lista de músicas, playlists, favoritas, histórico " +
      "de ouvidas e preferências vão para o servidor do Wave, e seus celulares e este " +
      "computador compartilham tudo. Áudio e caminhos de arquivos nunca vão.",
    waveAccountSignOutNote:
      "Finalizar sessão mantém seus arquivos de música e ouvidas neste computador. Músicas da " +
      "conta sem arquivo aqui saem da Biblioteca.",
    yourWaveSessionEndedSoThisPhone:
      "Sua sessão do Wave terminou, então a sessão deste computador foi finalizada. Inicie sessão novamente para manter seu backup.",
    addAGoogleAccountToThisPhone: "Não foi possível iniciar sessão. Tente novamente.",
    signOutOnAllPhones: "Finalizar Sessão em Todos os Dispositivos",
    everyPhoneOnThisWaveAccountSignedOut:
      "A sessão de todos os dispositivos nesta Conta Wave foi finalizada. Inicie sessão novamente para manter seu backup.",
    couldntSignOutOnAllPhonesWithoutAConnection:
      "Não foi possível finalizar a sessão em todos os dispositivos sem conexão.",
    wavesServerDidntSignOutThePhonesTry:
      "O servidor do Wave não finalizou a sessão dos dispositivos. Tente novamente.",
    signOutEverywhere: {
      title: "Finalizar sessão em todos os dispositivos?",
      message:
        "Todos os celulares e computadores com sessão iniciada nesta Conta Wave têm a sessão " +
        "finalizada, inclusive este. Nada neles é apagado. Inicie sessão novamente onde você usa o Wave.",
      action: "Finalizar Sessão em Todos os Dispositivos",
    },
    signInInvitation: {
      libraryTitle: "Sua Biblioteca em todos os dispositivos",
      library:
        "Playlists, favoritas, histórico de ouvidas e preferências nos seus celulares e neste computador.",
    },
    howMuchOfAStreamedSongWave:
      "Quanto de uma música online o Wave carrega com antecedência, incluindo as próximas músicas em A Seguir, para continuar tocando sem sinal. Períodos maiores usam mais memória: cerca de 50 MB para 30 minutos. Músicas baixadas tocam do computador.",
    waveLooksUpAPhotoOfEach:
      "O Wave busca uma foto de cada artista no Deezer, enviando os nomes dos artistas, e guarda as fotos neste computador. Desativado, os artistas mostram as capas dos álbuns e o Wave não faz solicitações.",
  },
  itemActions: {
    labels: {
      share: "Copiar Link",
    },
  },
  library: {
    offlineTapOnline:
      "Você está offline. Clique em Online para tentar de novo quando estiver online.",
    noAnswerTapOnline: "Sem resposta online. Clique em Online para tentar de novo.",
  },
  songDeletion: {
    removeMessage: {
      one: "O arquivo dela continua neste computador. Para trazê-la de volta, inclua-o de novo em Ajustes › Biblioteca.",
      several:
        "Os arquivos delas continuam neste computador. Para trazê-las de volta, inclua-os de novo em Ajustes › Biblioteca.",
    },
  },
} satisfies CatalogueVariants;
