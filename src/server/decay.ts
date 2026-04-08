import { differenceInHours } from "date-fns";
import { HALF_LIFE_DAYS } from "@/server/weights";

const HALF_LIFE_HOURS = HALF_LIFE_DAYS * 24;
const DECAY_LAMBDA = Math.log(2) / HALF_LIFE_HOURS;

export function recencyDecay(date: Date, now = new Date()) {
  const ageHours = Math.max(differenceInHours(now, date), 0);
  return Math.exp(-DECAY_LAMBDA * ageHours);
}
