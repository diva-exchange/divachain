/**
 * Copyright (C) 2023 diva.exchange
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { Logger } from '../../../dist/logger.js';
import { Util } from '../../../dist/chain/util.js';

const SIMULATOR_SIZE: number = 15;
const SIMULATOR_RUNS: number = 10000; // 10'000
const DEFAULT_PERCENTAGE_MESSAGE_RELIABILITY: number = 90;
const PEER_COMMUNICATION_COST: number = 500; // in milliseconds

class DivachainSimulator {
  public readonly size: number;
  public readonly quorum: number;
  public readonly cost: number;
  public runs: number;

  private readonly pMessageReliability;

  // per run
  private arrayNode: Array<number> = [];
  private arrayBitmapPerNode: Array<Array<number>> = [];

  // global
  private mapTrialVoteTx: Map<number, number> = new Map();
  private mapTrialNewBlock: Map<number, number> = new Map();

  constructor(
    size: number = SIMULATOR_SIZE,
    runs: number = SIMULATOR_RUNS,
    percMessageReliability: number = DEFAULT_PERCENTAGE_MESSAGE_RELIABILITY,
    cost: number = PEER_COMMUNICATION_COST
  ) {
    this.size = size > 5 && size < 64 ? size : SIMULATOR_SIZE;
    this.quorum = this.size * (2 / 3) + 1;
    runs = runs >= 1 ? runs : SIMULATOR_RUNS;
    this.runs = 0;
    this.pMessageReliability =
      percMessageReliability >= 10 && percMessageReliability <= 100
        ? percMessageReliability
        : DEFAULT_PERCENTAGE_MESSAGE_RELIABILITY;
    this.cost = cost > 10 && cost < 10000 ? cost : PEER_COMMUNICATION_COST;

    Logger.trace(`Setup // SIZE: ${this.size}; QUORUM: ${this.quorum}`);
    Logger.trace(`Setup // Reliability: ${this.pMessageReliability}%; Comm Costs: ${this.cost}`);

    do {
      this.run();
    } while (this.runs < runs);
  }

  private run() {
    this.arrayNode = [];
    this.arrayBitmapPerNode = [];
    this.runs++;

    // initial setup, populate the nodes with opinions: either a node has a transaction (1) or not (2)
    do {
      for (let n = 0; n < this.size; n++) {
        this.arrayNode[n] = Math.floor(Math.random() * 2) + 1; // 1 or 2
      }
    } while (!this.arrayNode.some((v) => v === 1));
    //@FIXME logging
    //Logger.trace('Nodes, bitmap of TX (1 = TX, 2 = NOTX): ' + this.arrayNode.join());
    //Logger.trace('Bitmaps: 0 = unknown state, 1 = confirmed TX, 2 = confirmed NOTX');

    let arrayQuorum: Array<Boolean>;
    let trial: number = 0;

    // ROUND 1 - VoteTx
    // simulate the communication between the nodes to exchange TXs and the consensus algo of the nodes
    do {
      trial++;
      for (let n = 0; n < this.size; n++) {
        this.arrayBitmapPerNode[n] = this.arrayBitmapPerNode[n] || [];
        for (let b = 0; b < this.size; b++) {
          // communication: only "percMessageReliability" of messages go through
          this.arrayBitmapPerNode[n][b] =
            this.arrayBitmapPerNode[n][b] && this.arrayBitmapPerNode[n][b] > 0
              ? this.arrayBitmapPerNode[n][b]
              : Math.random() * 100 < this.pMessageReliability
                ? this.arrayNode[b]
                : 0; // node value or 0
        }

        //@FIXME logging
        //Logger.trace(`Bitmap, node ${n}: ${this.arrayBitmapPerNode[n].join()}`);
      }

      // check quorum
      arrayQuorum = [];
      for (let n = 0; n < this.size; n++) {
        // hasQuorum ?
        let sumNodes: number = 0;
        for (let b = 0; b < this.size; b++) {
          sumNodes = sumNodes + (this.arrayBitmapPerNode[b][n] > 0 ? 1 : 0);
        }
        arrayQuorum[n] = this.hasQuorum(sumNodes);
      }
    } while (!this.hasQuorum(arrayQuorum.filter((v) => v).length));

    let n: number = this.mapTrialVoteTx.get(trial) || 0;
    this.mapTrialVoteTx.set(trial, n + 1);

    // ROUND 2: processProposeTxSet
    // nodes have reached quorum of confirmed TXs, a common set of TXs must be found
    // create TxMessage set, out of confirmed Txs (confirmed TxMessage = arrayNode[node] === 1)
    const arrayBlock: Array<Array<number>> = [];
    const arrayBlockHash: Array<string> = [];
    for (let n = 0; n < this.size; n++) {
      arrayBlock[n] = [];
      const arraySet: Array<string> = [];

      // simulate online nodes in arbitrary order
      const a: Array<number> = Util.shuffleArray([...this.arrayBitmapPerNode.keys()]);

      for (const k of a) {
        const arrayProposal: Array<number> = [];
        // add Txs to proposals, if they are confirmed (confirmed TxMessage = arrayNode[k] === 1)
        this.arrayBitmapPerNode[k].forEach(
          (v: number, k: number) => v === 1 && this.arrayNode[k] === 1 && arrayProposal.push(k)
        );
        if (!this.hasQuorum(arraySet.length)) {
          arraySet.push(k + ': ' + arrayProposal.join());
          arrayProposal.forEach((v: number) => !arrayBlock[n].includes(v) && arrayBlock[n].push(v));
        } else {
          arrayBlockHash[n] = arrayBlock[n].sort((a, b) => a - b).join('');
          // block set of a single node has been created - this block is going to be signed
          break;
        }
      }

      //@FIXME logging
      //arraySet.forEach((set: string) => {
      //  Logger.trace(`Proposal Set, node ${set}`);
      //});
      //Logger.trace(`Block Set, node ${n}: ${arrayBlockHash[n]}`);
    }

    // ROUND 3: processSign
    // involves the communication of the signed block to all peers. The peers must reach quorum with the signatures.
    // distribution of block hashes
    const mapDist: Map<string, number> = new Map();
    arrayBlockHash.forEach((h: string) => {
      const n: number = mapDist.get(h) || 0;
      mapDist.set(h, n + 1);
    });

    trial = [...mapDist.values()].some((n: number) => {
      return this.hasQuorum(n);
    })
      ? 1
      : mapDist.size;
    n = this.mapTrialNewBlock.get(trial) || 0;
    this.mapTrialNewBlock.set(trial, n + 1);
  }

  private hasQuorum(n: number) {
    return n >= this.quorum;
  }

  getRuns() {
    return this.runs;
  }

  getArrayTrialVoteTx(): Array<Array<number>> {
    const a: Array<Array<number>> = [];
    this.mapTrialVoteTx.forEach((v, k) => {
      a.push([k, v]);
    });
    return a.sort((b, c) => b[0] - c[0]).slice(0, 25);
  }

  getArrayTrialNewBlock(): Array<Array<number>> {
    const a: Array<Array<number>> = [];
    this.mapTrialNewBlock.forEach((v, k) => {
      a.push([k, v]);
    });
    return a.sort((b, c) => b[0] - c[0]).slice(0, 25);
  }
}

const dcs = new DivachainSimulator(19, 10000, 70);
Logger.trace(`Runs: ${dcs.getRuns()}`);
Logger.trace(`VoteTx Trial distribution: ${JSON.stringify(dcs.getArrayTrialVoteTx())}`);
Logger.trace(`NewBlock Trial distribution: ${JSON.stringify(dcs.getArrayTrialNewBlock())}`);

// calculate costs
// formula to calculate costs:
// ROUND 1: network_size * COMM_COST * QUORUM * weighted trial
// PLUS ROUND 2: network_size * COMM_COST * QUORUM
// PLUS ROUND 3: network_size * COMM_COST * QUORUM * weighted trial
const _r: number = dcs.size * dcs.cost * dcs.quorum;
let r1: number = 0,
  r3: number = 0;
dcs.getArrayTrialVoteTx().forEach((a: Array<number>) => {
  r1 = r1 + _r * a[0] * (a[1] / dcs.getRuns());
});
dcs.getArrayTrialNewBlock().forEach((a: Array<number>) => {
  r3 = r3 + _r * a[0] * (a[1] / dcs.getRuns());
});

const eT: number = (r1 + _r + r3) / 1000 / dcs.size;
Logger.trace(`Estimated time used per Block: ${eT.toFixed(3)} secs`);
Logger.trace(`Estimated time used per TX: ${(eT / dcs.quorum).toFixed(3)} secs`);
