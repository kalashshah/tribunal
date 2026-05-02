// Single source of truth for the rulebook deployment the web reads from.
// We DELIBERATELY point at 0G Galileo, not the local hardhat dev chain —
// the rulebook is meant to be publicly verifiable, so the page reads the
// live testnet regardless of local dev state.

import { DEPLOYMENT } from "./explorer";

export const RULEBOOK_RPC_URL =
  process.env.WEB_RULEBOOK_RPC_URL ??
  process.env.OG_RPC_URL ??
  "https://evmrpc-testnet.0g.ai";

export const RULEBOOK_ADDR = DEPLOYMENT.ogGalileo.contracts.RuleBook;
export const GOVERNOR_ADDR = DEPLOYMENT.ogGalileo.contracts.RuleBookGovernor;
