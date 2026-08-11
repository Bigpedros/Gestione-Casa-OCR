/* global process, Buffer, require */
import {
  ActivationValidator,
  buildCanonicalLicensePayloadV1,
  type SignedLicenseDocument,
  type CryptographicStatus,
} from '@gestione-casa/shared-sdk/activation';
import { ACTIVATION_CONFIG } from '../../config/activation.config';

export interface SignatureVerificationResult {
  isValid: boolean;
  status: CryptographicStatus;
  canonicalPayload?: string;
  error?: string;
}

/**
 * Converte varie forme di chiave pubblica Ed25519 (SPKI Base64, Raw Hex 64 car., Raw Base64 44 car., o PEM)
 * in una chiave pubblica Node crypto o ArrayBuffer per Web Crypto.
 */
function parseEd25519PublicKey(publicKeyStr: string): any {
  const trimmed = publicKeyStr.trim();
  if (!trimmed) {
    throw new Error('Chiave pubblica non fornita');
  }

  // Se siamo in un ambiente Node.js / Vitest con modulo crypto
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    const crypto = require('crypto');

    if (trimmed.includes('-----BEGIN PUBLIC KEY-----')) {
      return crypto.createPublicKey(trimmed);
    }

    // SPKI Base64
    if (trimmed.startsWith('MCow')) {
      return crypto.createPublicKey({
        key: Buffer.from(trimmed, 'base64'),
        type: 'spki',
        format: 'der',
      });
    }

    // Raw 32 bytes (Hex 64 caratteri o Base64 44 caratteri)
    let rawBytes: any;
    if (trimmed.length === 64 && /^[0-9a-fA-F]+$/.test(trimmed)) {
      rawBytes = Buffer.from(trimmed, 'hex');
    } else {
      rawBytes = Buffer.from(trimmed, 'base64');
    }

    if (rawBytes.length === 32) {
      // Intestazione SPKI standard per Ed25519
      const spkiHeader = Buffer.from('302a300506032b6570032100', 'hex');
      const fullSpki = Buffer.concat([spkiHeader, rawBytes]);
      return crypto.createPublicKey({
        key: fullSpki,
        type: 'spki',
        format: 'der',
      });
    }

    // Fallback: tenta di interpretarlo come der base64
    return crypto.createPublicKey({
      key: Buffer.from(trimmed, 'base64'),
      type: 'spki',
      format: 'der',
    });
  }

  return trimmed;
}

/**
 * Esegue la verifica della firma Ed25519 sul canonical payload.
 */
async function verifyEd25519Signature(
  canonicalPayload: string,
  signatureBase64: string,
  publicKeyStr: string
): Promise<boolean> {
  try {
    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
      const payloadBuffer = Buffer.from(canonicalPayload, 'utf-8');
      const signatureBuffer = Buffer.from(signatureBase64, 'base64');
      const crypto = require('crypto');
      const pubKeyObj = parseEd25519PublicKey(publicKeyStr);
      return crypto.verify(null, payloadBuffer, pubKeyObj, signatureBuffer);
    }

    // Browser Web Crypto API
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
      const payloadBytes = new TextEncoder().encode(canonicalPayload);
      const binarySig = atob(signatureBase64);
      const signatureBytes = new Uint8Array(binarySig.length);
      for (let i = 0; i < binarySig.length; i++) {
        signatureBytes[i] = binarySig.charCodeAt(i);
      }

      let spkiDer: ArrayBuffer;
      const trimmed = publicKeyStr.trim();
      if (trimmed.startsWith('MCow')) {
        const binary = atob(trimmed);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        spkiDer = bytes.buffer;
      } else {
        let rawBytes: Uint8Array;
        if (trimmed.length === 64 && /^[0-9a-fA-F]+$/.test(trimmed)) {
          const match = trimmed.match(/.{1,2}/g) || [];
          rawBytes = new Uint8Array(match.map((byte) => parseInt(byte, 16)));
        } else {
          const binary = atob(trimmed);
          rawBytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) rawBytes[i] = binary.charCodeAt(i);
        }

        const spkiHeader = new Uint8Array([
          0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
        ]);
        const fullSpki = new Uint8Array(spkiHeader.length + rawBytes.length);
        fullSpki.set(spkiHeader);
        fullSpki.set(rawBytes, spkiHeader.length);
        spkiDer = fullSpki.buffer;
      }

      const key = await globalThis.crypto.subtle.importKey(
        'spki',
        spkiDer,
        { name: 'Ed25519' },
        false,
        ['verify']
      );

      return await globalThis.crypto.subtle.verify(
        { name: 'Ed25519' },
        key,
        signatureBytes,
        payloadBytes
      );
    }

    return false;
  } catch (err) {
    console.error('Errore durante la verifica della firma Ed25519:', err);
    return false;
  }
}

export const licenseSignatureVerifier = {
  /**
   * Valida la struttura di SignedLicenseDocument e ne verifica la firma Ed25519.
   */
  async verifySignedLicense(
    signedDoc: SignedLicenseDocument | null | undefined,
    expectedPublicKey?: string
  ): Promise<SignatureVerificationResult> {
    if (!signedDoc) {
      return {
        isValid: false,
        status: 'INVALID_FORMAT',
        error: 'Documento di licenza firmato mancante o nullo',
      };
    }

    // 1. Validazione di struttura tramite Shared SDK
    const formatValidation = ActivationValidator.validateSignedLicenseDocument(signedDoc);
    if (!formatValidation.isValid) {
      return {
        isValid: false,
        status: 'INVALID_FORMAT',
        error: formatValidation.issues.map((i: any) => `${i.field}: ${i.message}`).join('; '),
      };
    }

    // 2. Controllo algoritmo e versione
    if (signedDoc.signatureAlgorithm !== 'Ed25519') {
      return {
        isValid: false,
        status: 'UNSUPPORTED_VERSION',
        error: `Algoritmo firma non supportato: ${signedDoc.signatureAlgorithm}`,
      };
    }

    if (signedDoc.signatureVersion !== 1) {
      return {
        isValid: false,
        status: 'UNSUPPORTED_VERSION',
        error: `Versione firma non supportata: ${signedDoc.signatureVersion}`,
      };
    }

    // 3. Risoluzione chiave pubblica
    let pubKey = expectedPublicKey;
    if (!pubKey && signedDoc.keyId && ACTIVATION_CONFIG.publicKeysMap[signedDoc.keyId]) {
      pubKey = ACTIVATION_CONFIG.publicKeysMap[signedDoc.keyId];
    }
    if (!pubKey) {
      pubKey = ACTIVATION_CONFIG.publicKey;
    }

    if (!pubKey || pubKey.trim() === '') {
      return {
        isValid: false,
        status: 'UNKNOWN_KEY',
        error: `Chiave pubblica non trovata per keyId: "${signedDoc.keyId}" e nessuna chiave pubblica di fallback configurata.`,
      };
    }

    // 4. Generazione Canonical Payload V1
    let canonicalPayload: string;
    try {
      canonicalPayload = buildCanonicalLicensePayloadV1(signedDoc.license);
    } catch (err: any) {
      return {
        isValid: false,
        status: 'INVALID_FORMAT',
        error: `Errore generazione canonical payload: ${err?.message || err}`,
      };
    }

    // 5. Verifica firma crittografica
    const isSignatureValid = await verifyEd25519Signature(
      canonicalPayload,
      signedDoc.signature,
      pubKey
    );

    if (!isSignatureValid) {
      return {
        isValid: false,
        status: 'INVALID_SIGNATURE',
        canonicalPayload,
        error: 'Firma digitale non valida o il payload della licenza è stato alterato/manomesso.',
      };
    }

    return {
      isValid: true,
      status: 'VALID',
      canonicalPayload,
    };
  },
};
