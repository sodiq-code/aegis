import { JsonRpcProvider, Contract, keccak256, toUtf8Bytes } from 'ethers';
const provider = new JsonRpcProvider('https://coston2-api.flare.network/ext/C/rpc');

const VerifierRole = '0xb513516d02d88be754c5204e132defbb0f4156e6';
const verifierAddr = '0xe37Ee912289B047A7C5e9DC8c15ab23E21b8b0C4';

// hasRole(Role enum, address) — Role.VERIFIER = 1
// Selector: keccak256("hasRole(uint8,address)")[:4]
const sel = keccak256(toUtf8Bytes('hasRole(uint8,address)')).slice(0, 10);
console.log('hasRole(uint8,address) selector:', sel);

// Role enum: DEFAULT_ADMIN=0, VERIFIER=1, OPERATOR=2, DEPOSITOR=3
for (const [name, role] of [['DEFAULT_ADMIN', 0], ['VERIFIER', 1], ['OPERATOR', 2], ['DEPOSITOR', 3]] as const) {
  const data = sel + role.toString(16).padStart(64, '0') + verifierAddr.slice(2).padStart(64, '0');
  try {
    const r = await provider.call({ to: VerifierRole, data });
    console.log(`hasRole(${name}, ${verifierAddr}):`, r === '0x' + '0'.repeat(63) + '1' ? 'TRUE' : 'FALSE');
  } catch (e: any) {
    console.log(`hasRole(${name}) err:`, e.message?.slice(0, 100));
  }
}

// getRoleMemberCount(uint8)
const countSel = keccak256(toUtf8Bytes('getRoleMemberCount(uint8)')).slice(0, 10);
for (const [name, role] of [['DEFAULT_ADMIN', 0], ['VERIFIER', 1]] as const) {
  const data = countSel + role.toString(16).padStart(64, '0');
  try {
    const r = await provider.call({ to: VerifierRole, data });
    console.log(`getRoleMemberCount(${name}):`, BigInt(r).toString());
  } catch (e: any) {
    console.log(`getRoleMemberCount(${name}) err:`, e.message?.slice(0, 100));
  }
}

// getRoleMembers(uint8)
const membersSel = keccak256(toUtf8Bytes('getRoleMembers(uint8)')).slice(0, 10);
for (const [name, role] of [['DEFAULT_ADMIN', 0], ['VERIFIER', 1]] as const) {
  const data = membersSel + role.toString(16).padStart(64, '0');
  try {
    const r = await provider.call({ to: VerifierRole, data });
    // Decode dynamic array of addresses
    if (r && r !== '0x') {
      const count = BigInt(r.slice(2, 66));
      console.log(`getRoleMembers(${name}): count=${count}`);
      for (let i = 0; i < Number(count); i++) {
        const addr = '0x' + r.slice(66 + i*64 + 24, 66 + (i+1)*64);
        console.log(`  [${i}] ${addr}`);
      }
    }
  } catch (e: any) {
    console.log(`getRoleMembers(${name}) err:`, e.message?.slice(0, 100));
  }
}

// Try isVerifiedTEE(address)
const ivtSel = keccak256(toUtf8Bytes('isVerifiedTEE(address)')).slice(0, 10);
const data = ivtSel + verifierAddr.slice(2).padStart(64, '0');
try {
  const r = await provider.call({ to: VerifierRole, data });
  console.log(`isVerifiedTEE(${verifierAddr}):`, r);
} catch (e: any) {
  console.log(`isVerifiedTEE err:`, e.message?.slice(0, 100));
}

// FDC verification — try the correct Coston2 address and selector
// Per Flare docs, FdcVerification on Coston2: 0x...; merkleRoot(uint256) selector
const fdcAddrs = ['0x906507E0B64bcD494Db73bd0459d1C667e14B933', '0xA34Ff9be42b2C7782786270a51d33b1baC0462Cd'];
const fdcSel = keccak256(toUtf8Bytes('merkleRoot(uint256)')).slice(0, 10);
console.log('\nmerkleRoot(uint256) selector:', fdcSel);
const round = 1416145;
const roundHex = round.toString(16).padStart(64, '0');
for (const addr of fdcAddrs) {
  const data = fdcSel + roundHex;
  try {
    const r = await provider.call({ to: addr, data });
    console.log(`FdcVerification@${addr}.merkleRoot(${round}):`, r);
  } catch (e: any) {
    console.log(`FdcVerification@${addr}.merkleRoot(${round}) err:`, e.message?.slice(0, 100));
  }
}
