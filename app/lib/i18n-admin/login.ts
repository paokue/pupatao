// Admin login page strings. Namespace: "admin.login.*"
// Merged into app/lib/i18n.ts's STRINGS dict by the integrator.

export const ADMIN_LOGIN_STRINGS = {
  "admin.login.badge": { lo: "ແອັດມິນ · ເຂົ້າສູ່ລະບົບ", en: "ADMIN · SIGN IN" },
  "admin.login.emailLabel": { lo: "ອີເມວ", en: "Email" },
  "admin.login.passwordLabel": { lo: "ລະຫັດຜ່ານ", en: "Password" },
  "admin.login.signingIn": { lo: "ກຳລັງເຂົ້າສູ່ລະບົບ…", en: "Signing in…" },
  "admin.login.signIn": { lo: "ເຂົ້າສູ່ລະບົບ", en: "SIGN IN" },

  "admin.login.error.required": { lo: "ກະລຸນາປ້ອນອີເມວ ແລະ ລະຫັດຜ່ານ.", en: "Email and password are required." },
  "admin.login.error.invalidCredentials": { lo: "ອີເມວ ຫຼື ລະຫັດຜ່ານບໍ່ຖືກຕ້ອງ.", en: "Invalid email or password." },
  "admin.login.error.accountInactive": { lo: "ບັນຊີແອັດມິນນີ້ບໍ່ໄດ້ເປີດໃຊ້ງານ.", en: "Admin account is not active." },
  "admin.login.error.dbUnreachable": { lo: "ບໍ່ສາມາດເຊື່ອມຕໍ່ຖານຂໍ້ມູນໄດ້. ກະລຸນາລອງໃໝ່ໃນໄວໆນີ້.", en: "Cannot reach the database. Try again in a moment." },
  "admin.login.error.generic": { lo: "ມີຂໍ້ຜິດພາດເກີດຂຶ້ນ. ກະລຸນາລອງໃໝ່.", en: "Something went wrong. Please try again." },
} as const
