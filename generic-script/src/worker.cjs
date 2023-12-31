/*
 * Copyright (c) 2023 Fair Protocol
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const fs = require('fs');
const crypto = require('crypto');
const NodeBundlr = require('@bundlr-network/client');
const { WarpFactory } = require('warp-contracts');
const { ApolloClient, gql, InMemoryCache } = require('@apollo/client/core');
const { DeployPlugin } = require('warp-contracts-plugin-deploy');
const workerpool = require('workerpool');

const APP_NAME_TAG = 'App-Name';
const APP_VERSION_TAG = 'App-Version';
const PROTOCOL_NAME_TAG = 'Protocol-Name';
const PROTOCOL_VERSION_TAG = 'Protocol-Version';
const CONVERSATION_IDENTIFIER_TAG = 'Conversation-Identifier';
const CONTENT_TYPE_TAG = 'Content-Type';
const UNIX_TIME_TAG = 'Unix-Time';
const SCRIPT_CURATOR_TAG = 'Script-Curator';
const SCRIPT_NAME_TAG = 'Script-Name';
const SCRIPT_USER_TAG = 'Script-User';
const REQUEST_TRANSACTION_TAG = 'Request-Transaction';
const OPERATION_NAME_TAG = 'Operation-Name';
const INFERENCE_TRANSACTION_TAG = 'Inference-Transaction';
const CONTRACT_TAG = 'Contract';
const INPUT_TAG = 'Input';
const SEQUENCE_OWNER_TAG = 'Sequencer-Owner';
const SCRIPT_TRANSACTION_TAG = 'Script-Transaction';
const ASSET_NAMES_TAG = 'Asset-Names';
const NEGATIVE_PROMPT_TAG = 'Negative-Prompt';
const PROMPT_TAG = 'Prompt';
const INDEXED_BY_TAG = 'Indexed-By';
const TOPIC_AI_TAG = 'topic:ai-generated';
const MODEL_NAME_TAG = 'Model-Name';
const DESCRIPTION_TAG = 'Description';
const USER_CUSOM_TAGS_TAG = 'User-Custom-Tags';
const INFERENCE_SEED_TAG = 'Inference-Seed';
const RESPONSE_TRANSACTION_TAG = 'Response-Transaction';
const REGISTRATION_TRANSACTION_TAG = 'Registration-Transaction';
const SCRIPT_OPERATOR_TAG = 'Script-Operator';
const N_IMAGES_TAG = 'N-Images';

const NOT_OVERRIDABLE_TAGS = [
  APP_NAME_TAG,
  APP_VERSION_TAG,
  PROTOCOL_NAME_TAG,
  PROTOCOL_VERSION_TAG,
  SCRIPT_NAME_TAG,
  SCRIPT_CURATOR_TAG,
  OPERATION_NAME_TAG,
  SCRIPT_TRANSACTION_TAG,
  INFERENCE_TRANSACTION_TAG,
  REQUEST_TRANSACTION_TAG,
  RESPONSE_TRANSACTION_TAG,
  REGISTRATION_TRANSACTION_TAG,
  CONTRACT_TAG,
  INPUT_TAG,
  SEQUENCE_OWNER_TAG,
  UNIX_TIME_TAG,
  MODEL_NAME_TAG,
  PROMPT_TAG,
  NEGATIVE_PROMPT_TAG,
  INFERENCE_SEED_TAG,
  SCRIPT_USER_TAG,
  CONTENT_TYPE_TAG,
  SCRIPT_OPERATOR_TAG,
  CONVERSATION_IDENTIFIER_TAG
];

const PROTOCOL_NAME = 'Fair Protocol';

const NET_ARWEAVE_URL = 'https://arweave.net';
const NODE2_BUNDLR_URL = 'https://node2.bundlr.network';


const VAULT_ADDRESS = 'tXd-BOaxmxtgswzwMLnryROAYlX5uDC9-XK2P4VNCQQ';
const MARKETPLACE_PERCENTAGE_FEE = 0.1;
const CURATOR_PERCENTAGE_FEE = 0.05;
const CREATOR_PERCENTAGE_FEE = 0.15;
const U_CONTRACT_ID = 'KTzTXT_ANmF84fWEKHzWURD1LWd9QaFR9yfYUwH2Lxw';
const ATOMIC_TOKEN_CONTRACT_ID = 'h9v17KHV4SXwdW2-JHU6a23f6R0YtbXZJJht8LfP8QM';
const UDL_ID = 'yRj4a5KMctX_uOmKWCFJIjmY8DeJcusVk6-HzLiM_t8';

const MAX_STR_SIZE = 1000;
const secondInMS = 1000;

const JWK = JSON.parse(fs.readFileSync('wallet.json').toString());
// initailze the bundlr SDK
// const bundlr: Bundlr = new (Bundlr as any).default(
const bundlr = new NodeBundlr(NODE2_BUNDLR_URL, 'arweave', JWK);
const warp = WarpFactory.forMainnet().use(new DeployPlugin());

const clientGateway = new ApolloClient({
  uri: 'https://arweave.net:443/graphql',
  cache: new InMemoryCache(),
  defaultOptions: {
    query: {
      fetchPolicy: 'no-cache',
    },
    watchQuery: {
      fetchPolicy: 'no-cache',
    },
  },
});

const gqlQuery = gql`
  query FIND_BY_TAGS($tags: [TagFilter!], $first: Int!, $after: String) {
    transactions(tags: $tags, first: $first, after: $after, sort: HEIGHT_DESC) {
      pageInfo {
        hasNextPage
      }
      edges {
        cursor
        node {
          id
          tags {
            name
            value
          }
          block {
            height
          }
        }
      }
    }
  }
`;

const parseQueryResult = (result) =>
  result.data.transactions.edges;

const queryTransactionAnswered = async (transactionId, address, scriptName, scriptcurator) => {
  const tags = [
    {
      name: PROTOCOL_NAME_TAG,
      values: [ PROTOCOL_NAME ],
    },
    {
      name: OPERATION_NAME_TAG,
      values: ['Script Inference Response'],
    },
    {
      name: SCRIPT_NAME_TAG,
      values: [ scriptName ],
    },
    {
      name: SCRIPT_CURATOR_TAG,
      values: [ scriptcurator ],
    },
    {
      name: REQUEST_TRANSACTION_TAG,
      values: [transactionId],
    },
  ];
  const result = await clientGateway.query({
    query: gql`
      query TransactionAnswered($tags: [TagFilter!], $owner: String!) {
        transactions(first: 1, tags: $tags, owners: [$owner], sort: HEIGHT_DESC) {
          edges {
            node {
              id
              owner {
                address
                key
              }
              quantity {
                winston
                ar
              }
              tags {
                name
                value
              }
            }
          }
        }
      }
    `,
    variables: { tags, owner: address },
  });

  return parseQueryResult(result);
};

const queryCheckUserPayment = async (
  inferenceTransaction,
  userAddress,
  inputValues,
  scriptId,
) => {
  const tags = [
    {
      name: PROTOCOL_NAME_TAG,
      values: [ PROTOCOL_NAME ],
    },
    {
      name: OPERATION_NAME_TAG,
      values: ['Inference Payment'],
    },
    {
      name: SCRIPT_TRANSACTION_TAG,
      values: [ scriptId ],
    },
    {
      name: INFERENCE_TRANSACTION_TAG,
      values: [inferenceTransaction],
    },
    {
      name: CONTRACT_TAG,
      values: [U_CONTRACT_ID],
    },
    {
      name: SEQUENCE_OWNER_TAG,
      values: [userAddress],
    },
    {
      name: INPUT_TAG,
      values: inputValues,
    },
  ];
  const result = await clientGateway.query({
    query: gqlQuery,
    variables: { tags, first: 3 },
  });

  return parseQueryResult(result);
};

const getAssetName = (idx, assetNames) => {
  if (!assetNames) {
    return undefined;
  }

  try {
    const names = JSON.parse(assetNames);
    const validNames = names.filter((assetName) => assetName.length > 0).map((assetName) => assetName.trim());

    if (idx < validNames.length) {
      return validNames[idx];
    } else {
      const divider = (idx % validNames.length);

      return validNames[divider];
    }
  } catch (error) {
    return undefined;
  }
};

const getGeneralTags = (
  inferenceResult,
  userAddress,
  requestTransaction,
  requestTags,
  conversationIdentifier,
  registration,
) => {
  const protocolVersion = requestTags.find((tag) => tag.name === PROTOCOL_VERSION_TAG)?.value;
  const modelName = requestTags.find((tag) => tag.name === MODEL_NAME_TAG)?.value ?? registration.modelName;
  let prompt = registration.settings?.prompt ? `${registration.settings?.prompt}, ${inferenceResult.prompt}` : inferenceResult.prompt;
  if (prompt.length > MAX_STR_SIZE) {
    prompt = prompt.substring(0, MAX_STR_SIZE);
  }

  const settingsNegativePrompt = registration.settings?.['negative_prompt'];
  const requestNegativePrompt = requestTags.find((tag) => tag.name === NEGATIVE_PROMPT_TAG)?.value;

  let negativePrompt;
  if (settingsNegativePrompt && requestNegativePrompt) {
    negativePrompt = `${settingsNegativePrompt}, ${requestNegativePrompt}`;
  } else if (settingsNegativePrompt) {
    negativePrompt = settingsNegativePrompt;
  } else if (requestNegativePrompt) {
    negativePrompt = requestNegativePrompt;
  } else {
    // ignore
  }

  let description = requestTags.find((tag) => tag.name === DESCRIPTION_TAG)?.value;

  const generalTags = [
    { name: PROTOCOL_NAME_TAG, value: PROTOCOL_NAME },
    { name: PROTOCOL_VERSION_TAG, value: protocolVersion },
    // add logic tags
    { name: OPERATION_NAME_TAG, value: 'Script Inference Response' },
    { name: MODEL_NAME_TAG, value: modelName },
    { name: SCRIPT_NAME_TAG, value: registration.scriptName },
    { name: SCRIPT_CURATOR_TAG, value: registration.scriptCurator },
    { name: SCRIPT_TRANSACTION_TAG, value: registration.scriptId },
    { name: SCRIPT_USER_TAG, value: userAddress },
    { name: REQUEST_TRANSACTION_TAG, value: requestTransaction },
    { name: PROMPT_TAG, value: prompt },
    { name: CONVERSATION_IDENTIFIER_TAG, value: conversationIdentifier },
    
    // add atomic token tags
    { name: APP_NAME_TAG, value: 'SmartWeaveContract' },
    { name: APP_VERSION_TAG, value: '0.3.0' },
    { name: 'Contract-Src', value: ATOMIC_TOKEN_CONTRACT_ID }, // use contract source here
    {
      name: 'Contract-Manifest',
      value: JSON.stringify({
        evaluationOptions: {
          sourceType: 'redstone-sequencer',
          allowBigInt: true,
          internalWrites: true,
          unsafeClient: 'skip',
          useConstructor: false
        }
      }),
    },
    {
      name: 'Init-State',
      value: JSON.stringify({
        firstOwner: userAddress,
        canEvolve: false,
        balances: {
          [userAddress]: 1,
        },
        name: 'Fair Protocol Atomic Asset',
        ticker: 'FPAA',
      }),
    },
    // ans 110 tags discoverability
    { name: 'Title', value: 'Fair Protocol Atomic Asset' },
    { name: 'Type', value: 'image' },
    { name: INDEXED_BY_TAG, value: 'ucm' },
  
    // add license tags
    { name: 'License', value: UDL_ID },
    { name: 'Derivation', value: 'Allowed-With-License-Passthrough' },
    { name: 'Commercial-Use', value: 'Allowed' },
    // add extra tags

    { name: UNIX_TIME_TAG, value: (Date.now() / secondInMS).toString() },
    { name: TOPIC_AI_TAG, value: 'ai-generated' }
  ];
  
  
  // optional tags

  if (description && description?.length > MAX_STR_SIZE) {
    description = description?.substring(0, MAX_STR_SIZE);
    // insert after title tag
    const descriptionIdx = generalTags.findIndex((tag) => tag.name === 'Title') + 1;
    generalTags.splice(descriptionIdx, 0, { name: DESCRIPTION_TAG, value: description });
  } else if (description) {
    const descriptionIdx = generalTags.findIndex((tag) => tag.name === 'Title') + 1;
    generalTags.splice(descriptionIdx, 0, { name: DESCRIPTION_TAG, value: description });
  } else {
    // ignore
  }

  if (negativePrompt && negativePrompt?.length >= MAX_STR_SIZE) {
    negativePrompt = negativePrompt?.substring(0, MAX_STR_SIZE);
    const negativePromptIdx = generalTags.findIndex((tag) => tag.name === 'Prompt') + 1;
    generalTags.splice(negativePromptIdx, 0, { name: NEGATIVE_PROMPT_TAG, value: negativePrompt });
  } else if (negativePrompt) {
    const negativePromptIdx = generalTags.findIndex((tag) => tag.name === 'Prompt') + 1;
    generalTags.splice(negativePromptIdx, 0, { name: NEGATIVE_PROMPT_TAG, value: negativePrompt });
  } else {
    // ignore
  }

  const customUserTags = requestTags.find((tag) => tag.name === USER_CUSOM_TAGS_TAG)?.value;
  if (customUserTags) {
    try {
      const customTags = JSON.parse(customUserTags);
      // filter custom tags to remove not overridavble ones
      let newTagsIdx = 1;
      for (const customTag of customTags) {
        const isOverridable = !NOT_OVERRIDABLE_TAGS.includes(customTag.name);
        const tagIdx = generalTags.findIndex((tag) => tag.name === customTag.name);

        if (tagIdx >= 0 && isOverridable) {
          generalTags.splice(tagIdx, 1, customTag);
        } else if (isOverridable) {
          // insert afer unix time tag
          const unixTimeIdx = generalTags.findIndex((tag) => tag.name === UNIX_TIME_TAG) + newTagsIdx;
          generalTags.splice(unixTimeIdx, 0, customTag);

          // only increment if tag was added after unixtimestamp tag
          newTagsIdx++;
        } else {
          // ignore
        }
      }
    } catch (err) {
      // ignore custom tags if invalid
    }
  }


  return generalTags;
};

const sendToBundlr = async (
  inferenceResult,
  userAddress,
  requestTransaction,
  requestTags,
  conversationIdentifier,
  registration,
) => {
  let responses = inferenceResult.imgPaths ?? inferenceResult.audioPath;
  // turn into array to use same code for single and multiple responses
  responses = Array.isArray(responses) ? responses : [responses];

  // Get loaded balance in atomic units
  const atomicBalance = await bundlr.getLoadedBalance();

  workerpool.workerEmit({ type: 'info', message: `node balance (atomic units) = ${atomicBalance}` });

  // Convert balance to an easier to read format
  const convertedBalance = bundlr.utils.fromAtomic(atomicBalance);
  workerpool.workerEmit({ type: 'info', message: `node balance (converted) = ${convertedBalance}` });

  const generalTags = getGeneralTags(inferenceResult, userAddress, requestTransaction, requestTags, conversationIdentifier, registration);

  const assetNames = requestTags.find((tag) => tag.name === ASSET_NAMES_TAG)?.value;
  try {
    let i = 0;
    for (const response of responses) {
      const tags = [ ...generalTags ];
      const currentImageSeed = inferenceResult.seeds ? inferenceResult.seeds[i] : null;
      if (currentImageSeed) {
        // insert after negative prompt tag
        const inferenceSeedIdx = tags.findIndex((tag) => tag.name === NEGATIVE_PROMPT_TAG) + 1;
        tags.splice(inferenceSeedIdx, 0, { name: INFERENCE_SEED_TAG, value: currentImageSeed });
      }

      const assetName = getAssetName(i, assetNames);
      if (assetName) {
        // find title tag index
        const titleIdx = tags.findIndex((tag) => tag.name === 'Title');

        // replace title tag with asset name
        tags.splice(titleIdx, 1, { name: 'Title', value: assetName });
      } else {
        const hash = crypto.createHash('sha256').update(requestTransaction).update(i.toString()).digest('base64');
        const title = `Fair Protocol Atomic Asset [${hash.slice(0, 10)}]`;
        // find title tag index
        const titleIdx = tags.findIndex((tag) => tag.name === 'Title');

        // replace title tag with asset name
        tags.splice(titleIdx, 1, { name: 'Title', value: title });
      }

      const transaction = await bundlr.uploadFile(response, { tags });
      workerpool.workerEmit({ type: 'info', message: `Data uploaded ==> https://arweave.net/${transaction.id}` });
      try {
        const { contractTxId } = await warp.register(transaction.id, 'node2'); // must use same node as uploaded data
        workerpool.workerEmit({ type: 'info', message: `Token Registered ==> https://arweave.net/${contractTxId}` });
      } catch (e) {
        workerpool.workerEmit({ type: 'error', message: `Could not register token: ${e}` });
      }
      i++;
    }
  } catch (e) {
    // throw error to be handled by caller
    throw new Error(`Could not upload to bundlr: ${e}`);
  }
};

const fetchSeed = async (url, imageStr) => {
  try {
    const infoUrl = url.replace('/txt2img', '/png-info');
    
    const secRes = await fetch(infoUrl, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ image: `data:image/png;base64,${imageStr}` }),
    });

    const result = await secRes.json();
    const seedStrStartIdx = result.info.indexOf('Seed:');
    const seedStrEndIdx = result.info.indexOf(',', seedStrStartIdx); // search for next comma after 'Seed:' substring

    const seedStr = result.info.substring(seedStrStartIdx, seedStrEndIdx);
    const seed = seedStr.split('Seed:')[1].trim();

    return seed;
  } catch (e) {
    return '';
  }
};


const parsePayload = (format, text, settings, negativePrompt) => {
  let payload;

  if (format === 'webui') {
    const webuiPayload = {
      ...(settings && { ...settings }),
      prompt: settings?.prompt ? `${settings?.prompt}${text}` : text,
    };

    if (negativePrompt && webuiPayload['negative_prompt']) {
      webuiPayload['negative_prompt'] = `${webuiPayload['negative_prompt']} ${negativePrompt}`;
    } else if (negativePrompt) {
      webuiPayload['negative_prompt'] = negativePrompt;
    } else {
      // ignore
    }

    // force n_iter 1
    webuiPayload['n_iter'] = 1;
  
    payload = JSON.stringify(webuiPayload);
  } else {
    payload = text;
  }

  return payload;
};

const runInference = async (url, format, payload, scriptId, text) => {
  const res = await fetch(url, {
    method: 'POST',
    ...(format === 'webui' && { headers: {
      'accept': 'application/json',
      'Content-Type': 'application/json'
    }}),
    body: payload,
  });
  const tempData = await res.json();

  if (tempData.images) {
    let i = 0;
    const imgPaths = [], imgSeeds = [];

    for (const el of tempData.images) {
      fs.writeFileSync(`output_${scriptId}_${i}.png`, Buffer.from(el, 'base64'));
      imgPaths.push(`./output_${scriptId}_${i}.png`);
  
      const seed = await fetchSeed(url, el);
      imgSeeds.push(seed);
      i++;
    }

    return { imgPaths, prompt: text, seeds: imgSeeds };
  } else if (tempData.imgPaths) {
    return {
      imgPaths: tempData.imgPaths,
      prompt: text,
    };
  } else if (tempData.audioPath) {
    return {
      audioPath: tempData.audioPath,
      prompt: text,
    };
  } else {
    throw new Error('Invalid response from server');
  }
};

const inference = async function (requestTx, registration, nImages, cid, negativePrompt) {
  const { scriptId, url, settings, payloadFormat: format } = registration;

  const requestData = await fetch(`${NET_ARWEAVE_URL}/${requestTx.node.id}`);
  const text = await (await requestData.blob()).text();
  workerpool.workerEmit({ type: 'info', message: `User Prompt: ${text}` });

  const payload = parsePayload(format, text, settings, negativePrompt);

  const maxImages = 10;

  let nIters =  format === 'webui' ? settings['n_iter'] || 4 : 1;

  if (format === 'webui' && nImages && nImages > 0 && nImages <= maxImages) {
    nIters = nImages;
  } else {
    // use default
  }

  for (let i = 0; i < nIters; i++) {
    const result = await runInference(url, format, payload, scriptId, text);
    workerpool.workerEmit({ type: 'info', message: `Inference Result: ${JSON.stringify(result)}` });

    await sendToBundlr(
      result,
      requestTx.node.owner.address,
      requestTx.node.id,
      requestTx.node.tags,
      cid,
      registration,
    );
  }
};

const checkUserPaidInferenceFees = async (
  txid,
  userAddress,
  creatorAddress,
  curatorAddress,
  operatorFee,
  scriptId,
) => {
  const marketplaceShare = operatorFee * MARKETPLACE_PERCENTAGE_FEE;
  const curatorShare = operatorFee * CURATOR_PERCENTAGE_FEE;
  const creatorShare = operatorFee * CREATOR_PERCENTAGE_FEE;

  const marketpaceInput = JSON.stringify({
    function: 'transfer',
    target: VAULT_ADDRESS,
    qty: parseInt(marketplaceShare.toString(), 10).toString(),
  });

  const curatorInput = JSON.stringify({
    function: 'transfer',
    target: curatorAddress,
    qty: parseInt(curatorShare.toString(), 10).toString(),
  });

  const creatorInput = JSON.stringify({
    function: 'transfer',
    target: creatorAddress,
    qty: parseInt(creatorShare.toString(), 10).toString(),
  });

  const paymentTxs = await queryCheckUserPayment(txid, userAddress, [
    marketpaceInput,
    curatorInput,
    creatorInput,
  ], scriptId);
  const necessaryPayments = 3;

  if (paymentTxs.length < necessaryPayments) {
    return false;
  } else {
    // find marketplace payment
    const marketplacePayment = paymentTxs.find((tx) =>
      tx.node.tags.find((tag) => tag.name === INPUT_TAG && tag.value === marketpaceInput),
    );

    if (!marketplacePayment) {
      return false;
    }

    // find curator payment
    const curatorPayment = paymentTxs.find((tx) =>
      tx.node.tags.find((tag) => tag.name === INPUT_TAG && tag.value === curatorInput),
    );

    if (!curatorPayment) {
      return false;
    }

    // find creator payment
    const creatorPayment = paymentTxs.find((tx) =>
      tx.node.tags.find((tag) => tag.name === INPUT_TAG && tag.value === creatorInput),
    );

    if (!creatorPayment) {
      return false;
    }
  }

  return true;
};

const getRequest = async (transactionId) => {
  const result = await clientGateway.query({
    query: gql`
      query tx($id: ID!) {
        transactions(first: 1, ids: [$id], sort: HEIGHT_DESC) {
          edges {
            node {
              id
              owner {
                address
                key
              }
              quantity {
                winston
                ar
              }
              tags {
                name
                value
              }
            }
          }
        }
      }
    `,
    variables: { id: transactionId },
  });

  return parseQueryResult(result)[0];
};

const processRequest = async (requestId, reqUserAddr, registration, address) => {  
  const requestTx = await getRequest(requestId);
  if (!requestTx) {
    // If the request doesn't exist, skip
    workerpool.workerEmit({ type: 'error', message: `Request ${requestId} does not exist. Skipping...` });
    return false;
  }

  const responseTxs = await queryTransactionAnswered(requestId, address, registration.scriptName, registration.scriptCurator);
  if (responseTxs.length > 0) {
    // If the request has already been answered, we don't need to do anything
    workerpool.workerEmit({ type: 'info', message: `Request ${requestId} has already been answered. Skipping...` });
    return requestId;
  }

  const nImages = parseInt(requestTx.node.tags.find((tag) => tag.name === N_IMAGES_TAG)?.value ?? '0', 10);

  let operatorFee = registration.operatorFee;
  if (nImages > 0 && registration.payloadFormat === 'webui') {
    operatorFee = registration.operatorFee * nImages; 
  } else if (registration.payloadFormat === 'webui') {
    operatorFee = registration.operatorFee * 4;
  }

  if (
    !(await checkUserPaidInferenceFees(
      requestTx.node.id,
      reqUserAddr,
      registration.modelOwner,
      registration.scriptCurator,
      operatorFee,
      registration.scriptId,
    ))
  ) {
    workerpool.workerEmit({ type: 'error', message: `Could not find payment for request ${requestId}. Skipping...` });
    return false;
  }

  const protocolVersion = requestTx.node.tags.find((tag) => tag.name === PROTOCOL_VERSION_TAG)?.value;
  const conversationIdentifier = requestTx.node.tags.find(
    (tag) => tag.name === 'Conversation-Identifier',
  )?.value;
  if (!protocolVersion || !conversationIdentifier) {
    // If the request doesn't have the necessary tags, skip
    workerpool.workerEmit({ type: 'error', message: `Request ${requestId} does not have the necessary tags.` });
    return false;
  }

  const negativePrompt = requestTx.node.tags.find((tag) => tag.name === NEGATIVE_PROMPT_TAG)?.value;
  await inference(requestTx, registration, nImages, conversationIdentifier, negativePrompt);

  return requestId;
};

const processRequestLock = async (requestId, reqUserAddr, registration, address) => {
  try {
    workerpool.workerEmit({ type: 'info', message: `Thread working on request ${requestId}...` });
    
    const result = await processRequest(requestId, reqUserAddr, registration, address);
    
    workerpool.workerEmit({ type: 'result', message: result });
  } catch (e) {
    workerpool.workerEmit({ type: 'error', message: `Thread ${requestId} released with error: ${e}` });
    workerpool.workerEmit({ type: 'result', message: false });
  }
};

workerpool.worker({
  processRequestLock,
});