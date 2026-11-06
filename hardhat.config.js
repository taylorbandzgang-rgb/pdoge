import dotenv from "dotenv";
dotenv.config();

const PDOGE_RPC_URL = process.env.PDOGE_RPC_URL || "http://127.0.0.1:8546";

const networks = {
  hardhat: {
    type: "edr-simulated",
    chainId: 42069,
  },
  // PseudoDogecoin — Domenic's chain. Native gas token: PDOGE.
  // Gas price is set by the chain operator (you), so fees are fractions of a cent.
  pdoge: {
    type: "http",
    url: PDOGE_RPC_URL,
    chainId: 42069,
  },
};

/** @type import('hardhat/config').HardhatUserConfig */
export default {
  solidity: "0.8.24",
  networks,
};

export { PDOGE_RPC_URL };
