/**
 * Copyright (C) 2021-2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { decodeBase64Url, encodeBase64Url } from '@std/encoding';
import { copySync, existsSync } from '@std/fs';
import { Buffer } from 'node:buffer';
import sodium, { SecureBuffer } from 'sodium-native';
import { Config } from '../config.ts';
import { createLocalDestination } from '@i2p/sam';
import { I2pPublicKeys } from './keystore.ts';

export const NAME_HEADER_TOKEN_API: string = 'diva-token-api';
const DEFAULT_LENGTH_TOKEN_API: number = 32;
const TOKEN_VALIDITY_MS: number = 15 * 60 * 1000; // 15 minutes

interface KeyPair {
  pkBuf: SecureBuffer;
  skBuf: SecureBuffer;
  pkStr: string;
  skStr: string;
}

interface SamDestination {
  public: string;
  private: SecureBuffer | null;
  address: string;
}

export class Wallet {
  private config: Config;
  private ident: string = '';
  private identUdp: string = '';

  private nodePublicKey!: SecureBuffer;
  private nodeSecretKey!: SecureBuffer;

  private i2pHttpPrivateKey!: SecureBuffer;
  private i2pUdpPrivateKey!: SecureBuffer;

  private mapSocPublicKeys: Map<string, SecureBuffer> = new Map();
  private mapSocSecretKeys: Map<string, SecureBuffer> = new Map();

  private socPublicKeys: Array<string> = [];
  private primarySocStr: string = '';
  private i2pPublicKeys: I2pPublicKeys = {
    http: { public: '', address: '' },
    udp: { public: '', address: '' },
  };

  private tokenAPI: string = '';
  private timerTokenAPI: ReturnType<typeof setTimeout> | null = null;

  private masterPassphrase: SecureBuffer | null = null;
  private tokenExpiresAt: number = 0;
  private volatileSocs: Map<
    string,
    { sk: SecureBuffer; timer: ReturnType<typeof setTimeout> }
  > = new Map();

  static async make(
    config: Config,
    explicitPassphraseBuf?: Uint8Array,
    allowCreation: boolean = false,
  ): Promise<Wallet> {
    const w: Wallet = new Wallet(config);
    await w.open(explicitPassphraseBuf, allowCreation);
    return w;
  }

  private constructor(config: Config) {
    this.config = config;
  }

  // --- Core Lifecycle & Initialization ---

  public async open(
    explicitPassphraseBuf?: Uint8Array,
    allowCreation: boolean = false,
  ): Promise<void> {
    const passphraseBuf: Buffer<ArrayBuffer> = await this.resolvePassphrase(
      explicitPassphraseBuf,
    );

    // Sofort in den gesicherten V8-unabhängigen RAM übernehmen
    this.storeMasterPassphrase(passphraseBuf);

    if (existsSync(this.config.path_keystore)) {
      try {
        this.loadExistingKeystore();
      } catch (error) {
        this.close(); // Nullen der Master-Passphrase im RAM bei Abbruch
        throw error;
      }
    } else {
      if (!allowCreation) {
        this.close();
        throw new Error(
          'FATAL: Node not initialized. Start via terminal first.',
        );
      }
      await this.initializeNewKeystore();
    }

    this.createTokenAPI();
  }

  public close(): void {
    if (this.timerTokenAPI !== null) clearTimeout(this.timerTokenAPI);
    this.timerTokenAPI = null;

    if (this.masterPassphrase) this.freeBuffer(this.masterPassphrase, true);
    this.masterPassphrase = null;

    for (const entry of this.volatileSocs.values()) {
      clearTimeout(entry.timer);
      this.freeBuffer(entry.sk, true);
    }
    this.volatileSocs.clear();

    if (this.nodeSecretKey) this.freeBuffer(this.nodeSecretKey, true);
    if (this.nodePublicKey) this.freeBuffer(this.nodePublicKey, false);
    if (this.i2pHttpPrivateKey) this.freeBuffer(this.i2pHttpPrivateKey, true);
    if (this.i2pUdpPrivateKey) this.freeBuffer(this.i2pUdpPrivateKey, true);

    for (const skBuf of this.mapSocSecretKeys.values()) {
      this.freeBuffer(skBuf, true);
    }
    for (const pkBuf of this.mapSocPublicKeys.values()) {
      this.freeBuffer(pkBuf, false);
    }

    this.mapSocSecretKeys.clear();
    this.mapSocPublicKeys.clear();
    this.socPublicKeys = [];
    this.primarySocStr = '';
    this.ident = '';
    this.identUdp = '';
  }

  // --- Session & Identity Management ---

  public validateTokenAndSlide(token: string): boolean {
    if (!this.tokenAPI || this.tokenAPI !== token) return false;

    if (Date.now() > this.tokenExpiresAt) {
      this.lockApi();
      return false;
    }
    this.tokenExpiresAt = Date.now() + TOKEN_VALIDITY_MS;
    return true;
  }

  public lockApi(): void {
    if (this.timerTokenAPI !== null) {
      clearTimeout(this.timerTokenAPI);
      this.timerTokenAPI = null;
    }
    this.tokenAPI = '';

    if (this.masterPassphrase) {
      this.freeBuffer(this.masterPassphrase, true);
      this.masterPassphrase = null;
    }

    for (const entry of this.volatileSocs.values()) {
      clearTimeout(entry.timer);
      this.freeBuffer(entry.sk, true);
    }
    this.volatileSocs.clear();
  }

  public requestVolatileIdentity(): string {
    this.assertUnlocked();

    const kp: KeyPair = this.generateKeyPair();
    this.freeBuffer(kp.pkBuf, false);

    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
      const entry = this.volatileSocs.get(kp.pkStr);
      if (entry) {
        this.freeBuffer(entry.sk, true);
        this.volatileSocs.delete(kp.pkStr);
      }
    }, 300000);

    this.volatileSocs.set(kp.pkStr, { sk: kp.skBuf, timer });
    return kp.pkStr;
  }

  public finalizeVolatileIdentity(pkStr: string): void {
    const entry = this.volatileSocs.get(pkStr);
    if (!entry) throw new Error('FATAL: Identity expired or invalid.');

    clearTimeout(entry.timer);
    this.mapSocPublicKeys.set(pkStr, this.allocateBuffer(pkStr, false));
    this.mapSocSecretKeys.set(pkStr, entry.sk);
    this.socPublicKeys.push(pkStr);
    this.volatileSocs.delete(pkStr);

    this.saveCurrentKeystore();
  }

  // --- Getters ---

  public isLocked(): boolean {
    return this.masterPassphrase === null;
  }

  public getHttpAddress(): string {
    return this.ident;
  }

  public getUdpAddress(): string {
    return this.identUdp;
  }

  public getTokenAPI(): string {
    return this.tokenAPI;
  }

  public getAllSocs(): Array<{ publicKey: string }> {
    this.assertOpened();
    return this.socPublicKeys.map((pk: string) => ({ publicKey: pk }));
  }

  public getPublicKey(): string {
    this.assertOpened();
    return this.primarySocStr;
  }

  public getNodePublicKey(): string {
    this.assertOpened();
    return encodeBase64Url(new Uint8Array(this.nodePublicKey));
  }

  public getI2pPublicKeys(): I2pPublicKeys {
    this.assertOpened();
    return this.i2pPublicKeys;
  }

  public getSamPrivateKey(type: 'http' | 'udp'): SecureBuffer {
    this.assertOpened();
    const srcBuf: SecureBuffer = type === 'http'
      ? this.i2pHttpPrivateKey
      : this.i2pUdpPrivateKey;

    const cloneBuf: SecureBuffer = sodium.sodium_malloc(srcBuf.length);
    sodium.sodium_mlock(cloneBuf);
    cloneBuf.set(srcBuf);

    return cloneBuf;
  }

  // --- Cryptography (Signing) ---

  public sign(data: string, originPk?: string): string {
    this.assertOpened();
    const pk: string = originPk || this.primarySocStr;
    const skBuf: SecureBuffer | undefined = this.mapSocSecretKeys.get(pk);
    if (!skBuf) throw new Error(`FATAL: No secret key available for SOC ${pk}`);

    return this.executeSignature(data, skBuf);
  }

  public vrf(seed: string, originPk?: string): string {
    return this.sign(seed, originPk);
  }

  public signNode(data: string): string {
    this.assertOpened();
    return this.executeSignature(data, this.nodeSecretKey);
  }

  public vrfNode(seed: string): string {
    return this.signNode(seed);
  }

  private executeSignature(data: string, secretKey: SecureBuffer): string {
    const bufferSignature: Buffer<ArrayBuffer> = Buffer.alloc(
      sodium.crypto_sign_BYTES,
    );
    const messageBytes: Uint8Array = new TextEncoder().encode(data);
    const messageBuffer: SecureBuffer = sodium.sodium_malloc(
      messageBytes.length,
    );
    messageBuffer.set(messageBytes);

    sodium.crypto_sign_detached(bufferSignature, messageBuffer, secretKey);

    this.freeBuffer(messageBytes, false);
    this.freeBuffer(messageBuffer, false);
    return encodeBase64Url(bufferSignature);
  }

  // --- File I/O & Encryption (Binary TLV) ---

  public saveCurrentKeystore(): void {
    this.assertUnlocked();

    const PK_SIZE = sodium.crypto_sign_PUBLICKEYBYTES;
    const SK_SIZE = sodium.crypto_sign_SECRETKEYBYTES;
    const enc = new TextEncoder();

    const httpPubBuf = enc.encode(this.i2pPublicKeys.http.public);
    const httpAddrBuf = enc.encode(this.i2pPublicKeys.http.address);
    const udpPubBuf = enc.encode(this.i2pPublicKeys.udp.public);
    const udpAddrBuf = enc.encode(this.i2pPublicKeys.udp.address);

    let totalSize = 1 + PK_SIZE + SK_SIZE;
    totalSize += 2 + httpPubBuf.length + 2 + this.i2pHttpPrivateKey.length + 2 +
      httpAddrBuf.length;
    totalSize += 2 + udpPubBuf.length + 2 + this.i2pUdpPrivateKey.length + 2 +
      udpAddrBuf.length;
    totalSize += 2 + (this.socPublicKeys.length * (PK_SIZE + SK_SIZE));

    const payloadBuf: SecureBuffer = sodium.sodium_malloc(totalSize);
    sodium.sodium_mlock(payloadBuf);
    let offset = 0;

    try {
      payloadBuf[offset++] = 0x01; // Version 0x01

      payloadBuf.set(this.nodePublicKey, offset);
      offset += PK_SIZE;

      payloadBuf.set(this.nodeSecretKey, offset);
      offset += SK_SIZE;

      offset = this.write16V(payloadBuf, offset, httpPubBuf);
      offset = this.write16V(payloadBuf, offset, this.i2pHttpPrivateKey);
      offset = this.write16V(payloadBuf, offset, httpAddrBuf);

      offset = this.write16V(payloadBuf, offset, udpPubBuf);
      offset = this.write16V(payloadBuf, offset, this.i2pUdpPrivateKey);
      offset = this.write16V(payloadBuf, offset, udpAddrBuf);

      const view = new DataView(
        payloadBuf.buffer,
        payloadBuf.byteOffset,
        payloadBuf.byteLength,
      );
      view.setUint16(offset, this.socPublicKeys.length, true);
      offset += 2;

      for (const pkStr of this.socPublicKeys) {
        payloadBuf.set(this.mapSocPublicKeys.get(pkStr)!, offset);
        offset += PK_SIZE;

        payloadBuf.set(this.mapSocSecretKeys.get(pkStr)!, offset);
        offset += SK_SIZE;
      }

      const encryptedData: Buffer<ArrayBuffer> = this.encryptPayloadBuffer(
        payloadBuf,
        Buffer.from(this.masterPassphrase!),
      );
      this.writeKeystoreFile(encryptedData);
    } finally {
      this.freeBuffer(httpPubBuf, false);
      this.freeBuffer(httpAddrBuf, false);
      this.freeBuffer(udpPubBuf, false);
      this.freeBuffer(udpAddrBuf, false);
      this.freeBuffer(payloadBuf, true);
    }
  }

  private write16V(
    target: SecureBuffer,
    offset: number,
    data: Uint8Array,
  ): number {
    const view = new DataView(
      target.buffer,
      target.byteOffset,
      target.byteLength,
    );
    view.setUint16(offset, data.length, true);
    target.set(data, offset + 2);
    return offset + 2 + data.length;
  }

  private encryptPayloadBuffer(
    payloadBuf: SecureBuffer,
    passphraseBuf: Buffer,
  ): Buffer<ArrayBuffer> {
    const salt: Buffer<ArrayBuffer> = Buffer.alloc(
      sodium.crypto_pwhash_SALTBYTES,
    );
    sodium.randombytes_buf(salt);

    const encryptionKey: SecureBuffer = sodium.sodium_malloc(
      sodium.crypto_secretbox_KEYBYTES,
    );
    sodium.sodium_mlock(encryptionKey);
    sodium.crypto_pwhash(
      encryptionKey,
      passphraseBuf,
      salt,
      sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
      sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
    );

    const nonce: Buffer<ArrayBuffer> = Buffer.alloc(
      sodium.crypto_secretbox_NONCEBYTES,
    );
    sodium.randombytes_buf(nonce);

    const cipherText: Buffer<ArrayBuffer> = Buffer.alloc(
      payloadBuf.length + sodium.crypto_secretbox_MACBYTES,
    );
    sodium.crypto_secretbox_easy(cipherText, payloadBuf, nonce, encryptionKey);

    const result: Buffer<ArrayBuffer> = Buffer.concat([
      salt,
      nonce,
      cipherText,
    ]);

    this.freeBuffer(encryptionKey, true);
    return result;
  }

  private decryptPayloadBuffer(
    fileData: Uint8Array,
    passphraseBuf: Buffer,
  ): SecureBuffer {
    const saltBytes: number = sodium.crypto_pwhash_SALTBYTES;
    const nonceBytes: number = sodium.crypto_secretbox_NONCEBYTES;
    const macBytes: number = sodium.crypto_secretbox_MACBYTES;

    if (fileData.length < saltBytes + nonceBytes + macBytes) {
      this.freeBuffer(fileData, false);
      throw new Error(
        'FATAL: Keystore file is too small or improperly formatted.',
      );
    }

    const salt: Buffer<ArrayBuffer> = Buffer.from(
      fileData.subarray(0, saltBytes),
    );
    const nonce: Buffer<ArrayBuffer> = Buffer.from(
      fileData.subarray(saltBytes, saltBytes + nonceBytes),
    );
    const cipherText: Buffer<ArrayBuffer> = Buffer.from(
      fileData.subarray(saltBytes + nonceBytes),
    );

    const encryptionKey: SecureBuffer = sodium.sodium_malloc(
      sodium.crypto_secretbox_KEYBYTES,
    );
    sodium.sodium_mlock(encryptionKey);
    sodium.crypto_pwhash(
      encryptionKey,
      passphraseBuf,
      salt,
      sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
      sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
    );

    const decryptedBuf: SecureBuffer = sodium.sodium_malloc(
      cipherText.length - macBytes,
    );
    sodium.sodium_mlock(decryptedBuf);

    const hasSuccess: boolean = sodium.crypto_secretbox_open_easy(
      decryptedBuf,
      cipherText,
      nonce,
      encryptionKey,
    );

    if (!hasSuccess) {
      this.freeBuffer(encryptionKey, true);
      this.freeBuffer(decryptedBuf, true);
      this.freeBuffer(fileData, false);
      throw new Error(
        'FATAL: Keystore decryption failed. Wrong passphrase or corrupt file.',
      );
    }

    this.freeBuffer(encryptionKey, true);
    this.freeBuffer(fileData, false);
    return decryptedBuf;
  }

  private loadExistingKeystore(): void {
    const fileDataSecret: Uint8Array = Deno.readFileSync(
      this.config.path_keystore,
    );
    const payloadBuf: SecureBuffer = this.decryptPayloadBuffer(
      fileDataSecret,
      Buffer.from(this.masterPassphrase!),
    );

    const PK_SIZE = sodium.crypto_sign_PUBLICKEYBYTES;
    const SK_SIZE = sodium.crypto_sign_SECRETKEYBYTES;
    let offset = 0;

    try {
      if (payloadBuf[offset++] !== 0x01) {
        throw new Error('FATAL: Unsupported keystore binary version.');
      }

      const view = new DataView(
        payloadBuf.buffer,
        payloadBuf.byteOffset,
        payloadBuf.byteLength,
      );
      const dec = new TextDecoder();

      this.nodePublicKey = this.extractFixed(
        payloadBuf,
        offset,
        PK_SIZE,
        false,
      );
      offset += PK_SIZE;

      this.nodeSecretKey = this.extractFixed(payloadBuf, offset, SK_SIZE, true);
      offset += SK_SIZE;

      let len = view.getUint16(offset, true);
      offset += 2;
      this.i2pPublicKeys.http.public = dec.decode(
        payloadBuf.subarray(offset, offset + len),
      );
      offset += len;

      len = view.getUint16(offset, true);
      offset += 2;
      this.i2pHttpPrivateKey = this.extractFixed(payloadBuf, offset, len, true);
      offset += len;

      len = view.getUint16(offset, true);
      offset += 2;
      this.i2pPublicKeys.http.address = dec.decode(
        payloadBuf.subarray(offset, offset + len),
      );
      offset += len;

      len = view.getUint16(offset, true);
      offset += 2;
      this.i2pPublicKeys.udp.public = dec.decode(
        payloadBuf.subarray(offset, offset + len),
      );
      offset += len;

      len = view.getUint16(offset, true);
      offset += 2;
      this.i2pUdpPrivateKey = this.extractFixed(payloadBuf, offset, len, true);
      offset += len;

      len = view.getUint16(offset, true);
      offset += 2;
      this.i2pPublicKeys.udp.address = dec.decode(
        payloadBuf.subarray(offset, offset + len),
      );
      offset += len;

      const socCount = view.getUint16(offset, true);
      offset += 2;

      for (let i = 0; i < socCount; i++) {
        const pkBuf = this.extractFixed(payloadBuf, offset, PK_SIZE, false);
        offset += PK_SIZE;

        const skBuf = this.extractFixed(payloadBuf, offset, SK_SIZE, true);
        offset += SK_SIZE;

        const pkStr = encodeBase64Url(new Uint8Array(pkBuf));
        this.mapSocPublicKeys.set(pkStr, pkBuf);
        this.mapSocSecretKeys.set(pkStr, skBuf);
        this.socPublicKeys.push(pkStr);
      }

      this.applyKeystoreState();
    } finally {
      this.freeBuffer(payloadBuf, true);
    }
  }

  private extractFixed(
    src: SecureBuffer,
    offset: number,
    len: number,
    isSecret: boolean,
  ): SecureBuffer {
    const buf: SecureBuffer = sodium.sodium_malloc(len);
    if (isSecret) sodium.sodium_mlock(buf);
    buf.set(src.subarray(offset, offset + len));
    return buf;
  }

  private writeKeystoreFile(data: Buffer): void {
    const path: string = this.config.path_keystore;
    const pathTmp: string = `${path}.tmp`;

    if (existsSync(path)) copySync(path, `${path}.bak`, { overwrite: true });

    Deno.writeFileSync(pathTmp, data, { mode: 0o600 });
    Deno.renameSync(pathTmp, path);
  }

  // --- Setup Helpers ---

  private async resolvePassphrase(
    explicit?: Uint8Array,
  ): Promise<Buffer<ArrayBuffer>> {
    if (explicit) {
      const buf: Buffer<ArrayBuffer> = Buffer.alloc(explicit.length);
      buf.set(explicit);
      return buf;
    }

    // Secure OS-level allocation bypassing the V8 garbage collector heap
    const inputBuf: SecureBuffer = sodium.sodium_malloc(1024);
    sodium.sodium_mlock(inputBuf);

    const bytesRead: number | null = await Deno.stdin.read(inputBuf);
    if (bytesRead === null) {
      this.freeBuffer(inputBuf, true);
      throw new Error('FATAL: No passphrase provided via stdin.');
    }

    let len: number = bytesRead;
    while (len > 0 && (inputBuf[len - 1] === 10 || inputBuf[len - 1] === 13)) {
      len--;
    }
    if (len === 0) {
      this.freeBuffer(inputBuf, true);
      throw new Error('FATAL: Empty passphrase provided.');
    }

    const rawPassphrase: Uint8Array = inputBuf.subarray(0, len);
    const preHashBuffer: ArrayBuffer = await crypto.subtle.digest(
      'SHA-256',
      rawPassphrase as BufferSource,
    );
    const passphraseBuf: Buffer<ArrayBuffer> = Buffer.from(preHashBuffer);

    this.freeBuffer(inputBuf, true);
    return passphraseBuf;
  }

  private async initializeNewKeystore(): Promise<void> {
    const nodeKp: KeyPair = this.generateKeyPair();
    this.nodePublicKey = nodeKp.pkBuf;
    this.nodeSecretKey = nodeKp.skBuf;

    const primaryKp: KeyPair = this.generateKeyPair();
    this.mapSocPublicKeys.set(primaryKp.pkStr, primaryKp.pkBuf);
    this.mapSocSecretKeys.set(primaryKp.pkStr, primaryKp.skBuf);
    this.socPublicKeys.push(primaryKp.pkStr);

    const numDecoys: number = this.config.decoys || 0;
    for (let i: number = 0; i < numDecoys; i++) {
      const dKp: KeyPair = this.generateKeyPair();
      this.mapSocPublicKeys.set(dKp.pkStr, dKp.pkBuf);
      this.mapSocSecretKeys.set(dKp.pkStr, dKp.skBuf);
      this.socPublicKeys.push(dKp.pkStr);
    }

    const samHttp: SamDestination = await this.setupSamDestination(
      this.config.i2p_sam_http,
    );
    const samUdp: SamDestination = await this.setupSamDestination(
      this.config.i2p_sam_udp,
    );

    if (!samHttp.private || !samUdp.private) {
      throw new Error('FATAL: Failed to generate I2P destinations.');
    }

    this.i2pPublicKeys.http = {
      public: samHttp.public,
      address: samHttp.address,
    };
    this.i2pPublicKeys.udp = { public: samUdp.public, address: samUdp.address };
    this.i2pHttpPrivateKey = samHttp.private;
    this.i2pUdpPrivateKey = samUdp.private;

    this.saveCurrentKeystore();
    this.applyKeystoreState();
  }

  private applyKeystoreState(): void {
    this.primarySocStr = this.socPublicKeys[0] || '';
    this.ident = this.i2pPublicKeys.http.public;
    this.identUdp = this.i2pPublicKeys.udp.public;
  }

  private async setupSamDestination(
    configString: string,
  ): Promise<SamDestination> {
    const [host, port] = configString.split(':');
    return (await createLocalDestination({
      sam: { host, portTCP: Number(port) },
    })) as SamDestination;
  }

  // --- Memory & Assertions ---

  private assertOpened(): void {
    if (!this.ident) throw new Error('FATAL: Wallet not opened.');
  }

  private assertUnlocked(): void {
    if (!this.masterPassphrase) throw new Error('FATAL: Wallet is locked.');
  }

  private createTokenAPI(): void {
    const tokenBytes: SecureBuffer = sodium.sodium_malloc(
      DEFAULT_LENGTH_TOKEN_API,
    );
    sodium.sodium_mlock(tokenBytes);
    sodium.randombytes_buf(tokenBytes);

    this.tokenAPI = encodeBase64Url(new Uint8Array(tokenBytes)).substring(
      0,
      DEFAULT_LENGTH_TOKEN_API,
    );
    this.tokenExpiresAt = Date.now() + TOKEN_VALIDITY_MS;

    this.freeBuffer(tokenBytes, true);
  }

  private storeMasterPassphrase(passphraseBuf: Buffer<ArrayBuffer>): void {
    this.masterPassphrase = sodium.sodium_malloc(passphraseBuf.length);
    sodium.sodium_mlock(this.masterPassphrase);
    this.masterPassphrase.set(passphraseBuf);
    this.freeBuffer(passphraseBuf, false);
  }

  private generateKeyPair(): KeyPair {
    const pkBuf: SecureBuffer = sodium.sodium_malloc(
      sodium.crypto_sign_PUBLICKEYBYTES,
    );
    const skBuf: SecureBuffer = sodium.sodium_malloc(
      sodium.crypto_sign_SECRETKEYBYTES,
    );
    sodium.sodium_mlock(skBuf);
    sodium.crypto_sign_keypair(pkBuf, skBuf);

    return {
      pkBuf,
      skBuf,
      pkStr: encodeBase64Url(new Uint8Array(pkBuf)),
      skStr: encodeBase64Url(new Uint8Array(skBuf)),
    };
  }

  private allocateBuffer(base64Str: string, isSecret: boolean): SecureBuffer {
    const decoded: Uint8Array = decodeBase64Url(base64Str);
    const buf: SecureBuffer = sodium.sodium_malloc(decoded.length);
    if (isSecret) sodium.sodium_mlock(buf);
    buf.set(decoded);
    this.freeBuffer(decoded, false); // wipe v8 heap array quickly
    return buf;
  }

  private freeBuffer(buf: SecureBuffer | Uint8Array, unlock: boolean): void {
    if (!buf) return;
    if (unlock) sodium.sodium_munlock(buf as SecureBuffer);
    sodium.sodium_memzero(buf as SecureBuffer);
  }
}
