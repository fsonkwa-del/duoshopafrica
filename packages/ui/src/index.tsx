import type { ReactNode } from "react";
export function Notice({ children }: { children: ReactNode }) {
  return <aside className="notice">{children}</aside>;
}
export function Feature({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <article className="feature">
      <h2>{title}</h2>
      <p>{children}</p>
    </article>
  );
}
