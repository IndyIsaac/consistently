"use client";

import type { FeedItemDto } from "@/app/api/pacts/[id]/feed/route";

const QUICK = ["💪", "🔥", "👏", "😂"];

export function Feed({
  items,
  onReact,
}: {
  items: FeedItemDto[];
  onReact: (itemId: string, emoji: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-4">
      {items.map((item) => (
        <li key={item.id} className="rounded-2xl border border-neutral-200 p-4">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm">
              {item.authorName && <span className="font-medium">{item.authorName} </span>}
              <span className={item.type === "bot" ? "text-neutral-500" : ""}>{item.body}</span>
            </p>
            <time className="shrink-0 text-xs text-neutral-400">
              {new Date(item.createdAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          </div>

          {item.photoUrl && (
            <img src={item.photoUrl} alt="" className="mt-3 w-full rounded-xl object-cover" />
          )}

          <div className="mt-3 flex flex-wrap gap-1">
            {item.reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => onReact(item.id, r.emoji)}
                className={`rounded-full px-2 py-1 text-xs ${
                  r.mine ? "bg-black text-white" : "bg-neutral-100"
                }`}
              >
                {r.emoji} {r.count}
              </button>
            ))}
            {QUICK.filter((e) => !item.reactions.some((r) => r.emoji === e)).map((e) => (
              <button
                key={e}
                onClick={() => onReact(item.id, e)}
                className="rounded-full px-2 py-1 text-xs opacity-30 hover:opacity-100"
              >
                {e}
              </button>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
