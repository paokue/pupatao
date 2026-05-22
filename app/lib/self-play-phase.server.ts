// Self-play adversarial phase management.
//
// Phase ladder (REAL/PROMO only; DEMO always stays at its fixed 60 % tier):
//
//  NORMAL    → 50 % win / 50 % lose
//    ↓ triggered when netProfit ≥ threshold based on latest deposit tier
//  PHASE_A   → 10 % win / 90 % lose   (phaseEntryBalance recorded here)
//    ↓ triggered when balance ≤ 10 % of phaseEntryBalance
//  PHASE_B   → 30 % win / 70 % lose
//    ↓ triggered when balance ≥ 50 % of phaseEntryBalance
//  PHASE_C   →  5 % win / 95 % lose   (until all lost)
//
//  ADMIN_LOCKED → 0 % win (always lose); only admin can clear this.
//
// Reset rules:
//  · Natural phase reset: new deposit ≥ 50 000 ₭ resets phase to NORMAL
//    (handled by getPlayerGameState returning the latest qualifying deposit).
//  · Admin-locked users: NEVER auto-reset; admin must manually unlock.

import type { SelfPlayPhase } from '@prisma/client'
import { prisma } from './prisma.server'

export interface PhaseState {
  phase: SelfPlayPhase
  phaseEntryBalance: number | null
}

// Evaluate whether the phase should advance given the current game state,
// persist any transition to DB, and return the phase to use for this round.
export async function resolveAndAdvancePhase(
  userId: string,
  current: PhaseState,
  currentBalance: number,   // current wallet balance (₭)
  netProfit: number,        // net profit since last qualifying deposit
  lastDepositAmount: number, // amount of last qualifying deposit (≥ 50 000 ₭)
): Promise<PhaseState> {
  const { phase, phaseEntryBalance } = current

  // Admin lock is never touched automatically.
  if (phase === 'ADMIN_LOCKED') return current

  let newPhase = phase
  let newEntryBalance = phaseEntryBalance

  if (phase === 'NORMAL') {
    if (lastDepositAmount > 0) {
      // Phase A trigger threshold — based on latest deposit size:
      //   ≥ 200 000 ₭       → trigger when netProfit ≥ 200 000 (absolute)
      //   100 000–199 999 ₭ → trigger when netProfit ≥ 100 % of deposit (1×)
      //    50 000– 99 999 ₭ → trigger when netProfit ≥ 120 % of deposit (1.2×)
      //    30 000– 49 999 ₭ → trigger when netProfit ≥ 200 % of deposit (2×)
      //         < 30 000 ₭  → trigger when netProfit ≥ 300 % of deposit (3×)
      let threshold: number
      if (lastDepositAmount >= 200_000) {
        threshold = 200_000
      } else if (lastDepositAmount >= 100_000) {
        threshold = lastDepositAmount          // 100 % profit
      } else if (lastDepositAmount >= 50_000) {
        threshold = Math.round(lastDepositAmount * 1.2)  // 120 % profit
      } else if (lastDepositAmount >= 30_000) {
        threshold = lastDepositAmount * 2      // 200 % profit
      } else {
        threshold = lastDepositAmount * 3      // 300 % profit
      }
      if (netProfit >= threshold) {
        newPhase = 'PHASE_A'
        newEntryBalance = currentBalance
      }
    }
  } else if (phase === 'PHASE_A') {
    if (phaseEntryBalance && currentBalance <= Math.floor(phaseEntryBalance * 0.10)) {
      newPhase = 'PHASE_B'
      // Keep phaseEntryBalance — it stays as the reference throughout all phases.
    }
  } else if (phase === 'PHASE_B') {
    if (phaseEntryBalance && currentBalance >= Math.floor(phaseEntryBalance * 0.50)) {
      newPhase = 'PHASE_C'
    }
  }
  // PHASE_C has no further automatic transition.

  // Persist if anything changed.
  if (newPhase !== phase || newEntryBalance !== phaseEntryBalance) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        selfPlayPhase: newPhase,
        selfPlayPhaseBalance: newEntryBalance,
      },
    })
  }

  return { phase: newPhase, phaseEntryBalance: newEntryBalance }
}

// Admin helpers —————————————————————————————————————————

export async function adminLockPlayer(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { selfPlayPhase: 'ADMIN_LOCKED' },
  })
}

export async function adminUnlockPlayer(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { selfPlayPhase: 'NORMAL', selfPlayPhaseBalance: null },
  })
}
