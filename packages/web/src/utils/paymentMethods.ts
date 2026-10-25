// Where a mill sends the money for a plan, shown on the checkout page.
//
// The account details are not in yet: fill in accountName and accountNumber (and
// qrImage, a file under packages/web/public, if there is a QR code). A method
// with no account number shows "details coming soon", and while none has one
// the mill can still send its request without a payment reference.

export interface PaymentMethod {
  id: string;
  label: string;
  /** The bank or wallet, e.g. "BDO". */
  provider: string;
  accountName: string;
  accountNumber: string;
  /** Path under /public, e.g. "/payments/gcash-qr.png". */
  qrImage?: string;
  /** What the mill types as its reference, e.g. "the 13-digit reference number". */
  referenceHint: string;
}

export const PAYMENT_METHODS: PaymentMethod[] = [
  {
    id: "gcash",
    label: "GCash",
    provider: "GCash",
    accountName: "",
    accountNumber: "",
    referenceHint: "The reference number on your GCash receipt",
  },
  {
    id: "maya",
    label: "Maya",
    provider: "Maya",
    accountName: "",
    accountNumber: "",
    referenceHint: "The reference ID on your Maya receipt",
  },
  {
    id: "bank",
    label: "Bank transfer",
    provider: "",
    accountName: "",
    accountNumber: "",
    referenceHint: "The transaction or confirmation number from your bank",
  },
];

export function hasDetails(m: PaymentMethod): boolean {
  return m.accountNumber.trim() !== "";
}

export function anyPaymentReady(methods: PaymentMethod[] = PAYMENT_METHODS): boolean {
  return methods.some(hasDetails);
}
