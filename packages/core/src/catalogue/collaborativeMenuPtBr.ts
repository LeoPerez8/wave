import { formatNumber } from "../formatting.ts";
import { plural } from "../plural.ts";
import type { collaborativeMenuEn } from "./collaborativeMenuEn.ts";

const n = (count: number): string => formatNumber("pt-BR", count);

const othersKeepACopy = (count: number): string =>
  plural("pt-BR", count, {
    one: "O outro membro fica com uma cópia.",
    other: `Os ${n(count)} outros membros ficam com uma cópia.`,
  });

export const collaborativeMenuPtBr: typeof collaborativeMenuEn = {
  makeTitle: (name) => `Tornar “${name}” colaborativa?`,
  makeMessage:
    "Quem entrar pelo seu convite poderá adicionar, remover e reordenar músicas e mudar o nome. Só você convida, remove membros e apaga a playlist.",
  makeAction: "Tornar Colaborativa",
  signInTitle: "Inicie sessão na conta Wave",
  signInMessage:
    "Playlists colaborativas usam a conta Wave. Inicie sessão e depois torne a playlist colaborativa.",
  signIn: "Iniciar Sessão",

  leaveTitle: (name) => `Sair de “${name}”?`,
  leaveMessage:
    "A playlist sai da sua Biblioteca. As músicas que você adicionou continuam para os outros.",
  leave: "Sair",
  removeTitle: (name) => (name === null ? "Remover este membro?" : `Remover ${name}?`),
  removeMessage: "A pessoa fica com uma cópia só dela e o link de convite atual deixa de valer.",
  remove: "Remover",
  endTitle: "Encerrar a colaboração?",
  endMessage: (others) =>
    others === 0
      ? "A playlist volta a ser só sua."
      : `A playlist volta a ser só sua. ${othersKeepACopy(others)}`,
  end: "Encerrar",
  deleteMessage: (others) => `Ela é apagada para você. ${othersKeepACopy(others)}`,

  invite: "Convidar",
  validUntil: (date) =>
    `Vale até ${date}. Qualquer pessoa com o link e uma conta Wave pode entrar na playlist.`,
  madeElsewhere: (date) =>
    `Um link de convite criado em outro aparelho vale até ${date}. Crie um novo para compartilhar daqui; o atual deixa de valer.`,
  noLink: "Não há link de convite ativo. Crie um para convidar pessoas para a playlist.",
  shareLink: "Compartilhar Link",
  copyLink: "Copiar Link",
  turnOffLink: "Desativar Link",
  createLink: "Criar Link de Convite",
  inviteLink: "Link de convite",
  linkCopied: "Link copiado",
  linkTurnedOff: "Link de convite desativado",
  copyFailed: "Não foi possível copiar o link",
  shareFailed: "Não foi possível compartilhar o link",

  members: "Membros",
  owner: "Dono",
  you: "Você",
  ownerAndYou: "Dono · Você",
  noName: "Sem nome",
  inviteSection: "Convite",

  failed: {
    make: "Não foi possível tornar a playlist colaborativa",
    invite: "Não foi possível criar o link de convite",
    readInvite: "Não foi possível ler o link de convite",
    turnOff: "Não foi possível desativar o link de convite",
    members: "Não foi possível carregar os membros",
    remove: "Não foi possível remover o membro",
    end: "Não foi possível encerrar a colaboração",
    leave: "Não foi possível sair da playlist",
  },
  why: {
    offline: "Você está offline. Tente novamente quando estiver online.",
    notMember: "Esta playlist não é mais colaborativa, ou você não faz mais parte dela.",
    notOwner: "Só o dono pode fazer isso.",
    ownerCannotLeave: "O dono não pode sair da playlist. Encerre a colaboração.",
    deleted: "O dono apagou esta playlist.",
    notFound: "A playlist ou o membro não está mais lá.",
    taken: "Esta playlist não pode ser tornada colaborativa.",
    linkNotValid: "Este link de convite não vale mais.",
    full: "A conta Wave chegou a um limite das playlists colaborativas.",
    failed: "Algo deu errado. Tente novamente mais tarde.",
  },
};
