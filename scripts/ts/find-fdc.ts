// The FdcVerification contract at 0x906507... is only 170 bytes — it's a proxy/stub.
// Let me search the Flare docs for the correct Coston2 FdcVerification address.
// Per Flare docs: https://dev.flare.network/fdc/reference/addresses
// On Coston2, the real FDC contracts are deployed at specific addresses.

import { JsonRpcProvider } from 'ethers';
const provider = new JsonRpcProvider('https://coston2-api.flare.network/ext/C/rpc');

// Let me check several known Flare Coston2 addresses for FDC
// Per the Flare docs, the FdcVerification on Coston2 might be at a different address
// Let me check the FlareSystemsManager for the correct address
// Actually, let me check what's at the FdcHub address and trace from there
const fdcHub = '0x48aC463d7975828989331F4De43341627b9c5f1D';
const code = await provider.getCode(fdcHub);
console.log(`FdcHub code length: ${(code.length - 2) / 2} bytes`);

// Let me check the Coston2 chain registry for the real FDC addresses
// Per https://dev.flare.network/, Coston2 FDC contracts:
// FdcHub: 0x48aC463d7975828989331F4De43341627b9c5f1D  (we have this)
// FdcVerification: 0x... (need to find the real one)

// Let me look at the FlareSystemsManager to find the verification contract
const fsm = '0xA90Db6D10F856799b10ef2A77EBCbF460aC71e52';
const fsmCode = await provider.getCode(fsm);
console.log(`FlareSystemsManager code length: ${(fsmCode.length - 2) / 2} bytes`);

// Check if FdcVerification at 0x906507... is a proxy that delegates elsewhere
const fdcVerif = '0x906507E0B64bcD494Db73bd0459d1C667e14B933';
const fdcVerifCode = await provider.getCode(fdcVerif);
console.log(`\nFdcVerification @ 0x906507... code (${(fdcVerifCode.length-2)/2} bytes):`);
console.log(fdcVerifCode);
console.log('\n(This is likely a minimal proxy pointing to an implementation)');

// The EIP-1967 proxy storage slot
const proxySlot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const implRaw = await provider.getStorage(fdcVerif, proxySlot);
console.log(`\nEIP-1967 implementation slot: ${implRaw}`);
if (implRaw !== '0x' + '0'.repeat(64)) {
  const implAddr = '0x' + implRaw.slice(26);
  console.log(`Implementation address: ${implAddr}`);
  const implCode = await provider.getCode(implAddr);
  console.log(`Implementation code length: ${(implCode.length - 2) / 2} bytes`);
}
