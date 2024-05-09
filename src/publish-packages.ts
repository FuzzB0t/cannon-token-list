import { CannonStorage, IPFSLoader, OnChainRegistry, getCannonContract } from "@usecannon/builder";
import { Address, Abi, zeroAddress, stringToHex, encodeFunctionData, multicall3Abi, SimulateContractParameters, AccountStateConflictError } from "viem";
import { createClient, createWallet } from "./client";
import fs from "fs/promises";
import { privateKeyToAccount } from 'viem/accounts';


const MULTICALL_ADDRESS = '0xE2C5658cC5C448B48141168f3e475dF8f65A1e3e';

export interface TxData {
  abi: Abi;
  address: Address;
  functionName: string;
  value?: string | bigint | number;
  args?: any[];
}

export async function publishPackages(chainId: Number) {
  // Read the contents of the file
  const packages = await fs.readFile('./src/cannondir/packages', 'utf-8');
  // Split the data into an array of strings using newline characters as separators
  const packageNames: string[] = packages.split('\n').map(str => str.trim());

  console.log(packageNames)

  const OPClient = createClient(10, process.env.OP_URL!);
  const registry = await getCannonContract({
    package: 'registry:2.13.1@main',
    chainId: 1,
    contractName: 'Proxy',
    storage: new CannonStorage(
      new OnChainRegistry({ address: '0x8E5C7EFC9636A6A0408A46BB7F617094B81e5dba', provider: OPClient }),
      { ipfs: new IPFSLoader(process.env.IPFS_URL!, {}, 30000, 3) })
  });

  let txs: TxData[] = [];
  const multicallAbi = JSON.parse(await fs.readFile(`./src/multicall.json`, 'utf8'));

  for (let pkg of packageNames) {
    const packageHash = stringToHex(pkg, { size: 32 });
    const variant = stringToHex(`${chainId}-main`, { size: 32 });
    const ipfsHash = (await fs.readFile(`./src/cannondir/tags/${pkg}_1.0.0_${chainId}-main.txt`)).toString();
    const ipfsMetaHash = (await fs.readFile(`./src/cannondir/tags/${pkg}_1.0.0_${chainId}-main.meta.txt`)).toString();

    txs.push({
      ...registry,
      functionName: 'publish',
      value: BigInt(0),
      args: [
        packageHash,
        variant,
        ['1', 'latest'].map((t) => stringToHex(t, { size: 32 })),
        ipfsHash,
        ipfsMetaHash || '',
      ],
    });
  }
  console.log(txs)

  const value = txs.reduce((val, txn) => {
    return val + (BigInt(txn.value || 0) || BigInt(0));
  }, BigInt(0));


  const txArgs = txs.map((txn) => ({
    target: txn.address || zeroAddress,
    callData: encodeFunctionData(txn as any),
    value: txn.value || '0',
    requireSuccess: true,
  }));

  const txData = {
    abi: multicallAbi,
    address: MULTICALL_ADDRESS,
    functionName: 'aggregate3Value',
    value,
    args: [
      txArgs
    ],
  };

  const account = privateKeyToAccount(process.env.PRIVATE_KEY! as Address);

  const params = {
    ...txData,
    account: account,
  };

  console.log("SIMULATING CONTRACT")
  const tx = await OPClient.simulateContract(params as any);

  const signer = await createWallet(OPClient)
  tx.request.account = account; 
  console.log("Writing to contract")
  const hash = await signer.writeContract(tx.request as any);
  console.log("TX has been written")

  const receipt = await OPClient.waitForTransactionReceipt({ hash });
  console.log("TX has been waited for")

  console.log(receipt);
}

publishPackages(1);
publishPackages(13370);