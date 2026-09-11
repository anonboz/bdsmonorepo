// @repo/shared/vietqr — build a VietQR (NAPAS 247, EMVCo-format) payload that
// any Vietnamese banking app can scan to prefill a transfer: receiving bank +
// account, amount, and a purpose message. Pure string work, no dependencies;
// the caller renders the string as a QR image.
//
// Spec: EMV QRCPS merchant-presented mode, with the NAPAS application id
// A000000727 and service code QRIBFTTA (transfer to account).

/** NAPAS bank identifiers (BIN) for the banks landlords most commonly use. */
export const VN_BANKS: readonly { bin: string; name: string; shortName: string }[] = [
  { bin: "970436", name: "Vietcombank", shortName: "VCB" },
  { bin: "970415", name: "VietinBank", shortName: "CTG" },
  { bin: "970418", name: "BIDV", shortName: "BIDV" },
  { bin: "970405", name: "Agribank", shortName: "AGR" },
  { bin: "970422", name: "MB Bank", shortName: "MB" },
  { bin: "970407", name: "Techcombank", shortName: "TCB" },
  { bin: "970416", name: "ACB", shortName: "ACB" },
  { bin: "970432", name: "VPBank", shortName: "VPB" },
  { bin: "970423", name: "TPBank", shortName: "TPB" },
  { bin: "970403", name: "Sacombank", shortName: "STB" },
  { bin: "970441", name: "VIB", shortName: "VIB" },
  { bin: "970443", name: "SHB", shortName: "SHB" },
  { bin: "970437", name: "HDBank", shortName: "HDB" },
  { bin: "970426", name: "MSB", shortName: "MSB" },
  { bin: "970448", name: "OCB", shortName: "OCB" },
  { bin: "970429", name: "SCB", shortName: "SCB" },
  { bin: "970431", name: "Eximbank", shortName: "EIB" },
  { bin: "970454", name: "BVBank", shortName: "BVB" },
  { bin: "970409", name: "Bac A Bank", shortName: "BAB" },
  { bin: "970440", name: "SeABank", shortName: "SEAB" },
  { bin: "970406", name: "DongA Bank", shortName: "DAB" },
  { bin: "970452", name: "Kienlongbank", shortName: "KLB" },
];

export function findVnBank(bin: string) {
  return VN_BANKS.find((b) => b.bin === bin) ?? null;
}

/** EMVCo TLV: 2-digit id, 2-digit length, value. */
function tlv(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, "0")}${value}`;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), uppercase hex — per EMVCo. */
export function crc16ccitt(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Normalize a transfer message for the QR purpose field: strip diacritics,
 * keep letters/digits/spaces, collapse whitespace, uppercase, cap the length.
 * Banks display roughly the first 25–50 characters, so keep it short.
 */
export function sanitizeTransferMessage(message: string, max = 50): string {
  return message
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .slice(0, max)
    .trim();
}

export type VietQrInput = {
  bankBin: string; // NAPAS BIN, e.g. "970436"
  accountNo: string;
  /** Whole đồng (NOT cents). Omit or 0 for a static QR without an amount. */
  amountVnd?: number;
  /** Already sanitized (see sanitizeTransferMessage). */
  message?: string;
};

export function buildVietQrPayload({
  bankBin,
  accountNo,
  amountVnd,
  message,
}: VietQrInput): string {
  const hasAmount = typeof amountVnd === "number" && amountVnd > 0;
  const consumer = tlv("00", bankBin) + tlv("01", accountNo);
  const merchant = tlv("00", "A000000727") + tlv("01", consumer) + tlv("02", "QRIBFTTA");

  let payload =
    tlv("00", "01") + // payload format indicator
    tlv("01", hasAmount ? "12" : "11") + // 12 = dynamic (one-off with amount), 11 = static
    tlv("38", merchant) +
    tlv("53", "704"); // ISO 4217 VND
  if (hasAmount) payload += tlv("54", String(Math.round(amountVnd)));
  payload += tlv("58", "VN");
  if (message) payload += tlv("62", tlv("08", message));
  payload += "6304"; // CRC id + length, then the CRC over everything so far
  return payload + crc16ccitt(payload);
}
