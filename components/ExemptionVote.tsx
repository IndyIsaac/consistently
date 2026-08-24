"use client";

export function ExemptionVote({
  requesterName,
  reason,
  approvals,
  needed,
  canVote,
  onVote,
}: {
  requesterName: string;
  reason: string;
  approvals: number;
  needed: number;
  canVote: boolean;
  onVote: (approve: boolean) => void;
}) {
  return (
    <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
      <p className="text-sm">
        <span className="font-medium">{requesterName}</span> is asking to be let off.
      </p>
      <p className="mt-1 text-sm italic text-neutral-700">&ldquo;{reason}&rdquo;</p>
      <p className="mt-2 text-xs text-neutral-500">
        {approvals} of {needed} needed
      </p>
      {canVote && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => onVote(true)}
            className="rounded-full bg-black px-4 py-2 text-sm text-white"
          >
            Let them off
          </button>
          <button
            onClick={() => onVote(false)}
            className="rounded-full border border-neutral-300 px-4 py-2 text-sm"
          >
            They still owe
          </button>
        </div>
      )}
    </div>
  );
}
