import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkRewardFeedUI} from './reward-feed-ui.mjs';
import {checkRewardFeedRpcUI} from './reward-feed-rpc-ui.mjs';

/** Compatibility entry retained for the isolated SQL acceptance suite.
 * Synthetic feed scenarios and real RPC assertions remain explicitly separate.
 */
export async function checkRewardDiscoveryUI(options={}) {
 const hasRpc=options.discover||options.program||options.owner||options.setup;
 return hasRpc?checkRewardFeedRpcUI(options):checkRewardFeedUI(options);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await checkRewardDiscoveryUI();
