// app/api/user/wallet/crypto-transfer/route.ts
import "server-only";

// Reuse the exact same implementation as /api/user/wallet/transfer
export { runtime, dynamic, POST } from "../transfer/route";
