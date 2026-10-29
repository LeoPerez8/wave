import { formatNumber } from "../formatting.ts";
import { plural } from "../plural.ts";
import type { settingsEn } from "./settingsEn.ts";

export const settingsPtBr: typeof settingsEn = {
  pages: {
    library: "Biblioteca",
    appearance: "Aparência",
    layout: "Layout",
    swipeActions: "Ações de deslizar",
    playback: "Reprodução",
    history: "Histórico de Audição",
    followedArtists: "Artistas Seguidos",
    lyricsAndTags: "Letras e tags",
    downloads: "Downloads",
    accounts: "Contas",
    developer: "Developer",
  },
  layoutPages: {
    home: "Início",
    library: "Biblioteca",
    playlists: "Playlists",
    tabBar: "Barra de abas",
    nowPlaying: "Tocando Agora",
  },
  appearances: { system: "Sistema", light: "Claro", dark: "Escuro" },
  swatches: {
    white: "Padrão",
    fog: "Névoa",
    sand: "Areia",
    sage: "Sálvia",
    blush: "Rosado",
    lilac: "Lilás",
    paper: "Papel",
    black: "Preto puro",
    slate: "Ardósia",
    graphite: "Grafite",
    navy: "Azul-marinho",
    forest: "Floresta",
    plum: "Ameixa",
    teal: "Verde-azulado",
    blue: "Azul",
    violet: "Violeta",
    green: "Verde",
    rose: "Rosa",
    lime: "Lima",
    ember: "Brasa",
    gold: "Dourado",
    coral: "Coral",
    magenta: "Magenta",
    sky: "Céu",
    lemon: "Limão",
  },
  waveAccountCard: {
    title: "O que vai para o Wave",
    message:
      "Com a sessão iniciada, sua lista de músicas, playlists, favoritas, histórico de audição e preferências vão para o " +
      "servidor do Wave, assim como a conta do Soulseek criada por Baixar na melhor qualidade. Áudio, " +
      "caminhos de arquivos e sua sessão do YouTube nunca vão.",
    action: "Continuar",
  },
  deleteWaveAccount: {
    title: "Apagar sua Conta Wave?",
    message:
      "O servidor do Wave apaga tudo o que tem da conta, e a sessão deste telefone é finalizada. " +
      "Nada neste telefone é apagado.",
    action: "Apagar Conta",
  },
  launcherIcon: {
    title: "Alterar também o ícone do app?",
    dropsFromHomeScreen:
      "O ícone do Wave fica com estas cores quando você sai do app, e o launcher o remove da tela inicial quando ele muda. Adicione-o de novo pela gaveta de apps.",
    message: "O ícone do Wave fica com estas cores quando você sai do app.",
    yes: "Sim",
    no: "Não",
  },
  blackPlayerImport: {
    nothingNew: "Nada novo importado",
    imported: "Estatísticas do BlackPlayer importadas",
    newPlays: (n) =>
      `${formatNumber("pt-BR", n)} ${plural("pt-BR", n, { one: "reprodução nova", other: "reproduções novas" })}`,
    allInHistory: "Todas as reproduções destes arquivos já estão no seu histórico",
    from: (songs, snapshots) =>
      `De ${formatNumber("pt-BR", songs)} ${plural("pt-BR", songs, { one: "música", other: "músicas" })}, em ${formatNumber("pt-BR", snapshots)} ${plural("pt-BR", snapshots, { one: "registro", other: "registros" })}`,
    notInLibrary: (n) =>
      `${formatNumber("pt-BR", n)} ${plural("pt-BR", n, { one: "música não está", other: "músicas não estão" })} na sua biblioteca`,
    notImported: (songs, plays) =>
      `${plural("pt-BR", plays, { one: `${formatNumber("pt-BR", plays)} reprodução`, other: `${formatNumber("pt-BR", plays)} reproduções` })} ${songs === 1 ? "dela" : "delas"} ${plural("pt-BR", plays, { one: "não foi importada", other: "não foram importadas" })}`,
    unreadable: "Não foi possível ler",
    notStats: "Não é um arquivo de estatísticas do BlackPlayer",
  },
  spotifySignInFailures: {
    offline: "Não foi possível iniciar sessão sem conexão.",
    failed: "O Spotify não confirmou o início de sessão. Tente novamente.",
    changed: "O Spotify mudou algo. Tente novamente depois de atualizar o Wave.",
  },
  missingSongs: {
    downloadAll: "Baixar Tudo",
    retryFailed: "Tentar Falhas Novamente",
    cancel: "Cancelar",
    downloading: (saved, total) =>
      `Baixando · ${formatNumber("pt-BR", saved)} de ${formatNumber("pt-BR", total)}`,
    missing: (n) =>
      `${formatNumber("pt-BR", n)} ${plural("pt-BR", n, { one: "música não está", other: "músicas não estão" })} neste telefone`,
    notFound: (n) =>
      `${formatNumber("pt-BR", n)} ${plural("pt-BR", n, { one: "música não foi encontrada", other: "músicas não foram encontradas" })}`,
  },
  internalStorage: "Armazenamento interno",
  sdCard: "Cartão SD",
  hexPlaceholder: "rrggbb",
  tryAgain: "Tentar Novamente",
  moveUp: "Mover para cima",
  moveDown: "Mover para baixo",
  done: "OK",
  back: "Voltar",
  couldntScanYourMusic: "Não foi possível verificar suas músicas",
  tryAgainText: "Tentar novamente",
  updatingYourLibrary: "Atualizando sua biblioteca",
  addingSongsToYourLibrary: "Adicionando músicas à sua biblioteca",
  lookingForMusic: "Procurando músicas",
  waveIsScanning: "O Wave está verificando",
  youCanExcludeAFolderOnceThe: "Você pode excluir uma pasta quando a verificação terminar.",
  youCanAddAFolderOnceThe: "Você pode adicionar uma pasta quando a verificação terminar.",
  alreadyInYourLibrary: "Já está na sua biblioteca",
  waveCantReadThisFolder: "O Wave não consegue ler esta pasta",
  pickItFromYourPhonesStorageOr:
    "Escolha uma pasta no armazenamento do telefone ou no cartão SD, em vez de um atalho como Downloads ou um serviço na nuvem.",
  glass: "Vidro",
  blur: "Desfoque",
  refraction: "Refração",
  off: "Desativado",
  tint: "Tonalidade",
  rim: "Borda",
  howTheTabBarMiniPlayerMenus:
    "Como a barra de abas, o miniplayer, os menus e os diálogos mostram o que está atrás. O desfoque suaviza, a refração curva as bordas, a tonalidade mantém o texto legível e a borda dá brilho ao contorno. Desativar a refração mantém os outros efeitos. A amostra mostra cada alteração; o vidro do app muda quando você sai de Aparência.",
  resetToDefaults: "Restaurar padrões",
  sampleSong: "Música de exemplo",
  sampleSongRow: "Linha de música de exemplo",
  retryAll: "Tentar Todas Novamente",
  clearAll: "Limpar Tudo",
  hideSongs: "Ocultar Músicas",
  showSongs: "Mostrar Músicas",
  hideFailedSongs: "Ocultar músicas que falharam",
  showFailedSongs: "Mostrar músicas que falharam",
  retry: "Tentar Novamente",
  remove: "Remover",
  removeFromFailedDownloads: "Remover dos downloads que falharam",
  yourYouTubeSessionEndedSoYTMusic:
    "Sua sessão do YouTube terminou. Inicie sessão novamente para usar sua conta no YT Music.",
  couldntSignInWithoutAConnection: "Não foi possível iniciar sessão sem conexão.",
  youtubeDidntConfirmTheSigninTryAgain:
    "O YouTube não confirmou o início de sessão. Tente novamente.",
  signOut: "Finalizar Sessão",
  searchPlaybackAndHomesMixesUseThis:
    "Buscar, a reprodução e os mixes do Início usam esta conta. Finalizar sessão esquece a conta neste telefone.",
  useYTMusic: "Usar YT Music",
  searchAlsoFindsSongsOnYouTubeMusic:
    "Buscar também encontra músicas no YouTube Music e envia o que você digita ao YouTube. Nada da sua biblioteca é enviado. Desativado, o Wave não faz solicitações ao YT Music.",
  alwaysSearchOnlineOpensAlbumsAndArtists:
    "Buscar sempre online abre álbuns e artistas com Online selecionado e busca online enquanto você digita. Buscar sempre no Wi-Fi faz isso apenas fora dos dados móveis. Só quando solicitado espera um toque em Online. Mantenha Biblioteca | Online pressionado para alterar essa opção ali.",
  clearArtistPhotos: "Limpar fotos de artistas?",
  clear: "Limpar",
  artistPhotos: "Fotos de artistas",
  downloadArtistPhotos: "Baixar fotos de artistas",
  waveLooksUpAPhotoOfEach:
    "O Wave busca uma foto de cada artista no Deezer, enviando os nomes dos artistas, e guarda as fotos no telefone. Desativado, os artistas mostram as capas dos álbuns e o Wave não faz solicitações.",
  clearArtistPhotosText: "Limpar fotos de artistas",
  swipeLeft: "Deslizar para a esquerda",
  swipeRight: "Deslizar para a direita",
  removeTakesASongOutOfThe:
    "Remover tira a música da playlist atual. Em outros lugares, pede confirmação para apagá-la. Uma música sem a ação escolhida, como Baixar para uma música já no telefone, não desliza nessa direção.",
  appearance: "Aparência",
  systemFollowsAndroidsLightOrDarkSetting:
    "Sistema segue o modo claro ou escuro do Android. Claro e Escuro mantêm o Wave no modo escolhido, independentemente do Android.",
  spotifyEndedYourSessionSoWaveIs:
    "O Spotify encerrou sua sessão. Inicie sessão novamente para usar sua conta.",
  signingOutForgetsThisAccountOnThis: "Finalizar sessão esquece esta conta neste telefone.",
  alwaysSearchOnline: "Buscar sempre online",
  alwaysSearchOnWiFi: "Buscar sempre no Wi-Fi",
  onlyOnDemand: "Só quando solicitado",
  searchOnline: "Buscar online",
  cancel: "Cancelar",
  downloading: "Baixando",
  buffer: "Buffer",
  scanning: "Verificando…",
  soulseeksServerIsntAnsweringTryAgainLater:
    "O servidor do Soulseek não está respondendo. Tente mais tarde.",
  couldntMakeASoulseekAccountTryAgain:
    "Não foi possível criar uma conta do Soulseek. Tente novamente.",
  couldntConnectToSoulseekTryAgainWhen:
    "Não foi possível conectar ao Soulseek. Tente quando estiver online.",
  couldntReadTheSettingReopenSettingsTo:
    "Não foi possível ler a configuração. Abra Ajustes novamente para tentar.",
  couldntTurnItOffTryAgain: "Não foi possível desativar. Tente novamente.",
  downloadInBestQuality: "Baixar na melhor qualidade",
  bestQualityIsMP3320KbpsFrom:
    "A melhor qualidade é MP3 a 320 kbps, obtido de músicas compartilhadas por outras pessoas. É mais lento que o YouTube Music. Se uma música não for encontrada, ela vem do YouTube Music. Desativado, os downloads vêm do YouTube Music enquanto o YT Music estiver ativado.",
  theQuickBrownFoxJumpsOverThe: "Um pequeno jabuti xereta viu dez cegonhas felizes",
  sphinxOfBlackQuartzJudgeMyVow: "Gazeta publica hoje breve nota de faxina na quermesse",
  sampleGlassCardOverColouredStripesDrawn:
    "Cartão de vidro de exemplo sobre faixas coloridas, com os ajustes abaixo",
  nowPlayingsBottomRowLeftToRight:
    "A linha inferior de Tocando Agora, da esquerda para a direita, com Fila sempre à direita. Nenhum remove a posição, e os outros botões se distribuem.",
  resetToDefault: "Restaurar Padrão",
  aButtonAnotherSlotHoldsSwapsPlaces:
    "Um botão que já ocupa outra posição troca de lugar com o desta posição.",
  signIn: "Iniciar Sessão",
  signInAgain: "Iniciar Sessão Novamente",
  signingIn: "Iniciando Sessão…",
  lightBackground: "Fundo claro",
  darkBackground: "Fundo escuro",
  primary: "Primária",
  secondary: "Secundária",
  longpressToRemoveIt: "Mantenha pressionado para remover",
  customColour: "Cor personalizada",
  opensTheColourPicker: "Abre o seletor de cores",
  theme: "Tema",
  custom: "Personalizada",
  saved: "Salvas",
  cardsGroupsSeparatorsAndTextFollowThe:
    "Cartões, grupos, separadores e texto seguem o fundo escolhido para cada modo. A cor primária aparece no progresso, nos controles e no que está ativo; a secundária marca favoritas e a reprodução atual. Padrão usa branco no modo escuro e a cor do texto no claro. A última amostra aceita qualquer cor. Salvar guarda até quatro cores na linha; mantenha uma cor salva pressionada para removê-la. Cores sem contraste suficiente são ajustadas. Se as cores alterarem o ícone do app, o Wave pede confirmação. O ícone muda quando você sai do Wave, usando as cores escolhidas ou as mais próximas disponíveis.",
  primaryColour: "Cor primária",
  secondaryColour: "Cor secundária",
  save: "Salvar",
  addsThisColourToTheSavedColours: "Adiciona esta cor às cores salvas sem aplicá-la",
  fourColoursAreSavedToSaveThis:
    "Já há quatro cores salvas. Para salvar esta, mantenha uma cor salva pressionada e remova-a.",
  thisColourIsSaved: "Esta cor está salva.",
  hexColour: "Cor hexadecimal",
  light: "Claro",
  dark: "Escuro",
  enterA3Or6digitHexColour: "Digite uma cor hexadecimal de 3 ou 6 dígitos.",
  hue: "Matiz",
  dragTheRingForTheHueAnd:
    "Arraste o anel para escolher o matiz e o quadrado para escolher o tom, ou digite uma cor hexadecimal",
  fixSongsOnline: "Corrigir músicas online",
  lyricsAndGenre: "Letra e gênero",
  fixSongInTheMenuOfA:
    "Corrigir Música, no menu de uma música sem letra, gênero, ano, número da faixa ou marcação de conteúdo explícito, busca apenas o que falta: a letra no LRCLIB e os outros dados no Deezer. O título, artista, álbum e duração são enviados a esses serviços. O que for encontrado é gravado no arquivo, sem substituir os dados existentes. Desativado, o Wave não faz buscas.",
  fixSongsInTheWholeLibrary: "Corrigir músicas em toda a Biblioteca",
  couldntSignIn: "Não foi possível iniciar sessão",
  demoItemItOnlyClosesTheMenu: "Item de exemplo. Apenas fecha o menu.",
  sampleMenu: "Menu de exemplo",
  showsTheLongpressDelayWhenHeldOpens:
    "Mostra a duração do toque longo ao manter pressionado. Abre um menu de exemplo.",
  openTheSampleMenu: "Abrir o menu de exemplo",
  yourWaveSessionEndedSoThisPhone:
    "Sua sessão do Wave terminou. Inicie sessão novamente para manter seu backup.",
  yourWaveAccountWasDeletedEverythingOn:
    "Sua Conta Wave foi apagada. Tudo neste telefone permanece.",
  addAGoogleAccountToThisPhone:
    "Adicione uma conta do Google nos ajustes do Android e inicie sessão.",
  thisGoogleAccountCantUseWavesServer: "Esta conta do Google não pode usar o servidor do Wave.",
  couldntSignInTryAgain: "Não foi possível iniciar sessão. Tente novamente.",
  signInWithGoogle: "Iniciar Sessão com o Google",
  couldntDeleteTheAccountWithoutAConnection: "Não foi possível apagar a conta sem conexão.",
  wavesServerDidntDeleteTheAccountTry: "O servidor do Wave não apagou a conta. Tente novamente.",
  signingOut: "Finalizando Sessão…",
  deleting: "Apagando…",
  deleteAccount: "Apagar Conta",
  waveAccount: "Conta Wave",
  waveAccountsArentSetUpOnThis: "As Contas Wave não estão configuradas nesta versão.",
  touch: "Toque",
  longpressDelay: "Duração do toque longo",
  androidsRemoveAnimationsIsOnSoThe:
    "Remover animações está ativado no Android, então a amostra não preenche.",
  showsTheBounceWhenSwipedItPlays: "Mostra a elasticidade ao deslizar. Não reproduz nada.",
  motion: "Movimento",
  bounceAmount: "Elasticidade",
  androidsRemoveAnimationsIsOnSoNothing:
    "Remover animações está ativado no Android, então não há elasticidade.",
  importing: "Importando…",
  importBlackPlayerStats: "Importar Estatísticas do BlackPlayer",
  addsThePlaysInBlackPlayersTrackStats:
    "Adiciona as reproduções dos arquivos de estatísticas do BlackPlayer ao seu histórico. Escolha todos os registros que tiver: compará-los permite datar as reproduções. Importar novamente só adiciona reproduções novas.",
  musicFolders: "Pastas de música",
  theFoldersOnYourPhoneThatWave:
    "As pastas do telefone cujas músicas o Wave mostra, e as pastas dentro delas que ele ignora.",
  rescanLibrary: "Verificar Biblioteca de Novo",
  wavePicksUpNewChangedAndRemoved:
    "O Wave detecta arquivos novos, alterados e removidos sempre que você o abre e quando você puxa a Biblioteca para baixo.",
  geniusInsights: "Informações do Genius",
  openingLyricsOnASongWithLyrics:
    "Abrir Letra em uma música com letra mostra as informações do Genius e destaca os versos com anotações. Isso envia ao Genius o título e o artista da música. Desativado, o Wave não faz solicitações ao Genius.",
  notInYourMusicFolders: "Fora das suas pastas de música",
  waveOnlyShowsSongsFromYourMusic:
    "O Wave só mostra músicas das suas pastas de música. Não há nada para excluir aqui.",
  thisIsAMusicFolder: "Esta é uma pasta de música",
  toStopWaveShowingItsSongsRemove:
    "Para não mostrar mais suas músicas, remova-a das pastas de música.",
  alreadyExcluded: "Já excluída",
  couldntFixSongs: "Não foi possível corrigir as músicas",
  somethingWentWrong: "Algo deu errado",
  waveNotedWhatHappenedSaveLogsKeeps:
    "O Wave registrou o que aconteceu. Salvar Logs guarda o registro em Downloads/Wave. Enviar para o Leo compartilha o registro com ele.",
  couldntSendTheLogsTryAgain: "Não foi possível enviar os logs. Tente novamente.",
  saveLogs: "Salvar Logs",
  savedToDownloadsWave: "Salvo em Downloads/Wave",
  couldntSaveTheLogs: "Não foi possível salvar os logs",
  sendToLeo: "Enviar para o Leo",
  waveCantSeeYourMusicYet: "O Wave ainda não pode ver suas músicas",
  allowAccessToYourMusic: "Permita o acesso às suas músicas",
  allFilesAccessIsStillOffTurn:
    "O acesso a todos os arquivos está desativado. Ative “Permitir acesso para gerenciar todos os arquivos” para o Wave e volte.",
  wavePlaysTheAudioFilesOnThis:
    "O Wave reproduz os arquivos de áudio deste telefone. Para encontrá-los, precisa do acesso a todos os arquivos, ativado nos ajustes do Android.",
  couldntOpenAndroidSettingsTryAgainOr:
    "Não foi possível abrir os ajustes do Android. Tente novamente ou procure o Wave em Acesso a todos os arquivos nos ajustes do Android.",
  openSettings: "Abrir ajustes",
  itsSongsLeaveYourLibraryTheFiles:
    "Suas músicas saem da biblioteca. Os arquivos ficam no telefone.",
  couldntRemoveTheFolder: "Não foi possível remover a pasta",
  loadingMusicFolders: "Carregando pastas de música",
  waveShowsSongsFrom: "O Wave mostra músicas de",
  addFolder: "Adicionar pasta",
  everyFolderInsideTheseIsIncludedWave:
    "Todas as subpastas estão incluídas. O Wave mantém pelo menos uma pasta. As pastas não podem mudar durante uma verificação.",
  waveIgnores: "O Wave ignora",
  stopExcluding: "Parar de excluir",
  couldntIncludeTheFolder: "Não foi possível incluir a pasta",
  excludeFolder: "Excluir pasta",
  songsInExcludedFoldersAndTheFolders:
    "As músicas das pastas excluídas e de suas subpastas saem da biblioteca. Os arquivos ficam no telefone.",
  followedArtists: "Artistas seguidos",
  youArentFollowingAnyArtistsYet: "Você ainda não segue nenhum artista.",
  following: "Seguindo",
  newReleases: "Novos lançamentos",
  newReleasesAndShows: "Novos lançamentos e shows",
  developerIsOn: "Developer is on",
  developerHidden: "Developer hidden",
  settings: "Ajustes",
  crossfade: "Crossfade",
  asASongEndsOnItsOwn:
    "Quando uma música termina, a próxima entra gradualmente durante este período. Pular ou escolher uma música troca imediatamente. Desativado, as músicas tocam uma após a outra, sem intervalo.",
  dontPlayExplicit: "Não reproduzir conteúdo explícito",
  skipsSongsMarkedExplicitByYouTubeMusic:
    "Pula músicas marcadas como explícitas pelo YouTube Music ou Deezer.",
  howMuchOfAStreamedSongWave:
    "Quanto de uma música online o Wave carrega com antecedência, incluindo as próximas músicas em A Seguir, para continuar tocando sem sinal. Períodos maiores usam mais memória: cerca de 50 MB para 30 minutos. Músicas baixadas tocam do telefone.",
  swipeActions: "Ações de deslizar",
  swipeASongSidewaysInAList:
    "Deslize uma música para executar uma ação. A Seguir não aceita esse gesto.",
  songRowsDontSwipeEveryActionIs:
    "As linhas de músicas não deslizam. Todas as ações continuam no menu de toque longo.",
  noListeningHistoryYet: "Nenhum histórico de audição ainda.",
  couldntLoadListeningHistory: "Não foi possível carregar o histórico de audição.",
  keepFindFieldVisible: "Manter Campo de Busca Visível",
  theFindFieldStaysUnderThePages:
    "O campo de busca fica sob o cabeçalho enquanto a lista rola, em vez de aparecer apenas ao puxar a lista para baixo.",
  oneOfHomesSectionsShownUnderThe:
    "Uma seção do Início, mostrada abaixo das linhas da Biblioteca quando há conteúdo.",
  everyShuffleUsesItALongPress:
    "Vale para todos os botões Aleatório. Mantenha um botão pressionado para escolher; em uma posição de Tocando Agora, isso altera o botão.",
  pressBackAgainWithin2SecondsTo: "Pressione Voltar novamente em até 2 segundos para sair",
  dismisses: "Fecha",
  close: "Fechar",
  selectionActions: "Ações de seleção",
  more: "Mais",
  moreActions: "Mais ações",
  selectAll: "Selecionar Tudo",
  ytMusicNote:
    "Iniciar sessão é opcional. Buscar, a reprodução e os mixes do Início usam sua conta. A sessão fica neste telefone. Com Baixar na melhor qualidade desativado, ou quando o Soulseek não encontra uma música, o download vem do YouTube Music: AAC a 256 kbps com Premium, cerca de 128 kbps sem Premium.",
  spotifyNote:
    "Iniciar sessão permite ao Wave ler suas playlists do Spotify e compartilhar as suas lá. Use seu e-mail e senha ou um código recebido por e-mail: Continuar com o Google pode não funcionar aqui. A sessão fica neste telefone, e o Wave se comunica com o Spotify como o player da web.",
  waveAccountNote:
    "Opcional. Guarda sua lista de músicas, playlists, favoritas, histórico de audição e preferências para recuperá-los em outro telefone com a mesma conta.",
  waveAccountSignOutNote:
    "Finalizar sessão mantém tudo neste telefone. Apagar a conta remove o que o servidor do Wave guarda, sem apagar nada deste telefone.",
  longPressFootnote: (ms) =>
    `Mantenha a música de exemplo pressionada para sentir a duração. O padrão é ${formatNumber("pt-BR", ms)} ms.`,
  bounceFootnote: (percent) =>
    `Deslize a música de exemplo para sentir a elasticidade. O padrão é ${formatNumber("pt-BR", percent)}%.`,
  manageFollow: (name, level) => `Gerenciar ${name}, Seguindo, ${level}`,
  signedIn: (name, email) => `Sessão iniciada como ${name}${email === null ? "" : `, ${email}`}`,
  spotifySignedIn: (name) => `Sessão iniciada no Spotify como ${name}`,
  retryLine: (line) => `Tentar novamente ${line}`,
  removeFailure: (line) => `Remover ${line} dos downloads que falharam`,
  slot: (n) => `Posição ${n}`,
  swapSlot: (label, title, holder) => `${label}, ${title}, troca com ${holder}`,
  swipeHint: (side) =>
    `Escolhe a ação de deslizar para a ${side === "left" ? "esquerda" : "direita"}`,
  minutes: (n) =>
    `${formatNumber("pt-BR", n)} ${plural("pt-BR", n, { one: "minuto", other: "minutos" })}`,
  downloadedLine: (count, line) => `${count} baixadas, ${line}`,
  colourMode: (mode, colour) => `Modo ${mode.toLowerCase()}: ${colour}`,
  adjustedColour: (light, dark) =>
    `Ajustada para ficar legível ${light && dark ? "nos seus fundos" : light ? "no seu fundo claro" : "no seu fundo escuro"}, como na amostra.`,
  clearPhotos: (n) =>
    `${plural("pt-BR", n, { one: "A foto que o Wave baixou será apagada", other: `As ${formatNumber("pt-BR", n)} fotos que o Wave baixou serão apagadas` })}. Os artistas mostram as capas dos álbuns até as fotos serem baixadas de novo.`,
  newFiles: (read, total) => `${read} de ${total} arquivos novos ou alterados lidos`,
  indexedFiles: (read, total) => `${read} de ${total} arquivos indexados`,
  foundFiles: (n, count) =>
    `${n} ${plural("pt-BR", count, { one: "arquivo encontrado", other: "arquivos encontrados" })}`,
  selected: (n, count) =>
    `${n} ${plural("pt-BR", count, { one: "selecionado", other: "selecionados" })}`,
  folderCovered: (name) => `O Wave já mostra as músicas de ${name}, que inclui esta pasta.`,
  folderIgnored: (name) => `O Wave já ignora ${name}, que inclui esta pasta.`,
  savedColour: (n, hex) => `Cor salva ${n}, ${hex}`,
  removeFolder: (name) => `Remover ${name}?`,
  couldntFixSongsToast: (message) => `Não foi possível corrigir as músicas: ${message}`,
  musicFolderCount: (n) =>
    `${formatNumber("pt-BR", n)} ${plural("pt-BR", n, { one: "pasta de música", other: "pastas de música" })}`,
  artistCount: (n) =>
    `${formatNumber("pt-BR", n)} ${plural("pt-BR", n, { one: "artista", other: "artistas" })}`,
};
