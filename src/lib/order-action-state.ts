export function shouldRequireOrderRefresh(status: number) {
  return status === 409 || status >= 500;
}

export type OrdersNeedRefreshEvent =
  | { type: "transport-unknown" }
  | { type: "mutation-response"; status: number }
  | { type: "mutation-succeeded-refresh-failed" }
  | { type: "refresh-failed" }
  | { type: "refresh-succeeded" };

export function reduceOrdersNeedRefresh(
  current: boolean,
  event: OrdersNeedRefreshEvent,
): boolean {
  switch (event.type) {
    case "refresh-succeeded":
      return false;
    case "transport-unknown":
    case "mutation-succeeded-refresh-failed":
    case "refresh-failed":
      return true;
    case "mutation-response":
      return current || shouldRequireOrderRefresh(event.status);
  }
}
