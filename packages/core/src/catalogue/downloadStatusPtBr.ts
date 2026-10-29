import { formatNumber } from "../formatting.ts";
import { plural } from "../plural.ts";
import type { downloadStatusEn } from "./downloadStatusEn.ts";

export const downloadStatusPtBr: typeof downloadStatusEn = {
  queued: "Aguardando download",
  connecting: "Conectando",
  searching: "Procurando esta gravação",
  validating: "Verificando o download",
  downloading: "Baixando",
  downloadingPercent: (percent) => `Baixando · ${percent}%`,
  saving: "Salvando na Biblioteca",
  done: "Na Biblioteca",
  failures: {
    offline: "O download falhou: offline",
    failed: "O download falhou",
    timedOut: "O download falhou",
    noFolder: "O download falhou: nenhuma pasta de música",
    storage: "O download falhou: não foi possível salvar o arquivo",
    account: "Ative Baixar na melhor qualidade em Ajustes",
    accountRejected: "Ative Baixar na melhor qualidade em Ajustes",
    unreachable: "O download falhou: não foi possível acessar o Soulseek",
    unavailable: "Esta gravação não está disponível em 320 kbps",
    noSource: "Ative YT Music ou Baixar na melhor qualidade em Ajustes",
    ytUnavailable: "Esta música não está disponível no YouTube Music",
    notFound: "Não encontrada online",
  },
  downloadingCount: (n) => `${formatNumber("pt-BR", n)} baixando`,
  savingCount: (n) => `${formatNumber("pt-BR", n)} salvando`,
  waitingCount: (n) => `${formatNumber("pt-BR", n)} aguardando`,
  failedSongs: (n) =>
    `${formatNumber("pt-BR", n)} ${plural("pt-BR", n, { one: "música falhou", other: "músicas falharam" })}`,
};
