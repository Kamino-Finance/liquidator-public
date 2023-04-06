import { struct, u32, u8 } from '@project-serum/borsh';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';

export function createAddExtraComputeUnitsTransaction(owner: PublicKey, units: number): TransactionInstruction {
  const computeBudgetProgramId = new PublicKey('ComputeBudget111111111111111111111111111111');
  const params = { instruction: 0, units, fee: 0 };
  const layout = struct([u8('instruction'), u32('units'), u32('fee')]);
  const data = Buffer.alloc(layout.span);
  layout.encode(params, data);
  const keys = [{ pubkey: owner, isSigner: false, isWritable: false }];
  const unitsIx = new TransactionInstruction({
    keys,
    programId: computeBudgetProgramId,
    data,
  });

  return unitsIx;
}
