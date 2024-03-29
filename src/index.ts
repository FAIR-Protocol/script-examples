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

import fs from 'node:fs';
import CONFIG from '../config.json' assert { type: 'json' };
import Arweave from 'arweave';
import { default as Pino } from 'pino';
import { IEdge, OperatorParams, UrlConfig } from './interfaces';
import {
  INFERENCE_TRANSACTION_TAG,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  SCRIPT_TRANSACTION_TAG,
  SEQUENCE_OWNER_TAG,
  secondInMS,
} from './constants';
import {
  queryTransactionsReceived,
  queryOperatorRegistrations,
  isRegistrationCancelled,
  getModelOwnerAndName,
} from './queries';
import { JWKInterface } from 'arweave/node/lib/wallet';
import workerpool from 'workerpool';
import path from 'path';
import { fileURLToPath } from 'url';
import { Mutex } from 'async-mutex';
import NodeBundlr from '@bundlr-network/client/build/esm/node/index';

const fileName = fileURLToPath(import.meta.url);
const dirName = path.dirname(fileName);

let address: string;
const registrations: OperatorParams[] = [];
const mutexes: Mutex[] = [];
const lastProcessedTxs: string[] = [];

const logger = Pino({
  name: 'Operator Loop',
  level: 'info',
});

const arweave = Arweave.init({
  host: 'arweave.net',
  port: 443,
  protocol: 'https',
});

let pool: workerpool.WorkerPool;

const JWK: JWKInterface = JSON.parse(fs.readFileSync('wallet.json').toString());
// initialize ar-io bundler
const bundlr = new NodeBundlr('https://up.arweave.net', 'arweave', JWK);

/* const lastProofTimestamp */

const findRegistrations = async () => {
  const registrationTxs = await queryOperatorRegistrations(address);

  // filtered cancelled registrations
  const filtered = [];
  for (const tx of registrationTxs) {
    const txid = tx.node.id;
    const isTxCancelled = await isRegistrationCancelled(txid, address);
    // filter by scripts that have config  url
    const urls = Object.keys(CONFIG.urls);
    const scriptTx = tx.node.tags.find((tag) => tag.name === 'Script-Transaction')?.value;
    const scriptName = tx.node.tags.find((tag) => tag.name === 'Script-Name')?.value;
    const hasUrlForScript = scriptTx && urls.includes(scriptTx);

    if (!isTxCancelled && hasUrlForScript) {
      filtered.push(tx);
    } else if (!hasUrlForScript && !isTxCancelled) {
      logger.info(
        `Script ${scriptName}(id: '${scriptTx}') not found in config, Registration for this script will be ignored. Skipping...`,
      );
    } else {
      logger.info(`Registration with id '${txid}' is cancelled. Skipping...`);
    }
  }

  return filtered;
};

const validateRegistration = async (tx: IEdge) => {
  const urls = CONFIG.urls;
  let hasErrors = false;
  const txid = tx.node.id;
  const tags = tx.node.tags;

  const scriptName = tags.find((tag) => tag.name === 'Script-Name')?.value;
  const scriptCurator = tags.find((tag) => tag.name === 'Script-Curator')?.value;
  const scriptId = tags.find((tag) => tag.name === 'Script-Transaction')?.value;
  const feeIndex = tags.findIndex((tag) => tag.name === 'Operator-Fee');

  if (!scriptCurator) {
    logger.error(`Could not find Script Curator for registration '${txid}'. Ignoring...`);
    hasErrors = true;
  }

  if (!scriptName) {
    logger.error(`Could not find Script Name for registration '${txid}'. Ignoring...`);
    hasErrors = true;
  }

  if (!scriptId) {
    logger.error(`Could not find Script Transaction for registration '${txid}'. Ignoring...`);
    hasErrors = true;
  }

  const { creatorAddr: modelOwner, modelName } = await getModelOwnerAndName(
    scriptName as string,
    scriptCurator as string,
  );
  if (!modelOwner) {
    logger.error(`Could not find Model Owner for registration '${txid}'. Ignoring...`);
    hasErrors = true;
  }

  if (!modelName) {
    logger.error(`Could not find Model Name for registration '${txid}'. Ignoring...`);
    hasErrors = true;
  }

  if (feeIndex < 0) {
    logger.error(`Could not find Operator Fee Tag for registration '${txid}'. Ignoring...`);
    hasErrors = true;
  }

  const opFee = parseFloat(tags[feeIndex].value);
  if (Number.isNaN(opFee) || opFee <= 0) {
    logger.error(`Invalid Operator Fee Found for registration '${txid}'. Ignoring...`);
    hasErrors = true;
  }

  const urlConf: UrlConfig = (urls as any)[scriptId as string];

  if (!hasErrors) {
    registrations.push({
      ...urlConf,
      modelOwner,
      modelName,
      scriptId: scriptId as string,
      operatorFee: opFee,
      scriptName: scriptName as string,
      scriptCurator: scriptCurator as string,
      registrationTx: tx,
    });
  } else {
    // ignore registrations with errors
  }
};

const sendProofOfLife = async () => {
  // dispatch tx
  const tx = await bundlr.upload(`Operator ${address} Running`, {
    tags: [
      { name: 'Protocol-Name', value: PROTOCOL_NAME },
      { name: 'Protocol-Version', value: PROTOCOL_VERSION },
      { name: 'Operation-Name', value: 'Operator Active Proof' },
      /* { name: 'Operator-Irys-Balance', value: convertedBalance.toString() }, */
      { name: 'Unix-Time', value: (Date.now() / secondInMS).toString() },
    ],
  });
  logger.info(`Proof of Life Transaction: ${tx.id}`);
};

const startThread = (
  reqTxId: string,
  reqUserAddr: string,
  currentRegistration: OperatorParams,
  lock: Mutex,
  txid: string,
) => {
  return lock.runExclusive(async () => {
    logger.info(`Thread ${reqTxId} acquired lock`);
    if (lastProcessedTxs.includes(txid)) {
      // if txid is already processed skip launching thread
      logger.info(`Thread ${reqTxId} released lock`);
      return;
    }
    await pool.exec('processRequestLock', [reqTxId, reqUserAddr, currentRegistration, address], {
      on: (payload) => handleWorkerEvents(payload, txid),
    });

    logger.info(`Thread ${reqTxId} released lock`);
  });
};

const handleWorkerEvents = (
  payload: { type: 'info' | 'error' | 'result'; message: string | boolean },
  txid: string,
) => {
  if (payload.type === 'error') {
    logger.error(payload.message);
  } else if (payload.type === 'info') {
    logger.info(payload.message);
  } else {
    const result = payload.message;
    if (typeof result === 'string') {
      // save latest tx id only for successful processed requests
      lastProcessedTxs.push(txid);
    }
  }
};

const start = async () => {
  try {
    const scriptIds = registrations.map((reg) => reg.scriptId);
    const operatorFees = registrations.map((reg) => reg.operatorFee);
    const isStableDifusion = registrations.map((reg) => reg.payloadFormat === 'webui');
    // request only new txs
    const { requestTxs, hasNextPage } = await queryTransactionsReceived(
      address,
      operatorFees,
      scriptIds,
      isStableDifusion,
    );

    const newRequestTxs = requestTxs.filter(
      (tx) => !lastProcessedTxs.find((txid) => txid === tx.node.id),
    );

    let fetchMore = hasNextPage;

    const pageSize = 10;
    // if lastProcessed request length is bigger than one page then script already processed all previous requests
    if (lastProcessedTxs.length <= pageSize) {
      while (fetchMore && newRequestTxs.length > 0) {
        const { requestTxs: nextPageTxs, hasNextPage: newHasNextPage } =
          await queryTransactionsReceived(
            address,
            operatorFees,
            scriptIds,
            isStableDifusion,
            newRequestTxs[newRequestTxs.length - 1].cursor,
          );

        newRequestTxs.push(...nextPageTxs);
        fetchMore = newHasNextPage;
      }
    }

    const mostRecent: IEdge[] = [];
    newRequestTxs.forEach((tx) => {
      if (!tx.node.block || tx.node.block?.height >= parseInt(CONFIG.startBlockHeight, 10)) {
        mostRecent.push(tx);
      } else {
        lastProcessedTxs.push(tx.node.id); // ignore old txs
      }
    });

    for (const edge of mostRecent) {
      logger.info(`Processing request ${edge.node.id} ...`);
      // Check if request already answered:
      const reqTxId = edge.node.tags.find((tag) => tag.name === INFERENCE_TRANSACTION_TAG)?.value;
      const reqUserAddr =
        edge.node.tags.find((tag) => tag.name === SEQUENCE_OWNER_TAG)?.value ??
        edge.node.owner.address;
      const currentRegistration = registrations.find(
        (reg) =>
          reg.scriptId === edge.node.tags.find((tag) => tag.name === SCRIPT_TRANSACTION_TAG)?.value,
      );
      const registrationIdx = registrations.findIndex(
        (reg) =>
          reg.scriptId === edge.node.tags.find((tag) => tag.name === SCRIPT_TRANSACTION_TAG)?.value,
      );

      if (reqTxId && reqUserAddr && currentRegistration && registrationIdx >= 0) {
        startThread(
          reqTxId,
          reqUserAddr,
          currentRegistration,
          mutexes[registrationIdx],
          edge.node.id,
        );
      } else {
        logger.error('No Registration, inference Tx or userAddr found for request. Skipping...');
        // skip requests without inference transaction tag
      }
    }
    logger.info(pool.stats());
  } catch (e) {
    logger.error(`Errored with: ${e}`);
  }
  logger.info(`Sleeping for ${CONFIG.sleepTimeSeconds} second(s) ...`);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  address = await arweave.wallets.jwkToAddress(JWK);
  logger.info(`Wallet address: ${address}`);
  logger.info('Fetching Operator Registrations...');

  let tempRegistrations: IEdge[] = [];
  try {
    tempRegistrations = await findRegistrations();
  } catch (err) {
    logger.error('Error Fetching Operator Registrations');
    logger.info('Shutting down...');

    process.exit(1);
  }

  try {
    for (const tx of tempRegistrations) {
      await validateRegistration(tx);
    }
  } catch (err) {
    logger.error('Error Fetching Model Owners for registrations');
    logger.info('Shutting down...');

    process.exit(1);
  }

  if (registrations.length === 0) {
    logger.error('No registrations found. Shutting down...');
    process.exit(1);
  }

  const nThreads = registrations.length > workerpool.cpus ? workerpool.cpus : registrations.length;
  registrations.forEach(() => mutexes.push(new Mutex())); // start one mutex for each registration
  // start pool
  pool = workerpool.pool(dirName + '/worker.cjs', { maxWorkers: nThreads });
  logger.info(pool.stats());

  // create interval for proofs every 30 min
  const minuteInSeconds = 60;
  const halfHourInMinutes = 30;

  await sendProofOfLife(); // run first time;
  // create interval every 30 min
  setInterval(async () => {
    await sendProofOfLife();
  }, secondInMS * minuteInSeconds * halfHourInMinutes);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await start();
    await sleep(CONFIG.sleepTimeSeconds * secondInMS);
  }
})();
