import { Bed, Car, ChefHat, Gamepad2, Sofa, Trees, UtensilsCrossed, type LucideIcon, Monitor } from "lucide-react";
import type { RoomIllustrationKey } from "../../config/curatedHome";

/**
 * Large, thin-stroke line-art icons used as the decorative watermark in each
 * room card — same visual idea as the reference dashboard's hand-drawn
 * furniture sketches, built from lucide's icon set so the linework style
 * stays consistent instead of hand-rolling bespoke SVGs per room.
 */
export const ROOM_ILLUSTRATIONS: Record<RoomIllustrationKey, LucideIcon> = {
  kitchen: ChefHat,
  livingRoom: Sofa,
  office: Monitor,
  bedroom: Bed,
  driveway: Car,
  diningRoom: UtensilsCrossed,
  backyard: Trees,
  attic: Gamepad2,
};
