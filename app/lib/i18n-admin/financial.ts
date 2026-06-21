// Admin financial overview page strings. Namespace: "admin.financial.*"
// Merged into app/lib/i18n.ts's STRINGS dict by the integrator.

export const ADMIN_FINANCIAL_STRINGS = {
  "admin.financial.title": { lo: "ພາບລວມການເງິນ", en: "Financial Overview" },

  // Period filter tabs
  "admin.financial.period.today": { lo: "ມື້ນີ້", en: "Today" },
  "admin.financial.period.week": { lo: "ອາທິດນີ້", en: "This Week" },
  "admin.financial.period.month": { lo: "ເດືອນນີ້", en: "This Month" },
  "admin.financial.period.all": { lo: "ທັງໝົດ", en: "All Time" },
  "admin.financial.period.custom": { lo: "ກຳນົດເອງ", en: "Custom" },
  "admin.financial.apply": { lo: "ນຳໃຊ້", en: "Apply" },

  // Bank reconciliation
  "admin.financial.recon.title": { lo: "ການກະທົບຍອດທະນາຄານ — ທັງໝົດ", en: "BANK RECONCILIATION — ALL TIME" },
  "admin.financial.recon.bankPosition": { lo: "ຍອດທະນາຄານ", en: "Bank Position" },
  "admin.financial.recon.bankPositionSub": { lo: "ຝາກ − ຖອນ", en: "Deposits − Withdrawals" },
  "admin.financial.recon.customerLiability": { lo: "ໜີ້ສິນລູກຄ້າ", en: "Customer Liability" },
  "admin.financial.recon.customerLiabilitySub": { lo: "ລວມຍອດກະເປົາ REAL ທັງໝົດ", en: "Sum of all REAL balances" },
  "admin.financial.recon.estimatedProfit": { lo: "ກຳໄລຮ້ານ (ປະມານ)", en: "ESTIMATED HOUSE PROFIT" },
  "admin.financial.recon.estimatedDeficit": { lo: "ຂາດທຶນຮ້ານ (ປະມານ)", en: "ESTIMATED HOUSE DEFICIT" },
  "admin.financial.recon.profitFormula": { lo: "ຍອດທະນາຄານ − ໜີ້ສິນລູກຄ້າ", en: "Bank Position − Customer Liability" },

  // Pending chips
  "admin.financial.pending.deposits": { lo: "ການຝາກລໍຖ້າ {count} ລາຍການ", en: "{count} pending deposit{s}" },
  "admin.financial.pending.depositsNote": { lo: "ຍັງບໍ່ໄດ້ອະນຸມັດ — ບໍ່ທັນຢູ່ໃນທະນາຄານ", en: "Not yet approved — not in bank" },
  "admin.financial.pending.withdrawals": { lo: "ການຖອນລໍຖ້າ {count} ລາຍການ", en: "{count} pending withdrawal{s}" },
  "admin.financial.pending.withdrawalsNote": { lo: "ຍັງບໍ່ໄດ້ຈ່າຍ — ຍັງຢູ່ໃນທະນາຄານ", en: "Not yet paid — still in bank" },

  // Period metric cards
  "admin.financial.metric.depositsIn": { lo: "ຝາກເຂົ້າ", en: "Deposits IN" },
  "admin.financial.metric.withdrawalsOut": { lo: "ຖອນອອກ", en: "Withdrawals OUT" },
  "admin.financial.metric.netCashFlow": { lo: "ກະແສເງິນສົດສຸດທິ", en: "Net Cash Flow" },
  "admin.financial.metric.newCustomers": { lo: "ລູກຄ້າໃໝ່", en: "New Customers" },
  "admin.financial.metric.promoBonusGiven": { lo: "ໂປຣໂມຊັນທີ່ມອບໃຫ້", en: "Promo Bonus Given" },
  "admin.financial.metric.referralBonusGiven": { lo: "ໂບນັດແນະນຳທີ່ມອບໃຫ້", en: "Referral Bonus Given" },
  "admin.financial.metric.transactionCount": { lo: "{count} ລາຍການ", en: "{count} transaction{s}" },

  // Daily breakdown table
  "admin.financial.daily.title": { lo: "ສະຫຼຸບລາຍວັນ", en: "DAILY BREAKDOWN" },
  "admin.financial.daily.date": { lo: "ວັນທີ", en: "DATE" },
  "admin.financial.daily.depositsIn": { lo: "ຝາກເຂົ້າ", en: "DEPOSITS IN" },
  "admin.financial.daily.withdrawalsOut": { lo: "ຖອນອອກ", en: "WITHDRAWALS OUT" },
  "admin.financial.daily.net": { lo: "ສຸທິ", en: "NET" },
  "admin.financial.daily.empty": { lo: "ບໍ່ມີລາຍການທີ່ສຳເລັດໃນຊ່ວງເວລານີ້.", en: "No completed transactions in this period." },
  "admin.financial.daily.total": { lo: "ລວມທັງໝົດ", en: "TOTAL" },

  // Glossary
  "admin.financial.glossary.netCashFlow.term": { lo: "ກະແສເງິນສົດສຸດທິ", en: "Net Cash Flow" },
  "admin.financial.glossary.netCashFlow.formula": { lo: "ຝາກເຂົ້າ − ຖອນອອກ (ຊ່ວງເວລາທີ່ເລືອກ)", en: "Deposits IN − Withdrawals OUT (selected period)" },
  "admin.financial.glossary.netCashFlow.explain": {
    lo: "ຈຳນວນເງິນສົດທີ່ໝູນວຽນຜ່ານລະບົບໃນຊ່ວງເວລາທີ່ເລືອກ. ບວກ = ເງິນເຂົ້າຫຼາຍກວ່າເງິນອອກ. ຄ່ານີ້ຈະຣີເຊັດໃໝ່ທຸກຊ່ວງເວລາ — ບໍ່ແມ່ນຍອດສະສົມ.",
    en: "How much cash moved through the system in the chosen time window. Positive = more money came in than went out. This resets each period — it is not a running total.",
  },
  "admin.financial.glossary.netCashFlow.example": {
    lo: "ເດືອນນີ້: {periodIn} ເຂົ້າ − {periodOut} ອອກ = {periodNet}",
    en: "This month: {periodIn} IN − {periodOut} OUT = {periodNet}",
  },

  "admin.financial.glossary.customerLiability.term": { lo: "ໜີ້ສິນລູກຄ້າ", en: "Customer Liability" },
  "admin.financial.glossary.customerLiability.formula": { lo: "ລວມຍອດກະເປົາ REAL ທັງໝົດໃນປະຈຸບັນ", en: "Sum of all REAL wallet balances right now" },
  "admin.financial.glossary.customerLiability.explain": {
    lo: "ຍອດເງິນລວມທີ່ລູກຄ້າທຸກຄົນຖືຢູ່ໃນກະເປົາ REAL ຂອງຕົນໃນປະຈຸບັນ. ຖ້າລູກຄ້າທຸກຄົນຖອນເງິນພ້ອມກັນມື້ນີ້, ນີ້ແມ່ນຈຳນວນທີ່ຕ້ອງຈ່າຍອອກຈາກທະນາຄານ.",
    en: "The total amount all customers currently hold in their REAL accounts. If every customer withdrew today, this is what you would need to pay out from the bank.",
  },
  "admin.financial.glossary.customerLiability.example": {
    lo: "ປະຈຸບັນ: {amount} ຢູ່ໃນກະເປົາ REAL ຂອງລູກຄ້າທັງໝົດ",
    en: "Right now: {amount} sitting across all customer REAL wallets",
  },

  "admin.financial.glossary.bankPosition.term": { lo: "ຍອດທະນາຄານ", en: "Bank Position" },
  "admin.financial.glossary.bankPosition.formula": {
    lo: "ການຝາກທີ່ສຳເລັດທັງໝົດ − ການຖອນທີ່ສຳເລັດທັງໝົດ (ທຸກເວລາ)",
    en: "All-time COMPLETED Deposits − All-time COMPLETED Withdrawals",
  },
  "admin.financial.glossary.bankPosition.explain": {
    lo: "ຍອດທີ່ລະບົບຄິດໄລ່ວ່າຄວນຈະມີຢູ່ໃນບັນຊີທະນາຄານຂອງທ່ານ. ທຸກຄັ້ງທີ່ອະນຸມັດການຝາກ ຍອດນີ້ຈະເພີ່ມຂຶ້ນ; ທຸກຄັ້ງທີ່ສຳເລັດການຖອນ ຍອດນີ້ຈະຫຼຸດລົງ. ໃຫ້ທຽບກັບຍອດໃນແອັບທະນາຄານຈິງວ່າຕົງກັນຫຼືບໍ່.",
    en: "What the system calculates should be in your bank account. Every time you approve a deposit it goes up; every time you complete a withdrawal it goes down. Compare this against your actual bank app balance to check if they match.",
  },
  "admin.financial.glossary.bankPosition.example": {
    lo: "ລະບົບຄາດວ່າທະນາຄານຄວນມີ {amount}",
    en: "System expects your bank to hold {amount}",
  },

  "admin.financial.glossary.houseProfit.term": { lo: "ກຳໄລຮ້ານ (ປະມານ)", en: "Estimated House Profit" },
  "admin.financial.glossary.houseDeficit.term": { lo: "ຂາດທຶນຮ້ານ (ປະມານ)", en: "Estimated House Deficit" },
  "admin.financial.glossary.houseProfit.formula": { lo: "ຍອດທະນາຄານ − ໜີ້ສິນລູກຄ້າ", en: "Bank Position − Customer Liability" },
  "admin.financial.glossary.houseProfit.explainPositive": {
    lo: "ທະນາຄານຂອງທ່ານມີເງິນຫຼາຍກວ່າທີ່ຄ້າງລູກຄ້າ. ສ່ວນຕ່າງນີ້ແມ່ນລາຍຮັບຂອງຮ້ານຈາກການຫຼິ້ນ (ການແພ້ຂອງລູກຄ້າຫັກລົບການຊະນະ).",
    en: "Your bank holds more than you owe customers. The difference is the house's earnings from game play (customers' losses minus their wins).",
  },
  "admin.financial.glossary.houseProfit.explainNegative": {
    lo: "ທະນາຄານຂອງທ່ານມີເງິນໜ້ອຍກວ່າທີ່ຄ້າງລູກຄ້າ. ຮ້ານກຳລັງຂາດທຶນ — ລູກຄ້າຊະນະຫຼາຍກວ່າແພ້ໂດຍລວມ.",
    en: "Your bank holds less than you owe customers. The house is in deficit — customers have won more than they have lost overall.",
  },
  "admin.financial.glossary.houseProfit.example": {
    lo: "{bankPosition} (ທະນາຄານ) − {customerLiability} (ຄ້າງ) = {houseProfit}",
    en: "{bankPosition} (bank) − {customerLiability} (owed) = {houseProfit}",
  },
  "admin.financial.glossary.example.prefix": { lo: "ຕົວຢ່າງ", en: "e.g." },

  // Verification guide
  "admin.financial.verify.title": { lo: "ວິທີກວດສອບຍອດທະນາຄານຂອງທ່ານ", en: "How to verify your bank balance" },
  "admin.financial.verify.step1": { lo: "ເປີດແອັບທະນາຄານຂອງທ່ານ ແລະ ບັນທຶກຍອດເງິນປະຈຸບັນ.", en: "Open your bank app and note the current balance." },
  "admin.financial.verify.step2": {
    lo: "ທຽບກັບ ຍອດທະນາຄານ ({amount}) — ຄວນຈະຕົງກັນ.",
    en: "Compare it to Bank Position ({amount}) — they should match.",
  },
  "admin.financial.verify.step3": { lo: "ຖ້າຕົງກັນ ✅ ລະບົບສອດຄ່ອງກັບຄວາມເປັນຈິງຢ່າງສົມບູນ.", en: "If they match ✅ the system is fully in sync with reality." },
  "admin.financial.verify.step4": { lo: "ຖ້າບໍ່ຕົງກັນ ❌ ໃຫ້ກວດສອບການຝາກທີ່ຍັງບໍ່ໄດ້ອະນຸມັດ ຫຼື ການຖອນທີ່ຍັງບໍ່ໄດ້ຈ່າຍຂ້າງລຸ່ມນີ້.", en: "If they differ ❌ check for unapproved deposits or unpaid withdrawals below." },
  "admin.financial.verify.step5": {
    lo: "ການຖອນລໍຖ້າ ({amount}) — ເງິນຍັງຢູ່ໃນທະນາຄານ, ຍັງບໍ່ໄດ້ໂອນອອກ.",
    en: "Pending withdrawals ({amount}) — money still in your bank, not sent yet.",
  },
  "admin.financial.verify.step6": {
    lo: "ການຝາກລໍຖ້າ ({amount}) — ຍັງບໍ່ໄດ້ອະນຸມັດ, ຍັງບໍ່ໄດ້ນັບເຂົ້າຍອດທະນາຄານ.",
    en: "Pending deposits ({amount}) — not yet approved, not counted in Bank Position yet.",
  },
} as const
