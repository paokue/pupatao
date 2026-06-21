// Reject reason codes admins choose from when declining a deposit/withdraw
// request. The code is persisted on `Transaction.rejectReasonCode` and the
// customer-facing text is resolved from it via `app/lib/i18n.ts` so it can
// render in the customer's locale. The `label` below is the admin dropdown
// text, kept bilingual so the admin language switcher applies to it too.

export const DEPOSIT_REJECT_REASONS = [
  { code: 'INVALID_SLIP', label: { lo: 'ສະລິບການໂອນບໍ່ຖືກຕ້ອງ — ກາລຸນາກວດສອບ ແລະ ລອງໃໝ່ອີກຄັ້ງ', en: 'Invalid slip — please check and try again' } },
  { code: 'AMOUNT_MISMATCH', label: { lo: 'ຈໍານວນເງິນທີ່ໂອນບໍ່ຕົງກັບຈໍານວນທີ່ຝາກ', en: 'Transferred amount does not match the deposit amount' } },
] as const

export const WITHDRAW_REJECT_REASONS = [
  { code: 'INSUFFICIENT_BALANCE', label: { lo: 'ຍອດເງິນບໍ່ພຽງພໍສຳລັບການຖອນນີ້', en: 'Insufficient balance to withdraw' } },
  { code: 'QR_ISSUE', label: { lo: 'QR ມີບັນຫາ — ກາລຸນາອັບເດດ QR ໃໝ່', en: 'QR code has an issue — please update your QR' } },
] as const

export type DepositRejectReasonCode = typeof DEPOSIT_REJECT_REASONS[number]['code']
export type WithdrawRejectReasonCode = typeof WITHDRAW_REJECT_REASONS[number]['code']
export type RejectReasonCode = DepositRejectReasonCode | WithdrawRejectReasonCode

export function rejectReasonsFor(type: 'DEPOSIT' | 'WITHDRAW') {
  return type === 'DEPOSIT' ? DEPOSIT_REJECT_REASONS : WITHDRAW_REJECT_REASONS
}

export function isValidRejectReason(type: 'DEPOSIT' | 'WITHDRAW', code: string): code is RejectReasonCode {
  return rejectReasonsFor(type).some(r => r.code === code)
}

export function rejectReasonLabel(type: 'DEPOSIT' | 'WITHDRAW', code: string, locale: 'lo' | 'en' = 'lo'): string | null {
  return rejectReasonsFor(type).find(r => r.code === code)?.label[locale] ?? null
}
