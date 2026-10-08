import type { ReactNode } from 'react';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const GearIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="3.1" />
    <path d="M12 3.2v2.3M12 18.5v2.3M3.2 12h2.3M18.5 12h2.3M5.8 5.8l1.6 1.6M16.6 16.6l1.6 1.6M18.2 5.8l-1.6 1.6M7.4 16.6l-1.6 1.6" />
  </Icon>
);

export const FullscreenIcon = ({ active }: { active: boolean }) => (
  <Icon>
    {active ? (
      <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
    ) : (
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    )}
  </Icon>
);

export const SoundIcon = ({ on }: { on: boolean }) => (
  <Icon>
    <path d="M4 9.5v5h3.4l4.6 3.8V5.7L7.4 9.5H4z" />
    {on ? <path d="M15.6 9.2a4 4 0 0 1 0 5.6M18 6.8a7.4 7.4 0 0 1 0 10.4" /> : <path d="M16 9.6l4.6 4.8M20.6 9.6L16 14.4" />}
  </Icon>
);

export const DebugIcon = () => (
  <Icon>
    <path d="M4.5 6.5h15v11h-15z" />
    <path d="M7.6 10l2.5 2-2.5 2M12.2 14.2h4.2" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

/** A kayon (gunungan): the leaf-shaped figure that opens and closes a wayang performance. */
export const KayonMark = () => (
  <svg viewBox="0 0 24 28" width="19" height="22" aria-hidden="true">
    <path d="M12 1.2c3.6 4.6 7.6 8.4 7.6 14.2 0 4-2.6 7-5.6 8.6V27H10v-3c-3-1.6-5.6-4.6-5.6-8.6C4.4 9.6 8.4 5.8 12 1.2z" fill="#f2cf7c" />
    <path d="M12 6.4c2 2.8 4 5.2 4 8.6s-1.8 5.4-4 6.6c-2.2-1.2-4-3.2-4-6.6s2-5.8 4-8.6z" fill="none" stroke="#1a120b" strokeWidth="1.2" />
    <circle cx="12" cy="15" r="1.7" fill="#1a120b" />
  </svg>
);
