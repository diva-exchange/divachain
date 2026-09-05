/**
 * Copyright (C) 2026 diva.exchange
 *
 * See /LICENSE file for details.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import WebSocket from 'ws';

export const awaitWsOpen = (ws: WebSocket): Promise<void> => {
  if (ws.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('WebSocket Open Timeout')),
      2000,
    );
    ws.on('open', () => {
      clearTimeout(timer);
      resolve();
    });
  });
};

export const awaitWsClose = (ws: WebSocket): Promise<void> => {
  if (ws.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    ws.on('close', () => resolve());
    ws.on('error', () => resolve());
  });
};
