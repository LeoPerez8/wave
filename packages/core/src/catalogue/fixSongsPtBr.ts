import { formatNumber } from "../formatting.ts";
import { plural } from "../plural.ts";
import type { fixSongsEn } from "./fixSongsEn.ts";

const count = (n: number): string => formatNumber("pt-BR", n);
const songs = (n: number): string =>
  `${count(n)} ${plural("pt-BR", n, { one: "música", other: "músicas" })}`;

/** "a", "a e b", "a, b e c". */
const listed = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} e ${items.at(-1)}`;

const EVERYTHING = "letra, gênero, número da faixa, ano e marcação de conteúdo explícito";

export const fixSongsPtBr: typeof fixSongsEn = {
  progress: "Corrigindo músicas…",
  progressCount: (done, total) => `${count(done)} de ${count(total)}`,
  tags: {
    lyrics: "letra",
    genre: "gênero",
    trackNumber: "número da faixa",
    year: "ano",
    explicit: "marcação de conteúdo explícito",
  },
  lookupFailed: (title) => `Não foi possível buscar “${title}”`,
  lookupFailedMessage: "Não foi possível acessar o LRCLIB ou o Deezer. O arquivo não foi alterado.",
  updateFailed: (title) => `Não foi possível atualizar “${title}”`,
  writeFailedMessage: "O Wave não conseguiu gravar no arquivo. Ele não foi alterado.",
  formatFailedMessage:
    "Nenhuma letra foi encontrada, e o Wave não consegue gravar tags no formato deste arquivo. Ele não foi alterado.",
  songFixed: "Música corrigida",
  savedAsLrc: (notWritten) =>
    `O Wave não consegue gravar tags no formato deste arquivo, então a letra foi salva ao lado dele como um arquivo .lrc.${
      notWritten.length === 0
        ? ""
        : ` Não ${notWritten.length === 1 ? "foi gravado" : "foram gravados"}: ${listed(notWritten)}.`
    }`,
  filledIn: (filled, title) => `Preenchido em “${title}”: ${listed(filled)}.`,
  nothingToFix: "Nada para corrigir",
  allComplete: (n) =>
    n === 1
      ? `A única música já tem ${EVERYTHING}.`
      : `Todas as ${count(n)} músicas já têm ${EVERYTHING}.`,
  nothingFound: "Nada encontrado",
  nothingFoundFor: (title) =>
    `Nada do que falta em “${title}” foi encontrado. O arquivo não foi alterado.`,
  tally: (fixed, notFound, failed) =>
    `${count(fixed)} ${plural("pt-BR", fixed, { one: "corrigida", other: "corrigidas" })} · ${count(notFound)} ${plural("pt-BR", notFound, { one: "não encontrada", other: "não encontradas" })} · ${count(failed)} ${plural("pt-BR", failed, { one: "falhou", other: "falharam" })}`,
  skipped: (n) =>
    `${songs(n)} já ${n === 1 ? "tinha" : "tinham"} ${EVERYTHING}, então ${n === 1 ? "foi pulada" : "foram puladas"}.`,
  sidecars: (named, more) =>
    `Letras salvas como arquivos .lrc, gênero não gravado (o Wave não consegue gravar tags no formato delas): ${named.join(", ")}${more > 0 ? ` e mais ${count(more)}` : ""}.`,
  notLookedUp: (n, unreachable) =>
    `${unreachable ? "Não foi possível acessar o LRCLIB e o Deezer, então " : ""}${songs(n)} não ${n === 1 ? "foi buscada" : "foram buscadas"}.`,
  songsFixed: "Músicas corrigidas",
  stopped: "Corrigir Músicas parou",
  toast: {
    fixed: (title) => `“${title}” corrigida`,
    fixedAsLrc: (title) => `“${title}” corrigida · letra salva como .lrc`,
    nothingFoundFor: (title) => `Nada encontrado para “${title}”`,
    nothingFixed: "Nada corrigido",
    fixedSongs: (n) =>
      `${songs(n)} ${plural("pt-BR", n, { one: "corrigida", other: "corrigidas" })}`,
    notFound: (n) =>
      `${count(n)} ${plural("pt-BR", n, { one: "não encontrada", other: "não encontradas" })}`,
    failed: (n) => `${count(n)} ${plural("pt-BR", n, { one: "falhou", other: "falharam" })}`,
    complete: (n) =>
      `${count(n)} já ${plural("pt-BR", n, { one: "completa", other: "completas" })}`,
    notLookedUp: (n, offline) =>
      `${count(n)} não ${plural("pt-BR", n, { one: "buscada", other: "buscadas" })}${offline ? " (offline)" : ""}`,
  },
};
