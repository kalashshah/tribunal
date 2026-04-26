import "@nomicfoundation/hardhat-toolbox";
import { HardhatUserConfig } from "hardhat/config";
import * as dotenv from "dotenv";
dotenv.config({ path: "../.env" });

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.27",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  paths: { sources: "src" },
  networks: {
    ogTestnet: {
      url: process.env.OG_RPC_URL ?? "https://evmrpc-testnet.0g.ai",
      accounts: process.env.OG_PRIVATE_KEY ? [process.env.OG_PRIVATE_KEY] : [],
      // 0G Galileo testnet — verified at deploy time against the live RPC.
      chainId: 16602,
    },
  },
};

export default config;
