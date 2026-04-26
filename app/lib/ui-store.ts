import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface UIState {
  balanceHidden: boolean
  toggleBalanceHidden: () => void
  setBalanceHidden: (hidden: boolean) => void
}

// Client-only UI preferences (hide/show balance, etc.). Persisted to localStorage.
export const useUIStore = create<UIState>()(
  persist(
    set => ({
      balanceHidden: false,
      toggleBalanceHidden: () => set(s => ({ balanceHidden: !s.balanceHidden })),
      setBalanceHidden: hidden => set({ balanceHidden: hidden }),
    }),
    {
      name: 'fpc_ui',
      // Guard for SSR where localStorage isn't available.
      storage: createJSONStorage(() => {
        if (typeof window !== 'undefined') return window.localStorage
        // SSR-safe noop storage.
        return {
          getItem: () => null,
          setItem: () => { },
          removeItem: () => { },
          key: () => null,
          length: 0,
          clear: () => { },
        } as Storage
      }),
      // Only persist the balanceHidden preference (future fields can be added here explicitly).
      partialize: state => ({ balanceHidden: state.balanceHidden }),
    },
  ),
)
