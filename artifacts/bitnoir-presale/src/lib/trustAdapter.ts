import {
  BaseMessageSignerWalletAdapter,
  scopePollingDetectionStrategy,
  type SendTransactionOptions,
  WalletAccountError,
  WalletConnectionError,
  WalletDisconnectedError,
  WalletDisconnectionError,
  WalletError,
  WalletNotConnectedError,
  WalletNotReadyError,
  WalletPublicKeyError,
  WalletReadyState,
  WalletSendTransactionError,
  WalletSignMessageError,
  WalletSignTransactionError,
  type WalletName,
} from '@solana/wallet-adapter-base';
import { TrustWalletAdapter, TrustWalletName } from '@solana/wallet-adapter-trust';
import {
  type Connection,
  PublicKey,
  type Transaction,
  type TransactionSignature,
  type VersionedTransaction,
} from '@solana/web3.js';
import { extractSignatureBytes, getTrustSolanaProvider } from './solana';

const TRUST_ICON = new TrustWalletAdapter().icon;

function normalizeTrustPublicKey(rawPk: any): PublicKey {
  if (!rawPk) {
    throw new WalletAccountError();
  }
  if (rawPk instanceof PublicKey) {
    return rawPk;
  }
  if (typeof rawPk === 'string') {
    return new PublicKey(rawPk);
  }
  if (typeof rawPk.toBytes === 'function') {
    return new PublicKey(rawPk.toBytes());
  }
  if (typeof rawPk.toBase58 === 'function') {
    return new PublicKey(rawPk.toBase58());
  }
  return new PublicKey(rawPk);
}

export class ResilientTrustWalletAdapter extends BaseMessageSignerWalletAdapter {
  name: WalletName<'Trust'> = TrustWalletName;
  url = 'https://trustwallet.com';
  icon = TRUST_ICON;
  readonly supportedTransactionVersions = null;

  private _connecting = false;
  private _wallet: any = null;
  private _publicKey: PublicKey | null = null;
  private _readyState: WalletReadyState;

  constructor() {
    super();
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      this._readyState = WalletReadyState.Unsupported;
      return;
    }

    if (getTrustSolanaProvider()) {
      this._readyState = WalletReadyState.Installed;
    } else {
      this._readyState = WalletReadyState.NotDetected;
      scopePollingDetectionStrategy(() => {
        if (getTrustSolanaProvider()) {
          this._readyState = WalletReadyState.Installed;
          this.emit('readyStateChange', this._readyState);
          return true;
        }
        return false;
      });
    }
  }

  get publicKey(): PublicKey | null {
    return this._publicKey;
  }

  get connecting(): boolean {
    return this._connecting;
  }

  get connected(): boolean {
    return Boolean(this._wallet && (this._wallet.isConnected ?? Boolean(this._publicKey)));
  }

  get readyState(): WalletReadyState {
    if (this._readyState !== WalletReadyState.Installed && typeof window !== 'undefined' && getTrustSolanaProvider()) {
      this._readyState = WalletReadyState.Installed;
    }
    return this._readyState;
  }

  private _disconnected = () => {
    const wallet = this._wallet;
    if (wallet) {
      if (typeof wallet.off === 'function') {
        wallet.off('disconnect', this._disconnected);
      } else if (typeof wallet.removeListener === 'function') {
        wallet.removeListener('disconnect', this._disconnected);
      }
      this._wallet = null;
      this._publicKey = null;
      this.emit('error', new WalletDisconnectedError());
      this.emit('disconnect');
    }
  };

  async connect(): Promise<void> {
    try {
      if (this.connected || this.connecting) return;
      const wallet = getTrustSolanaProvider();
      if (!wallet) {
        throw new WalletNotReadyError();
      }
      this._readyState = WalletReadyState.Installed;
      this._connecting = true;

      if (!wallet.isConnected || !wallet.publicKey) {
        try {
          await wallet.connect();
        } catch (error: any) {
          throw new WalletConnectionError(error?.message, error);
        }
      }

      if (!wallet.publicKey) {
        throw new WalletAccountError();
      }

      let publicKey: PublicKey;
      try {
        publicKey = normalizeTrustPublicKey(wallet.publicKey);
      } catch (error: any) {
        throw new WalletPublicKeyError(error?.message, error);
      }

      if (typeof wallet.on === 'function') {
        wallet.on('disconnect', this._disconnected);
      }
      this._wallet = wallet;
      this._publicKey = publicKey;
      this.emit('connect', publicKey);
    } catch (error: any) {
      this.emit('error', error);
      throw error;
    } finally {
      this._connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    const wallet = this._wallet;
    if (wallet) {
      if (typeof wallet.off === 'function') {
        wallet.off('disconnect', this._disconnected);
      } else if (typeof wallet.removeListener === 'function') {
        wallet.removeListener('disconnect', this._disconnected);
      }
      this._wallet = null;
      this._publicKey = null;
      try {
        if (typeof wallet.disconnect === 'function') {
          await wallet.disconnect();
        }
      } catch (error: any) {
        this.emit('error', new WalletDisconnectionError(error?.message, error));
      }
    }
    this.emit('disconnect');
  }

  async sendTransaction(
    transaction: Transaction | VersionedTransaction,
    connection: Connection,
    options: SendTransactionOptions = {},
  ): Promise<TransactionSignature> {
    try {
      const wallet = this._wallet;
      if (!wallet) throw new WalletNotConnectedError();

      try {
        const { signers, ...sendOptions } = options;
        const prepared = await this.prepareTransaction(transaction as Transaction, connection, sendOptions);
        if (signers?.length && 'partialSign' in prepared) {
          prepared.partialSign(...signers);
        }
        sendOptions.preflightCommitment = sendOptions.preflightCommitment || connection.commitment;

        if (typeof wallet.signAndSendTransaction === 'function') {
          const result = await wallet.signAndSendTransaction(prepared, sendOptions);
          const signature = typeof result === 'string' ? result : result?.signature;
          if (!signature) {
            throw new WalletSendTransactionError('Trust Wallet did not return a transaction signature.');
          }
          return signature;
        }

        if (typeof wallet.signTransaction === 'function') {
          const signedTx = (await wallet.signTransaction(prepared)) || prepared;
          return await connection.sendRawTransaction(signedTx.serialize(), sendOptions);
        }

        throw new WalletSendTransactionError('Trust Wallet transaction signing is unavailable.');
      } catch (error: any) {
        if (error instanceof WalletError) throw error;
        throw new WalletSendTransactionError(error?.message, error);
      }
    } catch (error: any) {
      this.emit('error', error);
      throw error;
    }
  }

  async signTransaction<T extends Transaction>(transaction: T): Promise<T> {
    try {
      const wallet = this._wallet;
      if (!wallet) throw new WalletNotConnectedError();
      try {
        return (await wallet.signTransaction(transaction)) || transaction;
      } catch (error: any) {
        throw new WalletSignTransactionError(error?.message, error);
      }
    } catch (error: any) {
      this.emit('error', error);
      throw error;
    }
  }

  async signAllTransactions<T extends Transaction>(transactions: T[]): Promise<T[]> {
    try {
      const wallet = this._wallet;
      if (!wallet) throw new WalletNotConnectedError();
      try {
        if (typeof wallet.signAllTransactions === 'function') {
          return (await wallet.signAllTransactions(transactions)) || transactions;
        }
        const signed: T[] = [];
        for (const tx of transactions) {
          signed.push((await wallet.signTransaction(tx)) || tx);
        }
        return signed;
      } catch (error: any) {
        throw new WalletSignTransactionError(error?.message, error);
      }
    } catch (error: any) {
      this.emit('error', error);
      throw error;
    }
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    try {
      const wallet = this._wallet;
      if (!wallet) throw new WalletNotConnectedError();
      try {
        const res = await wallet.signMessage(message);
        const bytes = extractSignatureBytes(res);
        if (!bytes || bytes.length !== 64) {
          throw new Error('Trust Wallet returned an invalid signature.');
        }
        return bytes;
      } catch (error: any) {
        throw new WalletSignMessageError(error?.message, error);
      }
    } catch (error: any) {
      this.emit('error', error);
      throw error;
    }
  }
}
