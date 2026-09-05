#!/usr/bin/env bash
#
# Copyright (C) 2025-2026 diva.exchange
#
# See /LICENSE file for details.
#
# Author/Maintainer: DIVA.EXCHANGE Association <contact@diva.exchange>
#
set -e

PROJECT_PATH="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"/../
cd "${PROJECT_PATH}"
PROJECT_PATH=$(pwd)

echo "=> Checking dependencies (cargo, wasm-pack)..."
if ! command -v cargo &> /dev/null || ! command -v wasm-pack &> /dev/null; then
    echo "Error: cargo and wasm-pack are required. Please install them first."
    exit 1
fi

TARGET_DIR="$PROJECT_PATH/src/wasm"
TEMP_DIR=$(mktemp -d)

echo "=> Creating temporary Rust WASM project in $TEMP_DIR..."
cd "$TEMP_DIR"
cargo new --lib blake3_wasm
cd blake3_wasm

cat << 'EOF' > Cargo.toml
[package]
name = "blake3_wasm"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
wasm-bindgen = "0.2"
blake3 = "1.5"
EOF

cat << 'EOF' > src/lib.rs
use wasm_bindgen::prelude::*;
use blake3::Hasher;

#[wasm_bindgen]
pub fn hash_hex(input: &str) -> String {
    let mut hasher = Hasher::new();
    hasher.update(input.as_bytes());
    hasher.finalize().to_hex().to_string()
}

#[wasm_bindgen]
pub fn grind_pow(pub_key: &str, target_zeros: usize) -> String {
    let prefix = "0".repeat(target_zeros);
    let mut nonce: u64 = 0;

    loop {
        let nonce_str = format!("{:x}", nonce);
        
        let mut hasher = Hasher::new();
        hasher.update(pub_key.as_bytes());
        hasher.update(nonce_str.as_bytes());
        let hash_str = hasher.finalize().to_hex().to_string();

        if hash_str.starts_with(&prefix) {
            return nonce_str;
        }
        nonce += 1;
    }
}
EOF

echo "=> Compiling to WebAssembly..."
wasm-pack build --target web --out-dir "$TARGET_DIR" --release

echo "=> Cleanup..."
rm -rf "$TEMP_DIR"
rm -f "$TARGET_DIR/.gitignore" "$TARGET_DIR/package.json"

cd "$PROJECT_PATH/src/client" && ln -sfn ../wasm wasm

echo "=> Success! Shared WASM files built in $TARGET_DIR"