export const LINE_CUSTOMER_LINK_CONSENT_DAYS = 180;
export const LINE_CUSTOMER_LINK_SOURCE = "LINE_CUSTOMER_LINK";

export function getLineCustomerLinkConsentCutoff(now = new Date()): Date {
  return new Date(
    now.getTime() - LINE_CUSTOMER_LINK_CONSENT_DAYS * 24 * 60 * 60 * 1000
  );
}
