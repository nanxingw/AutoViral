export function Ruler({
  duration,
  pxPerSecond,
}: {
  duration: number;
  pxPerSecond: number;
}) {
  const ticks = Array.from(
    { length: Math.ceil(duration) + 1 },
    (_, i) => i,
  );
  return (
    <div
      className="timeline-ruler"
      style={{
        width: duration * pxPerSecond,
        position: "relative",
        height: 24,
      }}
    >
      {ticks.map((t) => (
        <div
          key={t}
          style={{
            position: "absolute",
            left: t * pxPerSecond,
            top: 0,
            bottom: 0,
            borderLeft: "1px solid var(--border)",
            paddingLeft: 4,
            fontSize: 10,
            fontFamily: "var(--font-mono)",
          }}
        >
          {t % 5 === 0 ? `${t}s` : ""}
        </div>
      ))}
    </div>
  );
}
