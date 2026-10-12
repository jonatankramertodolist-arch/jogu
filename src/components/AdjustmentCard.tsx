import { applyAdjustment, rejectAdjustment, undoAdjustment } from '../lib/actions';
import { describeSessionOp, describeWeekOp } from '../lib/patch';
import { useAppState } from '../lib/store';
import type { Adjustment } from '../lib/types';
import { Button, Pill } from './ui';

export default function AdjustmentCard({ adjustment }: { adjustment: Adjustment }) {
  const state = useAppState();
  const weeks = state.plan?.weeks ?? [];
  const total = adjustment.sessionOps.length + adjustment.weekOps.length;

  const lines = [
    ...adjustment.sessionOps.map((op) => ({
      text: describeSessionOp(op, adjustment.undo?.sessions ?? state.sessions),
      why: op.why,
    })),
    ...adjustment.weekOps.map((op) => ({
      text: describeWeekOp(op, adjustment.undo?.weeks ?? weeks),
      why: op.why,
    })),
  ];

  return (
    <div className="mt-2 rounded-2xl border border-swim/25 bg-swim/[0.06] p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold tracking-wide text-swim uppercase">
          Föreslagen ändring
        </span>
        {adjustment.status === 'applied' && <Pill tone="good">Genomförd</Pill>}
        {adjustment.status === 'rejected' && <Pill tone="neutral">Avslagen</Pill>}
        {adjustment.status === 'undone' && <Pill tone="neutral">Ångrad</Pill>}
      </div>

      {adjustment.reasoning && (
        <p className="mt-2 text-[13px] leading-relaxed text-muted">{adjustment.reasoning}</p>
      )}

      <ul className="mt-3 space-y-2.5">
        {lines.map((line, index) => (
          <li key={index} className="border-l-2 border-swim/40 pl-3">
            <p className="text-[13.5px] leading-snug font-medium text-white">{line.text}</p>
            {line.why && <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{line.why}</p>}
          </li>
        ))}
      </ul>

      {adjustment.status === 'pending' && (
        <div className="mt-4 flex gap-2">
          <Button className="flex-1" onClick={() => applyAdjustment(adjustment.id)}>
            Godkänn {total > 1 ? `alla ${total}` : ''}
          </Button>
          <Button variant="secondary" onClick={() => rejectAdjustment(adjustment.id)}>
            Avslå
          </Button>
        </div>
      )}

      {adjustment.status === 'applied' && (
        <button
          type="button"
          onClick={() => undoAdjustment(adjustment.id)}
          className="mt-3 text-[13px] font-medium text-muted underline underline-offset-2"
        >
          Ångra ändringen
        </button>
      )}
    </div>
  );
}
