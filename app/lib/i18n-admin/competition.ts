// Admin-only i18n strings for the Demo Competition control panel and its
// history detail page. Namespace: "admin.competition.*" — owned exclusively
// by this file. Merged into app/lib/i18n.ts's STRINGS dict by hand.
export const ADMIN_COMPETITION_STRINGS = {
  // ─── Type labels (radio options + badges) ───────────────────────────
  "admin.competition.type.demoLive.label": { lo: "🎮 Demo → ສະເພາະ Live", en: "🎮 Demo → Live only" },
  "admin.competition.type.demoLive.desc": {
    lo: "ຈັດອັນດັບຕາມຍອດ Demo. ເງິນ Demo ຈະຖືກເຊື່ອງຈາກໂໝດຫຼິ້ນດ່ຽວ.",
    en: "Ranks by Demo balance. Demo hidden from self-play.",
  },
  "admin.competition.type.realLive.label": { lo: "💰 Real → ສະເພາະ Live", en: "💰 Real → Live only" },
  "admin.competition.type.realLive.desc": {
    lo: "ຈັດອັນດັບຕາມຍອດ Real. ເງິນ Real ຈະຖືກເຊື່ອງຈາກໂໝດຫຼິ້ນດ່ຽວ.",
    en: "Ranks by Real balance. Real hidden from self-play.",
  },
  "admin.competition.type.realAll.label": { lo: "💰 Real → Live + Self", en: "💰 Real → Live + Self" },
  "admin.competition.type.realAll.desc": {
    lo: "ຈັດອັນດັບຕາມຍອດ Real. ໃຊ້ເງິນ Real ໄດ້ທຸກໂໝດ.",
    en: "Ranks by Real balance. Real available everywhere.",
  },
  // Short type label used in the history list (table + mobile cards)
  "admin.competition.type.short.demoLive": { lo: "Demo", en: "Demo" },
  "admin.competition.type.short.realLive": { lo: "Real ສະເພາະ Live", en: "Real Live" },
  "admin.competition.type.short.realAll": { lo: "Real ທຸກໂໝດ", en: "Real All" },

  // ─── Action errors ───────────────────────────────────────────────────
  "admin.competition.err.insufficientPermissions": { lo: "ສິດການນຳໃຊ້ບໍ່ພຽງພໍ", en: "Insufficient permissions" },
  "admin.competition.err.userIdRequired": { lo: "ຕ້ອງລະບຸ userId", en: "userId required" },
  "admin.competition.err.unknownOp": { lo: "ບໍ່ຮູ້ຈັກຄຳສັ່ງນີ້", en: "Unknown op" },

  // ─── Page header ─────────────────────────────────────────────────────
  "admin.competition.title": { lo: "ການແຂ່ງຂັນ Demo", en: "Demo Competition" },
  "admin.competition.playersCount": { lo: "{n} ຜູ້ຫຼິ້ນ", en: "{n} players" },

  // ─── Blank slate (no competition configured) ─────────────────────────
  "admin.competition.blank.title": { lo: "ບໍ່ມີການແຂ່ງຂັນທີ່ກຳລັງດຳເນີນ", en: "No active competition" },
  "admin.competition.blank.subtitle": { lo: "ສ້າງການແຂ່ງຂັນໃໝ່ເພື່ອເລີ່ມຕົ້ນ.", en: "Create a new competition to get started." },
  "admin.competition.blank.newButton": { lo: "ການແຂ່ງຂັນໃໝ່", en: "New Competition" },

  // ─── Config form ──────────────────────────────────────────────────────
  "admin.competition.form.typeLabel": { lo: "ປະເພດການແຂ່ງຂັນ", en: "COMPETITION TYPE" },
  "admin.competition.form.rulesLabel": { lo: "ກົດລະບຽບ / ລາຍລະອຽດ", en: "RULES / DESCRIPTION" },
  "admin.competition.form.rulesPlaceholder": { lo: "ປ້ອນກົດລະບຽບການແຂ່ງຂັນ…", en: "Enter competition rules…" },
  "admin.competition.form.startLabel": { lo: "ເລີ່ມ (GMT+7)", en: "START (GMT+7)" },
  "admin.competition.form.endLabel": { lo: "ສິ້ນສຸດ (GMT+7)", en: "END (GMT+7)" },
  "admin.competition.form.cancel": { lo: "ຍົກເລີກ", en: "Cancel" },
  "admin.competition.form.create": { lo: "ສ້າງການແຂ່ງຂັນ", en: "Create Competition" },
  "admin.competition.form.saveChanges": { lo: "ບັນທຶກການປ່ຽນແປງ", en: "Save Changes" },

  // ─── Past competitions list ───────────────────────────────────────────
  "admin.competition.history.heading": { lo: "ການແຂ່ງຂັນທີ່ຜ່ານມາ ({n})", en: "PAST COMPETITIONS ({n})" },
  "admin.competition.history.col.detail": { lo: "ລາຍລະອຽດແຄມເປນ", en: "CAMPAIGN DETAIL" },
  "admin.competition.history.col.type": { lo: "ປະເພດ", en: "TYPE" },
  "admin.competition.history.col.startDate": { lo: "ວັນທີເລີ່ມ", en: "START DATE" },
  "admin.competition.history.col.endDate": { lo: "ວັນທີສິ້ນສຸດ", en: "END DATE" },
  "admin.competition.history.col.applicants": { lo: "ຜູ້ເຂົ້າຮ່ວມ", en: "APPLICANTS" },
  "admin.competition.history.col.status": { lo: "ສະຖານະ", en: "STATUS" },
  "admin.competition.history.fallbackDetail": { lo: "ການແຂ່ງຂັນ #{n}", en: "Competition #{n}" },
  "admin.competition.history.completed": { lo: "ສຳເລັດແລ້ວ", en: "Completed" },
  "admin.competition.history.view": { lo: "ເບິ່ງ →", en: "View →" },
  "admin.competition.history.mobileSummary": { lo: "{type} · {n} ຜູ້ເຂົ້າຮ່ວມ · {date}", en: "{type} · {n} participants · {date}" },

  // ─── Active/stopped competition control panel ────────────────────────
  "admin.competition.status.running": { lo: "ກຳລັງດຳເນີນ", en: "STARTED" },
  "admin.competition.status.summarized": { lo: "ສະຫຼຸບແລ້ວ ✓", en: "SUMMARIZED ✓" },
  "admin.competition.status.stopped": { lo: "ຢຸດແລ້ວ", en: "STOPPED" },
  "admin.competition.resetAllDemo": { lo: "ຣີເຊັດ Demo ທັງໝົດ", en: "Reset All Demo" },
  "admin.competition.configure": { lo: "ຕັ້ງຄ່າ", en: "Configure" },
  "admin.competition.summary.title.stopFirst": { lo: "ກະລຸນາຢຸດການແຂ່ງຂັນກ່ອນ", en: "Stop the competition first" },
  "admin.competition.summary.title.startFirst": { lo: "ກະລຸນາເລີ່ມການແຂ່ງຂັນກ່ອນ", en: "Start the competition first" },
  "admin.competition.summary.title.snapshot": { lo: "ບັນທຶກອັນດັບ 3 ອັນດັບຫຼ້າສຸດເປັນຜູ້ຊະນະສຸດທ້າຍ", en: "Snapshot current top 3 as final winners" },
  "admin.competition.summary.resummarize": { lo: "ສະຫຼຸບໃໝ່", en: "Re-summarize" },
  "admin.competition.summary.button": { lo: "ສະຫຼຸບ", en: "Summary" },
  "admin.competition.end.title.summarizeFirst": { lo: "ກະລຸນາສະຫຼຸບກ່ອນ", en: "Take a summary first" },
  "admin.competition.end.title.endAndSave": { lo: "ສິ້ນສຸດ ແລະ ບັນທຶກໄວ້ໃນປະຫວັດ", en: "End and save to history" },
  "admin.competition.end.button": { lo: "ສິ້ນສຸດການແຂ່ງຂັນ", en: "End Competition" },
  "admin.competition.stop": { lo: "⏹ ຢຸດ", en: "⏹ Stop" },
  "admin.competition.start": { lo: "▶ ເລີ່ມ", en: "▶ Start" },

  // ─── Final top-3 snapshot ─────────────────────────────────────────────
  "admin.competition.finalSnapshot.heading": { lo: "ສະຫຼຸບ 3 ອັນດັບສຸດທ້າຍ", en: "FINAL TOP 3 SNAPSHOT" },

  // ─── Participants panel (Type B/C only) ───────────────────────────────
  "admin.competition.participants.heading": { lo: "ຜູ້ເຂົ້າຮ່ວມ ({n})", en: "PARTICIPANTS ({n})" },
  "admin.competition.participants.subheading": { lo: "ຜູ້ໃຊ້ທີ່ເຂົ້າຮ່ວມການແຂ່ງຂັນນີ້", en: "Users who joined this competition" },
  "admin.competition.participants.empty": { lo: "ຍັງບໍ່ມີຜູ້ເຂົ້າຮ່ວມ. ຜູ້ໃຊ້ສາມາດເຂົ້າຮ່ວມໄດ້ຈາກໜ້າ /competition.", en: "No participants yet. Users join from the /competition page." },
  "admin.competition.participants.removeTitle": { lo: "ລຶບອອກຈາກການແຂ່ງຂັນ", en: "Remove from competition" },
  "admin.competition.participants.remove": { lo: "ລຶບ", en: "Remove" },

  // ─── Ranking table ─────────────────────────────────────────────────────
  "admin.competition.ranking.col.rank": { lo: "ອັນດັບ", en: "RANK" },
  "admin.competition.ranking.col.player": { lo: "ຜູ້ຫຼິ້ນ", en: "PLAYER" },
  "admin.competition.ranking.col.phone": { lo: "ເບີໂທ", en: "PHONE" },
  "admin.competition.ranking.col.joined": { lo: "ສະໝັກເມື່ອ", en: "JOINED" },
  "admin.competition.ranking.col.totalBets": { lo: "ຍອດເດີມພັນທັງໝົດ", en: "TOTAL BETS" },
  "admin.competition.ranking.col.balance": { lo: "ຍອດ {wallet}", en: "{wallet} BALANCE" },
  "admin.competition.ranking.empty": { lo: "ຍັງບໍ່ມີຜູ້ຫຼິ້ນ.", en: "No players yet." },
  "admin.competition.ranking.betsShort": { lo: "ເດີມພັນ {amount}", en: "bets {amount}" },

  // ─── Reset confirmation modal ──────────────────────────────────────────
  "admin.competition.resetConfirm.title": { lo: "ຣີເຊັດກະເປົາ Demo ທັງໝົດ?", en: "Reset All Demo Wallets?" },
  "admin.competition.resetConfirm.body": {
    lo: "ຍອດ Demo ຂອງທຸກຜູ້ໃຊ້ຈະຖືກຕັ້ງເປັນ {amount} ₭ ແບບທັນທີ.",
    en: "Every user's demo balance will be set to {amount} ₭ in real-time.",
  },
  "admin.competition.resetConfirm.cancel": { lo: "ຍົກເລີກ", en: "Cancel" },
  "admin.competition.resetConfirm.confirming": { lo: "ກຳລັງຣີເຊັດ…", en: "Resetting…" },
  "admin.competition.resetConfirm.confirm": { lo: "ແມ່ນ, ຣີເຊັດທັງໝົດ", en: "Yes, Reset All" },

  // ─── End competition confirmation modal ────────────────────────────────
  "admin.competition.endConfirm.title": { lo: "ສິ້ນສຸດການແຂ່ງຂັນ?", en: "End Competition?" },
  "admin.competition.endConfirm.body": {
    lo: "ສະຫຼຸບ 3 ອັນດັບຈະຖືກ {saved}. ການຕັ້ງຄ່າທັງໝົດຂອງການແຂ່ງຂັນຈະຖືກລ້າງ ແລະ ຜູ້ໃຊ້ຈະເຫັນໜ້າຜົນການແຂ່ງຂັນ.",
    en: "The top 3 snapshot will be {saved}. All competition settings will be cleared and users will see the results page.",
  },
  "admin.competition.endConfirm.savedToHistory": { lo: "ບັນທຶກໄວ້ໃນປະຫວັດ", en: "saved to history" },
  "admin.competition.endConfirm.cancel": { lo: "ຍົກເລີກ", en: "Cancel" },
  "admin.competition.endConfirm.confirming": { lo: "ກຳລັງສິ້ນສຸດ…", en: "Ending…" },
  "admin.competition.endConfirm.confirm": { lo: "ແມ່ນ, ສິ້ນສຸດການແຂ່ງຂັນ", en: "Yes, End Competition" },

  // ─── History detail page ($id.tsx) ─────────────────────────────────────
  "admin.competition.detail.notFound": { lo: "ບໍ່ພົບຂໍ້ມູນ", en: "Not found" },
  "admin.competition.detail.competitionNotFound": { lo: "ບໍ່ພົບການແຂ່ງຂັນ", en: "Competition not found" },
  "admin.competition.detail.back": { lo: "ກັບຄືນ", en: "Back" },
  "admin.competition.detail.title": { lo: "ລາຍລະອຽດການແຂ່ງຂັນ", en: "Competition Detail" },

  // Meta grid labels
  "admin.competition.detail.meta.type": { lo: "ປະເພດ", en: "TYPE" },
  "admin.competition.detail.meta.start": { lo: "ເລີ່ມ", en: "START" },
  "admin.competition.detail.meta.end": { lo: "ສິ້ນສຸດ", en: "END" },
  "admin.competition.detail.meta.totalParticipants": { lo: "ຜູ້ເຂົ້າຮ່ວມທັງໝົດ", en: "TOTAL PARTICIPANTS" },
  "admin.competition.detail.completed": { lo: "ສຳເລັດແລ້ວ", en: "Completed" },
  "admin.competition.detail.archivedOn": { lo: "ບັນທຶກໄວ້ເມື່ອ {date}", en: "Archived on {date}" },

  // Admin trail labels
  "admin.competition.detail.trail.configuredBy": { lo: "ຕັ້ງຄ່າໂດຍ", en: "CONFIGURED BY" },
  "admin.competition.detail.trail.startedBy": { lo: "ເລີ່ມໂດຍ", en: "STARTED BY" },
  "admin.competition.detail.trail.endedBy": { lo: "ສິ້ນສຸດໂດຍ", en: "ENDED BY" },

  // Winners section
  "admin.competition.detail.winners.heading": { lo: "3 ອັນດັບຜູ້ຊະນະ", en: "TOP 3 WINNERS" },
  "admin.competition.detail.winners.rank": { lo: "ອັນດັບ #{n}", en: "Rank #{n}" },
  "admin.competition.detail.winners.empty": { lo: "ບໍ່ມີຜູ້ຊະນະທີ່ບັນທຶກໄວ້ສຳລັບການແຂ່ງຂັນນີ້.", en: "No winners were recorded for this competition." },
} as const
