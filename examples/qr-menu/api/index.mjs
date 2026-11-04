import target from '../qa-targets.json' with { type: 'json' };
import {createServerlessHandler} from '../serverless.mjs';
export default createServerlessHandler({env:process.env,target});
