// Admin transactions page strings. Namespace: "admin.transactions.*"
// Merged into app/lib/i18n.ts's STRINGS dict by the integrator.

export const ADMIN_TRANSACTIONS_STRINGS = {
  "admin.transactions.title": { lo: "ລາຍການທຸລະກຳ", en: "Transactions" },
  "admin.transactions.totalCount": { lo: "ທັງໝົດ {n}", en: "{n} total" },

  // Tabs
  "admin.transactions.tab.deposit": { lo: "ຝາກ", en: "Deposit" },
  "admin.transactions.tab.withdraw": { lo: "ຖອນ", en: "Withdraw" },
  "admin.transactions.tab.transfer": { lo: "ໂອນ", en: "Transfer" },
  "admin.transactions.tab.reward": { lo: "🎁 ລາງວັນ", en: "🎁 Reward" },

  // Search bar
  "admin.transactions.pageSizeOption": { lo: "{n} / ໜ້າ", en: "{n} / page" },
  "admin.transactions.searchPlaceholder": { lo: "ກັ່ນຕອງດ້ວຍເບີໂທ…", en: "Filter by phone number…" },
  "admin.transactions.search": { lo: "ຄົ້ນຫາ", en: "Search" },
  "admin.transactions.clear": { lo: "ລ້າງ", en: "Clear" },

  // Empty state
  "admin.transactions.noneMatch": { lo: "ບໍ່ມີລາຍການ{tab} ກົງກັນ.", en: "No {tab} transactions match." },

  // Pagination
  "admin.transactions.prev": { lo: "← ກ່ອນໜ້າ", en: "← Prev" },
  "admin.transactions.next": { lo: "ຕໍ່ໄປ →", en: "Next →" },
  "admin.transactions.showingRange": {
    lo: "ສະແດງ {from}–{to} ຈາກ {total} ລາຍການ · ໜ້າ {page}/{totalPages}",
    en: "Showing {from}–{to} of {total} transactions · Page {page}/{totalPages}",
  },

  // New-request toast (Pusher event)
  "admin.transactions.toast.newRequest": { lo: "ມີຄຳຂໍ {type} ໃໝ່", en: "New {type} request" },

  // Confirm dialog (approve/reject)
  "admin.transactions.confirm.approveTitle": { lo: "ອະນຸມັດການ{tab} {amount} ₭?", en: "Approve {amount} ₭ {tab}?" },
  "admin.transactions.confirm.rejectTitle": { lo: "ປະຕິເສດຄຳຂໍ{tab}ນີ້?", en: "Reject this {tab} request?" },
  "admin.transactions.confirm.approveDepositDesc": {
    lo: "{tel} ຈະໄດ້ຮັບເງິນ {amount} ₭ ເຂົ້າກະເປົາ REAL.",
    en: "{tel} will be credited {amount} ₭ on their REAL wallet.",
  },
  "admin.transactions.confirm.approveWithdrawDesc": {
    lo: "{tel} ຈະຖືກຫັກເງິນ {amount} ₭ ອອກຈາກກະເປົາ REAL.",
    en: "{tel} will be debited {amount} ₭ from their REAL wallet.",
  },
  "admin.transactions.confirm.rejectDesc": {
    lo: "{tel} ຈະໄດ້ຮັບການແຈ້ງເຕືອນວ່າຄຳຂໍຖືກປະຕິເສດ. ບໍ່ມີການປ່ຽນແປງຍອດເງິນ.",
    en: "{tel} will be notified the request was rejected. No balance change.",
  },
  "admin.transactions.confirm.approve": { lo: "ອະນຸມັດ", en: "Approve" },
  "admin.transactions.confirm.reject": { lo: "ປະຕິເສດ", en: "Reject" },
  "admin.transactions.confirm.rejectReasonLabel": { lo: "ສາເຫດການປະຕິເສດ", en: "Reject reason" },
  "admin.transactions.confirm.rejectReasonPlaceholder": { lo: "ເລືອກສາເຫດ…", en: "Select a reason…" },
  "admin.transactions.confirm.depositAmountLabel": { lo: "ຈຳນວນເງິນຝາກ (₭)", en: "Deposit amount (₭)" },
  "admin.transactions.confirm.depositAmountHint": { lo: "ແກ້ໄຂຖ້າລູກຄ້າປ້ອນຈຳນວນຜິດ.", en: "Edit if the customer entered the wrong amount." },

  // TxCard
  "admin.transactions.card.previewSlipAria": { lo: "ເບິ່ງສະລິບ", en: "Preview slip" },
  "admin.transactions.card.slipAlt": { lo: "ສະລິບ", en: "Slip" },
  "admin.transactions.card.fee": { lo: "ຄ່າທຳນຽມ", en: "Fee" },
  "admin.transactions.card.netTransfer": { lo: "ໂອນໃຫ້ລູກຄ້າ", en: "Transfer to customer" },
  "admin.transactions.card.approvedBy": { lo: "ອະນຸມັດໂດຍ", en: "Approved by" },
  "admin.transactions.card.rejectedBy": { lo: "ປະຕິເສດໂດຍ", en: "Rejected by" },
  "admin.transactions.card.reject": { lo: "ປະຕິເສດ", en: "Reject" },
  "admin.transactions.card.approve": { lo: "ອະນຸມັດ", en: "Approve" },
  "admin.transactions.card.slip": { lo: "ສະລິບ", en: "Slip" },

  // TransferCard
  "admin.transactions.transfer.unknownRecipient": { lo: "ບໍ່ຮູ້ຈັກຜູ້ຮັບ", en: "Unknown recipient" },
  "admin.transactions.transfer.encrypted": { lo: "ຕ້ອງມີລະຫັດ", en: "ENCRYPTED" },
  "admin.transactions.transfer.normal": { lo: "ທົ່ວໄປ", en: "NORMAL" },
  "admin.transactions.transfer.balanceAfter": { lo: "ຍອດເງິນຫຼັງຈາກນີ້: {amount} ₭", en: "Balance after: {amount} ₭" },

  // RewardCard
  "admin.transactions.reward.badge": { lo: "ລາງວັນ", en: "REWARD" },
  "admin.transactions.reward.balanceAfter": { lo: "ຍອດເງິນຫຼັງຈາກນີ້: {amount} ₭", en: "Balance after: {amount} ₭" },

  // SlipPreview
  "admin.transactions.slip.previewAria": { lo: "ເບິ່ງສະລິບ", en: "Slip preview" },
  "admin.transactions.slip.closeAria": { lo: "ປິດ", en: "Close preview" },
  "admin.transactions.slip.pdfTitle": { lo: "ສະລິບ PDF", en: "Slip PDF" },
  "admin.transactions.slip.imageAlt": { lo: "ສະລິບການໂອນ", en: "Payment slip" },

  // Action (server) error/success messages
  "admin.transactions.error.insufficientPermissions": { lo: "ສິດອະນຸຍາດບໍ່ພຽງພໍ", en: "Insufficient permissions" },
  "admin.transactions.error.txIdRequired": { lo: "ຕ້ອງມີ txId", en: "txId required" },
  "admin.transactions.error.unknownOp": { lo: "ບໍ່ຮູ້ຈັກ op", en: "Unknown op" },
  "admin.transactions.error.txNotFound": { lo: "ບໍ່ພົບລາຍການທຸລະກຳ.", en: "Transaction not found." },
  "admin.transactions.error.onlyPendingReviewable": { lo: "ກວດສອບໄດ້ສະເພາະລາຍການທີ່ກຳລັງລໍຖ້າເທົ່ານັ້ນ.", en: "Only pending transactions can be reviewed." },
  "admin.transactions.error.onlyDepositWithdrawRejectable": { lo: "ປະຕິເສດໄດ້ສະເພາະຄຳຂໍຝາກ/ຖອນເທົ່ານັ້ນ.", en: "Only deposit/withdraw requests can be rejected here." },
  "admin.transactions.error.selectRejectReason": { lo: "ກາລຸນາເລືອກສາເຫດການປະຕິເສດ.", en: "Please select a reject reason." },
  "admin.transactions.error.walletNotFound": { lo: "ບໍ່ພົບກະເປົາເງິນ.", en: "Wallet not found." },
  "admin.transactions.error.insufficientBalance": {
    lo: "ຍອດເງິນບໍ່ພຽງພູ: ຜູ້ໃຊ້ມີ {balance} ₭ ແຕ່ຖອນ {amount} ₭.",
    en: "Insufficient balance: user has {balance} ₭ but withdraw is {amount} ₭.",
  },
  "admin.transactions.error.actionFailed": { lo: "ການດຳເນີນການລົ້ມເຫລວ.", en: "Action failed." },
  "admin.transactions.error.invalidAmount": { lo: "ຈຳນວນເງິນບໍ່ຖືກຕ້ອງ.", en: "Invalid amount." },
} as const
