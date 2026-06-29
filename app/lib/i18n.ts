// Tiny i18n layer. Pupatao supports Lao (default) and English on the customer
// surface. Admin pages are intentionally not translated.
//
// Usage:
//   const t = useT()
//   <h1>{t('wallet.title')}</h1>
//   <p>{t('wallet.minimum', { amount: '5,000' })}</p>
//
// Locale is persisted in a cookie (`pupatao_locale`), read by the root loader,
// and exposed through outlet context. Switching it POSTs to /api/locale.
//
// Admin-page strings live in per-page modules under ./i18n-admin/ (one file per
// admin route, each owning its own `admin.<page>.*` key namespace) and are
// spread into STRINGS below so admin shares the exact same t()/useT() machinery.

import { ADMIN_SHELL_STRINGS } from "./i18n-admin/shell";
import { ADMIN_LOGIN_STRINGS } from "./i18n-admin/login";
import { ADMIN_CUSTOMERS_STRINGS } from "./i18n-admin/customers";
import { ADMIN_TRANSACTIONS_STRINGS } from "./i18n-admin/transactions";
import { ADMIN_WALLET_STRINGS } from "./i18n-admin/wallet";
import { ADMIN_PLAY_HISTORY_STRINGS } from "./i18n-admin/play-history";
import { ADMIN_COMPETITION_STRINGS } from "./i18n-admin/competition";
import { ADMIN_FINANCIAL_STRINGS } from "./i18n-admin/financial";
import { ADMIN_LIVE_STRINGS } from "./i18n-admin/live";

export type Locale = "lo" | "en";
export const DEFAULT_LOCALE: Locale = "lo";
export const LOCALES: Locale[] = ["lo", "en"];
export const LOCALE_COOKIE = "pupatao_locale";

export const LOCALE_LABEL: Record<Locale, string> = {
  lo: "ລາວ",
  en: "EN",
};

// Country-flag emoji rendered before the locale label in the language picker.
// Keeping these as Unicode regional-indicator pairs means no asset lookup —
// they render natively on every modern OS / browser.
export const LOCALE_FLAG: Record<Locale, string> = {
  lo: "🇱🇦",
  en: "🇬🇧",
};

// Exhaustive dictionary. Every string user-facing on the customer side lives
// here. Each value is a record of { lo, en }; missing translations fall back
// to the English value, then to the key itself.
export const STRINGS = {
  // ─── Admin pages (per-page modules under ./i18n-admin/) ──────────────
  ...ADMIN_SHELL_STRINGS,
  ...ADMIN_LOGIN_STRINGS,
  ...ADMIN_CUSTOMERS_STRINGS,
  ...ADMIN_TRANSACTIONS_STRINGS,
  ...ADMIN_WALLET_STRINGS,
  ...ADMIN_PLAY_HISTORY_STRINGS,
  ...ADMIN_COMPETITION_STRINGS,
  ...ADMIN_FINANCIAL_STRINGS,
  ...ADMIN_LIVE_STRINGS,

  // ─── Common ──────────────────────────────────────────────────────────
  "common.cancel": { lo: "ຍົກເລີກ", en: "Cancel" },
  "common.save": { lo: "ບັນທຶກ", en: "Save" },
  "common.saveChanges": { lo: "ບັນທຶກການປ່ຽນແປງ", en: "Save changes" },
  "common.saving": { lo: "ກຳລັງບັນທຶກ…", en: "Saving…" },
  "common.next": { lo: "ຖັດໄປ", en: "Next" },
  "common.back": { lo: "ກັບຄືນ", en: "Back" },
  "common.close": { lo: "ປິດ", en: "Close" },
  "common.continue": { lo: "ສືບຕໍ່", en: "Continue" },
  "common.search": { lo: "ຄົ້ນຫາ", en: "Search" },
  "common.upload": { lo: "ອັບໂຫລດ", en: "Upload" },
  "common.chooseFile": { lo: "ເລືອກໄຟລ໌", en: "Choose file" },
  "common.tryAgain": { lo: "ລອງອີກຄັ້ງ", en: "Try again" },
  "common.loadMore": { lo: "ໂຫຼດເພີ່ມ", en: "Load more" },
  "common.loadMoreCount": { lo: "ໂຫຼດເພີ່ມ ({n})", en: "Load more ({n})" },

  "common.status.pending": { lo: "ກຳລັງລໍ", en: "PENDING" },
  "common.status.completed": { lo: "ສຳເລັດ", en: "COMPLETED" },
  "common.status.cancelled": { lo: "ຍົກເລີກແລ້ວ", en: "CANCELLED" },
  "common.status.failed": { lo: "ລົ້ມເຫລວ", en: "FAILED" },

  // ─── Auth (login / register modals + pages) ─────────────────────────
  "auth.signIn": { lo: "ເຂົ້າສູ່ລະບົບ", en: "Sign In" },
  "auth.signOut": { lo: "ອອກຈາກລະບົບ", en: "Sign Out" },
  "auth.signingIn": { lo: "ກຳລັງເຂົ້າສູ່ລະບົບ…", en: "Signing in…" },
  "auth.register": { lo: "ລົງທະບຽນ", en: "Register" },
  "auth.creating": { lo: "ກຳລັງສ້າງ…", en: "Creating…" },
  "auth.createAccount": { lo: "ສ້າງບັນຊີ", en: "CREATE ACCOUNT" },
  "auth.welcomeBack": { lo: "ຍິນດີຕ້ອນຮັບກັບ", en: "Welcome back" },
  "auth.titleLogin": { lo: "ປູປາເຕົາ · ເຂົ້າສູ່ລະບົບ", en: "PUPATAO · LOGIN" },
  "auth.titleRegister": { lo: "ປູປາເຕົາ · ລົງທະບຽນ", en: "PUPATAO · REGISTER" },
  "auth.phone": { lo: "ເບີໂທລະສັບ", en: "Phone number" },
  "auth.password": { lo: "ລະຫັດຜ່ານ", en: "Password" },
  "auth.confirmPassword": { lo: "ຢືນຢັນລະຫັດຜ່ານ", en: "Confirm password" },
  "auth.noAccount": { lo: "ຍັງບໍ່ມີບັນຊີ?", en: "No account?" },
  "auth.alreadyHaveAccount": {
    lo: "ມີບັນຊີແລ້ວ?",
    en: "Already have an account?",
  },
  "auth.forgotPassword": {
    lo: "ລືມລະຫັດຜ່ານ? ຕິດຕໍ່ແອັດມິນ",
    en: "Forgot password? Contact admin",
  },
  "auth.anonymous": { lo: "ບໍ່ມີຊື່", en: "Anonymous" },
  "auth.signInOrRegister": {
    lo: "ເຂົ້າສູ່ລະບົບ ຫຼື ລົງທະບຽນ",
    en: "Sign in or register",
  },
  "auth.signInToUseRealWallet": {
    lo: "ເຂົ້າສູ່ລະບົບເພື່ອໃຊ້ກະເປົາຈິງ.",
    en: "Sign in to use your real wallet.",
  },
  "auth.registerHint": {
    lo: "ຕ້ອງການແຕ່ເບີໂທແລະລະຫັດຜ່ານ. ທ່ານສາມາດປ້ອນຊື່ແລະໂປຣໄຟລ໌ໃນພາຍຫຼັງ.",
    en: "Only phone number and password are required. You can fill in your name and profile later.",
  },
  "auth.agreeRulesPrefix": {
    lo: "ຂ້ອຍໄດ້ອ່ານ ແລະ ຍອມຮັບ",
    en: "I have read and agree to the",
  },
  "auth.agreeRulesLink": {
    lo: "ກົດລະບຽບການຫຼິ້ນເກມ",
    en: "game rules",
  },
  "auth.agreeRulesSuffix": { lo: "ແລ້ວ.", en: "." },
  "auth.mustAgreeRules": {
    lo: "ກະລຸນາຍອມຮັບກົດລະບຽບການຫຼິ້ນເກມກ່ອນລົງທະບຽນ.",
    en: "You must agree to the game rules before registering.",
  },

  // ─── Wallet page ─────────────────────────────────────────────────────
  "wallet.title": { lo: "ກະເປົາເງິນ", en: "Wallet" },
  "wallet.totalAvailable": { lo: "ຍອດທີ່ມີ", en: "TOTAL AVAILABLE" },
  "wallet.realWallet": { lo: "ກະເປົາຈິງ", en: "Real wallet" },
  "wallet.promoWallet": { lo: "ກະເປົາໂປຣໂມ", en: "PROMO wallet" },
  "wallet.promoNote": {
    lo: "ໃຊ້ສຳລັບແທງເທົ່ານັ້ນ — ຖອນບໍ່ໄດ້",
    en: "Bettable only — not withdrawable",
  },
  "wallet.totalDeposit": { lo: "ຝາກທັງໝົດ", en: "TOTAL DEPOSIT" },
  "wallet.totalWithdraw": { lo: "ຖອນທັງໝົດ", en: "TOTAL WITHDRAW" },
  "wallet.tab.deposit": { lo: "ຝາກ", en: "Deposit" },
  "wallet.tab.withdraw": { lo: "ຖອນ", en: "Withdraw" },
  "wallet.tab.transfer": { lo: "ໂອນ", en: "Transfer" },
  "wallet.tab.reward": { lo: "🎁 ລາງວັນ", en: "🎁 Rewards" },
  "wallet.depositCoins": { lo: "ຝາກເງິນ", en: "Deposit Coins" },
  "wallet.withdrawCoins": { lo: "ຖອນເງິນ", en: "Withdraw Coins" },
  "wallet.customAmount": { lo: "ຈຳນວນກຳນົດເອງ", en: "Custom amount" },
  "wallet.enterAmount": { lo: "ໃສ່ຈຳນວນ…", en: "Enter amount…" },
  "wallet.transferComingSoon": {
    lo: "ການໂອນກຳລັງຈະມາໄວໆນີ້.",
    en: "Transfer is coming soon.",
  },
  "wallet.history.deposit": { lo: "ປະຫວັດການຝາກ", en: "DEPOSIT HISTORY" },
  "wallet.history.withdraw": { lo: "ປະຫວັດການຖອນ", en: "WITHDRAW HISTORY" },
  "wallet.history.transfer": { lo: "ປະຫວັດການໂອນ", en: "TRANSFER HISTORY" },
  "wallet.history.reward": { lo: "ປະຫວັດລາງວັນ", en: "REWARD HISTORY" },
  "wallet.noTx.deposit": {
    lo: "ຍັງບໍ່ມີລາຍການຝາກ.",
    en: "No deposit transactions yet.",
  },
  "wallet.noTx.withdraw": {
    lo: "ຍັງບໍ່ມີລາຍການຖອນ.",
    en: "No withdraw transactions yet.",
  },
  "wallet.noTx.transfer": {
    lo: "ຍັງບໍ່ມີລາຍການໂອນ.",
    en: "No transfer transactions yet.",
  },
  "wallet.noTx.reward": {
    lo: "ຍັງບໍ່ມີລາງວັນ.",
    en: "No rewards yet.",
  },
  "wallet.viewSlip": { lo: "ເບິ່ງໃບໂອນ", en: "View slip" },
  "wallet.errEnterAmount": {
    lo: "ໃສ່ຈຳນວນທີ່ຖືກຕ້ອງ.",
    en: "Enter a valid amount.",
  },
  "wallet.errMin": { lo: "ຕ່ຳສຸດ {amount} ₭.", en: "Minimum {amount} ₭." },
  "wallet.errMax": { lo: "ສູງສຸດ {amount} ₭.", en: "Maximum {amount} ₭." },
  "wallet.errExceedsBalance": {
    lo: "ການຖອນເກີນຍອດເງິນຂອງທ່ານ.",
    en: "Withdraw exceeds your available balance.",
  },
  "wallet.back": { lo: "ກັບ", en: "Back" },
  "wallet.showBalance": { lo: "ສະແດງຍອດເງິນ", en: "Show balance" },
  "wallet.hideBalance": { lo: "ເຊື່ອງຍອດເງິນ", en: "Hide balance" },

  // ─── Deposit modal ───────────────────────────────────────────────────
  "deposit.step1": {
    lo: "ຂັ້ນຕອນ 1 · ສະແກນເພື່ອຈ່າຍ",
    en: "STEP 1 · SCAN TO PAY",
  },
  "deposit.step2": {
    lo: "ຂັ້ນຕອນ 2 · ອັບໂຫຼດໃບໂອນ",
    en: "STEP 2 · UPLOAD SLIP",
  },
  "deposit.qrInstruction": {
    lo: 'ສະແກນ QR ດ້ວຍແອັບທະນາຄານ ຫຼື ກະເປົາເງິນເພື່ອໂອນຍອດຂ້າງເທິງ. ເມື່ອໂອນແລ້ວ ກົດ "ຖັດໄປ" ເພື່ອອັບໂຫຼດໃບໂອນ.',
    en: "Scan the QR code with your bank or e-wallet app to transfer the amount above. Once payment is sent, tap Next to upload your payment slip.",
  },
  "deposit.uploadInstruction": {
    lo: "ອັບໂຫຼດຮູບໃບໂອນຂອງທ່ານ. ການຝາກຈະຖືກກວດສອບໂດຍແອັດມິນ ແລະ ເຕີມຍອດເງິນເມື່ອອະນຸມັດ.",
    en: "Upload a screenshot of your payment slip. Your deposit will be reviewed by an admin and credited once verified.",
  },
  "deposit.example": { lo: "ຕົວຢ່າງ", en: "EXAMPLE" },
  "deposit.tapForFull": {
    lo: "ກົດເພື່ອເບິ່ງເຕັມຈໍ",
    en: "Tap to view full screen",
  },
  "deposit.tapToChooseSlip": {
    lo: "ກົດເພື່ອເລືອກໃບໂອນ",
    en: "Tap below to choose your slip",
  },
  "deposit.fileTypes": {
    lo: "JPG / PNG / WebP / PDF · ສູງສຸດ 8MB",
    en: "JPG / PNG / WebP / PDF · max 8MB",
  },
  "deposit.changeSlip": { lo: "ປ່ຽນໃບໂອນ", en: "CHANGE SLIP" },
  "deposit.confirmCta": { lo: "ຢືນຢັນການຝາກ", en: "CONFIRM DEPOSIT" },
  "deposit.submitting": { lo: "ກຳລັງສົ່ງ…", en: "Submitting…" },
  "deposit.submitted": { lo: "ສົ່ງການຝາກແລ້ວ", en: "Deposit submitted" },
  "deposit.submittedDesc": {
    lo: "ກຳລັງລໍຖ້າການຢືນຢັນຈາກແອັດມິນ. ທ່ານຈະໄດ້ຮັບແຈ້ງເຕືອນເມື່ອອະນຸມັດ.",
    en: "Awaiting admin verification. You will be notified once approved.",
  },
  "deposit.uploaded": { lo: "ອັບໂຫຼດແລ້ວ", en: "Uploaded" },
  "deposit.title": { lo: "ຢືນຢັນການຝາກ", en: "CONFIRM DEPOSIT" },
  "deposit.pdfUploaded": { lo: "📄 ອັບໂຫຼດ PDF", en: "📄 PDF uploaded" },
  "deposit.aria.close": { lo: "ປິດ", en: "Close deposit" },
  "deposit.aria.viewQr": {
    lo: "ເບິ່ງ QR ເຕັມຈໍ",
    en: "View QR code full screen",
  },
  "deposit.aria.viewExample": {
    lo: "ເບິ່ງຕົວຢ່າງໃບໂອນ",
    en: "View example payment slip full screen",
  },
  "deposit.downloadQr": { lo: "ດາວໂຫຼດ QR", en: "Download QR" },

  // ─── Withdraw modal ──────────────────────────────────────────────────
  "withdraw.step1": { lo: "ຂັ້ນຕອນ 1 · QR ທະນາຄານ", en: "STEP 1 · BANK QR" },
  "withdraw.step2": { lo: "ຂັ້ນຕອນ 2 · ຢືນຢັນ", en: "STEP 2 · CONFIRM" },
  "withdraw.confirmTitle": { lo: "ຢືນຢັນການຖອນ", en: "CONFIRM WITHDRAW" },
  "withdraw.qrInstruction": {
    lo: "ອັບໂຫຼດ QR ຂອງບັນຊີທະນາຄານທີ່ຈະຮັບເງິນຖອນ. ພວກເຮົາຈະບັນທຶກໄວ້ ບໍ່ຕ້ອງອັບໂຫຼດໃໝ່ຄັ້ງໜ້າ.",
    en: "Upload the QR code of the bank account that should receive your withdrawal. We'll keep it on file so you don't need to upload it again next time.",
  },
  "withdraw.confirmInstruction": {
    lo: "ພວກເຮົາຈະສົ່ງເງິນຖອນໄປບັນຊີຂ້າງລຸ່ມເມື່ອແອັດມິນຢືນຢັນ.",
    en: "We'll send the withdrawal to the account below once an admin verifies your request.",
  },
  "withdraw.tapToUpload": {
    lo: "ກົດເພື່ອອັບໂຫຼດ QR ທະນາຄານ",
    en: "Tap below to upload your bank QR",
  },
  "withdraw.fileTypes": {
    lo: "JPG / PNG / WebP · ສູງສຸດ 5MB",
    en: "JPG / PNG / WebP · max 5MB",
  },
  "withdraw.changeQr": { lo: "ປ່ຽນ QR", en: "CHANGE QR" },
  "withdraw.keepCurrentQr": { lo: "ໃຊ້ QR ປັດຈຸບັນ", en: "KEEP CURRENT QR" },
  "withdraw.fee": { lo: "ຄ່າທຳນຽມ", en: "Fee" },
  "withdraw.youReceive": { lo: "ຈະໄດ້ຮັບ", en: "You receive" },
  "withdraw.confirmCta": { lo: "ຢືນຢັນການຖອນ", en: "CONFIRM WITHDRAW" },
  "withdraw.submitted": { lo: "ສົ່ງການຖອນແລ້ວ", en: "Withdraw submitted" },
  "withdraw.submittedDesc": {
    lo: "ກຳລັງລໍຖ້າການຢືນຢັນຈາກແອັດມິນ. ເງິນຈະຖືກສົ່ງໄປ QR ທະນາຄານຂອງທ່ານເມື່ອອະນຸມັດ.",
    en: "Awaiting admin verification. Funds will be sent to your bank QR once approved.",
  },
  "withdraw.aria.close": { lo: "ປິດ", en: "Close withdraw" },
  "withdraw.aria.viewQr": {
    lo: "ເບິ່ງ QR ເຕັມຈໍ",
    en: "View bank QR full screen",
  },

  // ─── Profile page ────────────────────────────────────────────────────
  "profile.title": { lo: "ໂປຣໄຟລ໌", en: "Profile" },
  "profile.firstName": { lo: "ຊື່", en: "First name" },
  "profile.lastName": { lo: "ນາມສະກຸນ", en: "Last name" },
  "profile.dob": { lo: "ວັນເດືອນປີເກີດ", en: "Date of birth" },
  "profile.phoneReadonly": {
    lo: "ເບີໂທລະສັບ (ບໍ່ສາມາດປ່ຽນໄດ້)",
    en: "Phone number (cannot be changed)",
  },
  "profile.personalInfo": { lo: "ຂໍ້ມູນສ່ວນຕົວ", en: "Personal information" },
  "profile.unnamed": { lo: "ຜູ້ຫຼິ້ນບໍ່ມີຊື່", en: "Unnamed player" },
  "profile.memberSince": {
    lo: "ສະມາຊິກຕັ້ງແຕ່ {date}",
    en: "Member since {date}",
  },
  "profile.bankQr": { lo: "QR ທະນາຄານ", en: "Bank QR" },
  "profile.bankQrDesc": {
    lo: "ການຖອນເງິນຈະຖືກສົ່ງໄປບັນຊີໃນ QR ນີ້. ທ່ານສາມາດປ່ຽນໄດ້ທຸກເມື່ອ — ຄຳຂໍຖອນທີ່ກຳລັງລໍຖ້າຈະຍັງໃຊ້ QR ທີ່ສົ່ງໄປ.",
    en: "Withdrawals are sent to the bank account encoded in this QR. You can replace it any time — pending withdrawals keep the QR they were submitted with.",
  },
  "profile.noBankYet": {
    lo: "ຍັງບໍ່ໄດ້ອັບໂຫຼດ QR ທະນາຄານ",
    en: "No bank QR uploaded yet",
  },
  "profile.uploadQr": { lo: "ອັບໂຫຼດ QR", en: "UPLOAD QR" },
  "profile.replaceQr": { lo: "ປ່ຽນ QR", en: "REPLACE QR" },
  "profile.bankQrUpdated": { lo: "ປ່ຽນ QR ທະນາຄານແລ້ວ", en: "Bank QR updated" },
  "profile.bankQrUpdatedDesc": {
    lo: "ການຖອນຕໍ່ໄປຈະຖືກສົ່ງໄປບັນຊີນີ້.",
    en: "Future withdrawals will go to this account.",
  },
  "profile.profileUpdated": { lo: "ປ່ຽນຂໍ້ມູນແລ້ວ", en: "Profile updated" },
  "profile.profileUpdatedDesc": {
    lo: "ການປ່ຽນແປງຂອງທ່ານຖືກບັນທຶກແລ້ວ.",
    en: "Your changes have been saved.",
  },
  "profile.current": { lo: "ປັດຈຸບັນ", en: "CURRENT" },
  "profile.notSet": { lo: "ຍັງບໍ່ໄດ້ຕັ້ງ", en: "NOT SET" },
  "profile.language": { lo: "ພາສາ", en: "Language" },
  "profile.languageDesc": {
    lo: "ປ່ຽນພາສາທີ່ສະແດງໃນແອັບ.",
    en: "Switch the language used across the app.",
  },

  // ─── Game (home page) ────────────────────────────────────────────────
  "game.modeSelf": { lo: "🎲 ຫຼິ້ນດ່ຽວ", en: "🎲 Self Play" },
  "game.modeLive": { lo: "🔴 ໄລສສົດ", en: "🔴 Live" },
  "game.toggleToRandom": { lo: "ປ່ຽນໄປໂໝດ ສຸ່ມ", en: "Switch to RANDOM mode" },
  "game.toggleToLive": {
    lo: "ປ່ຽນໄປໂໝດ ຖ່າຍທອດສົດ",
    en: "Switch to LIVE (host) mode",
  },
  "game.placeBet": { lo: "ກະລຸນາວາງເດີມພັນ.", en: "Please place your bet." },
  "game.youWin": { lo: "ທ່ານຊະນະ {amount}!", en: "You win {amount}!" },
  "game.betterLuck": { lo: "ໂຊກດີຄັ້ງໜ້າ!", en: "Better luck next time!" },
  "game.rolling": { lo: "ກຳລັງໂຍນ...", en: "Rolling..." },
  "game.lastBet": { lo: "ເດີມພັນຫຼ້າສຸດ", en: "LAST BET" },
  "game.lastWin": { lo: "ຊະນະຫຼ້າສຸດ", en: "LAST WIN" },
  "game.curBet": { lo: "ເດີມພັນປັດຈຸບັນ", en: "CUR BET" },
  "game.balance": { lo: "ຍອດເງິນ", en: "BALANCE" },
  "game.history": { lo: "ປະຫວັດ", en: "HISTORY" },
  "game.noRolls": { lo: "ຍັງບໍ່ມີການໂຍນ", en: "No rolls yet" },
  "game.noLiveRolls": { lo: "ຍັງບໍ່ມີການໂຍນສົດ", en: "No live rolls yet" },
  "game.liveRoundBanner": {
    lo: "🔴 ກຳລັງມີຮອບໄລສົດ — ກົດເພື່ອເຂົ້າຮ່ວມ!",
    en: "🔴 A live round is open right now — tap to join!",
  },
  "game.watchLive": { lo: "ໄປໄລສົດ", en: "Watch Live" },

  // ─── Feature discovery tour ──────────────────────────────────────────
  "tour.replay": { lo: "ວິທີຫຼິ້ນ", en: "How to Play" },
  "tour.stepOf": {
    lo: "ບາດກ້າວ {current}/{total}",
    en: "Step {current} of {total}",
  },
  "tour.next": { lo: "ຕໍ່ໄປ", en: "Next" },
  "tour.skip": { lo: "ຂ້າມ", en: "Skip" },
  "tour.finish": { lo: "ເລີ່ມຫຼິ້ນ! 🎉", en: "Let's Play! 🎉" },
  "tour.step1Title": { lo: "🎮 ໂໝດການຫຼິ້ນ", en: "🎮 Play Modes" },
  "tour.step1Body": {
    lo: "ມີ 2 ໂໝດ: 🎲 ຫຼິ້ນດ່ຽວ — ຜົນອອກອັດຕະໂນມັດ. 🔴 ໄລສົດ — ຫຼິ້ນພ້ອມຄົນອື່ນ ມີແອດມິນເປີດໄຂດ້ວຍກ້ອງສົດ. ກົດທີ່ນີ້ເພື່ອສະຫຼັບໂໝດໄດ້ທຸກເວລາ.",
    en: "Two modes: 🎲 Self-Play — dice resolve automatically. 🔴 Live — play together in real time with an admin-hosted stream. Tap here anytime to switch.",
  },
  "tour.step2Title": { lo: "💰 ບັນຊີເງິນ", en: "💰 Wallets" },
  "tour.step2Body": {
    lo: "ທ່ານມີ 3 ບັນຊີ: REAL (ເງິນຈິງ), PROMO (ໂປຣໂມຊັ່ນ), ແລະ DEMO (ສຳລັບລອງຫຼິ້ນ). ບັນຊີ DEMO ມີໄອຄອນ 🔄 ສຳລັບເຕີມຍອດເງິນຄືນໄດ້ບໍ່ຈຳກັດ — ລອງຫຼິ້ນແບບບໍ່ມີຄວາມສ່ຽງ!",
    en: "You have 3 wallets: REAL money, PROMO bonus credit, and DEMO for practice. DEMO has a 🔄 refresh button that tops up your balance unlimited times — practice risk-free!",
  },
  "tour.step3Title": { lo: "🎯 ການວາງເດີມພັນ", en: "🎯 Placing Bets" },
  "tour.step3Body": {
    lo: "ກົດຮູບສັດເທື່ອທີ 1 ເພື່ອເລືອກ (ຈະກະພິບ), ແລ້ວກົດຮູບດຽວກັນອີກຄັ້ງເພື່ອວາງເດີມພັນດ່ຽວ. ຫຼື ກົດຕໍ່ໄປຫາຮູບທີ່ຢູ່ຂ້າງກັນເພື່ອວາງເດີມພັນຄູ່ — ຊະນະຖ້າທັງສອງຮູບອອກພ້ອມກັນ, ໄດ້ກຳໄລສູງກວ່າ!",
    en: "Tap a symbol once to select it (it'll pulse), then tap it again for a SINGLE bet. Or tap an adjacent symbol next for a PAIR bet — wins big if BOTH symbols land!",
  },
  "tour.step4Title": { lo: "📊 ເດີມພັນຍອດລວມ", en: "📊 Sum Range Bets" },
  "tour.step4Body": {
    lo: "ນອກຈາກຮູບສັດ, ທ່ານຍັງວາງເດີມພັນຍອດລວມໝາກລູກເຕົ໋າໄດ້: ຕໍ່າ, ກາງ, ສູງ — ເລືອກຊ່ວງຍອດລວມທີ່ທ່ານຄາດວ່າຈະອອກ.",
    en: "Beyond symbols, you can also bet on the total dice sum: LOW, MIDDLE, or HIGH — pick the range you think the roll will land in.",
  },
  "tour.step5Title": {
    lo: "🪙 ເລືອກຈຳນວນເງິນ",
    en: "🪙 Choose Your Bet Amount",
  },
  "tour.step5Body": {
    lo: "ກົດເລືອກຈຳນວນຊິບກ່ອນວາງເດີມພັນ. ບໍ່ມີຈຳນວນທີ່ທ່ານຕ້ອງການ? ກົດໄອຄອນດິນສໍເພື່ອປ້ອນຈຳນວນເອງໄດ້ເລີຍ!",
    en: "Pick a chip amount before placing bets. Don't see the amount you want? Tap the pencil icon to enter a custom amount!",
  },
  "tour.step6Title": {
    lo: "✅ ຢືນຢັນການວາງເດີມພັນ",
    en: "✅ Confirm Your Bet",
  },
  "tour.step6Body": {
    lo: "ໂໝດຫຼິ້ນດ່ຽວ: ກົດ 'ວາງເດີມພັນ' ເພື່ອເລີ່ມຮອບ — ຜົນຈະອອກອັດຕະໂນມັດຫຼັງໝົດເວລາ. ໂໝດໄລສົດ: ປຸ່ມຈະເປັນ 'ແທງເລີຍ' — ສຳຄັນ! ເດີມພັນຂອງທ່ານຈະບໍ່ຖືກບັນທຶກຈົນກວ່າທ່ານຈະກົດປຸ່ມນີ້.",
    en: "In Self-Play, tap 'BET' to start a round — it resolves automatically when the timer ends. In LIVE mode, this button reads 'ແທງເລີຍ' instead — important: your bets aren't submitted until you tap it!",
  },

  "game.low": { lo: "ຕໍ່າ", en: "LOW" },
  "game.middle": { lo: "ກາງ", en: "MIDDLE" },
  "game.high": { lo: "ສູງ", en: "HIGH" },
  "game.pays": { lo: "ຈ່າຍ {x}x", en: "Pays {x}x" },
  "game.tapAdjacent": {
    lo: "ກົດໃສ່ສັດທີ່1 ແລ້ວກົດໃສ່ຕົວທີ່2 ເພື່ອວາງເດີມພັນຄູ່ (×5). ກົດສັດດຽວສອງຄັ້ງເພື່ອວາງແບບດ່ຽວ (×1).",
    en: "Tap a cell, then tap an adjacent cell for a PAIR bet (×5). Tap same cell twice for a single.",
  },
  "game.dailyBonus": { lo: "ປະຈຳວັນ +200", en: "Daily +200" },
  "game.timeBonus": { lo: "ເວລາ +50", en: "Time +50" },
  "game.continue": { lo: "ສືບຕໍ່", en: "CONTINUE" },
  "game.youLost": { lo: "ທ່ານເສຍ", en: "You Lost" },
  "game.youWonHeader": { lo: "ທ່ານຊະນະ!", en: "You Won!" },
  "game.netResult": { lo: "ຜົນລວມ", en: "Net result" },
  "game.totalBalance": { lo: "ຍອດເງິນທັງໝົດ", en: "Total balance" },
  "game.totalBet": { lo: "ເດີມພັນທັງໝົດ", en: "Total bet" },
  "game.netWin": { lo: "ກຳໄລສຸດທິ", en: "Net win" },
  "game.demoBalance": {
    lo: "ຣີເຊັດກະເປົາທົດລອງເປັນ {amount} ₭",
    en: "Reset demo balance to {amount} ₭",
  },

  // ─── Profile menu (header dropdown) ──────────────────────────────────
  "menu.wallet": { lo: "ກະເປົາເງິນ", en: "Wallet" },
  "menu.walletDesc": { lo: "ຝາກແລະຖອນເງິນ", en: "Deposit & withdraw coins" },
  "menu.playHistory": { lo: "ປະຫວັດການຫຼິ້ນ", en: "Play History" },
  "menu.playHistoryDesc": {
    lo: "ເບິ່ງປະຫວັດເກມຂອງທ່ານ",
    en: "View your game records",
  },
  "menu.profile": { lo: "ໂປຣໄຟລ໌ຜູ້ໃຊ້", en: "User Profile" },
  "menu.profileDesc": { lo: "ແກ້ໄຂຂໍ້ມູນຂອງທ່ານ", en: "Edit your information" },
  "menu.rules": { lo: "ກົດລະບຽບການຫຼິ້ນ", en: "Game Rules" },
  "menu.rulesDesc": {
    lo: "ອ່ານຄູ່ມື ແລະ ກົດລະບຽບຂອງເກມ",
    en: "Read the manual and house rules",
  },
  "menu.contactAdmin": { lo: "ຕິດຕໍ່ແອັດມີນ", en: "Contact Admin" },
  "menu.contactAdminDesc": {
    lo: "ສົນທະນາກັບແອັດມິນຜ່ານ WhatsApp",
    en: "Chat with admin on WhatsApp",
  },
  "menu.joinGroup": { lo: "ເຂົ້າຮ່ວມກຸ່ມ", en: "Join Group" },
  "menu.joinGroupDesc": {
    lo: "ເຂົ້າກຸ່ມ WhatsApp ຫຼື Messenger",
    en: "Join our WhatsApp or Messenger group",
  },
  "joinGroup.title": { lo: "ເຂົ້າຮ່ວມກຸ່ມ", en: "Join Our Group" },
  "joinGroup.subtitle": {
    lo: "ເລືອກແອັບທີ່ທ່ານໃຊ້ ເພື່ອເຂົ້າຮ່ວມກຸ່ມຂອງພວກເຮົາ",
    en: "Pick an app to join our community group",
  },
  "joinGroup.whatsapp": { lo: "ເຂົ້າກຸ່ມ WhatsApp", en: "Join WhatsApp Group" },
  "joinGroup.messenger": {
    lo: "ເຂົ້າກຸ່ມ Messenger",
    en: "Join Messenger Group",
  },
  "menu.loggedIn": { lo: "ເຂົ້າສູ່ລະບົບແລ້ວ", en: "Logged in" },
  "menu.language": { lo: "ພາສາ", en: "Language" },
  "menu.account": { lo: "ບັນຊີ", en: "ACCOUNT" },
  "menu.mode": { lo: "ໂໝດ", en: "MODE" },
  "menu.realAccount": { lo: "ບັນຊີຈິງ", en: "Real account" },
  "menu.demoAccount": { lo: "ບັນຊີທົດລອງ", en: "Demo account" },
  "menu.promoAccount": { lo: "ບັນຊີໂປຣໂມ", en: "Promo account" },

  // ─── Referral modal (opens from the profile card) ────────────────────
  "referral.title": { lo: "ແນະນໍາເພື່ອນ", en: "Invite a friend" },
  "referral.invite": { lo: "ແນະນໍາ", en: "Invite" },
  "referral.description": {
    lo: "ຮັບ 10,000 ກີບ ຕໍ່ຜູ້ຖືກແນະນໍາ ທີ່ລົງທະບຽນ ແລະ ຝາກຄັ້ງທຳອິດສຳເລັດ.",
    en: "Got 10,000 Kip per referred friend who registers and completes their first top-up.",
  },
  "referral.codeLabel": { lo: "ລະຫັດແນະນໍາ", en: "Code" },
  "referral.copy": { lo: "ສຳເນົາ", en: "Copy" },
  "referral.copied": { lo: "ສຳເນົາແລ້ວ", en: "Copied" },
  "referral.linkAria": { lo: "ລິ້ງແນະນໍາ", en: "Referral link" },
  "referral.yourReferrals": {
    lo: "ຄົນທີ່ທ່ານແນະນໍາ",
    en: "PEOPLE YOU INVITED",
  },
  "referral.empty": {
    lo: "ຍັງບໍ່ມີຄົນເຂົ້າຮ່ວມ. ແບ່ງປັນລະຫັດຂອງທ່ານເພື່ອຮັບ 10,000 ກີບ ຕໍ່ຄົນ.",
    en: "No invites yet. Share your code to earn 10,000 ₭ per friend.",
  },
  "referral.bonusPaid": { lo: "ຮັບໂບນັດແລ້ວ", en: "BONUS PAID" },
  "referral.pending": { lo: "ລໍຖ້າຝາກຄັ້ງທຳອິດ", en: "AWAITING TOPUP" },

  // ─── Symbol names ────────────────────────────────────────────────────
  "symbol.crab": { lo: "ປູ", en: "Crab" },
  "symbol.fish": { lo: "ປາ", en: "Fish" },
  "symbol.prawn": { lo: "ກຸ້ງ", en: "Prawn" },
  "symbol.frog": { lo: "ກົບ", en: "Frog" },
  "symbol.rooster": { lo: "ໄກ່", en: "Rooster" },
  "symbol.gourd": { lo: "ນໍ້າເຕົ້າ", en: "Gourd" },

  // ─── Bet type labels ─────────────────────────────────────────────────
  "bet.symbol": { lo: "ເດີນພັນດ່ຽວ", en: "Symbol" },
  "bet.pair": { lo: "ເດີນພັນຄູ່", en: "Pair" },
  "bet.range": { lo: "ຕໍ່າ/ສູງ", en: "Range" },

  // ─── Pair bet hint ───────────────────────────────────────────────────
  "game.pairHint": {
    lo: "ກົດໃສ່ສັດທີ1 ແລ້ວກົດໃສ່ຕົວທີ2 ເພື່ອວາງເດີມພັນຄູ່ (×5). ກົດສັດດຽວສອງຄັ້ງເພື່ອວາງແບບດ່ຽວ (×1).",
    en: "Tap symbol 1, then symbol 2 for a pair bet (×5). Tap same symbol twice for a single bet (×1).",
  },
  "game.placeYourBets": { lo: "ວາງເດີນພັນຂອງທ່ານ", en: "Place your bets" },

  // ─── Cancel bet confirmation ──────────────────────────────────────────
  "bet.cancelTitle": { lo: "ຢືນຢັນການຍົກເລີກ?", en: "Cancel this bet?" },
  "bet.cancelDesc": {
    lo: "ຍົກເລີກການແທງ {amount} ₭ ແລະ ຮັບເງິນຄືນ?",
    en: "Cancel your {amount} ₭ bet and get a full refund?",
  },
  "bet.cancelConfirm": { lo: "ຢືນຢັນ — ຮັບເງິນຄືນ", en: "Yes, refund me" },
  "bet.cancelNo": { lo: "ບໍ່, ເກັບໄວ້", en: "No, keep it" },

  // ─── Game board action buttons ───────────────────────────────────────
  "game.custom": { lo: "ໃສ່ຈໍານວນເອງ", en: "CUSTOM" },
  "game.undo": { lo: "ກັບຄືນ", en: "UNDO" },
  "game.roll": { lo: "ຫຼີ້ນ", en: "ROLL" },
  "game.bet": { lo: "ວາງເດີມພັນ", en: "BET" },
  "game.betCountdown": { lo: "ປິດຮັບ", en: "CLOSING" },
  "game.okay": { lo: "ຕົກລົງ", en: "OKAY" },
  "game.waiting": { lo: "ກຳລັງລໍ", en: "WAITING" },

  // ─── Custom chip amount modal ────────────────────────────────────────
  "chip.customTitle": { lo: "ໃສ່ຈຳນວນເອງ", en: "Custom Chip Amount" },
  "chip.customHint": {
    lo: "ໃສ່ຈຳນວນໃດກໍໄດ້ ຕັ້ງແຕ່ {min} ຫາ {max} ₭.",
    en: "Enter any amount from {min} up to {max} ₭.",
  },
  "chip.customPlaceholder": { lo: "{min} – {max}", en: "{min} – {max}" },
  "chip.customPreview": {
    lo: "ຕົວຢ່າງ: {amount} ₭",
    en: "Preview: {amount} ₭",
  },
  "chip.setChip": { lo: "ຕັ້ງເເງິນ", en: "Set Chip" },

  // ─── LIVE-mode status badges + waiting messages ──────────────────────
  "live.statusBetting": { lo: "⏱ {n}s ຮັບແທງ", en: "⏱ {n}s BETTING" },
  "live.betLocked": { lo: "⏳ ກຳລັງເລີ່ມຮອບໃໝ່, ກະລຸນາລໍຖ້າ...", en: "⏳ Starting a new round, please wait…" },
  "live.reload": { lo: "ໂຫຼດໃໝ່", en: "Reload" },
  "live.tapForSound": { lo: "ເປີດສຽງ", en: "Sound" },
  "live.mute": { lo: "ປິດສຽງ", en: "Mute" },
  "live.statusWaitingResult": {
    lo: "🔒 ກຳລັງລໍຜົນ",
    en: "🔒 WAITING FOR RESULT",
  },
  "live.statusNotStarted": {
    lo: "⏸ ຮອບຍັງບໍ່ເລີ່ມ",
    en: "⏸ ROUND NOT STARTED",
  },
  "live.waitingHostStream": {
    lo: "ກຳລັງລໍຜູ້ດໍາເນີນຕັ້ງສະຕຣີມ…",
    en: "Waiting for the host to set the stream…",
  },
  "live.waitingHostStart": {
    lo: "⏸ ກຳລັງລໍຜູ້ດໍາເນີນເລີ່ມຮອບຕໍ່ໄປ…",
    en: "⏸ Waiting for the host to start the next round…",
  },
  "live.bettingClosed": {
    lo: "🔒 ແອັດມີນກຳລັງໃສ່ຜົນ.",
    en: "🔒 Betting closed — host is entering the result.",
  },
  "live.waitingHostShort": {
    lo: "ກຳລັງລໍຜູ້ດໍາເນີນ",
    en: "Waiting for the host",
  },
  "live.placeBetsTitle": {
    lo: "ແທງໃນຮອບນີ້",
    en: "Place your bets in this round",
  },

  // ─── Bet/round result toasts ─────────────────────────────────────────
  "live.betsPlacedTitle": { lo: "ແທງສຳເລັດ", en: "Bets placed" },
  "live.betsPlacedDesc": {
    lo: "{amount} ₭ — ກຳລັງລໍຜູ້ດໍາເນີນໃສ່ຜົນ",
    en: "{amount} ₭ — waiting for the host to enter dice",
  },
  "live.betNotPlaced": { lo: "ບໍ່ສາມາດແທງໄດ້", en: "Bet not placed" },
  "live.payoutTitle": { lo: "ໄດ້ຮັບລາງວັນ", en: "Live round payout" },
  "live.updateTitle": { lo: "ອັບເດດຮອບສົດ", en: "Live round update" },
  "live.balance": { lo: "ຍອດ: {amount} ₭", en: "Balance: {amount} ₭" },

  // ─── Sidebar stats (right column on desktop) ─────────────────────────
  "stats.lastBet": { lo: "ແທງລ່າສຸດ", en: "LAST BET" },
  "stats.lastWin": { lo: "ຊະນະລ່າສຸດ", en: "LAST WIN" },
  "stats.curBet": { lo: "ແທງປັດຈຸບັນ", en: "CUR BET" },
  "stats.balance": { lo: "ຍອດເງິນ", en: "BALANCE" },

  // ─── Round result modal (RANDOM + LIVE) ──────────────────────────────
  "result.titleRandom": { lo: "ຜົນຂອງຮອບ", en: "ROUND RESULT" },
  "result.titleLive": { lo: "ຜົນຮອບໄລຟສົດ", en: "LIVE ROUND RESULT" },
  "result.youWin": { lo: "🎉 ທ່ານຊະນະ!", en: "🎉 YOU WIN!" },
  "result.youLost": { lo: "💔 ທ່ານເສຍແລ້ວ", en: "💔 YOU LOST" },
  "result.breakEven": { lo: "ສະເໝີ", en: "BREAK EVEN" },
  "result.stake": { lo: "ແທງ", en: "STAKE" },
  "result.payout": { lo: "ໄດ້ຮັບ", en: "PAYOUT" },
  "result.totalBalance": { lo: "ຍອດເງິນທັງໝົດ", en: "TOTAL BALANCE" },
  "result.yourBetsThisRound": {
    lo: "ການແທງຂອງທ່ານໃນຮອບນີ້",
    en: "YOUR BETS THIS ROUND",
  },
  "result.continue": { lo: "ສືບຕໍ່", en: "CONTINUE" },
  "result.win": { lo: "ຊະນະ", en: "WIN" },
  "result.loss": { lo: "ແພ້", en: "LOSS" },
  "result.total": { lo: "ລວມ", en: "TOTAL" },
  "result.sum": { lo: "ລວມ", en: "SUM" },
  "result.singleBets": { lo: "ການແທງດ່ຽວ", en: "SINGLE BETS" },
  "result.rangeBets": { lo: "ການແທງຕໍ່າສູງ", en: "RANGE BETS" },
  "result.pairBets": { lo: "ການແທງຄູ່", en: "PAIR BETS" },
  "result.totalStake": { lo: "ລວມການແທງ", en: "Total stake" },
  "result.totalWon": { lo: "ລວມຊະນະ", en: "Total won" },
  "result.totalLost": { lo: "ລວມແພ້", en: "Total lost" },
  "result.refundNote": {
    lo: "ໝາຍເຫດ: ບາງລາຍການເກີດບັນຫາລະຫວ່າງການວາງເດີມພັນ ຈຶ່ງຖືກຄືນເງິນໃຫ້ທ່ານ.",
    en: "Note: some bets had a problem during betting, so they were refunded to you.",
  },

  // ─── Wallet realtime toasts (admin approve / reject events) ──────────
  "wallet.toast.depositApproved": {
    lo: "ອະນຸມັດການຝາກແລ້ວ",
    en: "Deposit approved",
  },
  "wallet.toast.depositRejected": {
    lo: "ປະຕິເສດການຝາກ",
    en: "Deposit rejected",
  },
  "wallet.toast.withdrawApproved": {
    lo: "ອະນຸມັດການຖອນແລ້ວ",
    en: "Withdraw approved",
  },
  "wallet.toast.withdrawRejected": {
    lo: "ປະຕິເສດການຖອນ",
    en: "Withdraw rejected",
  },
  "wallet.toast.transferReceived": {
    lo: "ໄດ້ຮັບການໂອນ",
    en: "Transfer received",
  },
  "wallet.toast.notApproved": {
    lo: "{amount} ₭ — ຄຳຂໍບໍ່ຖືກອະນຸມັດ",
    en: "{amount} ₭ — request not approved",
  },

  // ─── Reject reasons (admin picks a code; customer sees the translated
  // text in their own locale) ──────────────────────────────────────────
  "rejectReason.INVALID_SLIP": {
    lo: "ສະລິບການໂອນບໍ່ຖືກຕ້ອງ ກາລຸນາກວດສອບ ແລະ ລອງໃໝ່ອີກຄັ້ງ.",
    en: "The transfer slip is invalid. Please check and try again.",
  },
  "rejectReason.AMOUNT_MISMATCH": {
    lo: "ຈໍານວນເງີນທີ່ໂອນ ແລະ ເຕີມໃນລະບົບບໍ່ເທົ່າກັນ ກວດສອບ ແລະ ລອງໃໝ່",
    en: "The transferred amount does not match the deposit amount. Please check and try again.",
  },
  "rejectReason.INSUFFICIENT_BALANCE": {
    lo: "ຍອດເງີນຂອງທ່ານບໍ່ພຽງພໍທີ່ຈະຖອນ",
    en: "Your balance is insufficient for this withdrawal.",
  },
  "rejectReason.QR_ISSUE": {
    lo: "QR ຂອງທ່ານມີບັນຫາ ກາລຸນາອັບເດດ QR ໃໝ່",
    en: "There is an issue with your QR code. Please update it.",
  },

  // ─── History page ───────────────────────────────────────────────────
  "history.title": {
    lo: "ປະຫວັດການຫຼິ້ນ (ກະເປົາຈິງ)",
    en: "Play History (Real)",
  },
  "history.titleDemo": {
    lo: "ປະຫວັດການຫຼິ້ນ (ກະເປົາທົດລອງ)",
    en: "Play History (Demo)",
  },
  "history.tab.real": {
    lo: "ກະເປົາຈິງ",
    en: "REAL",
  },
  "history.tab.demo": {
    lo: "ກະເປົາທົດລອງ",
    en: "DEMO",
  },
  "history.lifetimeStats": {
    lo: "ສະຖິຕິລວມ · ກະເປົາຈິງ",
    en: "LIFETIME STATS · REAL WALLET",
  },
  "history.lifetimeStatsDemo": {
    lo: "ສະຖິຕິລວມ · ກະເປົາທົດລອງ",
    en: "LIFETIME STATS · DEMO WALLET",
  },
  "history.totalGames": { lo: "ຈຳນວນເກມ", en: "TOTAL GAMES" },
  "history.winRate": { lo: "ອັດຕາຊະນະ", en: "WIN RATE" },
  "history.netPL": { lo: "ກຳໄລ-ຂາດທຶນ", en: "NET P&L" },
  "history.empty": { lo: "ຍັງບໍ່ມີເກມ.", en: "No games played yet." },
  "history.emptyHint": { lo: "ໄປໂຍນລູກເຕົ໋າເລີຍ!", en: "Go roll some dice!" },
  "history.playNow": { lo: "ຫຼິ້ນ", en: "Play Now" },
  "history.totalBet": { lo: "ເດີມພັນທັງໝົດ", en: "Total bet" },
  "history.kind.single": { lo: "ດຽວ", en: "SINGLE" },
  "history.kind.pair": { lo: "ຄູ່", en: "PAIR" },
  "history.kind.range": { lo: "ຕໍ່າສູງ", en: "RANGE" },
  "history.modeRandom": { lo: "ຫຼິ້ນຄົນດຽວ", en: "SELF PLAY" },
  "history.modeLive": { lo: "ຖ່າຍທອດສົດ", en: "LIVE" },
  "history.filterAll": { lo: "ທັງໝົດ", en: "All" },
  "history.filterWin": { lo: "ຊະນະ", en: "Wins" },
  "history.filterLoss": { lo: "ເສຍ", en: "Losses" },
  "history.filter.result": { lo: "ຜົນ", en: "Result" },
  "history.filter.mode": { lo: "ໂໝດ", en: "Mode" },
  "history.filter.kind": { lo: "ປະເພດ", en: "Bet kind" },
  "history.filter.allResults": { lo: "ຜົນທັງໝົດ", en: "All results" },
  "history.filter.allModes": { lo: "ໂໝດທັງໝົດ", en: "All modes" },
  "history.filter.allKinds": { lo: "ປະເພດທັງໝົດ", en: "All kinds" },
  "history.won": { lo: "ຊະນະ +{amount}", en: "won +{amount}" },
  "history.lost": { lo: "ເສຍ", en: "lost" },
  "history.refunded": { lo: "ຄືນເງິນ", en: "refunded" },
  "history.win": { lo: "ຊະນະ +{amount}", en: "WIN +{amount}" },
  "history.loss": { lo: "ເສຍ -{amount}", en: "LOSS -{amount}" },
  "history.sum": { lo: "ລວມ:", en: "SUM:" },
  "history.range.low": { lo: "ຕ່ຳ", en: "LOW" },
  "history.range.middle": { lo: "ກາງ", en: "MID" },
  "history.range.high": { lo: "ສູງ", en: "HIGH" },

  // ─── Transfer ───────────────────────────────────────────────────────
  "transfer.title": { lo: "ໂອນເງິນ", en: "TRANSFER" },
  "transfer.confirmTitle": { lo: "ຢືນຢັນການໂອນ", en: "CONFIRM TRANSFER" },
  "transfer.transferCoins": { lo: "ໂອນເງິນ", en: "Transfer Coins" },
  "transfer.method": { lo: "ວິທີການ", en: "Method" },
  "transfer.methodGeneral": { lo: "ທົ່ວໄປ", en: "GENERAL" },
  "transfer.methodLocked": { lo: "ຕ້ອງມີລະຫັດ", en: "LOCKED" },
  "transfer.recipient": { lo: "ຜູ້ຮັບ", en: "RECIPIENT" },
  "transfer.code": { lo: "ລະຫັດ 6 ໂຕ", en: "6-DIGIT CODE" },
  "transfer.codeRandom": { lo: "ສຸ່ມ", en: "RANDOM" },
  "transfer.codeManual": { lo: "ປ້ອນເອງ", en: "MANUAL" },
  "transfer.regenerate": { lo: "ສຸ່ມໃໝ່", en: "Regenerate" },
  "transfer.codeHint": {
    lo: "ສົ່ງລະຫັດໃຫ້ຜູ້ຮັບແບບສ່ວນຕົວ. ລະບົບຈະບໍ່ສະແດງລະຫັດກັບຜູ້ຮັບ.",
    en: "Share this code with the recipient privately — the system never reveals it on their side.",
  },
  "transfer.shareCodeWarning": {
    lo: "⚠️ ບັນທຶກລະຫັດໄວ້ກ່ອນຢືນຢັນ — ຫຼັງສົ່ງແລ້ວ ບໍ່ສາມາດເບິ່ງໄດ້ອີກ.",
    en: "⚠️ Save this code before confirming — it is not shown again after submit.",
  },
  "transfer.confirmCta": { lo: "ຢືນຢັນການໂອນ", en: "CONFIRM TRANSFER" },
  "transfer.confirmGeneralDesc": {
    lo: "ຢືນຢັນເພື່ອຫັກເງິນຈາກກະເປົາທ່ານ ແລະ ສົ່ງໄປໃຫ້ຜູ້ຮັບທັນທີ.",
    en: "Confirm to debit your wallet and credit the recipient immediately.",
  },
  "transfer.confirmLockedDesc": {
    lo: "ເງິນຈະຖືກຫັກທັນທີ. ຜູ້ຮັບຕ້ອງປ້ອນລະຫັດຈຶ່ງຈະໄດ້ຮັບເງິນ. ທ່ານສາມາດຍົກເລີກໄດ້ກ່ອນຮັບ.",
    en: "Funds leave your wallet immediately. The recipient must enter the code to receive — you can cancel before they do.",
  },
  "transfer.errPhone": {
    lo: "ປ້ອນເບີໂທລະສັບຜູ້ຮັບ.",
    en: "Recipient phone is required.",
  },
  "transfer.errSelf": {
    lo: "ບໍ່ສາມາດໂອນຫາຕົວເອງ.",
    en: "You can't transfer to yourself.",
  },
  "transfer.errLookupFirst": {
    lo: "ກວດສອບເບີໂທຂອງຜູ້ຮັບກ່ອນ.",
    en: "Look up the recipient first.",
  },
  "transfer.errInactive": {
    lo: "ບັນຊີຜູ້ຮັບບໍ່ໄດ້ໃຊ້ງານ.",
    en: "Recipient's account is not active.",
  },
  "transfer.errNotFound": {
    lo: "ບໍ່ພົບເບີໂທນີ້.",
    en: "Phone number not found.",
  },
  "transfer.errCode": {
    lo: "ລະຫັດຕ້ອງເປັນ 6 ຕົວເລກ.",
    en: "Code must be 6 digits.",
  },
  "transfer.submitted": { lo: "ສົ່ງການໂອນແລ້ວ", en: "Transfer sent" },
  "transfer.submittedDesc": {
    lo: "ການໂອນຂອງທ່ານໄດ້ຖືກສົ່ງເຖິງຜູ້ຮັບ.",
    en: "Your transfer has been delivered.",
  },
  "transfer.pendingReceived": { lo: "ໂອນທີ່ລໍຮັບ", en: "PENDING TO RECEIVE" },
  "transfer.pendingSent": { lo: "ໂອນທີ່ລໍຄຳຢືນຢັນ", en: "PENDING (SENT)" },
  "transfer.from": { lo: "ຈາກ", en: "From" },
  "transfer.to": { lo: "ໄປ", en: "To" },
  "transfer.receive": { lo: "ຮັບ", en: "RECEIVE" },
  "transfer.cancel": { lo: "ຍົກເລີກ", en: "CANCEL" },
  "transfer.locked": { lo: "ລະຫັດຖືກລ້ອກ", en: "LOCKED" },
  "transfer.attemptsLeft": { lo: "ເຫຼືອ {n} ຄັ້ງ", en: "{n} attempt(s) left" },
  "transfer.claimTitle": { lo: "ຮັບການໂອນ", en: "CLAIM TRANSFER" },
  "transfer.claimDesc": {
    lo: "ປ້ອນລະຫັດ 6 ຕົວເລກທີ່ {sender} ສົ່ງມາໃຫ້.",
    en: "Enter the 6-digit code that {sender} shared with you.",
  },
  "transfer.claimCta": { lo: "ຮັບເງິນ", en: "CLAIM" },
  "transfer.claimed": { lo: "ຮັບການໂອນແລ້ວ", en: "Transfer claimed" },
  "transfer.claimedDesc": {
    lo: "ເງິນຖືກເພີ່ມເຂົ້າກະເປົາຂອງທ່ານແລ້ວ.",
    en: "The funds have been credited to your wallet.",
  },
  "transfer.cancelConfirmTitle": {
    lo: "ຍົກເລີກການໂອນ?",
    en: "Cancel this transfer?",
  },
  "transfer.cancelConfirmDesc": {
    lo: "ເງິນ {amount} ₭ ຈະຖືກສົ່ງຄືນເຂົ້າກະເປົາຂອງທ່ານທັນທີ.",
    en: "{amount} ₭ will be refunded to your wallet immediately.",
  },
  "transfer.cancelled": { lo: "ຍົກເລີກການໂອນແລ້ວ", en: "Transfer cancelled" },
  "transfer.cancelledDesc": {
    lo: "ເງິນຖືກສົ່ງຄືນເຂົ້າກະເປົາຂອງທ່ານ.",
    en: "The funds have been refunded to your wallet.",
  },
  "transfer.noPendingReceived": {
    lo: "ບໍ່ມີການໂອນລໍຮັບ.",
    en: "No transfers waiting for you.",
  },

  // ─── Rules page (game manual + house policy) ─────────────────────────
  "rules.headerTitle": { lo: "ກົດລະບຽບ", en: "Rules" },
  "rules.title": {
    lo: "ຄູ່ມື ແລະ ກົດລະບຽບການຫຼິ້ນເກມ (ສະບັບປັບປຸງ)",
    en: "Game manual and rules (Updated edition)",
  },
  "rules.intro": {
    lo: "ພວກເຮົາໃຫ້ບໍລິການເກມເດີມພັນ ປູ ປາ ນໍ້າເຕົ້າ ແບບອອນໄລນ໌ໄລຟ໌ສົດ (Live) ແລະ ແບບດ່ຽວ (Single Player) ຕະຫຼອດ 24 ຊົ່ວໂມງ. ເພື່ອຄວາມໂປ່ງໃສ ແລະ ຄວາມປອດໄພຂອງທຸກຝ່າຍ, ກະລຸນາອ່ານກົດລະບຽບດັ່ງລຸ່ມນີ້:",
    en: "We provide the Pu-Pa-Tao (Crab-Fish-Gourd) betting game online — both live (Live) and single-player modes — 24 hours a day. For transparency and the safety of everyone, please read the rules below:",
  },

  // Section 1
  "rules.s1.title": {
    lo: "1. ຮູບແບບການເດີມພັນ ແລະ ອັດຕາຈ່າຍ",
    en: "1. Betting modes and payout rates",
  },
  "rules.s1.b1.label": { lo: "ການເດີມພັນ", en: "Betting modes" },
  "rules.s1.b1.text": {
    lo: "ມີ 2 ແບບຄື: ໄລຟ໌ສົດເວລາຈິງ ແລະ ແບບຫຼິ້ນດ່ຽວ (ລູກຄ້າຂະເຫຍ້າເອງ).",
    en: "Two modes: real-time live, and single-player (the customer rolls themselves).",
  },
  "rules.s1.b2.label": { lo: "ວົງເງິນ", en: "Stake limits" },
  "rules.s1.b2.before": {
    lo: "ຂັ້ນຕ່ຳ 1,000₭ ແລະ",
    en: "Minimum 1,000₭ and",
  },
  "rules.s1.b2.highlight": {
    lo: "ສູງສຸດບໍ່ເກີນ 1,000,000₭ ຕໍ່ຮອບ.",
    en: "maximum 1,000,000₭ per round.",
  },
  "rules.s1.b3.label": { lo: "ອັດຕາການຈ່າຍ", en: "Payout rates" },
  "rules.s1.b3a.label": {
    lo: "ວາງດ່ຽວ / ຄະແນນຕ່ຳ-ສູງ",
    en: "Single bet / Low-High range",
  },
  "rules.s1.b3a.text": { lo: "ອັດຕາ 1 : 1", en: "Pays 1 : 1" },
  "rules.s1.b3b.label": {
    lo: "ວາງຄູ່ (ວາງຕັດ) / ຄະແນນກາງ",
    en: "Pair bet / Middle range",
  },
  "rules.s1.b3b.text": { lo: "ອັດຕາ 1 : 5", en: "Pays 1 : 5" },

  // Section 2
  "rules.s2.title": {
    lo: "2. ນະໂຍບາຍການຄືນເງິນ (Refund Policy)",
    en: "2. Refund Policy",
  },
  "rules.s2.b1.label": {
    lo: "ການເສຍຈາກການຫຼິ້ນ",
    en: "Losses from gameplay",
  },
  "rules.s2.b1.before": { lo: "ລະບົບຈະ", en: "The system has" },
  "rules.s2.b1.bold": { lo: "ບໍ່ມີການຄືນເງິນ (No Refund)", en: "No Refund" },
  "rules.s2.b1.after": {
    lo: "ໃນທຸກກໍລະນີທີ່ຜົນອອກຕາມກະຕິກາ ແຕ່ຜູ້ຫຼິ້ນວາງເດີມພັນຜິດພາດ ຫຼື ເສຍຕາມດວງ. ຖືວ່າການຕັດສິນໃຈວາງເດີມພັນເປັນຄວາມຮັບຜິດຊອບຂອງຜູ້ຫຼິ້ນເອງ.",
    en: "in any case where the result is delivered correctly under the rules but the player bet incorrectly or simply lost. Every betting decision is the player's own responsibility.",
  },
  "rules.s2.b2.label": {
    lo: "ຄວາມຜິດພາດຈາກລະບົບ",
    en: "Errors from our system",
  },
  "rules.s2.b2.before": { lo: "ທາງເຮົາຈະພິຈາລະນາ", en: "We will consider a" },
  "rules.s2.b2.bold": {
    lo: "ຄືນເງິນ ຫຼື ຊົດເຊີຍ",
    en: "refund or compensation",
  },
  "rules.s2.b2.after": {
    lo: "ໃຫ້ສະເພາະກໍລະນີທີ່ເກີດຈາກຄວາມຜິດພາດຂອງພະນັກງານ (Staff Error) ຫຼື ລະບົບຂັດຂ້ອງ (System Glitch) ທີ່ສົ່ງຜົນກະທົບຕໍ່ຜົນຂອງເກມຢ່າງຊັດເຈນເທົ່ານັ້ນ.",
    en: "only in cases caused by staff error or a system glitch that demonstrably affected the result of a game.",
  },

  // Section 3
  "rules.s3.title": {
    lo: "3. ມາດຕະການຄວາມປອດໄພ ແລະ ການກວດສອບ (Anti-Fraud)",
    en: "3. Security and Anti-Fraud measures",
  },
  "rules.s3.b1.label": { lo: "ການກວດສອບ", en: "Monitoring" },
  "rules.s3.b1.before": {
    lo: "ລະບົບມີຊ່ວຍງານກວດສອບພຶດຕິກຳການຫຼິ້ນຕະຫຼອດເວລາ. ຫາກກວດພົບການກະທຳທີ່",
    en: "Our system monitors gameplay behaviour at all times. If any",
  },
  "rules.s3.b1.bold": {
    lo: "ບໍ່ປົກກະຕິ (Abnormal Activity)",
    en: "abnormal activity",
  },
  "rules.s3.b1.after": {
    lo: ", ການໃຊ້ໂປຣແກຣມຊ່ວຍຫຼິ້ນ, ການແຮັກລະບົບ, ຫຼື ການສ້າງໂກງໃນຮູບແບບຕ່າງໆ.",
    en: ", use of bots/assist programs, system hacking, or any form of cheating is detected, action will follow.",
  },
  "rules.s3.b2.label": { lo: "ການລົງໂທດ", en: "Penalties" },
  "rules.s3.b2.before": {
    lo: "ຫາກພົບການທຸຈະລິດ, ທາງເຮົາຈະ",
    en: "Where fraud is found, we will",
  },
  "rules.s3.b2.bold": {
    lo: "ສັ່ງປິດບັນຊີ (Ban) ຖາວອນທັນທີ",
    en: "permanently ban the account immediately",
  },
  "rules.s3.b2.after": {
    lo: "ໂດຍບໍ່ຕ້ອງແຈ້ງໃຫ້ຊາບລ່ວງໜ້າ.",
    en: "without prior notice.",
  },
  "rules.s3.b3.label": { lo: "ການອາຍັດເງິນ", en: "Funds freeze" },
  "rules.s3.b3.before": {
    lo: "ໃນກໍລະນີທີ່ກວດພົບການທຸຈະລິດທີ່ຊັດເຈນ, ເງິນທັງໝົດໃນບັນຊີຈະຖືກ",
    en: "Where clear fraud is found, all funds in the account will be",
  },
  "rules.s3.b3.boldA": { lo: "Freeze (ອາຍັດ)", en: "frozen" },
  "rules.s3.b3.middle": { lo: "ແລະ ຈະ", en: "and there will be" },
  "rules.s3.b3.boldB": {
    lo: "ບໍ່ມີການໂອນຄືນ",
    en: "no return of funds",
  },
  "rules.s3.b3.after": {
    lo: "ໃຫ້ໃນທຸກກໍລະນີ.",
    en: "in any case.",
  },

  // Section 4
  "rules.s4.title": {
    lo: "4. ໂປຣໂມຊັ່ນ ແລະ ໂບນັດ",
    en: "4. Promotions and Bonuses",
  },
  "rules.s4.b1.label": { lo: "ສະມາຊິກໃໝ່", en: "New members" },
  "rules.s4.b1.text": {
    lo: "ເຕີມຄັ້ງທຳອິດ 100,000₭ ຮັບເພີ່ມ 20,000₭ | 500,000₭ ຮັບເພີ່ມ 50,000₭ | 1,000,000₭ ຮັບເພີ່ມ 100,000₭ (ເງີນທີ່ໄດ້ຈາກການເຕີມນີ້ຈະສາມາດໃຊ້ໃນການຫລີ້ນ ແລະ ສ້າງກຳໄລໄດ້ເທົ່ານັ້ນ, ບໍ່ສາມາດຖອນອອກໄດ້ໂດຍກົງ).",
    en: "First top-up bonuses: 100,000₭ → +20,000₭ | 500,000₭ → +50,000₭ | 1,000,000₭ → +100,000₭.",
  },
  "rules.s4.b2.label": { lo: "ແນະນຳໝູ່", en: "Refer a friend" },
  "rules.s4.b2.text": {
    lo: "ໝູ່ເຕີມເງິນຄັ້ງທຳອິດ ຮັບທັນທີ 10,000₭ (ຖອນໄດ້ທັນທີ ຫຼື ໃຊ້ຫຼິ້ນຕໍ່).",
    en: "When your invited friend completes their first top-up, you get 10,000₭ instantly (withdrawable or playable).",
  },

  // Warning
  "rules.warningLabel": { lo: "ຄຳເຕືອນ", en: "Warning" },
  "rules.warningText": {
    lo: 'ທຸກການເດີມພັນມີຄວາມສ່ຽງ. ພວກເຮົາຂໍແນະນຳໃຫ້ທ່ານ ບໍ່ນຳ "ເງິນຮ້ອນ" ຫຼື ເງິນທີ່ຈຳເປັນຕໍ່ການດຳລົງຊີວິດມາຫຼິ້ນ. ທາງລະບົບຈະຖືວ່າທ່ານໄດ້ຍອມຮັບເງື່ອນໄຂທັງໝົດນີ້ແລ້ວເມື່ອເລີ່ມຕົ້ນວາງເດີມພັນ.',
    en: 'Every bet carries risk. We recommend you do not stake "hot money" or money needed for daily living. By placing a bet you are deemed to have accepted all of these terms.',
  },
} as const;

export type StringKey = keyof typeof STRINGS;
type Vars = Record<string, string | number>;

export function t(locale: Locale, key: StringKey, vars?: Vars): string {
  const entry = STRINGS[key];
  let s: string = entry?.[locale] ?? entry?.en ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

export function isLocale(v: unknown): v is Locale {
  return v === "lo" || v === "en";
}

// Cookie helpers (safe to import on the client too — no Node-only deps).
export function parseLocaleCookie(cookieHeader: string | null): Locale {
  if (!cookieHeader) return DEFAULT_LOCALE;
  for (const raw of cookieHeader.split(";")) {
    const eq = raw.indexOf("=");
    if (eq < 0) continue;
    const k = raw.slice(0, eq).trim();
    const v = raw.slice(eq + 1).trim();
    if (k === LOCALE_COOKIE && isLocale(v)) return v;
  }
  return DEFAULT_LOCALE;
}

export function buildLocaleCookie(locale: Locale): string {
  const oneYear = 60 * 60 * 24 * 365;
  const attrs = [
    `${LOCALE_COOKIE}=${locale}`,
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${oneYear}`,
  ];
  if (
    typeof process !== "undefined" &&
    process.env?.NODE_ENV === "production"
  ) {
    attrs.push("Secure");
  }
  return attrs.join("; ");
}
