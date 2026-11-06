// Explicit nonce tracking for rapid-fire transactions.
//
// Some nodes serve a transaction receipt before their account-nonce state
// catches up, so back-to-back txs from one account must not rely on the
// node-reported nonce. This sender tracks the nonce locally.
import { ethers } from "ethers";

export class Sender {
  constructor(provider, wallet) {
    this.provider = provider;
    this.wallet = wallet;
    this.nonce = null;
  }

  async init() {
    this.nonce = await this.provider.getTransactionCount(await this.wallet.getAddress());
  }

  /** Send a raw transaction request with the next tracked nonce. Returns the receipt. */
  async send(txRequest) {
    const sent = await this.wallet.sendTransaction({ ...txRequest, nonce: this.nonce++ });
    return sent.wait();
  }

  /** Deploy a contract. Returns an ethers.Contract connected to the wallet. */
  async deploy(abi, bytecode, ...args) {
    const factory = new ethers.ContractFactory(abi, bytecode, this.wallet);
    const txRequest = await factory.getDeployTransaction(...args);
    const receipt = await this.send(txRequest);
    return new ethers.Contract(receipt.contractAddress, abi, this.wallet);
  }

  /** Call a state-changing contract method. Returns the receipt. */
  async call(contract, method, ...args) {
    const txRequest = await contract[method].populateTransaction(...args);
    return this.send(txRequest);
  }
}
