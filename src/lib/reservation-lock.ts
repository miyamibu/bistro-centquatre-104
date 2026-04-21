export function buildReservationAdvisoryLockKey(date: string, servicePeriod: string) {
  return `reservation:${date}:${servicePeriod}`;
}
