import { useEffect } from "react";

import { useScreenSight } from "@/lib/screenSight";

import { homeWork } from "./homeWork";

/** Home's screen opens Home's work while it's in sight (`homeWork`, #1351). */
export const useHomeWorkSight = (): void => {
  const sight = useScreenSight();
  useEffect(() => homeWork.follow(sight), [sight]);
};
