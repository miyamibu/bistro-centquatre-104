import { ReservationStatus } from "@prisma/client";

export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  [ReservationStatus.CONFIRMED]: "確定",
  [ReservationStatus.CANCELLED]: "キャンセル済み",
  [ReservationStatus.DONE]: "来店済み",
  [ReservationStatus.NOSHOW]: "無断キャンセル",
};

export function getReservationStatusLabel(status: ReservationStatus) {
  return RESERVATION_STATUS_LABELS[status];
}
