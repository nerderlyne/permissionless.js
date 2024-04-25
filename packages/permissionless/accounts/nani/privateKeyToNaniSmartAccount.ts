import { type Chain, type Client, type Hex, type Transport } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import type { ENTRYPOINT_ADDRESS_V06_TYPE, Prettify } from "../../types"
import {
    type NaniSmartAccount,
    type SignerToNaniSmartAccountParameters,
    signerToNaniSmartAccount
} from "./signerToNaniSmartAccount"

export type PrivateKeyToNaniSmartAccountParameters<
    entryPoint extends ENTRYPOINT_ADDRESS_V06_TYPE
> = Prettify<
    {
        privateKey: Hex
    } & Omit<SignerToNaniSmartAccountParameters<entryPoint>, "signer">
>

/**
 * @description Creates an Nani Account from a private key.
 *
 * @returns A Private Key Nani Account.
 */
export async function privateKeyToNaniSmartAccount<
    entryPoint extends ENTRYPOINT_ADDRESS_V06_TYPE,
    TTransport extends Transport = Transport,
    TChain extends Chain | undefined = Chain | undefined
>(
    client: Client<TTransport, TChain, undefined>,
    { privateKey, ...rest }: PrivateKeyToNaniSmartAccountParameters<entryPoint>
): Promise<NaniSmartAccount<entryPoint, TTransport, TChain>> {
    const privateKeyAccount = privateKeyToAccount(privateKey)

    return signerToNaniSmartAccount(client, {
        signer: privateKeyAccount,
        ...rest
    })
}
