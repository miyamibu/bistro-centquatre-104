const serverContactPhoneE164 = typeof window === "undefined" ? process.env.CONTACT_PHONE_E164 : undefined;
const serverContactPhoneDisplay =
  typeof window === "undefined" ? process.env.CONTACT_PHONE_DISPLAY : undefined;
const serverContactMessage = typeof window === "undefined" ? process.env.CONTACT_MESSAGE : undefined;

export const CONTACT_PHONE_E164 =
  serverContactPhoneE164 ?? process.env.NEXT_PUBLIC_CONTACT_PHONE_E164 ?? "+81492706897";
export const CONTACT_PHONE_DISPLAY =
  serverContactPhoneDisplay ?? process.env.NEXT_PUBLIC_CONTACT_PHONE_DISPLAY ?? "049－270－6897";
export const CONTACT_TEL_LINK = `tel:${CONTACT_PHONE_E164}`;
export const CONTACT_MESSAGE_BASE =
  serverContactMessage ?? process.env.NEXT_PUBLIC_CONTACT_MESSAGE ?? "お電話でお問い合わせください";
export const CONTACT_MESSAGE = `${CONTACT_MESSAGE_BASE}：${CONTACT_PHONE_DISPLAY}`;

export function getContactPayload() {
  return {
    callPhone: CONTACT_PHONE_DISPLAY,
    callMessage: CONTACT_MESSAGE,
  };
}
