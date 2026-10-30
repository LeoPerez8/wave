import type { downloadNoticeEn } from "./downloadNoticeEn.ts";
export const downloadNoticePtBr: typeof downloadNoticeEn = {
  count: (done, total) => `${done} de ${total}`,
  failed: (n, count) => (count === 1 ? `${n} falhou` : `${n} falharam`),
  left: (n, count) => (count === 1 ? `${n} restante` : `${n} restantes`),
  title: (count) => `Baixando ${count}`,
  lessThanMinute: "Menos de um minuto restante",
  minutes: (n) => `Cerca de ${n} min restantes`,
  hours: (n) => `Cerca de ${n} h restantes`,
  hoursMinutes: (h, m) => `Cerca de ${h} h ${m} min restantes`,
  paused: "Pausado",
};
