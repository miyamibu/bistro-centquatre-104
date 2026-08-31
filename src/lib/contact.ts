export const CONTACT_PHONE_E164 =
  process.env.NEXT_PUBLIC_CONTACT_PHONE_E164 ?? "+81492706897";
export const CONTACT_PHONE_DISPLAY =
  process.env.NEXT_PUBLIC_CONTACT_PHONE_DISPLAY ?? "049－270－6897";
export const CONTACT_TEL_LINK = `tel:${CONTACT_PHONE_E164}`;
export const CONTACT_MESSAGE_BASE =
  process.env.NEXT_PUBLIC_CONTACT_MESSAGE ?? "お電話でお問い合わせください";
export const CONTACT_MESSAGE = `${CONTACT_MESSAGE_BASE}：${CONTACT_PHONE_DISPLAY}`;

export function getContactPayload() {
  const callPhone = process.env.CONTACT_PHONE_DISPLAY ?? CONTACT_PHONE_DISPLAY;
  const callMessageBase = process.env.CONTACT_MESSAGE ?? CONTACT_MESSAGE_BASE;

  return {
    callPhone,
    callMessage: `${callMessageBase}：${callPhone}`,
  };
}
