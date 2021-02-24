const logger = require('../utils/logger');
const prompter = require('../utils/prompter');
const { saveDeploymentFile } = require('../utils/io');
const { getContractBytecodeHash } = require('../utils/contracts');
const { subtask } = require('hardhat/config');
const { SUBTASK_DEPLOY_CONTRACTS } = require('../task-names');

let _hre;

/*
 * Deploys a single contract.
 * */
subtask(SUBTASK_DEPLOY_CONTRACTS).setAction(
  async ({ contractNames, constructorArgs, areModules = false, force = false }, hre) => {
    _hre = hre;

    const deploymentsInfo = await _evaluateDeployments({ contractNames, areModules, force });
    await _confirmDeployments({ contractNames, deploymentsInfo });

    await _deployContracts({ contractNames, constructorArgs, areModules, deploymentsInfo });
  }
);

async function _evaluateDeployments({ contractNames, areModules, force }) {
  const deploymentsInfo = {};

  let data = _hre.deployer.data;
  data = areModules ? data.modules : data;

  for (let contractName of contractNames) {
    logger.debug(`${contractName}`);

    logger.debug(`force: ${force}`);
    if (force) {
      deploymentsInfo[contractName] = 'force is set to true';
      continue;
    }

    logger.debug(`network: ${_hre.network.name}`);
    if (_hre.network.name === 'hardhat') {
      deploymentsInfo[contractName] = 'always deploy in hardhat network';
      continue;
    }

    if (!data[contractName]) {
      data[contractName] = {};
    }
    const deployedData = data[contractName];

    logger.debug(`deployedData: ${JSON.stringify(deployedData, null, 2)}`);
    if (!deployedData.deployedAddress) {
      deploymentsInfo[contractName] = 'no previous deployment found';
      continue;
    }

    const sourceBytecodeHash = getContractBytecodeHash({
      contractName: contractName,
      isModule: areModules,
      hre: _hre,
    });
    logger.debug(`source bytecodehash: ${sourceBytecodeHash}`);
    const storedBytecodeHash = deployedData.bytecodeHash;
    logger.debug(`stored bytecodeHash: ${sourceBytecodeHash}`);
    const bytecodeChanged = sourceBytecodeHash !== storedBytecodeHash;
    if (bytecodeChanged) {
      deploymentsInfo[contractName] = 'bytecode changed';
      continue;
    }
  }

  return deploymentsInfo;
}

async function _confirmDeployments({ contractNames, deploymentsInfo }) {
  for (let contractName of contractNames) {
    const reason = deploymentsInfo[contractName];

    if (reason) {
      logger.notice(`${contractName} needs deployment - reason: ${deploymentsInfo[contractName]}`);
    } else {
      logger.checked(`${contractName} does not need to be deployed`);
    }
  }

  const numDeployments = Object.keys(deploymentsInfo).length;
  if (numDeployments === 0) {
    return;
  }

  await prompter.confirmAction('Deploy these contracts');
}

async function _deployContracts({ contractNames, constructorArgs, deploymentsInfo, areModules }) {
  for (let i = 0; i < contractNames.length; i++) {
    const contractName = contractNames[i];
    const args = constructorArgs ? constructorArgs[i] || [] : [];

    const factory = await _hre.ethers.getContractFactory(contractName);
    const contract = await factory.deploy(...args);

    const reason = deploymentsInfo[contractName];
    if (!reason) {
      continue;
    }

    if (!contract.address) {
      throw new Error(`Error deploying ${contractName}`);
    }

    logger.success(`Deployed ${contractName} to ${contract.address}`);

    const data = _hre.deployer.data;
    const target = areModules ? data.modules : data;

    target[contractName] = {
      deployedAddress: contract.address,
      bytecodeHash: getContractBytecodeHash({ contractName, isModule: areModules, hre: _hre }),
    };

    saveDeploymentFile({ data, hre: _hre });
  }
}