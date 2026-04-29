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

  // ─── Wallet page ─────────────────────────────────────────────────────
  "wallet.title": { lo: "ກະເປົາເງິນ", en: "Wallet" },
  "wallet.totalAvailable": { lo: "ຍອດທີ່ມີ", en: "TOTAL AVAILABLE" },
  "wallet.realWallet": { lo: "ກະເປົາຈິງ", en: "Real wallet" },
  "wallet.totalDeposit": { lo: "ຝາກທັງໝົດ", en: "TOTAL DEPOSIT" },
  "wallet.totalWithdraw": { lo: "ຖອນທັງໝົດ", en: "TOTAL WITHDRAW" },
  "wallet.tab.deposit": { lo: "ຝາກ", en: "Deposit" },
  "wallet.tab.withdraw": { lo: "ຖອນ", en: "Withdraw" },
  "wallet.tab.transfer": { lo: "ໂອນ", en: "Transfer" },
  "wallet.depositCoins": { lo: "ຝາກຫຼຽນ", en: "Deposit Coins" },
  "wallet.withdrawCoins": { lo: "ຖອນຫຼຽນ", en: "Withdraw Coins" },
  "wallet.customAmount": { lo: "ຈຳນວນກຳນົດເອງ", en: "Custom amount" },
  "wallet.enterAmount": { lo: "ໃສ່ຈຳນວນ…", en: "Enter amount…" },
  "wallet.transferComingSoon": {
    lo: "ການໂອນກຳລັງຈະມາໄວໆນີ້.",
    en: "Transfer is coming soon.",
  },
  "wallet.history.deposit": { lo: "ປະຫວັດການຝາກ", en: "DEPOSIT HISTORY" },
  "wallet.history.withdraw": { lo: "ປະຫວັດການຖອນ", en: "WITHDRAW HISTORY" },
  "wallet.history.transfer": { lo: "ປະຫວັດການໂອນ", en: "TRANSFER HISTORY" },
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
  "menu.walletDesc": { lo: "ຝາກແລະຖອນຫຼຽນ", en: "Deposit & withdraw coins" },
  "menu.playHistory": { lo: "ປະຫວັດການຫຼິ້ນ", en: "Play History" },
  "menu.playHistoryDesc": {
    lo: "ເບິ່ງປະຫວັດເກມຂອງທ່ານ",
    en: "View your game records",
  },
  "menu.profile": { lo: "ໂປຣໄຟລ໌ຜູ້ໃຊ້", en: "User Profile" },
  "menu.profileDesc": { lo: "ແກ້ໄຂຂໍ້ມູນຂອງທ່ານ", en: "Edit your information" },
  "menu.loggedIn": { lo: "ເຂົ້າສູ່ລະບົບແລ້ວ", en: "Logged in" },
  "menu.language": { lo: "ພາສາ", en: "Language" },

  // ─── Game board action buttons ───────────────────────────────────────
  "game.custom": { lo: "ໃສ່ຈໍານວນເອງ", en: "CUSTOM" },
  "game.undo": { lo: "ກັບຄືນ", en: "UNDO" },
  "game.roll": { lo: "ຫຼີ້ນ", en: "ROLL" },
  "game.okay": { lo: "ຕົກລົງ", en: "OKAY" },
  "game.waiting": { lo: "ກຳລັງລໍ", en: "WAITING" },

  // ─── Custom chip amount modal ────────────────────────────────────────
  "chip.customTitle": { lo: "ໃສ່ຈຳນວນເອງ", en: "Custom Chip Amount" },
  "chip.customHint": {
    lo: "ໃສ່ຈຳນວນໃດກໍໄດ້ ຕັ້ງແຕ່ {min} ຫາ {max} ₭.",
    en: "Enter any amount from {min} up to {max} ₭.",
  },
  "chip.customPlaceholder": { lo: "{min} – {max}", en: "{min} – {max}" },
  "chip.customPreview": { lo: "ຕົວຢ່າງ: {amount} ₭", en: "Preview: {amount} ₭" },
  "chip.setChip": { lo: "ຕັ້ງເຫຼຽນ", en: "Set Chip" },

  // ─── LIVE-mode status badges + waiting messages ──────────────────────
  "live.statusBetting": { lo: "⏱ {n}s ຮັບແທງ", en: "⏱ {n}s BETTING" },
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
    lo: "🔒 ປິດການແທງແລ້ວ — ຜູ້ດໍາເນີນກຳລັງໃສ່ຜົນ.",
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
  "result.titleLive": { lo: "ຜົນຮອບສົດ", en: "LIVE ROUND RESULT" },
  "result.youWin": { lo: "🎉 ທ່ານຊະນະ!", en: "🎉 YOU WIN!" },
  "result.youLost": { lo: "💔 ທ່ານແພ້", en: "💔 YOU LOST" },
  "result.breakEven": { lo: "ເສີມຍອດ", en: "BREAK EVEN" },
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

  // ─── History page ───────────────────────────────────────────────────
  "history.title": {
    lo: "ປະຫວັດການຫຼິ້ນ (ກະເປົາຈິງ)",
    en: "Play History (Real)",
  },
  "history.lifetimeStats": {
    lo: "ສະຖິຕິລວມ · ກະເປົາຈິງ",
    en: "LIFETIME STATS · REAL WALLET",
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
  "history.win": { lo: "ຊະນະ +{amount}", en: "WIN +{amount}" },
  "history.loss": { lo: "ເສຍ -{amount}", en: "LOSS -{amount}" },
  "history.sum": { lo: "ລວມ:", en: "SUM:" },
  "history.range.low": { lo: "ຕ່ຳ", en: "LOW" },
  "history.range.middle": { lo: "ກາງ", en: "MID" },
  "history.range.high": { lo: "ສູງ", en: "HIGH" },

  // ─── Transfer ───────────────────────────────────────────────────────
  "transfer.title": { lo: "ໂອນເງິນ", en: "TRANSFER" },
  "transfer.confirmTitle": { lo: "ຢືນຢັນການໂອນ", en: "CONFIRM TRANSFER" },
  "transfer.transferCoins": { lo: "ໂອນຫຼຽນ", en: "Transfer Coins" },
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
