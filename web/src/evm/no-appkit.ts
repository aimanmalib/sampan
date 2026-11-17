// Build stand-in for the vendor QR modal that @walletconnect/ethereum-provider imports only when showQrModal is
// true. Sampan draws its own QR code (showQrModal: false), so the modal and its dependencies are never bundled.
export function createAppKit(): never {
  throw new Error('The WalletConnect modal is not part of this build');
}
