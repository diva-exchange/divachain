/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

export class Namespace {
  public static readonly GENSIS_INIT: string = 'gen:init';
  public static readonly SYS_IDENTITY: string = 'sys:identity';
  public static readonly SYS_CHECKPOINT: string = 'sys:checkpoint';

  public static readonly APP_MESSAGING: string = 'app:message';
  public static readonly APP_FILE: string = 'app:file';

  public static readonly PREFIX_CONSENSUS_VALIDATORS: string = 'con:val:';
  public static readonly PREFIX_CONSENSUS_REPUTATION: string = 'con:rep:';
  public static readonly PREFIX_CONSENSUS_EPOCH: string = 'con:epc:';

  public static initGenesis(): string {
    return Namespace.GENSIS_INIT;
  }

  public static getRandomAppNamespace(): string {
    const apps = [Namespace.APP_MESSAGING, Namespace.APP_FILE];
    return apps[Math.floor(Math.random() * apps.length)];
  }

  public static validatorsForEpoch(epoch: number): string {
    return `${Namespace.PREFIX_CONSENSUS_VALIDATORS}${
      String(epoch).padStart(16, '0')
    }`;
  }

  public static reputationForEpoch(epoch: number): string {
    return `${Namespace.PREFIX_CONSENSUS_REPUTATION}${
      String(epoch).padStart(16, '0')
    }`;
  }

  public static consensusForEpoch(epoch: number): string {
    return `${Namespace.PREFIX_CONSENSUS_EPOCH}${
      String(epoch).padStart(16, '0')
    }`;
  }
}
