# 🌐 DivaChain — The Comprehensive Truth Manual
*Version 0.60.0 — Official Technical & Philosophical Reference*

---

## 🧒 1. The "5th Grader" Explanation
**What is DivaChain?**

Imagine you and your friends have a secret club where you trade trading cards. You don't want a "Boss" or a "Teacher" watching you or taking a piece of your lunch money as a fee.

**DivaChain is the technology that makes the club work:**

1.  **Your Own Notebook:** Instead of one big blackboard that only a teacher can write on, everyone has their own notebook. You only write your own trades in your notebook.
2.  **Secret Tunnels (I2P):** When you want to tell a friend about a trade, you send the message through a secret tunnel so no one in the hallway knows who is talking.
3.  **The Rule of the Signature:** You sign every trade with a special magic stamp (**Cryptography**). This proves it was really you and not an impostor.
4.  **The Club Vote (PBFT):** Before a trade is "Official," the club members look at the trade and say "Looks good!" If 2 out of 3 members agree, the trade is locked into history. This is called "Consensus"—building the chain by talking instead of doing hard math.

**Result:** You are your own bank. You are free.

---

## 🏗️ 2. System Architecture: Distributed Multi-Chain

DivaChain v0.60.0 is a decentralized state machine built on the **Deno** runtime. It uses a **Distributed Multi-Chain** model optimized for privacy and low-energy usage.

### **The Consensus Model**
*   **Weighted PBFT:** The protocol utilizes **Practical Byzantine Fault Tolerance** combined with **Proof-of-Stake (PoS)**.
*   **Communication over Computation:** Unlike Bitcoin (which uses electricity to solve puzzles), DivaChain builds the chain through "Communication"—nodes vote on proposals to reach agreement.
*   **Sovereign Chains:** Each node maintains its own independent transaction history and follows the chains of trusted peers.

---

## 📡 3. Networking & Transport (I2P Sovereignty)

DivaChain is "Invisible-By-Design." It utilizes the **I2P (Invisible Internet Project)** as its exclusive transport layer to ensure identity is separated from transaction data.

### **Transport Coordinates**
*   **SAM Bridge:** Local communication with the I2P router via `127.0.0.1:7656`.
*   **SOCKS5 Proxy:** Outbound synchronization traffic is routed through the I2P SOCKS proxy at `127.0.0.1:4445`.
*   **B32 Destinations:** Peer identities are mapped to I2P Base32 destination strings.

---

## 📂 4. Transaction & Command Logic

The system utilizes a structured JSON schema (v1) for all chain operations.

### **Transaction Structure (v1)**
| Field | Type | Description |
| :--- | :--- | :--- |
| `o` | String | Origin (Public Key of Sender) |
| `ha` | String | Cryptographic Hash of the Transaction |
| `cs` | Array | Command payload (Max 32 commands) |

### **The `data` Command**
*   **Identity Locking:** DivaChain automatically protects your data by appending your public key to the state entry (e.g., `namespace:your_pubkey`). Only the rightful owner of a namespace can update its values.
*   **Namespace Format:** The `ns` field must match `[A-Za-z0-9_-]{2,16}` per colon-separated segment, with 2–8 total segments (e.g., `diva:docs`, `app:user:settings`).
*   **Data Size Limit:** The `d` field has a hard cap of **8,192 bytes (8KB)**. Submissions exceeding this will be rejected.

---

## 🛠️ 5. API Reference (Localhost)

The node exposes a REST API on port **17468** and a WebSocket stream on port **17469**.

### **Read Operations**
*   `GET /about`: Node version and public key identity.
*   `GET /network`: Current list of known peers and their I2P coordinates.
*   `GET /state/{key}`: Fetch specific values from the local state DB.

### **Write Operations**
*   `GET /testnet/token`: Retrieve a rotating session token (required for submission).
*   `PUT /tx`: Submit a new transaction bundle. Requires the `diva-token-api` header.

---

## 🛡️ 6. Gotchas & Implementation Notes

*   **Alpine/musl Compatibility:** You must manually link the `sodium-native` C++ binary to the `linux-x64-musl` path for the crypto engine to load.
*   **Deno Permissions:** Your `deno.json` must include `"allowScripts": ["npm:sodium-native@5.1.0", "npm:classic-level@3.0.0"]`.
*   **Lockfile Sanity:** If you see "Unsupported lockfile version," delete `deno.lock` and let Deno recreate it to ensure environment compatibility.
*   **LevelDB LOCK Files:** If the node crashes or is killed with SIGKILL, LevelDB leaves a `LOCK` file behind. The node will refuse to start until you clear it: `find test/data/ -name LOCK -delete`.
*   **I2P Bootstrap Time:** After first launch, I2P needs **10–30 minutes** to establish its hidden service tunnels. The API is accessible during this window, but peer-to-peer sync will not start until tunnels are live.
*   **Quorum Requirement:** Transactions require a majority vote from network peers to commit. On a **single-node devnet**, submitted transactions will remain `pending` indefinitely — this is expected behavior, not a bug.
*   **Token Rotation:** The testnet API token (`GET /testnet/token`) rotates every **3–10 minutes**. Cache it for one session only; fetch a fresh one if you receive a `401`.

---

*Verified against DivaChain v0.60.0 source code and official documentation.*
