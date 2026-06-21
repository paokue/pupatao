// Admin customer-wallet detail/summary viewer strings. Namespace: "admin.wallet.*"
// Merged into app/lib/i18n.ts's STRINGS dict by the integrator.

export const ADMIN_WALLET_STRINGS = {
  "admin.wallet.title": { lo: "ກະເປົາເງິນລູກຄ້າ", en: "Customer Wallets" },
  "admin.wallet.customerCount": { lo: "{n} ລູກຄ້າ", en: "{n} customers" },

  "admin.wallet.pageSizeOption": { lo: "{n} / ໜ້າ", en: "{n} / page" },
  "admin.wallet.searchPlaceholder": { lo: "ຄົ້ນຫາດ້ວຍເບີໂທ ຫຼື ຊື່…", en: "Search by phone or first name…" },
  "admin.wallet.search": { lo: "ຄົ້ນຫາ", en: "SEARCH" },

  "admin.wallet.col.phone": { lo: "ເບີໂທ", en: "PHONE" },
  "admin.wallet.col.name": { lo: "ຊື່", en: "NAME" },
  "admin.wallet.col.totalDeposit": { lo: "ຝາກທັງໝົດ", en: "TOTAL DEPOSIT" },
  "admin.wallet.col.totalWithdraw": { lo: "ຖອນທັງໝົດ", en: "TOTAL WITHDRAW" },
  "admin.wallet.col.available": { lo: "ຍອດທີ່ມີ", en: "AVAILABLE" },
  "admin.wallet.col.status": { lo: "ສະຖານະ", en: "STATUS" },

  "admin.wallet.noCustomersMatch": { lo: "ບໍ່ພົບລູກຄ້າທີ່ກົງກັນ.", en: "No customers match." },

  "admin.wallet.pagination.prev": { lo: "← ກ່ອນໜ້າ", en: "← Prev" },
  "admin.wallet.pagination.next": { lo: "ຕໍ່ໄປ →", en: "Next →" },
  "admin.wallet.pagination.summary": {
    lo: "ສະແດງ {from}–{to} ຈາກ {total} ລູກຄ້າ · ໜ້າ {page}/{totalPages}",
    en: "Showing {from}–{to} of {total} customers · Page {page}/{totalPages}",
  },

  "admin.wallet.account.real": { lo: "ກະເປົາຈິງ", en: "Real Account" },
  "admin.wallet.account.demo": { lo: "ກະເປົາເດໂມ", en: "Demo Account" },
  "admin.wallet.account.promo": { lo: "ກະເປົາໂປຣໂມ", en: "Promo Account" },

  "admin.wallet.modal.detailTab": { lo: "ລາຍລະອຽດ", en: "DETAIL" },
  "admin.wallet.modal.summaryTab": { lo: "ສະຫຼຸບ", en: "SUMMARY" },
  "admin.wallet.modal.close": { lo: "ປິດ", en: "Close" },

  "admin.wallet.detail.balance": { lo: "ຍອດ {type}", en: "{type} BALANCE" },
  "admin.wallet.detail.recentTransactions": { lo: "ລາຍການລ່າສຸດ", en: "RECENT TRANSACTIONS" },
  "admin.wallet.detail.balanceAfter": { lo: "ຍອດຫຼັງທຳລາຍການ", en: "BALANCE AFTER" },
  "admin.wallet.detail.col.when": { lo: "ເວລາ", en: "WHEN" },
  "admin.wallet.detail.col.type": { lo: "ປະເພດ", en: "TYPE" },
  "admin.wallet.detail.col.amount": { lo: "ຈຳນວນ", en: "AMOUNT" },
  "admin.wallet.detail.col.status": { lo: "ສະຖານະ", en: "STATUS" },
  "admin.wallet.detail.noTransactions": { lo: "ຍັງບໍ່ມີລາຍການ.", en: "No transactions yet." },
  "admin.wallet.detail.viewMore": { lo: "ເບິ່ງເພີ່ມເຕີມ →", en: "View more →" },

  "admin.wallet.summary.depositsEarnings": { lo: "ຝາກເງິນ & ກຳໄລ", en: "Deposits & Earnings" },
  "admin.wallet.summary.withdrawalsLosses": { lo: "ການຖອນ & ການເສຍ", en: "Withdrawals & Losses" },
  "admin.wallet.summary.calculatedAvailable": { lo: "ຍອດທີ່ຄຳນວນໄດ້ (ເຂົ້າ − ອອກ)", en: "CALCULATED AVAILABLE (IN − OUT)" },
  "admin.wallet.summary.currentBalance": { lo: "ຍອດ {type} ປັດຈຸບັນ", en: "Current {type} balance" },
  "admin.wallet.summary.entryCount": { lo: "{n} ລາຍການ", en: "{n} {unit}" },
  "admin.wallet.summary.entryUnit.one": { lo: "ລາຍການ", en: "entry" },
  "admin.wallet.summary.entryUnit.many": { lo: "ລາຍການ", en: "entries" },

  "admin.wallet.card.deposit": { lo: "ຝາກ", en: "DEPOSIT" },
  "admin.wallet.card.withdraw": { lo: "ຖອນ", en: "WITHDRAW" },

  "admin.wallet.actionMenu.open": { lo: "ເປີດເມນູ", en: "Open actions" },

  "admin.wallet.type.deposit": { lo: "ຝາກເງິນ", en: "Deposit" },
  "admin.wallet.type.win": { lo: "ກຳໄລ (ຊະນະ)", en: "Earnings (Win)" },
  "admin.wallet.type.transferIn": { lo: "ໂອນເຂົ້າ", en: "Transfer received" },
  "admin.wallet.type.promoBonus": { lo: "ໂບນັດໂປຣໂມ", en: "Promo bonus" },
  "admin.wallet.type.referralBonus": { lo: "ໂບນັດແນະນຳ", en: "Referral bonus" },
  "admin.wallet.type.withdraw": { lo: "ຖອນເງິນ", en: "Withdraw" },
  "admin.wallet.type.loss": { lo: "ເສຍ (ເດີມພັນແພ້)", en: "Loss (lost bets)" },
  "admin.wallet.type.transferOut": { lo: "ໂອນອອກ", en: "Transfer sent" },
  "admin.wallet.type.demoReset": { lo: "ຣີເຊັດເດໂມ", en: "Demo reset" },
  "admin.wallet.type.adjustment": { lo: "ປັບປຸງຍອດ", en: "Adjustment" },
} as const
