import {
    type Address,
    type Chain,
    type Client,
    type Hex,
    type LocalAccount,
    type Transport,
    concatHex,
    encodeFunctionData,
    getAddress,
    isAddressEqual,
    numberToHex,
    zeroAddress
} from "viem"
import { getChainId, signMessage } from "viem/actions"
import { getAccountNonce } from "../../actions/public/getAccountNonce"
import { getSenderAddress } from "../../actions/public/getSenderAddress"
import type { ENTRYPOINT_ADDRESS_V06_TYPE, Prettify } from "../../types"
import type { EntryPoint } from "../../types/entrypoint"
import { getUserOperationHash } from "../../utils/getUserOperationHash"
import { isSmartAccountDeployed } from "../../utils/isSmartAccountDeployed"
import { toSmartAccount } from "../toSmartAccount"
import {
    SignTransactionNotSupportedBySmartAccount,
    type SmartAccount,
    type SmartAccountSigner
} from "../types"

const NANI_FACTORY_ADDRESS =
    "0x000000000000dD366cc2E4432bB998e41DFD47C7" as Address

export type NaniSmartAccount<
    entryPoint extends EntryPoint,
    transport extends Transport = Transport,
    chain extends Chain | undefined = Chain | undefined
> = SmartAccount<entryPoint, "NaniSmartAccount", transport, chain>

const getAccountInitCode = async (owner: Address, salt?: Hex): Promise<Hex> => {
    if (!owner) throw new Error("Owner account not found")

    if (salt) {
        const slice = getAddress(salt.slice(0, 40))
        if (
            !isAddressEqual(slice, zeroAddress) &&
            !isAddressEqual(slice, owner)
        ) {
            throw new Error(
                "Salt must start with owner address or zero address"
            )
        }
    }

    return encodeFunctionData({
        abi: [
            {
                inputs: [
                    { internalType: "address", name: "owner", type: "address" },
                    { internalType: "bytes32", name: "salt", type: "bytes32" }
                ],
                name: "createAccount",
                outputs: [
                    { internalType: "address", name: "", type: "address" }
                ],
                stateMutability: "payable",
                type: "function"
            }
        ],
        functionName: "createAccount",
        args: [
            owner,
            salt ??
                concatHex([
                    owner,
                    numberToHex(0, {
                        size: 12
                    })
                ])
        ]
    })
}

const getAccountAddress = async <
    entryPoint extends EntryPoint,
    TTransport extends Transport = Transport,
    TChain extends Chain | undefined = Chain | undefined
>({
    client,
    factoryAddress,
    entryPoint: entryPointAddress,
    owner,
    salt
}: {
    client: Client<TTransport, TChain>
    factoryAddress: Address
    owner: Address
    entryPoint: entryPoint
    salt?: Hex
}): Promise<Address> => {
    const factoryData = await getAccountInitCode(owner, salt)

    return getSenderAddress(client, {
        initCode: concatHex([factoryAddress, factoryData]),
        entryPoint: entryPointAddress as ENTRYPOINT_ADDRESS_V06_TYPE
    })
}

export type SignerToNaniSmartAccountParameters<
    entryPoint extends EntryPoint,
    TSource extends string = string,
    TAddress extends Address = Address
> = Prettify<{
    signer: SmartAccountSigner<TSource, TAddress>
    factoryAddress?: Address
    entryPoint: entryPoint
    salt?: Hex
    address?: Address
}>

/**
 * @description Creates a Nani Account
 *
 * @returns A Nani Account
 */
export async function signerToNaniSmartAccount<
    entryPoint extends EntryPoint,
    TTransport extends Transport = Transport,
    TChain extends Chain | undefined = Chain | undefined,
    TSource extends string = string,
    TAddress extends Address = Address
>(
    client: Client<TTransport, TChain, undefined>,
    {
        signer,
        factoryAddress = NANI_FACTORY_ADDRESS,
        entryPoint: entryPointAddress,
        salt,
        address
    }: SignerToNaniSmartAccountParameters<entryPoint, TSource, TAddress>
): Promise<NaniSmartAccount<entryPoint, TTransport, TChain>> {
    const viemSigner: LocalAccount = {
        ...signer,
        signTransaction: (_, __) => {
            throw new SignTransactionNotSupportedBySmartAccount()
        }
    } as LocalAccount

    const [accountAddress, chainId] = await Promise.all([
        address ??
            getAccountAddress<entryPoint, TTransport, TChain>({
                client,
                factoryAddress,
                entryPoint: entryPointAddress,
                owner: viemSigner.address,
                salt
            }),
        client.chain?.id ?? getChainId(client)
    ])

    if (!accountAddress) throw new Error("Account address not found")

    let naniAccountDeployed = await isSmartAccountDeployed(
        client,
        accountAddress
    )

    return toSmartAccount({
        address: accountAddress,
        signMessage: async (_) => {
            throw new Error("Simple account isn't 1271 compliant")
        },
        signTransaction: (_, __) => {
            throw new SignTransactionNotSupportedBySmartAccount()
        },
        signTypedData: async (_) => {
            throw new Error("Simple account isn't 1271 compliant")
        },
        client,
        publicKey: accountAddress,
        entryPoint: entryPointAddress,
        source: "NaniSmartAccount",
        async getNonce() {
            return getAccountNonce(client, {
                sender: accountAddress,
                entryPoint: entryPointAddress
            })
        },
        async signUserOperation(userOperation) {
            return signMessage(client, {
                account: viemSigner,
                message: {
                    raw: getUserOperationHash({
                        userOperation,
                        entryPoint: entryPointAddress,
                        chainId
                    })
                }
            })
        },
        async getInitCode() {
            if (naniAccountDeployed) return "0x"

            naniAccountDeployed = await isSmartAccountDeployed(
                client,
                accountAddress
            )

            if (naniAccountDeployed) return "0x"

            return concatHex([
                factoryAddress,
                await getAccountInitCode(viemSigner.address, salt)
            ])
        },
        async getFactory() {
            naniAccountDeployed =
                naniAccountDeployed ??
                (await isSmartAccountDeployed(client, accountAddress))

            if (naniAccountDeployed) return undefined

            return factoryAddress
        },
        async getFactoryData() {
            if (naniAccountDeployed) return undefined
            naniAccountDeployed = await isSmartAccountDeployed(
                client,
                accountAddress
            )
            if (naniAccountDeployed) return undefined
            return getAccountInitCode(viemSigner.address, salt)
        },
        async encodeDeployCallData() {
            throw new Error("Simple account doesn't support account deployment")
        },
        async encodeCallData(args) {
            if (Array.isArray(args)) {
                const argsArray = args as {
                    to: Address
                    value: bigint
                    data: string
                }[]

                return encodeFunctionData({
                    abi: [
                        {
                            inputs: [
                                {
                                    components: [
                                        {
                                            internalType: "address",
                                            name: "target",
                                            type: "address"
                                        },
                                        {
                                            internalType: "uint256",
                                            name: "value",
                                            type: "uint256"
                                        },
                                        {
                                            internalType: "bytes",
                                            name: "data",
                                            type: "bytes"
                                        }
                                    ],
                                    internalType: "struct ERC4337.Call[]",
                                    name: "calls",
                                    type: "tuple[]"
                                }
                            ],
                            name: "executeBatch",
                            outputs: [
                                {
                                    internalType: "bytes[]",
                                    name: "results",
                                    type: "bytes[]"
                                }
                            ],
                            stateMutability: "payable",
                            type: "function"
                        }
                    ],
                    functionName: "executeBatch",
                    args: [
                        argsArray.map(({ to, value, data }) => {
                            return {
                                target: to,
                                value,
                                data: data as Hex
                            }
                        })
                    ]
                })
            }

            const { to, value, data } = args as {
                to: Address
                value: bigint
                data: Hex
            }

            return encodeFunctionData({
                abi: [
                    {
                        inputs: [
                            {
                                internalType: "address",
                                name: "target",
                                type: "address"
                            },
                            {
                                internalType: "uint256",
                                name: "value",
                                type: "uint256"
                            },
                            {
                                internalType: "bytes",
                                name: "data",
                                type: "bytes"
                            }
                        ],
                        name: "execute",
                        outputs: [
                            {
                                internalType: "bytes",
                                name: "result",
                                type: "bytes"
                            }
                        ],
                        stateMutability: "payable",
                        type: "function"
                    }
                ],
                functionName: "execute",
                args: [to, value, data]
            })
        },
        async getDummySignature(_userOperation) {
            return "0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c"
        }
    })
}
