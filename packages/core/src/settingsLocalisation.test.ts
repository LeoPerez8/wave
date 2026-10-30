import assert from "node:assert/strict";
import { test } from "node:test";
import {
  APPEARANCES,
  DEFAULT_THEME_CHOICE,
  LAUNCHER_ICONS,
  catalogueOf,
  confirmWaveAccountDeletion,
  describeFolder,
  describeTagLookups,
  downloadsSummary,
  launcherIconSwitch,
  libraryLookupProgress,
  missingSongsDownload,
  missingSongsDownloadActionLabels,
  planAlert,
  queuedDownloadsSummary,
  spotifySignInFailureLines,
  summarizeBlackPlayerImport,
  tagLookupsToast,
  themeSwatchRows,
  visibleSettingsPages,
  waveAccountCard,
  ytDownloadLine,
  type SongTagOutcome,
  type TagWriteReport,
} from "./index.ts";

const pt = catalogueOf("pt-BR");

test("Settings' pages and Layout's pages read in Portuguese; Developer stays English", () => {
  assert.deepEqual(
    visibleSettingsPages(true, pt).map(({ title }) => title),
    [
      "Biblioteca",
      "Aparência",
      "Layout",
      "Ações de deslizar",
      "Reprodução",
      "Histórico de Ouvidas",
      "Artistas Seguidos",
      "Letras e tags",
      "Downloads",
      "Contas",
      "Developer",
    ],
  );
  assert.equal(visibleSettingsPages(false).at(-1)?.title, "Accounts");
  assert.deepEqual(Object.values(pt.settings.layoutPages), [
    "Início",
    "Biblioteca",
    "Playlists",
    "Barra de abas",
    "Tocando Agora",
  ]);
  assert.deepEqual(
    APPEARANCES.map(({ id }) => pt.settings.appearances[id]),
    ["Sistema", "Claro", "Escuro"],
  );
});

test("theme swatches are named in the app's language", () => {
  const [light, dark, primary] = themeSwatchRows(DEFAULT_THEME_CHOICE, "light", pt);
  assert.equal(light?.swatches[0]?.label, "Névoa");
  assert.equal(dark?.swatches[0]?.label, "Preto puro");
  assert.equal(primary?.swatches[0]?.label, "Padrão");
  assert.equal(themeSwatchRows(DEFAULT_THEME_CHOICE, "light")[0]?.swatches[0]?.label, "Fog");
});

test("download counts and lines read in Portuguese, with grouped numbers", () => {
  assert.equal(downloadsSummary(1, undefined, pt), "1 música falhou");
  assert.equal(
    downloadsSummary(1200, { downloading: 2, saving: 0, waiting: 5 }, pt),
    "2 baixando · 5 aguardando · 1.200 músicas falharam",
  );
  assert.equal(queuedDownloadsSummary({ downloading: 0, saving: 1, waiting: 0 }, pt), "1 salvando");
  assert.equal(
    ytDownloadLine({ kind: "failed", reason: "offline" }, pt),
    "O download falhou: offline",
  );
  assert.equal(ytDownloadLine({ kind: "saving" }, pt), "Salvando na Biblioteca");
  assert.equal(ytDownloadLine({ kind: "queued" }, pt), "Aguardando download");
});

test("alert buttons, music folders and the scan banner's counts read in Portuguese", () => {
  const confirm = planAlert(
    { title: "Apagar?", message: "Confirme.", action: { label: "Apagar" } },
    pt,
  );
  assert.equal(confirm.buttons[0]?.label, "Cancelar");
  assert.equal(planAlert({ title: "Pronto", message: "Feito." }, pt).buttons[0]?.label, "OK");
  assert.equal(describeFolder("/storage/emulated/0", pt).name, "Armazenamento interno");
  assert.equal(describeFolder("/storage/1A2B-3C4D/Música", pt).storage, "Cartão SD");
  assert.equal(pt.settings.musicFolderCount(1), "1 pasta de música");
  assert.equal(pt.settings.musicFolderCount(2), "2 pastas de música");
  assert.equal(pt.settings.foundFiles("1", 1), "1 arquivo encontrado");
  assert.equal(pt.settings.selected("3", 3), "3 selecionados");
  assert.equal(pt.settings.minutes(1), "1 minuto");
  assert.equal(pt.settings.longPressFootnote(1500).endsWith("O padrão é 1.500 ms."), true);
});

test("account dialogs, sign-in failures and missing songs read in Portuguese", () => {
  assert.deepEqual(
    planAlert(waveAccountCard(pt), pt).buttons.map(({ label }) => label),
    ["Cancelar", "Continuar"],
  );
  assert.equal(confirmWaveAccountDeletion(pt).title, "Apagar sua Conta Wave?");
  assert.equal(confirmWaveAccountDeletion(pt).action.destructive, true);
  assert.equal(
    spotifySignInFailureLines(pt).failed,
    "O Spotify não confirmou o início de sessão. Tente novamente.",
  );
  assert.deepEqual(missingSongsDownloadActionLabels(pt), {
    downloadAll: "Baixar Tudo",
    retryFailed: "Tentar Falhas Novamente",
    cancel: "Cancelar",
  });
  const song = {
    videoId: "a",
    title: "Airbag",
    artists: [],
    album: null,
    durationMs: null,
    artworkUrl: null,
    explicit: false,
  };
  assert.equal(missingSongsDownload([song], [], pt).line, "1 música não está neste telefone");
  assert.equal(
    missingSongsDownload([song, { ...song, videoId: "b" }], [], pt).line,
    "2 músicas não estão neste telefone",
  );
});

test("the app icon prompt reads in Portuguese", () => {
  const stored = LAUNCHER_ICONS.find((icon) => icon.id === "vivid209_vivid29")!;
  const change = launcherIconSwitch(
    stored,
    DEFAULT_THEME_CHOICE,
    { dropsHomeScreenIcon: true },
    pt,
  );
  assert.equal(change?.warning.title, "Alterar também o ícone do app?");
  assert.match(change?.warning.message ?? "", /gaveta de apps/);
  assert.deepEqual(
    planAlert(change!.warning, pt).buttons.map(({ label }) => label),
    ["Não", "Sim"],
  );
});

test("the BlackPlayer import summary reads in Portuguese", () => {
  const summary = summarizeBlackPlayerImport(
    {
      plays: [
        { trackId: 1, startedAt: 1 },
        { trackId: 1, startedAt: 2 },
        { trackId: 2, startedAt: 3 },
      ],
      unmatched: [{ title: "505", artist: "Arctic Monkeys", plays: 16 }],
      snapshots: 1,
      skipped: [{ file: "notes.txt", reason: "notStats" }],
    },
    pt,
  );
  assert.equal(summary.title, "Estatísticas do BlackPlayer importadas");
  assert.deepEqual(
    summary.sections.map(({ heading, detail }) => [heading, detail]),
    [
      ["3 reproduções novas", "De 2 músicas, em 1 registro"],
      ["1 música não está na sua biblioteca", "16 reproduções dela não foram importadas"],
      ["notes.txt", "Não é um arquivo de estatísticas do BlackPlayer"],
    ],
  );
  const empty = { plays: [], unmatched: [], snapshots: 1, skipped: [] };
  assert.equal(summarizeBlackPlayerImport(empty, pt).title, "Nada novo importado");
});

const report = (written: Partial<TagWriteReport>): TagWriteReport => ({
  lyrics: "none",
  genre: "none",
  trackNumber: "none",
  year: "none",
  explicit: "none",
  ...written,
});
const fixed = (written: Partial<TagWriteReport>): SongTagOutcome => ({
  kind: "updated",
  written: report(written),
});

test("Fix Song's summaries, toasts and progress read in Portuguese", () => {
  assert.deepEqual(
    describeTagLookups(
      [{ title: "Airbag", outcome: fixed({ lyrics: "tags", genre: "tags", year: "tags" }) }],
      undefined,
      0,
      pt,
    ),
    { title: "Música corrigida", message: "Preenchido em “Airbag”: letra, gênero e ano." },
  );
  assert.equal(
    describeTagLookups(
      [{ title: "Airbag", outcome: fixed({ lyrics: "sidecar", genre: "notWritten" }) }],
      undefined,
      0,
      pt,
    ).message,
    "O Wave não consegue gravar tags no formato deste arquivo, então a letra foi salva ao lado dele como um arquivo .lrc. Não foi gravado: gênero.",
  );
  assert.deepEqual(describeTagLookups([], undefined, 1, pt).title, "Nada para corrigir");
  const run = [
    { title: "Airbag", outcome: fixed({ lyrics: "tags" }) },
    { title: "Bloom", outcome: { kind: "notFound" } as const },
  ];
  assert.deepEqual(describeTagLookups(run, { stopped: "unreachable", left: 1 }, 2, pt), {
    title: "Corrigir Músicas parou",
    message: [
      "1 corrigida · 1 não encontrada · 0 falhou",
      "2 músicas já tinham letra, gênero, número da faixa, ano e marcação de conteúdo explícito, então foram puladas.",
      "Não foi possível acessar o LRCLIB e o Deezer, então 1 música não foi buscada.",
    ].join("\n\n"),
  });
  assert.equal(
    tagLookupsToast(run, { stopped: "unreachable", left: 3 }, 1200, pt),
    "1 música corrigida · 1 não encontrada · 1.200 já completas · 3 não buscadas (offline)",
  );
  assert.equal(
    tagLookupsToast([{ title: "Airbag", outcome: fixed({ lyrics: "tags" }) }], undefined, 0, pt),
    "“Airbag” corrigida",
  );
  assert.deepEqual(libraryLookupProgress(3, 1200, pt), {
    title: "Corrigindo músicas…",
    detail: "3 de 1.200",
    line: "Corrigindo músicas… 3 de 1.200",
  });
});
