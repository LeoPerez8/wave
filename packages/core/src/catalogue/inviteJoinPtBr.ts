import type { inviteJoinEn } from "./inviteJoinEn.ts";

export const inviteJoinPtBr: typeof inviteJoinEn = {
  invitedBy: (owner) => `${owner} convidou você para`,
  invited: "Você recebeu um convite para",
  unnamedPlaylist: "Uma playlist colaborativa",
  allows: "Você vai poder adicionar, remover e reordenar músicas com os outros membros.",
  join: "Entrar",
  cancel: "Cancelar",
  joiningAs: (account) => `Você entra como ${account}`,
  signInTitle: "Inicie sessão para entrar",
  signInMessage:
    "Playlists colaborativas usam a conta Wave. Depois de iniciar sessão, o convite abre de novo.",
  fullTitle: "O serviço está cheio",
  fullMessage: "O Wave não aceita contas novas agora, então não dá para entrar nesta playlist.",
  notValidTitle: "Este convite não vale mais",
  notValidMessage: "Peça um link novo a quem convidou você.",
  couldntOpen: "Não foi possível abrir o convite",
  couldntJoin: "Não foi possível entrar na playlist",
  offlineMessage: "Conecte-se à internet e toque no link de novo.",
  failedMessage: "Tente de novo daqui a pouco.",
  joined: (playlist) =>
    `Você entrou em ${playlist}. Ela aparece na sua Biblioteca depois da sincronização.`,
};
