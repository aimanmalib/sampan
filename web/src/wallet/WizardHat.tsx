// A wizard's hat drawn for Sampan (no file or code from any WizardConnect package), shown in every button that
// starts a WizardConnect pairing. It takes the button's text colour and is hidden from screen readers, so the
// button's name stays its label. The pairing dialog shows it before its title, with its own class.
export function WizardHat({ className = 'button__icon' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path d="M12.6 2.5 6.4 17h11.2L14.2 9.2l3.4-2.4z" fill="currentColor" />
      <path d="M3 18.4c0-.8 4-1.4 9-1.4s9 .6 9 1.4-4 2.1-9 2.1-9-1.3-9-2.1z" fill="currentColor" />
      <path d="M10.2 12.6l1.2.4.4 1.2.4-1.2 1.2-.4-1.2-.4-.4-1.2-.4 1.2z" className="button__icon-star" />
    </svg>
  );
}
