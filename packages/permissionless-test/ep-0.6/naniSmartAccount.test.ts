import dotenv from "dotenv"
import { UserOperation } from "permissionless"
import { SignTransactionNotSupportedBySmartAccount } from "permissionless/accounts"
import {
    http,
    Account,
    Address,
    Chain,
    Transport,
    WalletClient,
    createWalletClient,
    decodeEventLog,
    getContract,
    zeroAddress
} from "viem"
import {
    beforeAll,
    beforeEach,
    describe,
    expect,
    expectTypeOf,
    test
} from "vitest"
import { EntryPointAbi } from "../abis/EntryPoint"
import { GreeterAbi, GreeterBytecode } from "../abis/Greeter"
import {
    getBundlerClient,
    getEntryPoint,
    getPimlicoPaymasterClient,
    getPrivateKeyAccount,
    getPublicClient,
    getSignerToNaniAccount,
    getSmartAccountClient,
    getTestingChain,
    refillSmartAccount,
    waitForNonceUpdate
} from "./utils"

dotenv.config()

beforeAll(() => {
    if (!process.env.FACTORY_ADDRESS_V06) {
        throw new Error("FACTORY_ADDRESS_V06 environment variable not set")
    }
    if (!process.env.TEST_PRIVATE_KEY) {
        throw new Error("TEST_PRIVATE_KEY environment variable not set")
    }
    if (!process.env.RPC_URL) {
        throw new Error("RPC_URL environment variable not set")
    }
})

describe("Nani Account", () => {
    let walletClient: WalletClient<Transport, Chain, Account>

    beforeEach(async () => {
        const owner = getPrivateKeyAccount()
        walletClient = createWalletClient({
            account: owner,
            chain: getTestingChain(),
            transport: http(process.env.RPC_URL as string)
        })
    })

    test("Simple Account address", async () => {
        const simpleSmartAccount = await getSignerToNaniAccount()

        expectTypeOf(simpleSmartAccount.address).toBeString()
        expect(simpleSmartAccount.address).toHaveLength(42)
        expect(simpleSmartAccount.address).toMatch(/^0x[0-9a-fA-F]{40}$/)

        await expect(async () =>
            simpleSmartAccount.signTransaction({
                to: zeroAddress,
                value: BigInt(0),
                data: "0x"
            })
        ).rejects.toThrow(SignTransactionNotSupportedBySmartAccount)
    })

    test("Smart account client signMessage", async () => {
        const smartAccountClient = await getSmartAccountClient()

        await expect(async () =>
            smartAccountClient.signMessage({
                message: "hello world"
            })
        ).rejects.toThrowError("Simple account isn't 1271 compliant")
    })

    test("Smart account client signTypedData", async () => {
        const smartAccountClient = await getSmartAccountClient()

        await expect(async () =>
            smartAccountClient.signTypedData({
                domain: {
                    chainId: 1,
                    name: "Test",
                    verifyingContract: zeroAddress
                },
                primaryType: "Test",
                types: {
                    Test: [
                        {
                            name: "test",
                            type: "string"
                        }
                    ]
                },
                message: {
                    test: "hello world"
                }
            })
        ).rejects.toThrowError("Simple account isn't 1271 compliant")
    })

    test("smart account client deploy contract", async () => {
        const smartAccountClient = await getSmartAccountClient()

        await expect(async () =>
            smartAccountClient.deployContract({
                abi: GreeterAbi,
                bytecode: GreeterBytecode
            })
        ).rejects.toThrowError(
            "Simple account doesn't support account deployment"
        )
    })

    test("Smart account client send multiple transactions", async () => {
        const smartAccountClient = await getSmartAccountClient()
        await refillSmartAccount(
            walletClient,
            smartAccountClient.account.address
        )
        const response = await smartAccountClient.sendTransactions({
            transactions: [
                {
                    to: zeroAddress,
                    value: BigInt(0),
                    data: "0x"
                },
                {
                    to: zeroAddress,
                    value: BigInt(0),
                    data: "0x"
                }
            ]
        })
        expectTypeOf(response).toBeString()
        expect(response).toHaveLength(66)
        expect(response).toMatch(/^0x[0-9a-fA-F]{64}$/)
        await waitForNonceUpdate()
    }, 1000000)

    test("Smart account write contract", async () => {
        const smartAccountClient = await getSmartAccountClient({
            account: await getSignerToNaniAccount()
        })

        await refillSmartAccount(
            walletClient,
            smartAccountClient.account.address
        )
        const entryPointContract = getContract({
            abi: EntryPointAbi,
            address: getEntryPoint(),
            client: {
                public: getPublicClient(),
                wallet: smartAccountClient
            }
        })

        const oldBalance = await entryPointContract.read.balanceOf([
            smartAccountClient.account.address
        ])

        const txHash = await entryPointContract.write.depositTo(
            [smartAccountClient.account.address],
            {
                value: BigInt(10)
            }
        )

        expectTypeOf(txHash).toBeString()
        expect(txHash).toHaveLength(66)

        const newBalnce = await entryPointContract.read.balanceOf([
            smartAccountClient.account.address
        ])

        await waitForNonceUpdate()
    }, 1000000)

    test("Smart account client send transaction", async () => {
        const smartAccountClient = await getSmartAccountClient({
            account: await getSignerToNaniAccount()
        })

        await refillSmartAccount(
            walletClient,
            smartAccountClient.account.address
        )
        const response = await smartAccountClient.sendTransaction({
            to: zeroAddress,
            value: BigInt(0),
            data: "0x"
        })
        expectTypeOf(response).toBeString()
        expect(response).toHaveLength(66)
        expect(response).toMatch(/^0x[0-9a-fA-F]{64}$/)
        await waitForNonceUpdate()
    }, 1000000)

    test("Smart account client send transaction with address", async () => {
        const oldSmartAccountClient = await getSmartAccountClient({
            account: await getSignerToNaniAccount()
        })

        const smartAccountClient = await getSmartAccountClient({
            account: await getSignerToNaniAccount({
                address: oldSmartAccountClient.account.address
            })
        })
        await refillSmartAccount(
            walletClient,
            smartAccountClient.account.address
        )

        const response = await smartAccountClient.sendTransaction({
            to: smartAccountClient.account.address,
            data: "0x",
            value: BigInt(0)
        })

        expectTypeOf(response).toBeString()
        expect(response).toHaveLength(66)
        expect(response).toMatch(/^0x[0-9a-fA-F]{64}$/)
        await waitForNonceUpdate()
    }, 1000000)

    test("test prepareUserOperationRequest", async () => {
        const smartAccountClient = await getSmartAccountClient()
        await refillSmartAccount(
            walletClient,
            smartAccountClient.account.address
        )

        const userOperation =
            await smartAccountClient.prepareUserOperationRequest({
                userOperation: {
                    callData: await smartAccountClient.account.encodeCallData({
                        to: zeroAddress,
                        value: BigInt(0),
                        data: "0x"
                    })
                }
            })

        smartAccountClient.sendUserOperation({ userOperation })
    }, 1000000)

    test("smart account client send Transaction with paymaster", async () => {
        const publicClient = getPublicClient()

        const bundlerClient = getBundlerClient()
        const pimlicoPaymaster = getPimlicoPaymasterClient()

        const smartAccountClient = await getSmartAccountClient({
            middleware: {
                sponsorUserOperation: pimlicoPaymaster.sponsorUserOperation
            }
        })

        const response = await smartAccountClient.sendTransaction({
            to: zeroAddress,
            value: BigInt(0),
            data: "0x"
        })

        expectTypeOf(response).toBeString()
        expect(response).toHaveLength(66)
        expect(response).toMatch(/^0x[0-9a-fA-F]{64}$/)

        const transactionReceipt = await publicClient.waitForTransactionReceipt(
            {
                hash: response
            }
        )

        let eventFound = false

        for (const log of transactionReceipt.logs) {
            const event = decodeEventLog({
                abi: EntryPointAbi,
                ...log
            })
            if (event.eventName === "UserOperationEvent") {
                eventFound = true
                const userOperation =
                    await bundlerClient.getUserOperationByHash({
                        hash: event.args.userOpHash
                    })
                expect(userOperation?.userOperation.paymasterAndData).not.toBe(
                    "0x"
                )
            }
        }

        expect(eventFound).toBeTruthy()
        await waitForNonceUpdate()
    }, 1000000)

    test("smart account client send multiple Transactions with paymaster", async () => {
        const publicClient = getPublicClient()

        const bundlerClient = getBundlerClient()
        const pimlicoPaymaster = getPimlicoPaymasterClient()

        const smartAccountClient = await getSmartAccountClient({
            middleware: {
                sponsorUserOperation: pimlicoPaymaster.sponsorUserOperation
            }
        })

        const response = await smartAccountClient.sendTransactions({
            transactions: [
                {
                    to: zeroAddress,
                    value: BigInt(0),
                    data: "0x"
                },
                {
                    to: zeroAddress,
                    value: BigInt(0),
                    data: "0x"
                }
            ]
        })

        expectTypeOf(response).toBeString()
        expect(response).toHaveLength(66)
        expect(response).toMatch(/^0x[0-9a-fA-F]{64}$/)

        const transactionReceipt = await publicClient.waitForTransactionReceipt(
            {
                hash: response
            }
        )

        let eventFound = false

        for (const log of transactionReceipt.logs) {
            const event = decodeEventLog({
                abi: EntryPointAbi,
                ...log
            })
            if (event.eventName === "UserOperationEvent") {
                eventFound = true
                const userOperation =
                    await bundlerClient.getUserOperationByHash({
                        hash: event.args.userOpHash
                    })
                expect(userOperation?.userOperation.paymasterAndData).not.toBe(
                    "0x"
                )
            }
        }

        expect(eventFound).toBeTruthy()
        await waitForNonceUpdate()
    }, 1000000)

    test("verifySignature", async () => {
        const initialEcdsaSmartAccount = await getSignerToNaniAccount()
        const pimlicoPaymaster = getPimlicoPaymasterClient()

        const smartAccountClient = await getSmartAccountClient({
            account: initialEcdsaSmartAccount,
            middleware: {
                sponsorUserOperation: pimlicoPaymaster.sponsorUserOperation
            }
        })

        const message = "hello world"

        const signature = await smartAccountClient.signMessage({
            message
        })

        const publicClient = getPublicClient()
        const isVerified = await publicClient.verifyMessage({
            address: smartAccountClient.account.address,
            message,
            signature
        })

        expect(isVerified).toBeTruthy()
    }, 1000000)
})
