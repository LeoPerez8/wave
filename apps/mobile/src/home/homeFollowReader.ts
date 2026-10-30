import type { HomeFollowSnapshot } from "@wave/core";

/** Each refresh starts after earlier reads settle, including refreshes requested after a write. */
export const createHomeFollowReader = (
  read: (admitted?: HomeFollowSnapshot) => Promise<HomeFollowSnapshot>,
) => {
  let tail: Promise<unknown> = Promise.resolve();
  return (admitted?: HomeFollowSnapshot): Promise<HomeFollowSnapshot> => {
    const request = tail.then(() => read(admitted));
    tail = request.catch(() => {});
    return request;
  };
};
