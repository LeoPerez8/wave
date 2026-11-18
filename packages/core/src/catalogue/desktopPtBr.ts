import type { CatalogueVariants } from "../localisation.ts";

/** `desktopEn.ts` in Brazilian Portuguese, key for key. */
export const desktopPtBr = {
  playbackText: {
    thisPhone: "Este computador",
  },
  settings: {
    waveAccountNote:
      "Opcional. Com a sessão iniciada, sua lista de músicas, playlists, favoritas, histórico " +
      "de ouvidas e preferências vão para o servidor do Wave, e seus celulares e este " +
      "computador compartilham tudo. Áudio e caminhos de arquivos nunca vão.",
    waveAccountSignOutNote:
      "Finalizar sessão mantém seus arquivos de música e ouvidas neste computador. Músicas da " +
      "conta sem arquivo aqui saem da Biblioteca.",
    yourWaveSessionEndedSoThisPhone:
      "Sua sessão do Wave terminou, então a sessão deste computador foi finalizada. Inicie sessão novamente para manter seu backup.",
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
  },
} satisfies CatalogueVariants;
