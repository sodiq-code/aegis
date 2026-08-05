import { ethers } from 'ethers';
const RPC = 'https://coston2-api.flare.network/ext/C/rpc';
const p = new ethers.JsonRpcProvider(RPC);
const txHash = '0xfc4958dda1b0c9850bd099335278b11b6f1198e4e6e2b3e3d732278ec46a728a';

const tx = await p.getTransaction(txHash);
console.log('TX from:', tx.from);
console.log('TX to:', tx.to);
console.log('TX value:', tx.value.toString());
console.log('TX nonce:', tx.nonce);
console.log('TX data length:', tx.data.length);
console.log('TX data (first 200 chars):', tx.data.slice(0, 200));

const receipt = await p.getTransactionReceipt(txHash);
console.log('\nReceipt status:', receipt.status);
console.log('Block:', receipt.blockNumber);
console.log('Gas used:', receipt.gasUsed.toString());
console.log('Logs:', receipt.logs.length);
for (const l of receipt.logs) {
  console.log('  log addr:', l.address, 'topics[0]:', l.topics[0]);
  if (l.topics[0] === ethers.id('DirectMintingExecuted(address,address,uint256,uint256,uint256)')) {
    const iface = new ethers.Interface(['event DirectMintingExecuted(address indexed agentVault, address indexed targetAddress, uint256 mintedAmountUBA, uint256 mintingFeeUBA, uint256 executorFeeUBA)']);
    const parsed = iface.parseLog({ topics: l.topics, data: l.data });
    console.log('    DirectMintingExecuted:');
    console.log('      agentVault:', parsed.args.agentVault);
    console.log('      targetAddress:', parsed.args.targetAddress);
    console.log('      mintedAmountUBA:', parsed.args.mintedAmountUBA.toString(), `(${ethers.formatUnits(parsed.args.mintedAmountUBA, 6)} FXRP)`);
    console.log('      mintingFeeUBA:', parsed.args.mintingFeeUBA.toString(), `(${ethers.formatUnits(parsed.args.mintingFeeUBA, 6)} FXRP)`);
    console.log('      executorFeeUBA:', parsed.args.executorFeeUBA.toString(), `(${ethers.formatUnits(parsed.args.executorFeeUBA, 6)} FXRP)`);
  }
}

const block = await p.getBlock(receipt.blockNumber);
console.log('\nBlock timestamp:', block.timestamp, '→', new Date(block.timestamp*1000).toISOString());

// Now check the FdcHub request tx 0xdff25459afe8325991560dddd541d5b92184f9477b8d87174155133c39cc757c
console.log('\n--- FdcHub request tx (my submission) ---');
const myTx = await p.getTransaction('0xdff25459afe8325991560dddd541d5b92184f9477b8d87174155133c39cc757c');
console.log('My TX from:', myTx.from);
console.log('My TX to:', myTx.to);
console.log('My TX block:', (await p.getTransactionReceipt('0xdff25459afe8325991560dddd541d5b92184f9477b8d87174155133c39cc757c')).blockNumber);
const myBlock = await p.getBlock((await p.getTransactionReceipt('0xdff25459afe8325991560dddd541d5b92184f9477b8d87174155133c39cc757c')).blockNumber);
console.log('My TX block timestamp:', myBlock.timestamp, '→', new Date(myBlock.timestamp*1000).toISOString());
