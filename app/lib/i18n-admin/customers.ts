// New dictionary entries for the admin Customers page (`app/routes/admin.customers.tsx`).
// Shaped exactly like entries in `app/lib/i18n.ts`'s STRINGS — merge this object's
// entries into STRINGS there. Namespace: "admin.customers.*" (owned exclusively by
// this file).

export const ADMIN_CUSTOMERS_STRINGS = {
  // ─── Action errors (returned from the route `action`) ─────────────────
  "admin.customers.err.insufficientPermissions": { lo: "ສິດບໍ່ພຽງພໍ", en: "Insufficient permissions" },
  "admin.customers.err.userIdRequired": { lo: "ຕ້ອງລະບຸ userId", en: "userId required" },
  "admin.customers.err.passwordMinLength": { lo: "ລະຫັດຜ່ານຕ້ອງມີຢ່າງໜ້ອຍ 6 ໂຕ.", en: "Password must be at least 6 characters." },
  "admin.customers.err.unknownOp": { lo: "ບໍ່ຮູ້ຈັກຄຳສັ່ງນີ້", en: "Unknown op" },

  // ─── Page header ────────────────────────────────────────────────────
  "admin.customers.title": { lo: "ລູກຄ້າ", en: "Customers" },
  "admin.customers.total": { lo: "{count} ລາຍການ", en: "{count} total" },

  // ─── Phase filter pills ─────────────────────────────────────────────
  "admin.customers.filter.all": { lo: "ທັງໝົດ", en: "All" },

  // ─── Page size select ───────────────────────────────────────────────
  "admin.customers.pageSizeOption": { lo: "{size} / ໜ້າ", en: "{size} / page" },

  // ─── Search ─────────────────────────────────────────────────────────
  "admin.customers.search.placeholder": { lo: "ຄົ້ນຫາດ້ວຍເບີໂທ ຫຼື ຊື່…", en: "Search by phone or name…" },
  "admin.customers.search.button": { lo: "ຄົ້ນຫາ", en: "SEARCH" },

  // ─── Table headers ──────────────────────────────────────────────────
  "admin.customers.table.phone": { lo: "ເບີໂທ", en: "PHONE" },
  "admin.customers.table.name": { lo: "ຊື່", en: "NAME" },
  "admin.customers.table.status": { lo: "ສະຖານະ", en: "STATUS" },
  "admin.customers.table.gameTier": { lo: "ລະດັບເກມ", en: "GAME TIER" },
  "admin.customers.table.noMatch": { lo: "ບໍ່ພົບລູກຄ້າ.", en: "No customers match." },

  // ─── Row actions ────────────────────────────────────────────────────
  "admin.customers.action.resetPasswordTitle": { lo: "ຣີເຊັດລະຫັດຜ່ານ", en: "Reset password" },
  "admin.customers.action.pwShort": { lo: "ລະຫັດ", en: "PW" },
  "admin.customers.action.suspend": { lo: "ປະງັບ", en: "SUSPEND" },
  "admin.customers.action.activate": { lo: "ເປີດໃຊ້ງານ", en: "ACTIVATE" },
  "admin.customers.action.suspendShort": { lo: "ປະງັບ", en: "SUSP" },
  "admin.customers.action.activateShort": { lo: "ເປີດ", en: "ACT" },

  // ─── Game lock button ───────────────────────────────────────────────
  "admin.customers.lock.unlockTitle": { lo: "ປົດລັອກເກມ (ໃຫ້ຊະນະໄດ້)", en: "Unlock game (allow wins)" },
  "admin.customers.lock.lockTitle": { lo: "ລັອກເກມ (ບັງຄັບໃຫ້ແພ້)", en: "Lock game (force losses)" },
  "admin.customers.lock.unlock": { lo: "ປົດລັອກ", en: "Unlock" },
  "admin.customers.lock.lock": { lo: "ລັອກ", en: "Lock" },
  "admin.customers.lock.adminLockedLabel": { lo: "🔒 ປິດ", en: "🔒 Locked" },
  "admin.customers.betLock.lockTitle": { lo: "ລັອກການແທງ Live (ບໍ່ໃຫ້ເຫັນກະດານແທງ)", en: "Bet-lock (hide the live betting board)" },
  "admin.customers.betLock.unlockTitle": { lo: "ປົດລັອກການແທງ Live", en: "Remove bet-lock" },
  "admin.customers.betLock.lock": { lo: "ລັອກແທງ", en: "B-LOCK" },
  "admin.customers.betLock.unlock": { lo: "ປົດແທງ", en: "B-OPEN" },

  // ─── Pagination ─────────────────────────────────────────────────────
  "admin.customers.page.prev": { lo: "← ກ່ອນໜ້າ", en: "← Prev" },
  "admin.customers.page.next": { lo: "ຕໍ່ໄປ →", en: "Next →" },
  "admin.customers.page.showing": {
    lo: "ສະແດງ {from}–{to} ຈາກ {total} ລູກຄ້າ · ໜ້າ {page}/{totalPages}",
    en: "Showing {from}–{to} of {total} customers · Page {page}/{totalPages}",
  },

  // ─── Suspend/Activate confirm dialog ────────────────────────────────
  "admin.customers.confirm.suspendTitle": { lo: "ປະງັບການນຳໃຊ້ລູກຄ້ານີ້?", en: "Suspend this customer?" },
  "admin.customers.confirm.activateTitle": { lo: "ເປີດໃຊ້ງານລູກຄ້ານີ້?", en: "Activate this customer?" },
  "admin.customers.confirm.suspendDescription": { lo: "{tel} ຈະບໍ່ສາມາດເຂົ້າສູ່ລະບົບໄດ້ ຈົນກວ່າຈະເປີດໃຊ້ງານຄືນ.", en: "{tel} won't be able to sign in until reactivated." },
  "admin.customers.confirm.activateDescription": { lo: "{tel} ຈະສາມາດເຂົ້າສູ່ລະບົບໄດ້ທັນທີ.", en: "{tel} will regain access immediately." },

  // ─── Reset password modal ───────────────────────────────────────────
  "admin.customers.resetPassword.heading": { lo: "ຣີເຊັດລະຫັດຜ່ານ", en: "Reset Password" },
  "admin.customers.resetPassword.newPasswordLabel": { lo: "ລະຫັດຜ່ານໃໝ່", en: "NEW PASSWORD" },
  "admin.customers.resetPassword.placeholder": { lo: "ຢ່າງໜ້ອຍ 6 ໂຕ", en: "Min. 6 characters" },
  "admin.customers.resetPassword.success": { lo: "ປ່ຽນລະຫັດຜ່ານສຳເລັດແລ້ວ.", en: "Password updated successfully." },
  "admin.customers.resetPassword.cancel": { lo: "ຍົກເລີກ", en: "Cancel" },
  "admin.customers.resetPassword.saving": { lo: "ກຳລັງບັນທຶກ…", en: "Saving…" },
  "admin.customers.resetPassword.submit": { lo: "ບັນທຶກລະຫັດຜ່ານ", en: "Set Password" },

  // ─── Empty state ────────────────────────────────────────────────────
  "admin.customers.emptyState": { lo: "ບໍ່ພົບລູກຄ້າ.", en: "No customers match." },
} as const
