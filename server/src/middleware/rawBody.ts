import type { Request, Response, NextFunction } from "express";

// Conserve le body brut pour verification HMAC webhook (x-bitnob-signature = HMAC-SHA512 du raw body)
export function rawBodySaver(req: Request, _res: Response, buf: Buffer) {
  (req as unknown as { rawBody: string }).rawBody = buf.toString("utf8");
}
export function getRawBody(req: Request): string {
  return (req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? "");
}
