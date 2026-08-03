#!/usr/bin/env python3
"""
Policy Transaction Helper for Aegis.

Signs and sends transactions to the PolicyRegistry contract on Coston2.
Uses raw JSON-RPC + eth_keys for signing (no web3.py dependency issues).

Usage:
  python3 policy-tx.py update-policy <policyId> "<fieldChanged>"
  python3 policy-tx.py set-policy <policyId> <policyJsonFile>
  python3 policy-tx.py read-policy <policyId>
  python3 policy-tx.py read-all
  python3 policy-tx.py set-status <policyId> <true|false>
"""

import sys
import json
import os
import urllib.request

# Configuration
RPC_URL = 'https://coston2-api.flare.network/ext/C/rpc'
POLICY_REGISTRY = '0xe3fd8668bd865f53c462abc02fe6c6c4397e8cf5'
CHAIN_ID = 114
PRIVATE_KEY = os.environ.get('AEGIS_DEPLOYER_KEY', '0xb3e509a0949e4d4ae489025a95eae959df178188f2c6ca130eceb2ef4ac70951')


def rpc_call(method, params=None):
    if params is None:
        params = []
    data = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}).encode()
    req = urllib.request.Request(RPC_URL, data=data, headers={'Content-Type': 'application/json'})
    resp = urllib.request.urlopen(req, timeout=30)
    result = json.loads(resp.read())
    if 'error' in result:
        raise Exception(f"RPC error: {result['error']}")
    return result['result']


def get_account():
    from eth_keys import keys
    from eth_utils import to_bytes
    pk_bytes = to_bytes(hexstr=PRIVATE_KEY)
    pk = keys.PrivateKey(pk_bytes)
    return pk


def sign_and_send_tx(to, data_hex, gas_limit=300000):
    """Sign and send a transaction using eth_keys + raw RLP encoding."""
    from eth_keys import keys
    from eth_utils import to_bytes
    import hashlib
    
    pk = get_account()
    from_addr = pk.public_key.to_checksum_address()
    
    # Get nonce and gas price
    nonce = int(rpc_call('eth_getTransactionCount', [from_addr, 'latest']), 16)
    gas_price = int(rpc_call('eth_gasPrice'), 16)
    
    from rlp import encode as rlp_encode
    from Crypto.Hash import keccak as eth_keccak_mod
    
    # Build unsigned tx fields for EIP-155
    # [nonce, gasPrice, gasLimit, to, value, data, chainId, 0, 0]
    nonce_b = int_to_bytes(nonce)
    gas_price_b = int_to_bytes(gas_price)
    gas_limit_b = int_to_bytes(gas_limit)
    to_b = bytes.fromhex(to[2:]) if to else b''
    value_b = b''  # 0 value = empty bytes in RLP (not b'\x00')
    data_b = bytes.fromhex(data_hex[2:]) if data_hex.startswith('0x') else bytes.fromhex(data_hex)
    
    # Encode unsigned tx (EIP-155: chainId, 0, 0 appended)
    unsigned_tx = [
        nonce_b, gas_price_b, gas_limit_b, to_b, value_b, data_b,
        int_to_bytes(CHAIN_ID), b'', b''
    ]
    
    encoded_unsigned = rlp_encode(unsigned_tx)
    
    # Hash with Keccak-256 (NOT SHA3-256 — Ethereum uses the original Keccak)
    k = eth_keccak_mod.new(digest_bits=256)
    k.update(encoded_unsigned)
    tx_hash = k.digest()
    
    # Sign with ECDSA
    sig = pk.sign_msg_hash(tx_hash)
    
    v = CHAIN_ID * 2 + 35 + sig.v
    r = sig.r.to_bytes(32, 'big')
    s = sig.s.to_bytes(32, 'big')
    
    # Build signed tx: [nonce, gasPrice, gasLimit, to, value, data, v, r, s]
    signed_tx = [
        nonce_b, gas_price_b, gas_limit_b, to_b, value_b, data_b,
        int_to_bytes(v), r, s
    ]
    
    encoded_signed = rlp_encode(signed_tx)
    raw_tx = '0x' + encoded_signed.hex()
    
    # Send
    tx_hash_result = rpc_call('eth_sendRawTransaction', [raw_tx])
    
    # Wait for receipt
    import time
    for _ in range(60):
        receipt = rpc_call('eth_getTransactionReceipt', [tx_hash_result])
        if receipt is not None:
            return {
                'txHash': tx_hash_result,
                'blockNumber': int(receipt['blockNumber'], 16),
                'gasUsed': int(receipt['gasUsed'], 16),
                'status': int(receipt['status'], 16),
            }
        time.sleep(2)
    
    return {'txHash': tx_hash_result, 'status': 'pending'}


def int_to_bytes(n):
    """Convert non-negative integer to bytes (big-endian, no leading zeros)."""
    if n == 0:
        return b'\x00'
    hex_str = hex(n)[2:]
    if len(hex_str) % 2:
        hex_str = '0' + hex_str
    return bytes.fromhex(hex_str)


# --- Function selector computation ---

def eth_keccak256(text):
    """Compute Keccak-256 hash (Ethereum's hash, NOT NIST SHA3-256)."""
    from Crypto.Hash import keccak
    k = keccak.new(digest_bits=256)
    k.update(text.encode())
    return k.hexdigest()[:8]


# Pre-computed selectors (verified on Coston2)
SELECTORS = {
    'getPolicyCount': eth_keccak256('getPolicyCount()'),         # 0xe59771d2
    'getPolicy': eth_keccak256('getPolicy(uint256)'),             # 0x2b07fce3
    'updatePolicy': eth_keccak256('updatePolicy(uint256,string)'),  # 0xb9d1d745
    'setPolicyStatus': eth_keccak256('setPolicyStatus(uint256,bool)'),  # 0xbef98d9d
}


def encode_uint256(val):
    return hex(val)[2:].zfill(64)


def encode_string(s):
    """ABI-encode a string (dynamic type)."""
    utf8_bytes = s.encode('utf-8')
    length = len(utf8_bytes)
    length_word = encode_uint256(length)
    # Pad to 32-byte boundary
    hex_data = utf8_bytes.hex()
    padded = hex_data + '0' * (64 - len(hex_data) % 64) if len(hex_data) % 64 != 0 else hex_data
    return length_word + padded


def read_policy(policy_id):
    """Read a single policy from on-chain (raw ABI decode)."""
    call_data = '0x' + SELECTORS['getPolicy'] + encode_uint256(policy_id)
    result = rpc_call('eth_call', [{'to': POLICY_REGISTRY, 'data': call_data}, 'latest'])
    
    # Decode (same approach as in the TS flare-rpc.ts)
    hex_data = result[2:]
    words = [hex_data[i:i+64] for i in range(0, len(hex_data), 64)]
    
    s = 1  # struct start
    policy = {
        'policyId': int(words[s+0], 16),
        'owner': '0x' + words[s+1][-40:],
        'name': decode_string(words, s, int(words[s+2], 16)),
        'description': decode_string(words, s, int(words[s+3], 16)),
        'riskLevel': int(words[s+4], 16),
        'isActive': int(words[s+5], 16) != 0,
        'createdAt': int(words[s+6], 16),
        'updatedAt': int(words[s+7], 16),
        'maxDrawdownBps': int(words[s+8], 16),
        'maxSingleExposureBps': int(words[s+9], 16),
        'hedgeThresholdBps': int(words[s+10], 16),
        'allowedAssets': decode_address_array(words, s, int(words[s+11], 16)),
        'maxDepositPerTx': int(words[s+12], 16),
        'maxWithdrawalPerTx': int(words[s+13], 16),
        'maxTotalExposure': int(words[s+14], 16),
        'minCollateralRatio': int(words[s+15], 16),
        'maxLeverage': int(words[s+16], 16),
        'withdrawalDelaySeconds': int(words[s+17], 16),
        'rebalanceThresholdBps': int(words[s+18], 16),
        'maxSlippageBps': int(words[s+19], 16),
        'onRiskBreach': int(words[s+20], 16),
        'onSolvencyWarning': int(words[s+21], 16),
    }
    
    print(json.dumps(policy, indent=2))


def decode_string(words, struct_start, offset):
    """Decode an ABI-encoded string from the word array."""
    word_idx = struct_start + (offset // 32)
    length = int(words[word_idx], 16)
    n_words = (length + 31) // 32
    hex_data = ''.join(words[word_idx+1:word_idx+1+n_words])
    return bytes.fromhex(hex_data[:length*2]).decode('utf-8', errors='replace')


def decode_address_array(words, struct_start, offset):
    """Decode an ABI-encoded address[] from the word array."""
    word_idx = struct_start + (offset // 32)
    count = int(words[word_idx], 16)
    addresses = []
    for i in range(count):
        addresses.append('0x' + words[word_idx+1+i][-40:])
    return addresses


def read_all():
    """Read all policies from on-chain."""
    count_hex = rpc_call('eth_call', [{'to': POLICY_REGISTRY, 'data': '0x' + SELECTORS['getPolicyCount']}, 'latest'])
    count = int(count_hex, 16)
    
    policies = []
    for i in range(1, count + 1):
        call_data = '0x' + SELECTORS['getPolicy'] + encode_uint256(i)
        result = rpc_call('eth_call', [{'to': POLICY_REGISTRY, 'data': call_data}, 'latest'])
        
        hex_data = result[2:]
        words = [hex_data[j:j+64] for j in range(0, len(hex_data), 64)]
        
        s = 1
        policy = {
            'policyId': int(words[s+0], 16),
            'owner': '0x' + words[s+1][-40:],
            'name': decode_string(words, s, int(words[s+2], 16)),
            'description': decode_string(words, s, int(words[s+3], 16)),
            'riskLevel': int(words[s+4], 16),
            'isActive': int(words[s+5], 16) != 0,
            'createdAt': int(words[s+6], 16),
            'updatedAt': int(words[s+7], 16),
            'maxDrawdownBps': int(words[s+8], 16),
            'maxSingleExposureBps': int(words[s+9], 16),
            'hedgeThresholdBps': int(words[s+10], 16),
            'allowedAssets': decode_address_array(words, s, int(words[s+11], 16)),
            'maxDepositPerTx': int(words[s+12], 16),
            'maxWithdrawalPerTx': int(words[s+13], 16),
            'maxTotalExposure': int(words[s+14], 16),
            'minCollateralRatio': int(words[s+15], 16),
            'maxLeverage': int(words[s+16], 16),
            'withdrawalDelaySeconds': int(words[s+17], 16),
            'rebalanceThresholdBps': int(words[s+18], 16),
            'maxSlippageBps': int(words[s+19], 16),
            'onRiskBreach': int(words[s+20], 16),
            'onSolvencyWarning': int(words[s+21], 16),
        }
        policies.append(policy)
    
    print(json.dumps({'count': count, 'policies': policies}, indent=2))


def update_policy(policy_id, field_changed):
    """Send an updatePolicy transaction."""
    # updatePolicy(uint256 policyId, string fieldChanged)
    # ABI encode: selector + policyId + string
    selector = SELECTORS['updatePolicy']
    
    # String encoding: offset (since it's a dynamic type after uint256)
    # [policyId (32 bytes)] [string_offset (32 bytes)] [string_data...]
    # string_offset = 64 (after policyId + offset word)
    string_offset = 64
    string_data = encode_string(field_changed)
    
    call_data = '0x' + selector + encode_uint256(policy_id) + encode_uint256(string_offset) + string_data
    
    result = sign_and_send_tx(POLICY_REGISTRY, call_data, gas_limit=200000)
    result['method'] = 'updatePolicy'
    result['policyId'] = policy_id
    result['fieldChanged'] = field_changed
    
    print(json.dumps(result, indent=2))


def set_policy_status(policy_id, is_active):
    """Send a setPolicyStatus transaction."""
    # setPolicyStatus(uint256 policyId, bool isActive)
    selector = SELECTORS['setPolicyStatus']
    bool_val = '1'.zfill(64) if is_active else '0'.zfill(64)
    call_data = '0x' + selector + encode_uint256(policy_id) + bool_val
    
    result = sign_and_send_tx(POLICY_REGISTRY, call_data, gas_limit=100000)
    result['method'] = 'setPolicyStatus'
    result['policyId'] = policy_id
    result['isActive'] = is_active
    
    print(json.dumps(result, indent=2))


def main():
    if len(sys.argv) < 2:
        print("Usage: policy-tx.py <command> [args...]")
        print("Commands: update-policy, set-policy, read-policy, read-all, set-status")
        sys.exit(1)
    
    command = sys.argv[1]
    
    if command == 'read-policy':
        policy_id = int(sys.argv[2])
        read_policy(policy_id)
    elif command == 'read-all':
        read_all()
    elif command == 'update-policy':
        policy_id = int(sys.argv[2])
        field_changed = sys.argv[3] if len(sys.argv) > 3 else "parameter update"
        update_policy(policy_id, field_changed)
    elif command == 'set-policy':
        policy_id = int(sys.argv[2])
        policy_json_file = sys.argv[3]
        # TODO: full setPolicy implementation if needed
        print(json.dumps({'error': 'set-policy full struct not yet implemented - use update-policy instead'}))
    elif command == 'set-status':
        policy_id = int(sys.argv[2])
        is_active = sys.argv[3].lower() in ('true', '1', 'yes')
        set_policy_status(policy_id, is_active)
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)


if __name__ == '__main__':
    main()
