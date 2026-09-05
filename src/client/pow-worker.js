/**
 * Copyright (C) 2021-2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import init, { grind_pow } from './wasm/blake3_wasm.js';

self.onmessage = async (e) => {
    const { pubKey, targetZeros } = e.data;
    
    try {
        await init();
        self.postMessage({ type: 'log', msg: `[Worker] Started native Rust PoW grinding for ${pubKey.substring(0,8)}...` });
        
        const startTime = Date.now();
        
        const nonce = grind_pow(pubKey, targetZeros);
        
        const elapsed = (Date.now() - startTime) / 1000;
        self.postMessage({ type: 'success', nonce, time: elapsed });
        
    } catch (err) {
        self.postMessage({ type: 'log', msg: `[Worker] Crash: ${err.message}` });
    }
};