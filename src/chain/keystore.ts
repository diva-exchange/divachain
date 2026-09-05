/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

export interface I2pKeyPair {
  public: string;
  private: string;
  address: string;
}

export interface I2pPublicDestination {
  public: string;
  address: string;
}

export interface I2pPublicKeys {
  http: I2pPublicDestination;
  udp: I2pPublicDestination;
}

export interface Keystore {
  network: {
    http: I2pKeyPair;
    udp: I2pKeyPair;
  };
  node: {
    publicKey: string;
    secretKey: string;
  };
  socs: Array<{
    publicKey: string;
    secretKey: string;
  }>;
}
