import { formatNumber } from "../formatting.ts";
import type { CatalogueVariants } from "../localisation.ts";
import { plural } from "../plural.ts";

/** `desktopEn.ts` in Brazilian Portuguese, key for key. */
export const desktopPtBr = {
  home: {
    noSections:
      "As seções do Início estão ocultas. Escolha Editar Início para adicioná-las de volta.",
  },
  playbackText: {
    thisPhone: "Este computador",
    holdYourPhoneNearTheMusic: "Aproxime a música do microfone.",
    listeningToAudioFromThisPhone: "Ouvindo o áudio deste computador.",
    allowWaveToCaptureAudioInItsAndroidSettingsToRecognizeSongs:
      "Permita que os apps usem o microfone nas configurações de privacidade do sistema e tente de novo.",
    thisAppBlocksAudioCapture: "Nenhum som deste computador",
    tryTheMicrophoneToRecognizeMusicAroundYou:
      "Toque a música neste computador ou use o microfone para reconhecer músicas ao seu redor.",
  },
  shows: {
    phoneRegion: "Região deste computador",
  },
  settings: {
    openingLyricsOnASongWithLyrics:
      "Ao abrir Letras em uma música que tem letra, o Wave mostra a descrição do Genius e destaca os trechos anotados. Desative para interromper todas as consultas ao Genius.",
    missingSongs: {
      missing: (n: number) =>
        `${formatNumber("pt-BR", n)} ${plural("pt-BR", n, { one: "música não está", other: "músicas não estão" })} neste computador`,
    },
    cardsGroupsSeparatorsAndTextFollowThe:
      "Cartões, grupos, separadores e texto seguem o fundo escolhido para cada modo. A cor primária aparece no progresso, nos controles e no que está ativo; a secundária marca favoritas e a reprodução atual. Padrão usa branco no modo escuro e a cor do texto no claro. A última amostra aceita qualquer cor. Salvar guarda até quatro cores na linha; o botão ao lado de uma cor salva a remove. Cores sem contraste suficiente são ajustadas.",
    fourColoursAreSavedToSaveThis:
      "Já há quatro cores salvas. Para salvar esta, remova antes uma cor salva.",
    waveAccountNote:
      "Opcional. Com a sessão iniciada, sua lista de músicas, playlists, favoritas, histórico " +
      "de ouvidas e preferências vão para o servidor do Wave, e seus celulares e este " +
      "computador compartilham tudo. Áudio e caminhos de arquivos nunca vão.",
    waveAccountSignOutNote:
      "Finalizar sessão mantém seus arquivos de música e ouvidas neste computador. Músicas da " +
      "conta sem arquivo aqui saem da Biblioteca. Apagar a conta remove o que o servidor do " +
      "Wave guarda, sem apagar nada deste computador.",
    deleteWaveAccount: {
      message:
        "O servidor do Wave apaga tudo o que tem da conta, e a sessão deste computador é " +
        "finalizada. Nada neste computador é apagado. Depois, seu navegador abre o início de " +
        "sessão do Google, para confirmar que é você.",
    },
    yourWaveAccountWasDeletedEverythingOn:
      "Sua Conta Wave foi apagada. Seus arquivos de música e ouvidas neste computador permanecem.",
    yourWaveSessionEndedSoThisPhone:
      "Sua sessão do Wave terminou, então a sessão deste computador foi finalizada. Inicie sessão novamente para manter seu backup.",
    addAGoogleAccountToThisPhone: "Não foi possível iniciar sessão. Tente novamente.",
    ytMusicNote:
      "Iniciar sessão é opcional. Buscar, a reprodução e os mixes do Início usam sua conta. A sessão fica neste computador. Com Baixar na melhor qualidade desativado, ou quando o Soulseek não encontra uma música, o download vem do YouTube Music: AAC a 256 kbps com Premium, cerca de 128 kbps sem Premium.",
    searchPlaybackAndHomesMixesUseThis:
      "Buscar, a reprodução e os mixes do Início usam esta conta. Finalizar sessão esquece a conta neste computador.",
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
  recap: {
    tapToWatch: "Clique para assistir",
  },
  share: {
    saveImage: "Salvar Imagem",
    copyImage: "Copiar Imagem",
    tapToChangeColour: "Clique no cartão para mudar a cor",
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
