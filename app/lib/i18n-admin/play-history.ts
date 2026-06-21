// i18n strings for /admin/play-history — admin view of all customer game
// rounds/bets history, sleep mode banner, lock/unlock players, wallet modal.
// Namespace: "admin.playHistory.*" — owned exclusively by this file.

export const ADMIN_PLAY_HISTORY_STRINGS = {
  // ─── Bet type filter labels ──────────────────────────────────────────
  "admin.playHistory.betType.all": { lo: "ທັງໝົດ", en: "All" },
  "admin.playHistory.betType.single": { lo: "ດຽວ", en: "Single" },
  "admin.playHistory.betType.pair": { lo: "ຄູ່", en: "Pair" },
  "admin.playHistory.betType.low": { lo: "ຕ່ຳ", en: "Low" },
  "admin.playHistory.betType.middle": { lo: "ກາງ", en: "Medium" },
  "admin.playHistory.betType.high": { lo: "ສູງ", en: "High" },

  // ─── Transaction type labels (TYPE_LABEL map) ────────────────────────
  "admin.playHistory.txType.deposit": { lo: "ຝາກເງິນ", en: "Deposit" },
  "admin.playHistory.txType.win": { lo: "ກຳໄລ (ຊະນະ)", en: "Earnings (Win)" },
  "admin.playHistory.txType.transferIn": { lo: "ໂອນເຂົ້າ", en: "Transfer received" },
  "admin.playHistory.txType.promoBonus": { lo: "ໂປຣໂມຊັນ", en: "Promo bonus" },
  "admin.playHistory.txType.referralBonus": { lo: "ໂບນັດແນະນຳ", en: "Referral bonus" },
  "admin.playHistory.txType.withdraw": { lo: "ຖອນເງິນ", en: "Withdraw" },
  "admin.playHistory.txType.loss": { lo: "ເສຍ (ແທ້ງ)", en: "Loss (lost bets)" },
  "admin.playHistory.txType.transferOut": { lo: "ໂອນອອກ", en: "Transfer sent" },
  "admin.playHistory.txType.demoReset": { lo: "ຣີເຊັດ Demo", en: "Demo reset" },
  "admin.playHistory.txType.adjustment": { lo: "ປັບປຸງຍອດ", en: "Adjustment" },

  // ─── action() error strings ──────────────────────────────────────────
  "admin.playHistory.error.insufficientPermissions": { lo: "ບໍ່ມີສິດອະນຸຍາດ", en: "Insufficient permissions" },
  "admin.playHistory.error.userIdRequired": { lo: "ຕ້ອງລະບຸ userId", en: "userId required" },
  "admin.playHistory.error.unknownOp": { lo: "ບໍ່ຮູ້ຈັກການດຳເນີນການ", en: "Unknown op" },

  // ─── Page header ──────────────────────────────────────────────────────
  "admin.playHistory.title": { lo: "ປະຫວັດການຫຼິ້ນ", en: "Play history" },
  "admin.playHistory.betsCount": { lo: "{n} ການແທງ", en: "{n} bets" },

  // ─── Sleep mode banner ────────────────────────────────────────────────
  "admin.playHistory.sleepMode.title": { lo: "ໂໝດພັກ (SLEEP MODE) ກຳລັງເປີດໃຊ້", en: "SLEEP MODE IS ON" },
  "admin.playHistory.sleepMode.desc": {
    lo: "ການຫຼິ້ນເອງ REAL/PROMO ທັງໝົດຈະຖືກບັງຄັບໃຫ້ໄດ້ຮັບເງິນຄືນ 0. ການແທງໃໝ່ທຸກລາຍການລຸ່ມນີ້ຈະສະແດງເປັນ LOSS ດ້ວຍຍອດເງິນຄືນ 0.",
    en: "All REAL/PROMO self-play rolls are forced to 0 payout. Every new bet below should show LOSS with payout 0.",
  },
  "admin.playHistory.sleepMode.manage": { lo: "ຈັດການ →", en: "Manage →" },

  // ─── Wallet tabs ──────────────────────────────────────────────────────
  "admin.playHistory.wallet.real": { lo: "ບັນຊີຈິງ", en: "REAL ACCOUNT" },
  "admin.playHistory.wallet.demo": { lo: "ບັນຊີ DEMO", en: "DEMO ACCOUNT" },

  // ─── Mode filter ──────────────────────────────────────────────────────
  "admin.playHistory.mode.all": { lo: "ໂໝດທັງໝົດ", en: "All modes" },
  "admin.playHistory.mode.random": { lo: "ຫຼິ້ນຄົນດຽວ", en: "Random" },
  "admin.playHistory.mode.live": { lo: "ຖ່າຍທອດສົດ", en: "Live" },

  // ─── Result filter ────────────────────────────────────────────────────
  "admin.playHistory.result.all": { lo: "ຜົນທັງໝົດ", en: "All results" },

  // ─── Search form ──────────────────────────────────────────────────────
  "admin.playHistory.pageSizeOption": { lo: "{n} / ໜ້າ", en: "{n} / page" },
  "admin.playHistory.searchPlaceholder": { lo: "ກັ່ນຕອງດ້ວຍເບີໂທ…", en: "Filter by phone number…" },
  "admin.playHistory.search": { lo: "ຄົ້ນຫາ", en: "SEARCH" },
  "admin.playHistory.clear": { lo: "ລ້າງ", en: "CLEAR" },

  // ─── Empty state ──────────────────────────────────────────────────────
  "admin.playHistory.empty": { lo: "ຍັງບໍ່ມີລາຍການແທງ.", en: "No bets recorded yet." },

  // ─── Table headers ────────────────────────────────────────────────────
  "admin.playHistory.col.when": { lo: "ເວລາ", en: "WHEN" },
  "admin.playHistory.col.player": { lo: "ຜູ້ຫຼິ້ນ", en: "PLAYER" },
  "admin.playHistory.col.bet": { lo: "ການແທງ", en: "BET" },
  "admin.playHistory.col.round": { lo: "ຮອບ", en: "ROUND" },
  "admin.playHistory.col.stake": { lo: "ຍອດແທງ", en: "STAKE" },
  "admin.playHistory.col.payout": { lo: "ເງິນຄືນ", en: "PAYOUT" },
  "admin.playHistory.col.result": { lo: "ຜົນ", en: "RESULT" },
  "admin.playHistory.col.action": { lo: "ຈັດການ", en: "ACTION" },

  // ─── Row tooltips / actions ───────────────────────────────────────────
  "admin.playHistory.locked": { lo: "ຖືກລັອກ", en: "LOCKED" },
  "admin.playHistory.viewWallet": { lo: "ເບິ່ງກະເປົາເງິນ", en: "View wallet" },
  "admin.playHistory.unlockPlayer": { lo: "ປົດລັອກຜູ້ຫຼິ້ນ", en: "Unlock player" },
  "admin.playHistory.lockPlayer": { lo: "ລັອກຜູ້ຫຼິ້ນ", en: "Lock player" },

  // ─── Pagination ───────────────────────────────────────────────────────
  "admin.playHistory.prev": { lo: "← ກ່ອນໜ້າ", en: "← Prev" },
  "admin.playHistory.next": { lo: "ຕໍ່ໄປ →", en: "Next →" },
  "admin.playHistory.pageSummary": {
    lo: "ສະແດງ {from}–{to} ຈາກ {total} ລາຍການ · ໜ້າ {page}/{totalPages}",
    en: "Showing {from}–{to} of {total} bets · Page {page}/{totalPages}",
  },

  // ─── BetDescription ───────────────────────────────────────────────────
  "admin.playHistory.bet.single": { lo: "ດຽວ", en: "Single" },
  "admin.playHistory.bet.pair": { lo: "ຄູ່", en: "Pair" },
  "admin.playHistory.bet.low": { lo: "ຕ່ຳ", en: "Low" },
  "admin.playHistory.bet.high": { lo: "ສູງ", en: "High" },
  "admin.playHistory.bet.middle": { lo: "ກາງ", en: "Middle" },
  "admin.playHistory.bet.sumExact": { lo: "ເລກ {n}", en: "Number {n}" },

  // ─── BetCard (mobile) ─────────────────────────────────────────────────
  "admin.playHistory.card.stake": { lo: "ຍອດແທງ", en: "STAKE" },
  "admin.playHistory.card.payout": { lo: "ເງິນຄືນ", en: "PAYOUT" },
  "admin.playHistory.card.viewWallet": { lo: "ເບິ່ງກະເປົາເງິນ", en: "View wallet" },
  "admin.playHistory.card.unlock": { lo: "ປົດລັອກ", en: "Unlock" },
  "admin.playHistory.card.lock": { lo: "ລັອກ", en: "Lock" },

  // ─── LockConfirmModal ─────────────────────────────────────────────────
  "admin.playHistory.lockModal.unlockTitle": { lo: "ປົດລັອກຜູ້ຫຼິ້ນ?", en: "Unlock player?" },
  "admin.playHistory.lockModal.lockTitle": { lo: "ລັອກຜູ້ຫຼິ້ນ?", en: "Lock player?" },
  "admin.playHistory.lockModal.unlockDesc": {
    lo: "{tel} ຈະກັບຄືນສູ່ໂຟສ NORMAL ແລະຫຼິ້ນຕາມປົກກະຕິ.",
    en: "{tel} will return to NORMAL phase and play normally.",
  },
  "admin.playHistory.lockModal.lockDescPrefix": { lo: "{tel} ຈະຖືກບັງຄັບໃຫ້", en: "{tel} will be forced to" },
  "admin.playHistory.lockModal.lockDescBold": { lo: "ແທ້ງທຸກການແທງ", en: "lose every bet" },
  "admin.playHistory.lockModal.lockDescSuffix": { lo: "(ADMIN_LOCKED).", en: "(ADMIN_LOCKED)." },
  "admin.playHistory.lockModal.cancel": { lo: "ຍົກເລີກ", en: "Cancel" },
  "admin.playHistory.lockModal.processing": { lo: "ກຳລັງດຳເນີນການ…", en: "Processing…" },
  "admin.playHistory.lockModal.yesUnlock": { lo: "ແມ່ນ, ປົດລັອກ", en: "Yes, Unlock" },
  "admin.playHistory.lockModal.yesLock": { lo: "ແມ່ນ, ລັອກ", en: "Yes, Lock" },

  // ─── PlayerWalletModal ────────────────────────────────────────────────
  "admin.playHistory.walletModal.real": { lo: "ຈິງ", en: "Real" },
  "admin.playHistory.walletModal.demo": { lo: "Demo", en: "Demo" },
  "admin.playHistory.walletModal.promo": { lo: "ໂປຣໂມ", en: "Promo" },
  "admin.playHistory.walletModal.header": { lo: "ກະເປົາເງິນຜູ້ຫຼິ້ນ", en: "Player Wallet" },
  "admin.playHistory.walletModal.detailTab": { lo: "ລາຍລະອຽດ", en: "DETAIL" },
  "admin.playHistory.walletModal.summaryTab": { lo: "ສະຫຼຸບ", en: "SUMMARY" },

  // ─── DetailView ───────────────────────────────────────────────────────
  "admin.playHistory.detail.balance": { lo: "ຍອດເງິນ {type}", en: "{type} BALANCE" },
  "admin.playHistory.detail.recentTx": { lo: "ລາຍການລ້າສຸດ", en: "RECENT TRANSACTIONS" },
  "admin.playHistory.detail.balanceAfter": { lo: "ຍອດເງິນຫຼັງຈາກນັ້ນ", en: "BALANCE AFTER" },
  "admin.playHistory.detail.col.when": { lo: "ເວລາ", en: "WHEN" },
  "admin.playHistory.detail.col.type": { lo: "ປະເພດ", en: "TYPE" },
  "admin.playHistory.detail.col.amount": { lo: "ຈຳນວນ", en: "AMOUNT" },
  "admin.playHistory.detail.col.status": { lo: "ສະຖານະ", en: "STATUS" },
  "admin.playHistory.detail.noTx": { lo: "ຍັງບໍ່ມີລາຍການ.", en: "No transactions yet." },
  "admin.playHistory.detail.viewMore": { lo: "ເບິ່ງເພີ່ມ →", en: "View more →" },

  // ─── SummaryView ──────────────────────────────────────────────────────
  "admin.playHistory.summary.depositsEarnings": { lo: "ຝາກເງິນ & ກຳໄລ", en: "Deposits & Earnings" },
  "admin.playHistory.summary.withdrawalsLosses": { lo: "ຖອນເງິນ & ຂາດທຶນ", en: "Withdrawals & Losses" },
  "admin.playHistory.summary.calculatedAvailable": { lo: "ຍອດທີ່ຄຳນວນໄດ້ (ເຂົ້າ − ອອກ)", en: "CALCULATED AVAILABLE (IN − OUT)" },
  "admin.playHistory.summary.currentBalance": { lo: "ຍອດເງິນ {type} ປັດຈຸບັນ", en: "Current {type} balance" },

  // ─── LedgerColumn ─────────────────────────────────────────────────────
  "admin.playHistory.ledger.entries": { lo: "{n} ລາຍການ", en: "{n} entries" },
  "admin.playHistory.ledger.entry": { lo: "{n} ລາຍການ", en: "{n} entry" },

  // ─── ErrorBoundary ────────────────────────────────────────────────────
  "admin.playHistory.errorBoundary.message": { lo: "ມີຂໍ້ຜິດພາດໃນການໂຫຼດປະຫວັດການຫຼິ້ນ.", en: "Something went wrong loading play history." },
  "admin.playHistory.errorBoundary.tryAgain": { lo: "ລອງອີກຄັ້ງ", en: "Try again" },
} as const
