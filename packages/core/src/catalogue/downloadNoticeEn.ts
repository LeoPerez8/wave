export const downloadNoticeEn = {
  count: (done: string, total: string) => `${done} of ${total}`,
  failed: (n: string, _count: number) => `${n} failed`,
  left: (n: string, _count: number) => `${n} left`,
  title: (count: string) => `Downloading ${count}`,
  lessThanMinute: "Less than a minute left",
  minutes: (n: string) => `About ${n} min left`,
  hours: (n: string) => `About ${n} h left`,
  hoursMinutes: (h: string, m: string) => `About ${h} h ${m} min left`,
  paused: "Paused",
};
