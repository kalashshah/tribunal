// web/lib/siwe.ts
import { verifyMessage } from "ethers";

export interface AuthInput {
  address: string;
  message: string;
  signature: string;
}

export function verifyTribunalAuth(input: AuthInput): boolean {
  if (!input.message.startsWith("tribunal-auth")) return false;
  try {
    const recovered = verifyMessage(input.message, input.signature);
    return recovered.toLowerCase() === input.address.toLowerCase();
  } catch {
    return false;
  }
}
