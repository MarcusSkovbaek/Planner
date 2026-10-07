import type { KeyObject } from 'node:crypto';

export const APP_ID: string;
export const PLATFORM: string;
export const CHANNEL: string;
export function rawPublicKey(publicKeyObject: KeyObject): Buffer;
export function keyIdOf(raw: Buffer): string;
export function generateKeyPair(): { privateKeyPem: string; publicKey: string; keyId: string };
export function describePrivateKey(privateKeyPem: string): { privateKey: KeyObject; publicKey: string; keyId: string };
export function sha512File(path: string): Promise<string>;
export function describeInstaller(path: string): Promise<{ size: number; sha512: string }>;
export function signManifest(
  manifest: Record<string, unknown>,
  privateKeyPem: string,
): { format: 1; keyId: string; payload: string; signature: string };
