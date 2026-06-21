// Admin shell (admin.tsx) + dashboard (admin._index.tsx) translation strings.
// Shaped like entries in `app/lib/i18n.ts`'s STRINGS — merged in there by hand.
export const ADMIN_SHELL_STRINGS = {
  // ─── admin.tsx — shell / sidebar / header ───────────────────────────
  "admin.shell.dashboard": { lo: "ໜ້າຫຼັກ", en: "Dashboard" },
  "admin.shell.dashboardMobile": { lo: "ໜ້າຫຼັກ", en: "Home" },
  "admin.shell.customers": { lo: "ລູກຄ້າ", en: "Customers" },
  "admin.shell.customersMobile": { lo: "ລູກຄ້າ", en: "Users" },
  "admin.shell.livePlay": { lo: "ຫຼິ້ນສົດ", en: "Live Play" },
  "admin.shell.livePlayMobile": { lo: "ສົດ", en: "Live" },
  "admin.shell.wallet": { lo: "ກະເປົາເງິນ", en: "Wallet" },
  "admin.shell.transactions": { lo: "ລາຍການເງິນ", en: "Transactions" },
  "admin.shell.transactionsMobile": { lo: "ລາຍການ", en: "Trans" },
  "admin.shell.playHistory": { lo: "ປະຫວັດການຫຼິ້ນ", en: "Play History" },
  "admin.shell.playHistoryMobile": { lo: "ປະຫວັດ", en: "Plays" },
  "admin.shell.competition": { lo: "ການແຂ່ງຂັນ", en: "Competition" },
  "admin.shell.competitionMobile": { lo: "ແຂ່ງຂັນ", en: "Contest" },
  "admin.shell.financial": { lo: "ການເງິນ", en: "Financial" },
  "admin.shell.financialMobile": { lo: "ການເງິນ", en: "Finance" },

  "admin.shell.newCustomerRegistered": { lo: "ມີລູກຄ້າໃໝ່ລົງທະບຽນ", en: "New customer registered" },
  "admin.shell.loading": { lo: "ກຳລັງໂຫຼດ...", en: "Loading..." },
  "admin.shell.signOut": { lo: "ອອກຈາກລະບົບ", en: "Sign out" },

  // ─── admin._index.tsx — dashboard ────────────────────────────────────
  "admin.dashboard.errInsufficientPermissions": { lo: "ບໍ່ມີສິດອະນຸຍາດ", en: "Insufficient permissions" },
  "admin.dashboard.errUnknownOp": { lo: "ບໍ່ຮູ້ຈັກການດຳເນີນການນີ້", en: "Unknown op" },

  "admin.dashboard.title": { lo: "ໜ້າຫຼັກ", en: "Dashboard" },

  "admin.dashboard.statCustomers": { lo: "ລູກຄ້າ", en: "Customers" },
  "admin.dashboard.statCustomersHint": { lo: "ໃຊ້ງານ / ທັງໝົດ", en: "active / total" },
  "admin.dashboard.statPendingDeposits": { lo: "ການຝາກເງິນທີ່ລໍ", en: "Pending deposits" },
  "admin.dashboard.statPendingDepositsHint": { lo: "{amount} ₭ ກຳລັງລໍ", en: "{amount} ₭ awaiting" },
  "admin.dashboard.statPendingWithdraws": { lo: "ການຖອນເງິນທີ່ລໍ", en: "Pending withdraws" },
  "admin.dashboard.statPendingWithdrawsHint": { lo: "ກຳລັງລໍກວດສອບ", en: "awaiting review" },
  "admin.dashboard.statBets24h": { lo: "ການເດີມພັນ (24ຊມ)", en: "Bets (24h)" },
  "admin.dashboard.statBets24hHint": { lo: "ທຸກໂໝດ", en: "all modes" },
  "admin.dashboard.statLiveRounds": { lo: "ຮອບສົດ", en: "Live rounds" },
  "admin.dashboard.statLiveRoundsHint": { lo: "ເປີດຢູ່ ຫຼື ລໍຜົນ", en: "open or awaiting result" },

  "admin.dashboard.sleepMode": { lo: "ໂໝດພັກ", en: "Sleep Mode" },
  "admin.dashboard.sleepModeOn": { lo: "ເປີດ — ຜູ້ໃຊ້ທັງໝົດແພ້", en: "ON — All users losing" },
  "admin.dashboard.sleepModeOff": { lo: "ປິດ — ຫຼິ້ນປົກກະຕິ", en: "OFF — Normal play" },
  "admin.dashboard.sleepModeDescOn": {
    lo: "ການຫຼິ້ນເອງດ້ວຍກະເປົາ REAL/PROMO ທັງໝົດຖືກບັງຄັບໃຫ້ໄດ້ 0. DEMO ແລະ LIVE ບໍ່ຖືກກະທົບ.",
    en: "All REAL/PROMO self-play rolls are forced to 0 payout. DEMO and LIVE mode unaffected.",
  },
  "admin.dashboard.sleepModeDescOff": {
    lo: "ເມື່ອເປີດໃຊ້, ການຫຼິ້ນເອງດ້ວຍກະເປົາ REAL/PROMO ທຸກຄັ້ງຈະໄດ້ 0 — ເຟສຂອງແຕ່ລະຄົນຍັງຄົງເກັບໄວ້.",
    en: "When enabled, every REAL/PROMO self-play roll returns 0 payout — individual phases are preserved.",
  },
  "admin.dashboard.disableSleepMode": { lo: "☀️ ປິດໂໝດພັກ", en: "☀️ Disable Sleep Mode" },
  "admin.dashboard.enableSleepMode": { lo: "🌙 ເປີດໂໝດພັກ", en: "🌙 Enable Sleep Mode" },

  "admin.dashboard.sidebarHint": {
    lo: "ໃຊ້ແຖບດ້ານຂ້າງເພື່ອຈັດການລູກຄ້າ, ກວດສອບສະລິບຝາກ-ຖອນເງິນ, ກວດປະຫວັດການຫຼິ້ນ, ຄວບຄຸມຮອບ LIVE, ແລະ ຈັດການການແຂ່ງຂັນ Demo.",
    en: "Use the sidebar to manage customers, review deposit slips and withdrawals, inspect play history, host LIVE rounds, and manage the Demo Competition.",
  },

  "admin.dashboard.confirmDisableTitle": { lo: "ປິດໂໝດພັກບໍ?", en: "Disable Sleep Mode?" },
  "admin.dashboard.confirmEnableTitle": { lo: "ເປີດໂໝດພັກບໍ?", en: "Enable Sleep Mode?" },

  "admin.dashboard.confirmDisableBody": {
    lo: "ການຫຼິ້ນປົກກະຕິຈະກັບມາ. ແຕ່ລະຄົນຈະກັບໄປເຟສ",
    en: "Normal play will resume. Each user will return to their",
  },
  "admin.dashboard.confirmDisableBodyStrong": {
    lo: "ສ່ວນຕົວຂອງເຂົາ",
    en: "individual phase",
  },
  "admin.dashboard.confirmDisableBodyEnd": {
    lo: "(Normal / Phase A / B / C) — ບໍ່ມີການຣີເຊັດ.",
    en: "(Normal / Phase A / B / C) — no resets.",
  },

  "admin.dashboard.confirmEnableBodyStrongRed": {
    lo: "ການຫຼິ້ນເອງດ້ວຍກະເປົາ REAL/PROMO ທັງໝົດ",
    en: "ALL REAL/PROMO self-play rolls",
  },
  "admin.dashboard.confirmEnableBodyMid": {
    lo: "ຈະຖືກບັງຄັບໃຫ້ໄດ້",
    en: "will be forced to",
  },
  "admin.dashboard.confirmEnableBodyStrongZero": {
    lo: "0",
    en: "0 payout",
  },
  "admin.dashboard.confirmEnableBodyEnd": {
    lo: "ທັນທີ. ກະເປົາ DEMO ແລະ LIVE ບໍ່ຖືກກະທົບ. ເຟສຂອງແຕ່ລະຄົນຍັງຄົງເກັບໄວ້.",
    en: "immediately. DEMO wallets and LIVE mode are unaffected. Individual user phases are preserved.",
  },

  "admin.dashboard.takesEffectNote": {
    lo: "ມີຜົນທັນທີໃນຮອບຕໍ່ໄປ — ບໍ່ຕ້ອງໂຫຼດໜ້າໃໝ່.",
    en: "Takes effect on the very next roll — no page refresh needed.",
  },

  "admin.dashboard.cancel": { lo: "ຍົກເລີກ", en: "Cancel" },
  "admin.dashboard.savingEllipsis": { lo: "ກຳລັງບັນທຶກ…", en: "Saving…" },
  "admin.dashboard.yesDisable": { lo: "ແມ່ນ, ປິດ", en: "Yes, Disable" },
  "admin.dashboard.yesEnable": { lo: "ແມ່ນ, ເປີດ", en: "Yes, Enable" },
} as const
